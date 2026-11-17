// Dica do impostor: uma pista indireta sobre a carta, difícil de usar para deduzir a resposta.
// Nunca usa país, posição, inicial, tamanho do nome nem contagem de letras. Roda no servidor (rules.ts) e no modo local.
//
// Dados (ver tools/dicas-dados.ts e ThemeItem em types.ts):
//   jogador: década de nascimento + um clube de passagem (nunca o atual), sorteado entre os que o jogador teve
//   time:    um ex-jogador que passou por vários times do tema + a região (maior que o país);
//            sem ex-jogador conhecido: só a região, ou a divisão quando for o caso (Série A/B)
// Toda linha só entra se, somada às outras, ainda restarem MIN_CAND ou mais itens do tema compatíveis.
import type { Card, Theme, ThemeItem } from "./types.ts";

/** Minúsculas sem acento, com as palavras separadas por espaço (o norm do util.ts junta tudo). */
const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Mínimo de itens do tema que a dica inteira precisa deixar como candidatos (contando a própria carta). */
export const MIN_CAND = 3;
/** Entre as opções seguras, prefere as que deixam poucos candidatos (menos óbvias) mas ainda acima de MIN_CAND. */
const ALVO_CAND = 10;

export type Dica = NonNullable<Card["dica"]>;

const lista = (s: string | undefined): string[] => (s ? s.split("|").filter(Boolean) : []);
const DIVISOES = new Set(["Série A", "Série B"]);

type Rnd = () => number;
const escolhe = <T,>(a: T[], rnd: Rnd): T => a[Math.floor(rnd() * a.length)];

/** Clubes da carreira de um jogador do tema, incluindo o atual (para contar candidatos). */
const CARREIRA = new WeakMap<ThemeItem, Set<string>>();
const carreira = (i: ThemeItem): Set<string> => {
  let c = CARREIRA.get(i);
  if (!c) CARREIRA.set(i, (c = new Set([i[3], ...lista(i[7])].map(norm))));
  return c;
};

interface Filtro {
  /** nascidos entre estes dois anos (inclusive): uma década, ou uma janela maior quando a década tem poucos jogadores */
  de?: number;
  ate?: number;
  clube?: string;
  regiao?: string;
  jogador?: string;
  divisao?: string;
}

/** Itens do tema compatíveis com o conjunto de linhas da dica. */
export function candidatos(theme: Theme, f: Filtro): ThemeItem[] {
  return theme.items.filter((i) => {
    if (theme.k === "p") {
      if (f.de != null) {
        const d = Number(i[6]);
        if (!i[6] || d < f.de || d > f.ate!) return false;
      }
      if (f.clube && !carreira(i).has(norm(f.clube))) return false;
      return true;
    }
    if (f.regiao && i[4] !== f.regiao) return false;
    if (f.jogador && !lista(i[5]).includes(f.jogador)) return false;
    if (f.divisao && i[3] !== f.divisao) return false;
    return true;
  });
}

/** O texto da dica não pode repetir o nome da carta nem pedaço dele (ex.: "Queens Park Rangers" para o Park Ji-sung). */
const vazaNome = (texto: string, nome: string): boolean => {
  const t = ` ${norm(texto)} `;
  return norm(nome).split(" ").filter((w) => w.length >= 4).some((w) => t.includes(` ${w} `)) || t.includes(` ${norm(nome)} `);
};

/** Sorteia entre as opções seguras, preferindo as que deixam poucos candidatos. */
function sorteia<T extends string>(opcoes: { v: T; n: number }[], rnd: Rnd, nome: string): T | null {
  const ok = opcoes.filter((o) => o.n >= MIN_CAND && !vazaNome(o.v, nome));
  if (!ok.length) return null;
  const fortes = ok.filter((o) => o.n <= ALVO_CAND);
  return escolhe(fortes.length ? fortes : ok, rnd).v;
}

export function gerarDica(theme: Theme, item: ThemeItem, rnd: Rnd = Math.random): Dica {
  const out: Dica = [];
  if (theme.k === "p") {
    const dec = Number(item[6]) || 0;
    if (!dec) {
      // sem nascimento: só serve um clube de passagem, se houver
      const clube = sorteia(lista(item[7]).map((c) => ({ v: c, n: candidatos(theme, { clube: c }).length })), rnd, item[1]);
      return clube ? [{ r: "Passagem", v: `Já jogou no ${clube}` }] : out;
    }
    // janela de nascimento: a década; se ela tem poucos jogadores no tema, abre para a anterior e a seguinte, e assim por diante
    let melhor: { de: number; ate: number; clube: string | null } | null = null;
    for (const w of [0, 10, 20, 40]) {
      const j = { de: dec - w, ate: dec + w + 9 };
      if (candidatos(theme, j).length < MIN_CAND) continue;
      const clube = sorteia(lista(item[7]).map((c) => ({ v: c, n: candidatos(theme, { ...j, clube: c }).length })), rnd, item[1]);
      if (!melhor) melhor = { ...j, clube };
      if (clube) { melhor = { ...j, clube }; break; }
    }
    if (melhor) out.push({ r: "Geração", v: melhor.ate - melhor.de === 9 ? `Nasceu nos anos ${melhor.de}` : `Nasceu entre ${melhor.de} e ${melhor.ate}` });
    const clube = melhor?.clube ?? null;
    if (clube) out.push({ r: "Passagem", v: `Já jogou no ${clube}` });
    return out;
  }
  const regiao = item[4] || "";
  const jogador = sorteia(
    lista(item[5]).map((p) => ({ v: p, n: candidatos(theme, { jogador: p }).length })),
    rnd,
    item[1],
  );
  const regOk = (j?: string) => !!regiao && candidatos(theme, { regiao, jogador: j }).length >= MIN_CAND;
  if (jogador) {
    out.push({ r: "Elenco", v: `Já teve ${jogador} no elenco` });
    if (regOk(jogador)) out.push({ r: "Região", v: regiao });
  } else if (regiao && regOk()) {
    out.push({ r: "Região", v: regiao });
  } else if (DIVISOES.has(item[3]) && candidatos(theme, { divisao: item[3] }).length >= MIN_CAND) {
    out.push({ r: "Divisão", v: `Joga a ${item[3]}` });
  }
  return out;
}

/** Candidatos que a dica gerada deixa (para testes): lê as linhas de volta. */
export function candidatosDaDica(theme: Theme, item: ThemeItem, dica: Dica): ThemeItem[] {
  const f: Filtro = {};
  for (const l of dica) {
    if (l.r === "Geração") {
      const m = l.v.match(/(\d{4})(?: e (\d{4}))?$/)!;
      f.de = Number(m[1]);
      f.ate = m[2] ? Number(m[2]) : f.de + 9;
    }
    else if (l.r === "Passagem") f.clube = l.v.replace("Já jogou no ", "");
    else if (l.r === "Elenco") f.jogador = l.v.replace(/^Já teve (.*) no elenco$/, "$1");
    else if (l.r === "Região") f.regiao = l.v;
    else if (l.r === "Divisão") f.divisao = item[3];
  }
  return candidatos(theme, f);
}
