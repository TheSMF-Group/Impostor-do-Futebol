// Testes da dica do impostor e do modo CAOS. Rodar com: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MIN_CAND, candidatosDaDica, gerarDica } from "../src/game/dica.ts";
import { caosLigado } from "../src/game/caos.ts";
import type { Theme, ThemeItem } from "../src/game/types.ts";

const themes = (JSON.parse(readFileSync(new URL("../public/data/temas.json", import.meta.url), "utf8")) as { themes: Record<string, Theme> }).themes;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// PRNG fixo: o teste é repetível, e cada item é sorteado várias vezes para exercitar as escolhas aleatórias
const prng = (seed: number) => {
  const f = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 5; i++) f();
  return f;
};

// o que a dica NUNCA pode carregar: países, posições, inicial e tamanho do nome
const PAISES = new Set<string>();
const POSICOES = new Set<string>();
for (const t of Object.values(themes)) if (t.k === "p") for (const i of t.items) { if (i[4]) PAISES.add(norm(i[4])); if (i[5]) POSICOES.add(norm(i[5])); }
for (const p of ["Brasil", "Argentina", "Inglaterra", "Espanha", "Itália", "Alemanha", "França", "Portugal", "Holanda", "Uruguai", "Chile", "Colômbia", "Equador", "Peru", "Paraguai", "México", "Estados Unidos", "Escócia", "Bélgica", "Suíça", "Áustria", "Turquia", "Grécia", "Croácia", "Sérvia", "Ucrânia", "Egito", "Japão", "Arábia Saudita", "Tunísia", "Marrocos", "África do Sul", "Coreia do Sul"]) PAISES.add(norm(p));
const contem = (texto: string, frase: string) => ` ${norm(texto)} `.includes(` ${frase} `);

/** Sem nascimento nem clubes em nenhuma das bases (Transfermarkt/Conecte): não há dado para montar dica sem inventar. */
const SEM_DADOS = new Set(["p766258", "p991134", "p856143", "p897051"]);

function irregularidade(theme: Theme, item: ThemeItem, linhas: { r: string; v: string }[]): string | null {
  const texto = linhas.map((l) => l.v).join(" · ");
  if (!linhas.length) return "sem dica";
  const nome = norm(item[1]);
  if (contem(texto, nome)) return "contém o nome inteiro";
  for (const tok of nome.split(" ").filter((t) => t.length >= 4)) if (contem(texto, tok)) return `contém parte do nome (${tok})`;
  if (theme.k === "p" && contem(texto, norm(item[3]))) return "contém o clube atual do jogador";
  for (const p of PAISES) if (contem(texto, p)) return `contém país (${p})`;
  for (const p of POSICOES) if (contem(texto, p)) return `contém posição (${p})`;
  if (/\b\d+\s*letras?\b|_ _|\bprimeira letra\b|\binicial\b|começa com/i.test(texto)) return "contém letra/tamanho do nome";
  const n = candidatosDaDica(theme, item, linhas);
  if (!n.some((c) => c[0] === item[0])) return "a própria carta não é candidata (dica falsa)";
  if (n.length < MIN_CAND) return `deixa só ${n.length} candidato(s)`;
  return null;
}

test("todos os itens dos 12 temas recebem dica segura (nunca o nome, nada de país/posição/letras, 3+ candidatos)", () => {
  assert.equal(Object.keys(themes).length, 12);
  const falhas: string[] = [];
  let total = 0;
  for (const [key, theme] of Object.entries(themes)) {
    for (const item of theme.items) {
      const rnd = prng(item[0].length * 7919 + item[1].length);
      for (let r = 0; r < 10; r++) {
        total++;
        const linhas = gerarDica(theme, item, rnd);
        const erro = irregularidade(theme, item, linhas);
        if (erro && SEM_DADOS.has(item[0]) && erro === "sem dica") break;
        if (erro) { falhas.push(`${key} / ${item[1]}: ${erro} -> ${JSON.stringify(linhas)}`); break; }
      }
    }
  }
  assert.ok(total > 5000);
  assert.equal(falhas.length, 0, `${falhas.length} item(ns) com dica ruim:\n${falhas.slice(0, 30).join("\n")}`);
});

test("a dica varia entre sorteios (não é sempre a mesma)", () => {
  const t = themes.jge;
  const item = t.items.find((i) => (i[7] || "").split("|").length >= 5)!;
  const vistos = new Set(Array.from({ length: 60 }, (_, k) => JSON.stringify(gerarDica(t, item, prng(k * 7919 + 13)))));
  assert.ok(vistos.size > 1);
});

test("CAOS vale com o campo novo ou com o antigo 'Infiltrado' avulso", () => {
  assert.equal(caosLigado({ chaos: true }), true);
  assert.equal(caosLigado({ chaos: false, inf: true }), true);
  assert.equal(caosLigado({ chaos: false }), false);
  assert.equal(caosLigado({ chaos: false, inf: false }), false);
});
