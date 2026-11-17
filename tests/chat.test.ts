// Slowmode e ordem de fala do chat. Rodar com: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_SLOW_MS, chatEspera, ordemDeFala } from "../src/game/chat.ts";
import type { ChatMsg } from "../src/game/types.ts";

const m = (u: string, at: number, t = "oi"): ChatMsg => ({ u, t, at });

test("slowmode: rejeita antes de 3 s e aceita a partir de 3 s da última mensagem do mesmo jogador", () => {
  assert.equal(CHAT_SLOW_MS, 3000);
  const chat = { "a-1": m("a", 10_000), "b-1": m("b", 11_000) };
  assert.equal(chatEspera(chat, "a", 10_000), 3000);
  assert.equal(chatEspera(chat, "a", 12_999), 1);
  assert.equal(chatEspera(chat, "a", 13_000), 0);
  assert.equal(chatEspera(chat, "a", 20_000), 0);
});

test("slowmode: vale por jogador (a mensagem de outro não trava) e quem não falou nunca espera", () => {
  const chat = { "a-1": m("a", 10_000) };
  assert.equal(chatEspera(chat, "b", 10_001), 0);
  assert.equal(chatEspera(chat, "c", 10_001), 0);
  assert.equal(chatEspera(null, "a", 10_001), 0);
  assert.equal(chatEspera({ "a-1": null }, "a", 10_001), 0);
});

test("slowmode: conta a mensagem mais recente, não a primeira", () => {
  const chat = { "a-1": m("a", 1000), "a-2": m("a", 9000) };
  assert.equal(chatEspera(chat, "a", 10_000), 2000);
});

test("ordem de fala: pela primeira mensagem de cada um; quem não falou vai ao fim, na ordem dos jogadores", () => {
  const chat = { "c-1": m("c", 100), "a-1": m("a", 200), "c-2": m("c", 250), "b-1": m("b", 300) };
  const r = ordemDeFala(chat, ["a", "b", "c", "d", "e"]);
  assert.deepEqual(r.falaram, ["c", "a", "b"]);
  assert.deepEqual(r.calados, ["d", "e"]);
});

test("ordem de fala: ninguém falou, mensagens apagadas e quem não está na rodada são ignorados", () => {
  assert.deepEqual(ordemDeFala(null, ["a", "b"]), { falaram: [], calados: ["a", "b"] });
  assert.deepEqual(ordemDeFala({ "a-1": null, "x-1": m("x", 1) }, ["a", "b"]), { falaram: [], calados: ["a", "b"] });
});

test("ordem de fala: empate de relógio desempata de forma estável", () => {
  const chat = { "b-1": m("b", 500), "a-1": m("a", 500) };
  assert.deepEqual(ordemDeFala(chat, ["a", "b"]).falaram, ["a", "b"]);
});
