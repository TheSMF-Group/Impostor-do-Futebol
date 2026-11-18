// Regras puras da partida (sem DOM): sorteio da rodada, votos, resultado e chute.
import { THEME_ORDER, THEMES, isPlayerTheme } from "./data.ts";
import { caosLigado } from "./caos.ts";
import { gerarDica } from "./dica.ts";

export { caosLigado };
import type { Card, Guess, Out, Patch, RankRow, Room, VoteResult } from "./types.ts";
import { chatKey } from "./chat.ts";
import { enc, esc, norm, now, pick, shuffle } from "./util.ts";

export const activeIds = (r: Pick<Room, "players">): string[] =>
  Object.entries(r.players || {})
    .filter((e): e is [string, NonNullable<(typeof e)[1]>] => !!e[1])
    .sort((a, b) => a[1].seat - b[1].seat)
    .map(([k]) => k);

export const maxImps = (n: number): number => Math.max(1, Math.min(3, Math.ceil(n / 2) - 1));

export const roundKey = (r: Pick<Room, "rn">): string => "r" + r.rn;

/** Temas marcados que existem nos dados. */
export const catsOf = (r: Room | null): string[] => (r?.settings?.cats || []).filter((k) => THEMES[k]);

/** Chave das pistas e votos da etapa atual: "r3" na 1ª etapa, "r3s2" na 2ª da eliminação. */
export const stageKey = (r: Pick<Room, "rn" | "round">): string => {
  const st = r.round?.stage || 1;
  return roundKey(r) + (st > 1 ? "s" + st : "");
};

export const isElim = (r: Pick<Room, "round">): boolean => r.round?.mode === "elim";

/** Quem ainda joga nesta etapa: na eliminação, quem não saiu; e só quem continua na sala. */
export const liveIds = (r: Pick<Room, "round" | "players">): string[] =>
  (r.round?.alive || r.round?.players || []).filter((id) => !!r.players?.[id]);

/** Quantos suspeitos cada um escolhe na votação. */
export const votesPerPlayer = (r: Pick<Room, "round" | "players">): number => (isElim(r) ? 1 : Math.max(1, r.round?.k || 1));

/** Voto guardado como "id" ou "id1,id2" (votação única com vários impostores). */
export const picksOf = (v: string | undefined | null): string[] => (v ? String(v).split(",").filter(Boolean) : []);

/** De quem é a vez de dar a pista. */
export const turnOf = (r: Room): string | undefined => {
  const l = r.clues?.[stageKey(r)] || {};
  return r.round?.order?.[Object.keys(l).length];
};

/** Pistas de todas as etapas da rodada, por jogador. */
export function cluesByPlayer(r: Room): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const last = r.round?.stage || 1;
  for (let st = 1; st <= last; st++) {
    const k = roundKey(r) + (st > 1 ? "s" + st : "");
    for (const c of Object.values(r.clues?.[k] || {})) (out[c.u] ||= []).push(c.t);
  }
  return out;
}

export function newRoomDoc(code: string, host: string, nick: string): Room {
  const t = now();
  return {
    code,
    host,
    status: "lobby",
    createdAt: t,
    updatedAt: t,
    settings: { imps: 1, chaos: false, hint: false, rounds: 1, cats: THEME_ORDER.slice(), clueTime: 60 },
    players: { [host]: { nick, seat: 0, at: t } },
    rn: 0,
    round: null,
    clues: {},
    votes: {},
    result: {},
    guess: {},
    used: [],
  };
}

export function genCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
}

/** Monta a próxima rodada (o anfitrião chama): tema, carta secreta, impostores, cartas e ordem. */
export function newRoundPatch(room: Room): Patch {
  const ids = activeIds(room),
    s = room.settings,
    n = ids.length;
  const cs = catsOf(room).length ? catsOf(room) : THEME_ORDER.filter((k) => THEMES[k]);
  const cat = pick(cs);
  const T = THEMES[cat].items,
    used = room.used || [];
  // o mesmo jogador ou clube aparece em vários temas: o histórico vale pelo id, não pelo tema
  const usados = new Set(used.map((u) => u.slice(u.indexOf(":") + 1)));
  let pool = T.filter((i) => !usados.has(i[0]));
  if (!pool.length) pool = T;
  const it = pick(pool),
    word = it[1];

  let k = Math.min(s.imps, maxImps(n)),
    chaos: string | null = null;
  const caos = caosLigado(s);
  if (caos && Math.random() < 1 / 6) {
    const x = Math.floor(Math.random() * 3);
    if (x === 0) {
      k = 0;
      chaos = "Rodada caótica: não tinha impostor nenhum.";
    } else if (x === 1) {
      k = n;
      chaos = "Rodada caótica: todo mundo era impostor.";
    } else {
      k = Math.min(n - 1, k + 1);
      chaos = "Rodada caótica: tinha um impostor a mais.";
    }
  }
  const imps = shuffle(ids).slice(0, k);
  let d: (typeof T)[number] | null = null;
  if (caos && k > 0 && k < n) {
    const o = T.filter((i) => i[0] !== it[0] && i[1] !== word);
    d = o.length ? pick(o) : null;
  }
  // dica do impostor: pista indireta (década e clube de passagem; ex-jogador e região), sorteada no servidor
  const dica = s.hint ? gerarDica(THEMES[cat], it) : [];
  const cards: Record<string, string> = {};
  for (const id of ids) {
    const imp = imps.includes(id);
    const card: Card = imp ? (d ? { w: d[1], id: d[0] } : { imp: 1, ...(s.hint ? { dica } : {}) }) : { w: word, id: it[0] };
    cards[id] = enc(JSON.stringify(card));
  }
  const start = Math.floor(Math.random() * n);
  const lap = ids.map((_, i) => ids[(start + i) % n]);
  // modos de votação só valem com 2 ou 3 impostores configurados; rodada caótica sem impostor
  // ou com todo mundo impostor cai na votação única
  const cfg = Math.min(s.imps, maxImps(n));
  const mode = cfg >= 2 && s.voteMode === "elim" && k > 0 && k < n ? "elim" : "multi";
  const laps = mode === "elim" ? 1 : s.rounds;
  const order: string[] = [];
  for (let i = 0; i < laps; i++) order.push(...lap);
  return {
    status: "clues",
    rn: (room.rn || 0) + 1,
    updatedAt: now(),
    turnAt: now(),
    used: used.concat(cat + ":" + it[0]).slice(-150),
    // apaga o chat da rodada anterior para a sala não crescer
    // e o chat do lobby (a conversa da sala de espera não entra na partida)
    chat: { lobby: null, ...(room.rn ? { ["r" + room.rn]: null } : {}) },
    round: {
      cat,
      secret: enc(word),
      sid: enc(it[0]),
      decoy: d ? enc(d[1]) : null,
      did: d ? enc(d[0]) : null,
      imps,
      chaos,
      players: ids,
      order,
      laps,
      cards,
      mode,
      k: cfg,
      // o patch é mesclado com a rodada anterior: zera os campos da eliminação quando não usa
      ...(mode === "elim" ? { stage: 1, alive: ids, outs: [] } : { stage: null, alive: null, outs: null }),
    },
  };
}

/** Chute: nome completo, ou o sobrenome/apelido final para jogadores. */
export function guessOk(t: string, word: string, cat: string): boolean {
  const g = norm(t),
    w = norm(word);
  if (!g) return false;
  if (g === w) return true;
  const toks = String(word)
    .split(/\s+/)
    .map(norm)
    .filter((x) => x.length >= 4);
  if (isPlayerTheme(cat) && toks.length && g === toks[toks.length - 1]) return true;
  return g.length >= 5 && w.includes(g) && g.length >= w.length * 0.6;
}

/**
 * Conta os votos da etapa atual. Cada voto pode ter até k suspeitos.
 * Saem os k mais votados; empate na fronteira não tira ninguém daquele grupo.
 * Se "Ninguém é impostor" for o mais votado sozinho, ninguém sai.
 */
export function tallyVotes(room: Room): VoteResult {
  const vs = room.votes?.[stageKey(room)] || {},
    k = votesPerPlayer(room),
    alive = liveIds(room),
    t: Record<string, number> = {};
  for (const id of alive) {
    const picks = [...new Set(picksOf(vs[id]))].slice(0, k);
    for (const v of picks) if (v === "none" || alive.includes(v)) t[v] = (t[v] || 0) + 1;
  }
  const none = t.none || 0;
  const ranked = Object.entries(t)
    .filter(([id]) => id !== "none")
    .sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[1] || 0;
  if (!ranked.length || none > top) return { out: none ? "none" : null, outs: [], tally: t };
  const outs: string[] = [];
  let i = 0;
  while (i < ranked.length && outs.length < k) {
    const c = ranked[i][1];
    const group = ranked.filter(([, x]) => x === c).map(([id]) => id);
    if (outs.length + group.length > k || (none === c && outs.length === 0)) break;
    outs.push(...group);
    i += group.length;
  }
  return { out: outs[0] ?? null, outs, tally: t };
}

/** Eliminação: depois de cada votação, tira o mais votado e decide se a rodada continua. */
export function elimPatch(room: Room): Patch {
  const r = room.round!,
    st = r.stage || 1,
    res = tallyVotes(room),
    u = res.outs?.[0] || null;
  const outs: Out[] = (r.outs || []).concat(u ? [{ u, imp: r.imps.includes(u), st }] : []);
  const alive = liveIds(room).filter((id) => id !== u);
  const impsAlive = r.imps.filter((id) => alive.includes(id));
  const crew = alive.length - impsAlive.length;
  const stageRes = { [stageKey(room)]: res };
  const end: VoteResult["end"] | null = impsAlive.length === 0 ? "caught" : impsAlive.length >= crew || st >= r.players.length ? "parity" : null;
  if (end)
    return {
      status: "result",
      updatedAt: now(),
      round: { alive, outs },
      result: { ...stageRes, [roundKey(room)]: { out: u, outs: outs.map((o) => o.u), tally: res.tally, end } },
    };
  const start = Math.floor(Math.random() * alive.length);
  return {
    status: "clues",
    updatedAt: now(),
    turnAt: now(),
    round: { alive, outs, stage: st + 1, order: alive.map((_, i) => alive[(start + i) % alive.length]) },
    result: stageRes,
  };
}

/** Impostores pegos na rodada (os que podem chutar). */
export function caughtImps(room: Room): string[] {
  const r = room.round!;
  if (isElim(room)) return (r.outs || []).filter((o) => o.imp).map((o) => o.u);
  const res = room.result?.[roundKey(room)];
  const outs = res?.outs || (res?.out && res.out !== "none" ? [res.out] : []);
  return r.imps.filter((id) => outs.includes(id));
}

/** Chutes da rodada por jogador (aceita o formato antigo, de um chute só). */
export function guessesOf(room: Room): Record<string, Guess> {
  const g = room.guess?.[roundKey(room)] as unknown;
  if (!g || typeof g !== "object") return {};
  if (typeof (g as Guess).t === "string") {
    const out = room.result?.[roundKey(room)]?.out;
    return out ? { [out]: g as Guess } : {};
  }
  return Object.fromEntries(Object.entries(g as Record<string, Guess | null>).filter((e): e is [string, Guess] => !!e[1]));
}

export interface Outcome {
  win: boolean;
  /** falta o chute de algum impostor pego */
  pending?: boolean;
  /** impostores pegos que ainda podem chutar */
  guessers?: string[];
  title: string;
  sub: string;
}

/** Texto do resultado. nick() já devolve o apelido escapado para HTML. */
export function outcome(room: Room, nick: (id: string) => string): Outcome {
  const r = room.round!,
    res = room.result?.[roundKey(room)] || ({} as Partial<VoteResult>),
    G = guessesOf(room);
  const imps = r.imps,
    out = res.out;
  const q = (s: string) => "“" + esc(s) + "”";
  const many = imps.length > 1;
  const list = (ids: string[]) => (ids.length <= 1 ? ids.map(nick).join("") : ids.slice(0, -1).map(nick).join(", ") + " e " + nick(ids[ids.length - 1]));
  if (imps.length === 0)
    return { win: out === "none", title: out === "none" ? "Na mosca!" : "Erraram!", sub: "Rodada caótica: não tinha impostor nenhum." };
  if (imps.length === r.players.length)
    return { win: false, title: "Todo mundo era impostor!", sub: "Rodada caótica. Cada um recebeu a mesma tela vermelha." };

  const here = (id: string) => !!room.players?.[id];
  const caught = caughtImps(room);
  const escaped = imps.filter((id) => !caught.includes(id) && here(id));
  if (!caught.length && !escaped.length)
    return { win: false, title: many ? "Os impostores saíram" : "O impostor saiu", sub: "Rodada sem vencedor: " + (many ? "os impostores saíram" : "o impostor saiu") + " da sala." };
  const outsList = isElim(room) ? (r.outs || []).map((o) => o.u) : res.outs || (out && out !== "none" ? [out] : []);
  const innocentOut = outsList.filter((id) => !imps.includes(id));

  if (isElim(room) && res.end === "parity")
    return {
      win: false,
      title: escaped.length > 1 ? "Os impostores venceram" : "O impostor venceu",
      sub: list(escaped) + (escaped.length > 1 ? " sobraram" : " sobrou") + " até o fim: o elenco ficou sem maioria." + (caught.length ? " " + list(caught) + (caught.length > 1 ? " foram pegos." : " foi pego.") : ""),
    };

  if (!caught.length) {
    if (!out) return { win: false, title: many ? "Os impostores escaparam" : "O impostor escapou", sub: "Empate na votação, ninguém foi eliminado." };
    if (out === "none") return { win: false, title: many ? "Os impostores venceram" : "O impostor venceu", sub: "Vocês votaram que ninguém era impostor." };
    return { win: false, title: many ? "Os impostores venceram" : "O impostor venceu", sub: list(innocentOut) + (innocentOut.length > 1 ? " eram do elenco." : " era do elenco.") };
  }

  // quem saiu da sala não chuta; com o chute desligado, impostor pego já perdeu
  const canGuess = room.settings?.guess !== false;
  const waiting = canGuess ? caught.filter((id) => !G[id] && here(id)) : [];
  const escNote = escaped.length ? " " + list(escaped) + (escaped.length > 1 ? " escaparam." : " escapou.") : "";
  if (waiting.length)
    return {
      win: true,
      pending: true,
      guessers: waiting,
      title: caught.length > 1 ? "Pegaram " + caught.length + " impostores!" : "Pegaram o impostor!",
      sub:
        list(caught) +
        (caught.length > 1 ? " eram impostores. Agora cada um tem um chute para adivinhar a carta secreta." : " era impostor. Agora tem um chute para adivinhar a carta secreta.") +
        escNote,
    };

  const right = caught.filter((id) => G[id]?.ok);
  const guessed = caught.filter((id) => G[id]);
  const parts = guessed.map((id) => nick(id) + " chutou " + q(G[id].t) + (G[id].ok ? " e acertou" : " e errou"));
  const caughtNote = !canGuess ? list(caught) + (caught.length > 1 ? " foram pegos e não têm chute." : " foi pego e não tem chute.") : "";
  const sub = ((parts.length ? parts.join("; ") + "." : caughtNote) + escNote).trim();
  if (!right.length && !escaped.length) return { win: true, title: "Vitória do elenco!", sub };
  const winners = right.concat(escaped);
  return {
    win: false,
    title: winners.length > 1 ? "Os impostores venceram" : right.length ? "Roubou a vitória!" : "O impostor venceu",
    sub: (right.length ? list(right) + (right.length > 1 ? " acertaram" : " acertou") + " a carta secreta. " : "") + sub,
  };
}

/* ---------- placar ---------- */
/** segundos máximos de uma votação: depois disso, conta os votos que já tem (a sala nunca fica travada) */
export const VOTE_TIME = 180;
/** segundos sem conexão para o jogador contar como ausente (não trava voto nem vez, perde o posto de anfitrião e sai da sala) */
export const AUSENTE_S = 180;
/**
 * Segundos para responder "Você ainda está aí?". A pergunta aparece para quem está conectado e deixou passar a
 * própria vez de dar pista ou o prazo da votação; sem resposta, sai da sala. Quem joga em call fala por voz e
 * pode não clicar a tempo: perder a vez ou o voto, sozinho, nunca tira ninguém.
 */
export const AQUI_S = 15;

export const PTS_IMP = 3;
export const PTS_CREW = 1;

/**
 * Pontos da rodada: impostor que venceu (acertou o chute ou escapou) ganha 3;
 * quando o elenco vence, cada jogador do elenco ganha 1.
 * Devolve null enquanto falta chute, a menos que force (rodada encerrada antes do chute: conta como erro).
 */
export function roundPoints(room: Room, force = false): Record<string, number> | null {
  const r = room.round;
  if (!r || room.status !== "result") return null;
  const o = outcome(room, (id) => id);
  if (o.pending && !force) return null;
  const pts: Record<string, number> = {};
  // quem saiu da sala (inclusive por inatividade) não pontua; o placar guarda só o que já tinha
  const imps = r.imps,
    crew = r.players.filter((id) => !imps.includes(id) && !!room.players?.[id]);
  if (imps.length === 0) {
    if (room.result?.[roundKey(room)]?.out === "none") for (const id of crew) pts[id] = PTS_CREW;
    return pts;
  }
  if (imps.length === r.players.length) return pts;
  const G = guessesOf(room),
    caught = caughtImps(room);
  const winImps = imps.filter((id) => (caught.includes(id) ? !!G[id]?.ok : !!room.players?.[id]));
  if (winImps.length) for (const id of winImps) pts[id] = PTS_IMP;
  else if (o.win) for (const id of crew) pts[id] = PTS_CREW;
  return pts;
}

/** Soma os pontos da rodada no placar (o anfitrião grava uma vez por rodada). */
export function scorePatch(room: Room, force = false): Patch | null {
  const k = roundKey(room);
  if (room.scored?.[k]) return null;
  const pts = roundPoints(room, force);
  if (!pts) return null;
  const scores: Patch = {};
  for (const [id, p] of Object.entries(pts)) {
    const cur = room.scores?.[id];
    scores[id] = { n: room.players?.[id]?.nick || cur?.n || "Jogador", p: (cur?.p || 0) + p };
  }
  // jogadores da rodada sem ponto entram no placar com 0, para aparecer no ranking
  for (const id of room.round?.players || [])
    if (!room.scores?.[id] && !scores[id]) scores[id] = { n: room.players?.[id]?.nick || "Jogador", p: 0 };
  return { scores, scored: { [k]: Object.keys(pts).length ? pts : { _: 0 } }, updatedAt: now() };
}

/** Ranking da sala, do maior para o menor. Empate: mesma posição. */
export function ranking(room: Room): (RankRow & { pos: number })[] {
  const rows: RankRow[] = Object.entries(room.scores || {})
    .filter((e): e is [string, { n: string; p: number }] => !!e[1])
    .map(([u, s]) => ({ u, n: room.players?.[u]?.nick || s.n, p: s.p }));
  for (const u of activeIds(room)) if (!rows.some((x) => x.u === u)) rows.push({ u, n: room.players![u]!.nick, p: 0 });
  rows.sort((a, b) => b.p - a.p || a.n.localeCompare(b.n));
  let pos = 0,
    last = -1;
  return rows.map((x, i) => {
    if (x.p !== last) {
      pos = i + 1;
      last = x.p;
    }
    return { ...x, pos };
  });
}

/** Mínimo de jogadores para uma rodada continuar. */
export const MIN_JOGADORES = 3;

/**
 * Tira da sala quem ficou ausente (desconectado, estourou o tempo da vez ou não votou no prazo).
 * Diferente de kickPatch, os votos dos OUTROS não são zerados: os votos no ausente simplesmente deixam de contar
 * (tallyVotes só apura entre os presentes) e a votação segue sem travar. O voto do próprio ausente some.
 * Se o ausente era impostor, a rodada acaba como se ele tivesse sido pego (o fluxo de sempre: quem saiu não chuta).
 * Com menos de MIN_JOGADORES a sala volta ao lobby. O anfitrião ausente passa o posto.
 * Devolve um patch para o deepMerge; o aviso para os outros vai no chat.
 */
export function ausentePatch(room: Room, id: string, online: (id: string) => boolean = () => true): Patch {
  const nick = room.players?.[id]?.nick || "Jogador";
  const p = kickPatch(room, id);
  const rest = activeIds(room).filter((x) => x !== id);
  const r = room.round;
  const sk = r ? stageKey(room) : "";
  if (p.votes) p.votes = { [sk]: { [id]: null } };
  if (room.host === id && rest.length) p.host = rest.find(online) || rest[0];
  let status = (p.status as Room["status"] | undefined) || room.status;
  let aviso = `${nick} saiu por inatividade.`;
  const jogando = !!r && (status === "clues" || status === "vote");
  if (jogando && rest.length < MIN_JOGADORES) {
    status = "lobby";
    p.status = "lobby";
    p.voteAt = null;
    aviso += " A sala voltou para a espera: restaram menos de 3 jogadores.";
  } else if (jogando && r!.imps.includes(id) && r!.imps.length < r!.players.length) {
    const restantes = r!.imps.filter((x) => x !== id && rest.includes(x));
    if (isElim(room)) {
      const outs: Out[] = (r!.outs || []).concat([{ u: id, imp: true, st: r!.stage || 1 }]);
      p.round = { ...(p.round as object), outs };
      if (!restantes.length) {
        status = "result";
        p.status = "result";
        p.voteAt = null;
        p.result = { [roundKey(room)]: { out: id, outs: outs.map((o) => o.u), tally: {}, end: "caught" } };
      }
    } else if (!restantes.length) {
      status = "result";
      p.status = "result";
      p.voteAt = null;
      p.result = { [roundKey(room)]: { out: id, outs: [id], tally: {} } };
    }
    if (status === "result") aviso += " Era o impostor: a rodada acabou.";
  }
  const key = chatKey({ status, rn: room.rn });
  p.chat = { [key]: { ["sys-" + now().toString(36) + "-" + id]: { u: "sys", sys: 1, t: aviso, at: now() } } };
  return p;
}

/** Tira alguém da sala. Durante as pistas, a vez dele é pulada e a ordem segue sem ele. */
export function kickPatch(room: Room, id: string): Patch {
  const p: Patch = { players: { [id]: null }, updatedAt: now() };
  const r = room.round;
  if (!r || (room.status !== "clues" && room.status !== "vote")) return p;
  const round: Patch = {};
  if (r.alive) round.alive = r.alive.filter((x) => x !== id);
  if (room.status === "clues") {
    const idx = Object.keys(room.clues?.[stageKey(room)] || {}).length;
    const order = r.order.slice(0, idx).concat(r.order.slice(idx).filter((x) => x !== id));
    round.order = order;
    if (order[idx] !== r.order[idx]) p.turnAt = now();
    if (order.length <= idx) p.status = "vote";
  }
  if (room.status === "vote") {
    // quem tinha votado em quem saiu precisa votar de novo (e o voto de quem saiu deixa de contar)
    const sk = stageKey(room),
      vs = room.votes?.[sk] || {},
      clear: Patch = {};
    for (const [voter, v] of Object.entries(vs)) if (voter === id || picksOf(v).includes(id)) clear[voter] = null;
    if (Object.keys(clear).length) p.votes = { [sk]: clear };
  }
  if (Object.keys(round).length) p.round = round;
  return p;
}

