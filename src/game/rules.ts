// Regras puras da partida (sem DOM): sorteio da rodada, votos, resultado e chute.
import { THEME_ORDER, THEMES, isPlayerTheme } from "./data";
import type { Card, Patch, Room, VoteResult } from "./types";
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

/** De quem é a vez de dar a pista. */
export const turnOf = (r: Room): string | undefined => {
  const l = r.clues?.[roundKey(r)] || {};
  return r.round?.order?.[Object.keys(l).length];
};

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
  const order: string[] = [];
  for (let i = 0; i < s.rounds; i++) order.push(...lap);
  return {
    status: "clues",
    rn: (room.rn || 0) + 1,
    updatedAt: now(),
    used: used.concat(cat + ":" + it[0]).slice(-150),
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
      laps: s.rounds,
      cards,
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

/** Empate não tira ninguém. */
export function tallyVotes(room: Room): VoteResult {
  const r = room.round!,
    vs = room.votes?.[roundKey(room)] || {},
    t: Record<string, number> = {};
  for (const id of r.players) {
    const v = vs[id];
    if (v) t[v] = (t[v] || 0) + 1;
  }
  let best: string | null = null,
    top = 0,
    tie = false;
  for (const [k, c] of Object.entries(t)) {
    if (c > top) {
      top = c;
      best = k;
      tie = false;
    } else if (c === top) tie = true;
  }
  return { out: tie || !best ? null : best, tally: t };
}

export interface Outcome {
  win: boolean;
  pending?: boolean;
  title: string;
  sub: string;
}

/** Texto do resultado. nick() já devolve o apelido escapado para HTML. */
export function outcome(room: Room, nick: (id: string) => string): Outcome {
  const r = room.round!,
    res = room.result?.[roundKey(room)] || ({} as Partial<VoteResult>),
    g = room.guess?.[roundKey(room)];
  const imps = r.imps,
    out = res.out;
  const q = (s: string) => "“" + esc(s) + "”";
  if (imps.length === 0)
    return { win: out === "none", title: out === "none" ? "Na mosca!" : "Erraram!", sub: "Rodada caótica: não tinha impostor nenhum." };
  if (imps.length === r.players.length)
    return { win: false, title: "Todo mundo era impostor!", sub: "Rodada caótica. Cada um recebeu a mesma tela vermelha." };
  if (!out) return { win: false, title: "O impostor escapou", sub: "Empate na votação, ninguém foi eliminado." };
  if (out === "none") return { win: false, title: "O impostor venceu", sub: "Vocês votaram que ninguém era impostor." };
  if (imps.includes(out)) {
    if (g?.ok) return { win: false, title: "Roubou a vitória!", sub: nick(out) + " era impostor, mas acertou o nome secreto: " + q(g.t) + "." };
    if (g) return { win: true, title: "Pegaram o impostor!", sub: nick(out) + " era impostor e chutou " + q(g.t) + ". Errou." };
    return {
      win: true,
      pending: true,
      title: "Pegaram o impostor!",
      sub: nick(out) + " era impostor. Agora ele tem um chute para adivinhar o nome secreto.",
    };
  }
  return { win: false, title: "O impostor venceu", sub: nick(out) + " era do elenco." };
}
