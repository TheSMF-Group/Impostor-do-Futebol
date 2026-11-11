// Regras puras da partida (sem DOM): sorteio da rodada, votos, resultado e chute.
import { THEME_ORDER, THEMES, isPlayerTheme } from "./data";
import type { Card, Guess, Out, Patch, Room, VoteResult } from "./types";
import { enc, esc, norm, now, pick, shuffle } from "./util";

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

/** Quem ainda joga nesta etapa (na eliminação, quem não saiu). */
export const liveIds = (r: Pick<Room, "round">): string[] => r.round?.alive || r.round?.players || [];

/** Quantos suspeitos cada um escolhe na votação. */
export const votesPerPlayer = (r: Pick<Room, "round">): number => (isElim(r) ? 1 : Math.max(1, r.round?.k || 1));

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
    settings: { imps: 1, inf: false, chaos: false, hint: false, rounds: 1, cats: THEME_ORDER.slice() },
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
  let pool = T.filter((i) => !used.includes(cat + ":" + i[0]));
  if (!pool.length) pool = T;
  const it = pick(pool),
    word = it[1];

  let k = Math.min(s.imps, maxImps(n)),
    chaos: string | null = null;
  if (s.chaos && Math.random() < 1 / 6) {
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
  if (s.inf && k > 0 && k < n) {
    const o = T.filter((i) => i[0] !== it[0] && i[1] !== word);
    d = o.length ? pick(o) : null;
  }
  const letters = word.replace(/\s/g, "");
  const isP = isPlayerTheme(cat);
  // dica: jogadores mostram país + posição; times mostram primeira letra e tamanho
  const tip =
    s.hint && !isP ? word[0].toUpperCase() + " " + "_ ".repeat(letters.length - 1).trim() + " · " + letters.length + " letras" : "";
  const hint: Card = s.hint && isP ? { nat: it[4] || "", pos: it[5] || "" } : {};
  const cards: Record<string, string> = {};
  for (const id of ids) {
    const imp = imps.includes(id);
    const card: Card = imp ? (d ? { w: d[1], id: d[0] } : { imp: 1, tip, ...hint }) : { w: word, id: it[0] };
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
    used: used.concat(cat + ":" + it[0]).slice(-150),
    // apaga o chat da rodada anterior para a sala não crescer
    ...(room.rn ? { chat: { ["r" + room.rn]: null } } : {}),
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

  const caught = caughtImps(room);
  const escaped = imps.filter((id) => !caught.includes(id));
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

  const waiting = caught.filter((id) => !G[id]);
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
  const parts = caught.map((id) => nick(id) + " chutou " + q(G[id].t) + (G[id].ok ? " e acertou" : " e errou"));
  const sub = parts.join("; ") + "." + escNote;
  if (!right.length && !escaped.length) return { win: true, title: "Vitória do elenco!", sub };
  const winners = right.concat(escaped);
  return {
    win: false,
    title: winners.length > 1 ? "Os impostores venceram" : right.length ? "Roubou a vitória!" : "O impostor venceu",
    sub: (right.length ? list(right) + (right.length > 1 ? " acertaram" : " acertou") + " a carta secreta. " : "") + sub,
  };
}
