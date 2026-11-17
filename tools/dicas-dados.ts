// Acrescenta aos itens de public/data/temas.json os dados que alimentam a dica do impostor (src/game/dica.ts).
//   node --experimental-strip-types tools/dicas-dados.ts
// Roda DEPOIS do temas-extra.ts (que recria os temas derivados sem esses campos). Pode rodar de novo: refaz tudo.
// Fontes (fora do repo, as mesmas do temas-extra.ts):
//   ~/theconnections/dados.js   nascimento e clubes por temporada (desde 1980) dos jogadores; clubes e elencos
//   ~/assets/jogadores.json     nascimento por id do Transfermarkt (cobre quem o dados.js não tem)
//   ~/assets/clubs/clubes.json  país de cada clube (vira região)
//
// Campos novos no fim de cada item (ver ThemeItem em src/game/types.ts):
//   jogador: [6] década de nascimento ("1990")  [7] clubes por onde passou, separados por "|" (sem o clube atual)
//   time:    [4] região ("Europa")              [5] ex-jogadores conhecidos que passaram por vários times do tema, "|"
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Item = string[];
interface Theme { n: string; k: "p" | "t"; items: Item[] }

const HERE = dirname(fileURLToPath(import.meta.url));
const PATH = join(HERE, "../public/data/temas.json");
const doc = JSON.parse(readFileSync(PATH, "utf8")) as { themes: Record<string, Theme> };
const T = doc.themes;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const D = JSON.parse(readFileSync(join(homedir(), "theconnections/dados.js"), "utf8").replace(/^const DADOS = /, "").trim().replace(/;$/, "")) as {
  clubs: string[]; clubsNorm: string[]; clubsCurto: string[];
  players: [string, string, number, number, number, number[], string, number, number][];
  stars: number[];
};
const NS = 47;
const tmDe = (f: string) => f.match(/^(?:s_)?(\d+)/)?.[1] ?? "";
const porTm = new Map<string, number>();
D.players.forEach((p, ix) => { if (p[6]) porTm.set(tmDe(p[6]), ix); });
const estrela = new Map(D.stars.map((ix, r) => [ix, r]));

const JOG = new Map((JSON.parse(readFileSync(join(homedir(), "assets/jogadores.json"), "utf8")) as { tm_id: number; nascimento?: string }[]).map((j) => [String(j.tm_id), j.nascimento ?? ""]));

/** Lendas sem registro em nenhuma das bases: década de nascimento (fato biográfico público). */
const NASC_LENDAS: Record<string, number> = {
  "Pelé": 1940, "Garrincha": 1930, "Rivellino": 1940, "Tostão": 1940, "Jairzinho": 1940, "Carlos Alberto Torres": 1940,
  "Nilton Santos": 1920, "Zagallo": 1930, "Gérson": 1940, "Vavá": 1930, "Alfredo Di Stéfano": 1920, "Ferenc Puskás": 1920,
  "Gerd Müller": 1940, "Just Fontaine": 1930,
};

const limpaNome = (n: string) => n.replace(/^(FC|CF|CR|EC|SC|CD|SV|FK|RC|CA) /, "").replace(/ (FC|CF|CR|EC|SC)$/, "");
const decada = (ano: number) => String(Math.floor(ano / 10) * 10);

/* ---------- jogadores ---------- */
const semDados: string[] = [];
const tipos = new Map<string, "p" | "t">();
for (const t of Object.values(T)) for (const i of t.items) tipos.set(i[0], t.k);

for (const t of Object.values(T)) {
  if (t.k !== "p") continue;
  for (const i of t.items) {
    i.length = 6;
    const tm = i[0].startsWith("p") ? i[0].slice(1) : "";
    const ix = tm ? porTm.get(tm) : undefined;
    const p = ix != null ? D.players[ix] : null;
    let ano = p && p[2] ? p[2] : 0;
    if (!ano && tm && JOG.get(tm)) ano = Number(JOG.get(tm)!.slice(0, 4)) || 0;
    if (!ano && NASC_LENDAS[i[1]]) ano = NASC_LENDAS[i[1]];
    let ex: string[] = [];
    if (p) {
      const stints = p[5].map((c) => ({ club: Math.floor(c / NS), ano: (c % NS) + 1980 })).sort((a, b) => b.ano - a.ano);
      const atual = stints[0]?.club;
      const sub = norm(i[3]);
      const vistos = new Set<string>();
      for (const s of stints) {
        if (s.club === atual) continue;
        const nome = limpaNome(D.clubsCurto[s.club]);
        const n = norm(nome);
        // o clube atual com outro nome (ex.: "Real" x "Real Madrid") não pode aparecer como passagem
        if (!n || n === sub || sub.includes(n) || n.includes(sub) || vistos.has(n)) continue;
        vistos.add(n);
        ex.push(nome);
      }
    }
    if (ano) i[6] = decada(ano);
    else semDados.push(`${i[1]} (${i[0]})`);
    if (ex.length) { i[6] ||= ""; i[7] = ex.join("|"); }
  }
}

/* ---------- times ---------- */
const CLUBES = JSON.parse(readFileSync(join(homedir(), "assets/clubs/clubes.json"), "utf8")) as { id: string; clube: string; pais: string }[];
const CB = new Map(CLUBES.map((c) => [c.id, c]));
/** País -> região mais larga que o país (a dica não pode nomear o país). Brasil fica sem região: a dica dele é a divisão. */
const REGIAO: Record<string, string> = {
  inglaterra: "Ilhas Britânicas", escocia: "Ilhas Britânicas",
  espanha: "Península Ibérica", portugal: "Península Ibérica",
  alemanha: "Europa Central", austria: "Europa Central", suica: "Europa Central",
  franca: "Europa Ocidental", belgica: "Europa Ocidental", holanda: "Europa Ocidental",
  italia: "Mediterrâneo", grecia: "Mediterrâneo", turquia: "Mediterrâneo", croacia: "Mediterrâneo",
  ucrania: "Leste Europeu", servia: "Leste Europeu",
  argentina: "Cone Sul", chile: "Cone Sul", uruguai: "Cone Sul", paraguai: "Cone Sul",
  colombia: "Região andina", equador: "Região andina", peru: "Região andina",
  mexico: "Concacaf", "estados-unidos": "Concacaf",
  "arabia-saudita": "Ásia", japao: "Ásia", "coreia-do-sul": "Ásia",
  egito: "África", "africa-do-sul": "África", tunisia: "África", marrocos: "África",
};
// time do tema -> clube do banco do Conecte (pelo nome; o banco usa "FC Barcelona", "CR Flamengo"; o tema, "Barcelona")
const RUIDO = new Set("fc cf cr ec sc ca cd sv fk rc rcd ssc sk ac as us ud afc kv cfc".split(" "));
const nucleo = (s: string) => norm(s).split(" ").filter((w) => !RUIDO.has(w)).join(" ");
/** nome do tema (normalizado) -> nome exato no banco do Conecte, quando o casamento automático não acha */
const ALIAS: Record<string, string> = {
  inter: "Inter Milan", "paris sg": "Paris Saint-Germain", "atletico madrid": "Atlético de Madrid", bayern: "Bayern Munich",
  internacional: "Sport Club Internacional", "athletico paranaense": "Club Athletico Paranaense", mirassol: "Mirassol Futebol Clube (SP)",
  "red bull bragantino": "Red Bull Bragantino", chapecoense: "Associação Chapecoense de Futebol", remo: "Clube do Remo (PA)",
  "vila nova": "Vila Nova Futebol Clube (GO)", "athletic club": "Athletic Bilbao", "real betis": "Real Betis Balompié",
  tottenham: "Tottenham Hotspur", newcastle: "Newcastle United", "west ham": "West Ham United", lazio: "SS Lazio", atalanta: "Atalanta BC",
  fiorentina: "ACF Fiorentina", "bayer leverkusen": "Bayer 04 Leverkusen", marseille: "Olympique Marseille", lyon: "Olympique Lyon",
  lille: "LOSC Lille", benfica: "SL Benfica", ajax: "Ajax Amsterdam", psv: "PSV Eindhoven", feyenoord: "Feyenoord Rotterdam",
  besiktas: "Besiktas JK", "rb salzburg": "Red Bull Salzburg", anderlecht: "RSC Anderlecht", wolfsburg: "VfL Wolfsburg",
  stuttgart: "VfB Stuttgart", wolverhampton: "Wolverhampton Wanderers", parma: "Parma Calcio 1913", nice: "OGC Nice",
  "dinamo zagreb": "GNK Dinamo Zagreb", "defensor sporting": "Defensor Sporting Club", olimpia: "Club Olimpia",
  "cerro porteno": "Club Cerro Porteño", libertad: "Club Libertad Asunción", "club america": "CF América", guadalajara: "Deportivo Guadalajara",
  "pumas unam": "UNAM Pumas", "la galaxy": "Los Angeles Galaxy", "al hilal": "Al-Hilal SFC", "al ittihad": "Al-Ittihad Club", "al ahli": "Al-Ahli SFC",
};
const pop = new Map<number, number>();
D.players.forEach((p) => p[5].forEach((c) => pop.set(Math.floor(c / NS), (pop.get(Math.floor(c / NS)) ?? 0) + 1)));
const clubeDoConecte = (nome: string, slug: string): number => {
  const exato = ALIAS[norm(nome)] ? D.clubs.indexOf(ALIAS[norm(nome)]) : -1;
  if (exato >= 0) return exato;
  const alvos = [nucleo(nome), nucleo(CB.get(slug)?.clube ?? "")].filter(Boolean);
  for (const a of alvos) {
    const ixs = D.clubsCurto.map((c, ix) => (nucleo(c) === a || nucleo(D.clubs[ix]) === a ? ix : -1)).filter((ix) => ix >= 0);
    if (ixs.length) return ixs.sort((x, y) => (pop.get(y) ?? 0) - (pop.get(x) ?? 0))[0];
  }
  return -1;
};
const jogadoresDoClube = new Map<number, Set<number>>();
D.players.forEach((p, pix) => {
  for (const c of p[5]) {
    const ci = Math.floor(c / NS);
    if (!jogadoresDoClube.has(ci)) jogadoresDoClube.set(ci, new Set());
    jogadoresDoClube.get(ci)!.add(pix);
  }
});

const semElenco: string[] = [];
const semClube: string[] = [];
for (const [key, t] of Object.entries(T)) {
  if (t.k !== "t") continue;
  const ci = new Map(t.items.map((i) => [i[0], clubeDoConecte(i[1], i[2])]));
  // jogador -> times deste tema onde jogou; só interessa quem passou por 3 ou mais (senão a dica seria quase o nome)
  const times = new Map<number, Set<string>>();
  for (const i of t.items) {
    const c = ci.get(i[0])!;
    if (c < 0) continue;
    for (const pix of jogadoresDoClube.get(c) ?? []) {
      if (!times.has(pix)) times.set(pix, new Set());
      times.get(pix)!.add(i[0]);
    }
  }
  for (const i of t.items) {
    i.length = 4;
    const reg = REGIAO[(CB.get(i[0]) ?? CB.get(i[2]))?.pais ?? ""] ?? "";
    const c = ci.get(i[0])!;
    if (c < 0) semClube.push(`${key}: ${i[1]}`);
    const nomes: string[] = [];
    if (c >= 0) {
      const cand = [...(jogadoresDoClube.get(c) ?? [])]
        .filter((pix) => estrela.has(pix) && !D.players[pix][3] && (times.get(pix)?.size ?? 0) >= 3)
        .sort((a, b) => estrela.get(a)! - estrela.get(b)!);
      for (const pix of cand.slice(0, 14)) nomes.push(D.players[pix][0]);
    }
    if (!nomes.length) semElenco.push(`${key}: ${i[1]}`);
    i[4] = reg;
    i[5] = nomes.join("|");
  }
}

writeFileSync(PATH, JSON.stringify(doc));
console.log("sem nascimento:", semDados.length, semDados.join("; "));
console.log("times sem clube no Conecte:", semClube.join("; "));
console.log("times sem ex-jogadores:", semElenco.length, semElenco.slice(0, 40).join("; "));
