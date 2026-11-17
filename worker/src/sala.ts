// Uma sala = um Durable Object. O servidor guarda a sala inteira, decide tudo que depende de segredo
// (sorteio, impostores, apuração, chute, pontos) e manda a cada jogador só a parte que ele pode ver.
import temas from "../../public/data/temas.json";
import { setThemes, THEMES } from "../../src/game/data";
import {
  activeIds,
  catsOf,
  elimPatch,
  guessOk,
  guessesOf,
  isElim,
  kickPatch,
  liveIds,
  maxImps,
  newRoomDoc,
  newRoundPatch,
  outcome,
  picksOf,
  ranking,
  roundKey,
  scorePatch,
  stageKey,
  tallyVotes,
  votesPerPlayer,
  VOTE_TIME,
  AUSENTE_S,
} from "../../src/game/rules";
import type { Patch, Room } from "../../src/game/types";
import { CHAT_SLOW_MS, chatEspera } from "../../src/game/chat";
import { dec, deepMerge, now } from "../../src/game/util";
import { resumoPublico, vistaPara } from "./vista";

setThemes((temas as { themes: never }).themes);

const LIMPEZA = 6 * 3600_000;
const CHAT_MAX_LEN = 140;
const CHAT_MAX_PER_PLAYER = 30;
const ID = /^[a-z0-9]{6,24}$/i;

class Erro extends Error {
  constructor(public codigo: string, msg: string) {
    super(msg);
  }
}
const nao = (c: string, m: string): never => {
  throw new Erro(c, m);
};

const voteDone = (picks: string[], k: number): boolean => picks.includes("none") || picks.length >= k;

async function hash(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const limpaNick = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 18);

export class Sala {
  ctx: DurableObjectState;
  env: Env;
  room: Room | null = null;
  keys: Record<string, string> = {};
  /** limite de mensagens por conexão (em memória) */
  taxa = new Map<WebSocket, { t: number; n: number }>();
  naLista = false;
  /** jogador → desde quando está sem nenhuma conexão (guardado no storage: o objeto pode hibernar e perder a memória) */
  fora = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.blockConcurrencyWhile(async () => {
      const [r, k, f] = await Promise.all([this.ctx.storage.get("room"), this.ctx.storage.get("keys"), this.ctx.storage.get("fora")]);
      this.room = (r as Room | undefined) ?? null;
      this.keys = (k as Record<string, string> | undefined) ?? {};
      this.fora = new Map(Object.entries((f as Record<string, number> | undefined) ?? {}));
    });
  }

  /* ---------- entrada ---------- */
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.pathname.split("/")[2];
    const me = url.searchParams.get("me") || "";

    if (url.pathname.endsWith("/info")) {
      const ok = !!this.room && this.room.status !== "closed";
      return new Response(JSON.stringify({ exists: ok, room: ok ? vistaPara(this.room!, me) : null }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    if (req.headers.get("upgrade") !== "websocket") return new Response("use WebSocket", { status: 426 });

    const k = url.searchParams.get("k") || "";
    if (!ID.test(me) || k.length < 12) return new Response("identidade inválida", { status: 400 });

    const par = new WebSocketPair();
    const [cli, srv] = [par[0], par[1]];
    const aviso = (t: string) => {
      this.ctx.acceptWebSocket(srv, ["x"]);
      srv.send(JSON.stringify({ t }));
      srv.close(1000, t);
      return new Response(null, { status: 101, webSocket: cli });
    };

    const criar = url.searchParams.get("create") === "1";
    if (criar) {
      if (this.room && this.room.status !== "closed") return aviso("exists");
      const nick = limpaNick(url.searchParams.get("nick"));
      if (!nick) return new Response("apelido", { status: 400 });
      this.keys = {};
      this.room = newRoomDoc(code, me, nick);
      // pública ou privada é escolhida na criação (privada não aparece na lista da home)
      if (url.searchParams.get("priv") === "1") this.room.settings.priv = true;
      this.naLista = false;
    } else if (!this.room || this.room.status === "closed") return aviso("none");

    // cada jogador tem um segredo só dele: quem não o tem não vira esse jogador
    const h = await hash(k);
    if (this.keys[me] && this.keys[me] !== h) return aviso("denied");
    this.keys[me] = h;

    this.ctx.acceptWebSocket(srv, [me]);
    srv.serializeAttachment({ c: crypto.randomUUID() });
    this.fora.delete(me);
    await this.persistir();
    this.enviar(srv, me);
    if (criar) {
      this.avisaLista();
      await this.agendar();
    }
    return new Response(null, { status: 101, webSocket: cli });
  }

  /* ---------- mensagens ---------- */
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 4000) return;
    if (raw === "ping") return void ws.send("pong");
    const tk = this.taxa.get(ws) ?? { t: now(), n: 0 };
    if (now() - tk.t > 1000) {
      tk.t = now();
      tk.n = 0;
    }
    if (++tk.n > 25) return;
    this.taxa.set(ws, tk);

    let m: { t?: string; id?: number; p?: Patch; a?: string; d?: Record<string, unknown> };
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const me = this.ctx.getTags(ws)[0];
    if (!this.room || !me || me === "x") return;
    try {
      if (m.t === "patch") this.patch(me, m.p || {});
      else if (m.t === "do") this.acao(me, String(m.a), m.d || {});
      else return;
      this.assentar();
      this.room.updatedAt = now();
      await this.persistir();
      this.difundir();
      this.avisaLista();
      await this.agendar();
      ws.send(JSON.stringify({ t: "ack", id: m.id }));
    } catch (e) {
      const er = e instanceof Erro ? e : new Erro("erro", "Erro no servidor.");
      if (!(e instanceof Erro)) console.error(e);
      ws.send(JSON.stringify({ t: "err", id: m.id, c: er.codigo, m: er.message }));
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.taxa.delete(ws);
    const me = this.ctx.getTags(ws)[0];
    try {
      ws.close(1000, "tchau");
    } catch {
      /* já fechada */
    }
    if (me && me !== "x" && !this.online(me, ws)) {
      this.fora.set(me, now());
      await this.ctx.storage.put("fora", Object.fromEntries(this.fora));
      await this.agendar();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /* ---------- presença ---------- */
  /** Tem alguma conexão (fora a que está fechando, comparada pela etiqueta de cada conexão). */
  online(id: string, fechando?: WebSocket): boolean {
    // WebSocket do Workers tem anexo por conexão (deserializeAttachment), que o tipo do DOM não conhece
    const etq = (w: WebSocket) => ((w as unknown as { deserializeAttachment(): { c?: string } | null }).deserializeAttachment())?.c;
    const sai = fechando ? etq(fechando) : undefined;
    return this.ctx.getWebSockets(id).some((w: WebSocket) => !fechando || etq(w) !== sai);
  }

  /** Sem conexão há AUSENTE_S segundos: não segura voto nem vez. Sem registro, começa a contar agora. */
  ausente(id: string): boolean {
    if (this.online(id)) return false;
    if (!this.fora.has(id)) this.fora.set(id, now());
    return now() - this.fora.get(id)! >= AUSENTE_S * 1000;
  }

  /** Anfitrião sumiu: passa o posto para alguém conectado (senão ninguém pula vez nem começa rodada). */
  trocaAnfitriao(): void {
    const room = this.room!;
    if (!this.ausente(room.host) && room.players?.[room.host]) return;
    const novo = activeIds(room).find((id) => this.online(id));
    if (novo && novo !== room.host) room.host = novo;
  }

  /* ---------- escritas do cliente ---------- */
  /** Patch genérico do cliente: só o que não revela segredo e só no que a pessoa pode mexer. */
  patch(me: string, p: Patch): void {
    const room = this.room!;
    const ok = new Set(["players", "settings", "chat", "votes", "updatedAt"]);
    for (const k of Object.keys(p)) if (!ok.has(k)) nao("proibido", "Essa alteração não é permitida.");
    const host = room.host === me;
    const membro = !!room.players?.[me];

    if (p.players) {
      for (const [id, v] of Object.entries(p.players as Record<string, unknown>)) {
        if (id !== me || !v || typeof v !== "object") nao("proibido", "Só dá para mexer no seu próprio jogador.");
        const nick = limpaNick((v as { nick?: unknown }).nick);
        if (!nick) nao("apelido", "Escreva um apelido.");
        if (membro) room.players[me]!.nick = nick;
        else {
          if (activeIds(room).length >= 15) nao("cheia", "Essa sala já está cheia.");
          const seat = Math.max(-1, ...Object.values(room.players || {}).filter((x) => !!x).map((x) => x!.seat)) + 1;
          room.players[me] = { nick, seat, at: now() };
        }
      }
    }
    if (p.settings) {
      if (!host || room.status !== "lobby") nao("proibido", "Só o anfitrião muda as regras, na sala de espera.");
      const s = p.settings as Record<string, unknown>;
      const set = room.settings as unknown as Record<string, unknown>;
      const bool = (k: string) => {
        if (k in s) set[k] = !!s[k];
      };
      ["chaos", "hint", "guess"].forEach(bool);
      // "Infiltrado" e "Rodada caótica" viraram o CAOS: cliente antigo ainda manda "inf"; o campo legado sempre zera
      if ("chaos" in s || "inf" in s) {
        set.chaos = !!(("chaos" in s ? s.chaos : s.inf) ?? false);
        set.inf = false;
      }
      const int = (k: string, lo: number, hi: number) => {
        if (k in s) set[k] = Math.max(lo, Math.min(hi, Math.round(Number(s[k]) || lo)));
      };
      int("imps", 1, 3);
      int("rounds", 1, 3);
      if ("clueTime" in s) set.clueTime = [0, 30, 60, 120].includes(Number(s.clueTime)) ? Number(s.clueTime) : 60;
      if ("voteMode" in s) set.voteMode = s.voteMode === "elim" ? "elim" : "multi";
      if ("cats" in s && Array.isArray(s.cats)) set.cats = (s.cats as unknown[]).filter((c): c is string => typeof c === "string" && !!THEMES[c]);
    }
    if (p.chat) {
      if ((room.status !== "clues" && room.status !== "vote") || !liveIds(room).includes(me)) nao("proibido", "Só quem está jogando pode escrever agora.");
      const rk = roundKey(room);
      const msgs = (p.chat as Record<string, Record<string, { t?: unknown }>>)[rk];
      if (!msgs) nao("proibido", "Mensagem inválida.");
      room.chat ||= {};
      room.chat[rk] ||= {};
      const sala = room.chat[rk]!;
      for (const [id, msg] of Object.entries(msgs)) {
        if (!id.startsWith(me + "-") || !msg || typeof msg.t !== "string") nao("proibido", "Mensagem inválida.");
        const t = (msg.t as string).replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN);
        if (!t) nao("vazio", "Escreva uma mensagem.");
        if (Object.values(sala).filter((x) => x?.u === me).length >= CHAT_MAX_PER_PLAYER) nao("limite", "Limite de mensagens da rodada.");
        // slowmode: o relógio é o do servidor; mensagem barrada não entra no chat nem conta como fala
        const falta = chatEspera(sala, me, now());
        if (falta > 0) nao("lento", `Espere ${Math.ceil(falta / 1000)}s para escrever de novo (intervalo de ${CHAT_SLOW_MS / 1000}s).`);
        sala[id] = { u: me, t, at: now() };
      }
    }
    if (p.votes) {
      if (room.status !== "vote" || !liveIds(room).includes(me)) nao("proibido", "Você não vota agora.");
      const sk = stageKey(room);
      const mine = (p.votes as Record<string, Record<string, unknown>>)[sk]?.[me];
      if (typeof mine !== "string") nao("proibido", "Voto inválido.");
      const live = liveIds(room);
      const k = votesPerPlayer(room);
      const picks = [...new Set(picksOf(mine as string))].filter((x) => x === "none" || live.includes(x)).slice(0, k);
      if (!picks.length) nao("vazio", "Escolha um suspeito.");
      room.votes[sk] ||= {};
      room.votes[sk][me] = picks.includes("none") ? "none" : picks.join(",");
    }
  }

  /** Ações que dependem de segredo ou de regra: o servidor calcula, o cliente só pede. */
  acao(me: string, a: string, d: Record<string, unknown>): void {
    const room = this.room!;
    const host = room.host === me;
    const soHost = () => {
      if (!host) nao("proibido", "Só o anfitrião faz isso.");
    };
    const mescla = (p: Patch | null) => p && deepMerge(room as never, p);
    switch (a) {
      case "start":
      case "again": {
        soHost();
        if (room.status !== "lobby" && room.status !== "result") nao("estado", "Agora não dá para começar.");
        if (room.status === "result") mescla(scorePatch(room, true));
        if (activeIds(room).length < 3) nao("poucos", "Precisa de pelo menos 3 jogadores.");
        if (!catsOf(room).length) nao("tema", "Escolha um tema.");
        room.settings.imps = Math.min(room.settings.imps, maxImps(activeIds(room).length));
        mescla(newRoundPatch(room));
        break;
      }
      case "clue":
      case "skip":
      case "timeout": {
        if (room.status !== "clues" || !room.round) nao("estado", "Agora não são as pistas.");
        const r = room.round!;
        const sk = stageKey(room);
        const i = Object.keys(room.clues?.[sk] || {}).length;
        const vez = r.order[i];
        let t: string;
        if (a === "clue") {
          if (vez !== me) nao("vez", "Não é a sua vez.");
          t = String(d.t ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
          if (!t) nao("vazio", "Escreva uma pista.");
        } else {
          soHost();
          t = a === "skip" ? "(pulou a vez)" : "(tempo esgotado)";
        }
        room.clues ||= {};
        room.clues[sk] ||= {};
        room.clues[sk][i] = { u: vez, t };
        room.turnAt = now();
        if (i === r.order.length - 1) room.status = "vote";
        break;
      }
      case "tovote":
        soHost();
        if (room.status !== "clues") nao("estado", "Agora não são as pistas.");
        room.status = "vote";
        break;
      case "close":
        soHost();
        if (room.status !== "vote") nao("estado", "Agora não é a votação.");
        this.fechaVotacao();
        break;
      case "guess": {
        if (room.status !== "result") nao("estado", "Agora não é o chute.");
        const o = outcome(room, (id) => id);
        if (!o.pending || !o.guessers?.includes(me) || guessesOf(room)[me]) nao("proibido", "Você não pode chutar agora.");
        const t = String(d.t ?? "").trim().slice(0, 40);
        if (!t) nao("vazio", "Escreva seu chute.");
        const ok = guessOk(t, dec(room.round!.secret), room.round!.cat);
        mescla({ guess: { [roundKey(room)]: { [me]: { t, ok } } } });
        break;
      }
      case "endYes": {
        soHost();
        if (room.status === "result") mescla(scorePatch(room, true));
        const list = ranking(room).map(({ u, n, p }) => ({ u, n, p }));
        room.status = "podium";
        room.final = { at: now(), list };
        break;
      }
      case "replay":
        soHost();
        room.status = "lobby";
        room.scores = null;
        room.scored = null;
        room.final = null;
        break;
      case "lobby":
        soHost();
        room.status = "lobby";
        break;
      case "kick": {
        soHost();
        const id = String(d.id || "");
        if (id === me || !room.players?.[id]) nao("proibido", "Esse jogador não está na sala.");
        mescla(kickPatch(room, id));
        break;
      }
      case "leave": {
        if (!room.players?.[me]) break;
        const rest = activeIds(room).filter((id) => id !== me);
        mescla(kickPatch(room, me));
        if (room.host === me && rest.length) room.host = rest.find((id) => this.online(id)) || rest[0];
        if (!rest.length) room.status = "closed";
        break;
      }
      default:
        nao("acao", "Ação desconhecida.");
    }
  }

  fechaVotacao(): void {
    const room = this.room!;
    deepMerge(room as never, isElim(room) ? elimPatch(room) : { status: "result", result: { [roundKey(room)]: tallyVotes(room) }, updatedAt: now() });
  }

  /** Depois de cada mudança: fecha a votação quando todos votaram e soma os pontos quando a rodada acaba de vez. */
  assentar(): void {
    const room = this.room!;
    if (room.status === "closed") return;
    this.trocaAnfitriao();
    for (let guarda = 0; guarda < 8; guarda++) {
      // vez de pista de quem está ausente: passa sozinha
      if (room.status === "clues" && room.round) {
        const sk = stageKey(room);
        const i = Object.keys(room.clues?.[sk] || {}).length;
        const vez = room.round.order[i];
        if (vez && this.ausente(vez)) {
          room.clues ||= {};
          room.clues[sk] ||= {};
          room.clues[sk][i] = { u: vez, t: "(ausente)" };
          room.turnAt = now();
          if (i === room.round.order.length - 1) room.status = "vote";
          continue;
        }
      }
      if (room.status === "vote" && room.round) {
        room.voteAt ||= now();
        const vs = room.votes?.[stageKey(room)] || {};
        const k = votesPerPlayer(room);
        const vivos = liveIds(room);
        // quem caiu da sala não trava: fecha quando todos os conectados votaram (e pelo menos um votou)
        const todos = vivos.every((id) => voteDone(picksOf(vs[id]), k) || !room.players?.[id] || this.ausente(id));
        const alguem = vivos.some((id) => voteDone(picksOf(vs[id]), k));
        const prazo = now() >= room.voteAt + VOTE_TIME * 1000;
        if ((todos && (alguem || vivos.every((id) => this.ausente(id)))) || prazo) {
          this.fechaVotacao();
          room.voteAt = null;
          continue;
        }
      }
      if (room.status === "result") {
        const sc = scorePatch(room);
        if (sc) {
          deepMerge(room as never, sc);
          continue;
        }
      }
      break;
    }
    if (room.status !== "vote" && room.voteAt) room.voteAt = null;
  }

  /* ---------- saída ---------- */
  enviar(ws: WebSocket, me: string): void {
    try {
      ws.send(JSON.stringify({ t: "room", r: vistaPara(this.room!, me) }));
    } catch {
      /* conexão caiu */
    }
  }

  difundir(): void {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const me = this.ctx.getTags(ws)[0];
      if (me && me !== "x") this.enviar(ws, me);
    }
  }

  async persistir(): Promise<void> {
    if (this.room?.status === "closed") {
      for (const ws of this.ctx.getWebSockets()) this.enviar(ws, this.ctx.getTags(ws)[0]);
      await this.ctx.storage.deleteAll();
      this.room = null;
      this.keys = {};
      return;
    }
    for (const id of this.fora.keys()) if (!this.room?.players?.[id]) this.fora.delete(id);
    await this.ctx.storage.put({ room: this.room, keys: this.keys, fora: Object.fromEntries(this.fora) });
  }

  avisaLista(): void {
    const room = this.room;
    const lobby = !!room && room.status === "lobby";
    if (!lobby && !this.naLista) return;
    this.naLista = lobby;
    const code = room?.code || "";
    const corpo = JSON.stringify({ code, room: lobby ? resumoPublico(room!) : null });
    this.ctx.waitUntil(
      this.env.LISTA.get(this.env.LISTA.idFromName("global")).fetch("https://lista/atualiza", { method: "POST", body: corpo }).catch(() => {}),
    );
  }

  /* ---------- relógio ---------- */
  prazoDaVez(): number | null {
    const r = this.room;
    const t = r?.settings?.clueTime || 0;
    return r && t && r.status === "clues" && r.turnAt ? r.turnAt + t * 1000 + 1000 : null;
  }

  async agendar(): Promise<void> {
    if (!this.room) return;
    const proximos = [this.room.updatedAt + LIMPEZA];
    const v = this.prazoDaVez();
    if (v) proximos.push(v);
    if (this.room.status === "vote") proximos.push((this.room.voteAt || now()) + VOTE_TIME * 1000 + 500);
    for (const [id, t] of this.fora) if (this.room.players?.[id] && !this.online(id)) proximos.push(Math.max(now(), t + AUSENTE_S * 1000 + 500));
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, Math.min(...proximos)));
  }

  async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (now() - room.updatedAt > LIMPEZA) {
      room.status = "closed";
      await this.persistir();
      this.avisaLista();
      return;
    }
    const antes = JSON.stringify(room);
    const v = this.prazoDaVez();
    if (v && now() >= v) {
      const r = room.round!;
      const sk = stageKey(room);
      const i = Object.keys(room.clues?.[sk] || {}).length;
      if (r.order[i]) {
        room.clues[sk] ||= {};
        room.clues[sk][i] = { u: r.order[i], t: "(tempo esgotado)" };
        room.turnAt = now();
        if (i === r.order.length - 1) room.status = "vote";
      }
    }
    // prazo da votação, ausentes e anfitrião que sumiu
    this.assentar();
    if (JSON.stringify(room) !== antes) {
      room.updatedAt = now();
      await this.persistir();
      this.difundir();
      this.avisaLista();
    }
    await this.agendar();
  }
}
