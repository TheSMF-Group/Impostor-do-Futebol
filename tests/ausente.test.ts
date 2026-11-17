// Remoção por ausência, apuração só entre presentes, pontos e a ordem de fala na vista. Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { ausentePatch, outcome, roundPoints, tallyVotes } from "../src/game/rules.ts";
import { deepMerge } from "../src/game/util.ts";
import type { Room } from "../src/game/types.ts";
import { vistaPara } from "../worker/src/vista.ts";

const nomes = ["a", "b", "c", "d", "e"];
function sala(opts: { n?: number; status?: Room["status"]; imps?: string[]; elim?: boolean } = {}): Room {
  const ids = nomes.slice(0, opts.n ?? 5);
  const players = Object.fromEntries(ids.map((id, i) => [id, { nick: id.toUpperCase(), seat: i, at: 1 }]));
  return {
    code: "ABCD", host: "a", status: opts.status ?? "vote", createdAt: 1, updatedAt: 1,
    settings: { imps: 1, chaos: false, hint: false, rounds: 1, cats: [], voteMode: opts.elim ? "elim" : "multi" },
    players, rn: 1,
    round: { cat: "jge", secret: "", decoy: null, imps: opts.imps ?? ["b"], chaos: null, players: ids, order: ids, laps: 1, cards: {}, k: 1, mode: opts.elim ? "elim" : "multi", ...(opts.elim ? { stage: 1, alive: ids, outs: [] } : {}) },
    clues: {}, votes: { r1: {} }, result: {}, guess: {}, used: [],
  } as unknown as Room;
}
const aplica = (room: Room, p: object) => deepMerge(room as never, p as never);

test("ausente que votou: o voto dele some da apuração e ele sai da sala", () => {
  const room = sala();
  room.votes.r1 = { a: "b", c: "b", d: "a", e: "b" }; // d votou em a, mas fica ausente
  aplica(room, ausentePatch(room, "d"));
  assert.equal(room.players.d, null);
  assert.equal(room.votes.r1.d, null);
  const res = tallyVotes(room);
  assert.deepEqual(res.tally, { b: 3 });
  assert.equal(res.out, "b");
});

test("ausente que recebeu voto: não entra na apuração e os votos dele não travam a votação", () => {
  const room = sala({ imps: ["c"] });
  room.votes.r1 = { a: "d", b: "d", c: "e", e: "d" };
  aplica(room, ausentePatch(room, "d"));
  assert.equal(room.votes.r1.a, "d"); // os votos dos outros não são zerados (ninguém precisa votar de novo)
  const res = tallyVotes(room);
  assert.equal(res.tally.d, undefined);
  assert.deepEqual(res.tally, { e: 1 });
  assert.equal(res.out, "e");
});

test("ausente que só recebeu votos: sem votos válidos sobrando, ninguém é eliminado (empate)", () => {
  const room = sala();
  room.votes.r1 = { a: "d", b: "d", c: "d", e: "d" };
  aplica(room, ausentePatch(room, "d"));
  const res = tallyVotes(room);
  assert.equal(res.out, null);
  assert.deepEqual(res.tally, {});
});

test("ausente que era o impostor: a rodada acaba como impostor pego; quem saiu não chuta, elenco vence", () => {
  const room = sala({ imps: ["b"] });
  aplica(room, ausentePatch(room, "b"));
  assert.equal(room.status, "result");
  assert.equal(room.result.r1.out, "b");
  const o = outcome(room, (x) => x);
  assert.equal(o.pending, undefined);
  assert.equal(o.win, true);
  assert.equal(o.title, "Vitória do elenco!");
});

test("pontos: o ausente não pontua e o impostor ausente não ganha nada; o elenco presente ganha", () => {
  const room = sala({ imps: ["b"] });
  aplica(room, ausentePatch(room, "b"));
  aplica(room, ausentePatch(room, "d"));
  const pts = roundPoints(room, true)!;
  assert.equal(pts.d, undefined);
  assert.equal(pts.b, undefined);
  assert.deepEqual(Object.keys(pts).sort(), ["a", "c", "e"]);
});

test("ausente na eliminação: impostor ausente conta como eliminado e encerra a rodada", () => {
  const room = sala({ elim: true, imps: ["b"] });
  aplica(room, ausentePatch(room, "b"));
  assert.equal(room.status, "result");
  assert.equal(room.round!.outs![0].u, "b");
  assert.equal(room.round!.outs![0].imp, true);
  assert.equal(room.result.r1.end, "caught");
  assert.ok(!room.round!.alive!.includes("b"));
});

test("sala no mínimo (3): ausente na partida devolve a sala ao lobby, sem travar, com aviso no chat do lobby", () => {
  const room = sala({ n: 3, status: "clues" });
  aplica(room, ausentePatch(room, "c"));
  assert.equal(room.status, "lobby");
  assert.equal(Object.keys(room.players).filter((id) => room.players[id]).length, 2);
  const msgs = Object.values(room.chat!.lobby!).map((m) => m!.t);
  assert.ok(msgs.some((t) => /C saiu por inatividade/.test(t) && /menos de 3/.test(t)));
});

test("ausente no lobby ou no resultado só sai (sem encerrar nada)", () => {
  const lobby = sala({ n: 3, status: "lobby" });
  aplica(lobby, ausentePatch(lobby, "c"));
  assert.equal(lobby.status, "lobby");
  const res = sala({ n: 3, status: "result" });
  aplica(res, ausentePatch(res, "c"));
  assert.equal(res.status, "result");
});

test("dono ausente: o posto passa para um jogador conectado; o aviso aparece no chat da rodada", () => {
  const room = sala();
  aplica(room, ausentePatch(room, "a", (id) => id === "c"));
  assert.equal(room.host, "c");
  assert.equal(room.players.a, null);
  assert.ok(Object.values(room.chat!.r1!).some((m) => m!.sys === 1 && /A saiu por inatividade/.test(m!.t)));
});

test("sem ninguém conectado para assumir, o posto vai para o primeiro da lista", () => {
  const room = sala();
  aplica(room, ausentePatch(room, "a", () => false));
  assert.equal(room.host, "b");
});

/* ---------- ordem de fala na vista de cada jogador (bug: dono aparecia como "não falou") ---------- */
test("vista: quem falou, inclusive o dono, aparece em round.fala por id; quem não falou fica de fora", () => {
  const room = sala({ imps: ["c"] });
  room.chat = {
    r1: {
      "a-1": { u: "a", t: "oi", at: 10 },
      "d-1": { u: "d", t: "ei", at: 20 },
      "sys-1": { u: "sys", sys: 1, t: "X saiu por inatividade.", at: 30 },
    },
    lobby: { "e-1": { u: "e", t: "lobby", at: 1 } },
  };
  for (const me of nomes) assert.deepEqual(vistaPara(room, me).round!.fala, ["a", "d"], `vista de ${me}`);
  // sem revelar o impostor
  assert.ok(!JSON.stringify(vistaPara(room, "a").round!.imps).includes("c"));
});

test("vista: homônimos (mesmo apelido) são jogadores distintos, cada um por id", () => {
  const room = sala();
  room.players.d!.nick = "Italo";
  room.players.e!.nick = "Italo";
  room.chat = { r1: { "d-1": { u: "d", t: "x", at: 5 } } };
  assert.deepEqual(vistaPara(room, "a").round!.fala, ["d"]);
});
