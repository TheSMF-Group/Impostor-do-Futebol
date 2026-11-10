// Monta os dados do jogo em public/data a partir dos repositórios locais.
//   npm run data            (grava em public/data)
//   npm run data -- <pasta> (grava em outra pasta)
// Fontes:
//   ~/Documents/thefenomeno-jogos      fotos, escudos, jogadores da Champions e lendas
//   ~/Downloads/gloria-eterna-astro    The Manager: elencos e titulares do Brasileirão e fotos extras
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Item = string[]; // [id, nome, escudo, subtítulo, país?, posição?]
/** [id, nome, seleção, nascimento, clube, último ano, famoso] */
type P = [number, string, number | null, number, number, number, number];
interface TmPlayer {
  id: number;
  name: string;
  nat: string;
  pos: string;
  altPos?: string[];
  ovr: number;
  injured?: boolean;
  suspended?: boolean;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(homedir(), "Documents/thefenomeno-jogos");
const TM = join(homedir(), "Downloads/gloria-eterna-astro");
const OUT = process.argv[2] || join(HERE, "../public/data");

const json = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

const d = json<{ P: P[]; N: [string, string][]; C: [string, string | null][]; K: string[][] }>(join(SRC, "dados.json"));
const { P, C, N: NAT } = d;
const K = Object.fromEntries(d.K.map((k) => [k[0], k])) as Record<string, string[]>;

const F: Record<string, string> = {};
for (const f of ["fotos.json", "fotos-dificil.json"]) Object.assign(F, json(join(SRC, f)));
for (const f of readdirSync(join(SRC, "fotos")).filter((x) => /^s\d+\.json$/.test(x))) Object.assign(F, json(join(SRC, "fotos", f)));
const L = json<Record<string, string>>(join(SRC, "lendas.json"));
const E = json<Record<string, string>>(join(SRC, "escudos.json"));
const AT = json<Record<string, number>>(join(SRC, "atuais.json"));
const POS = json<Record<string, number[]>>(join(SRC, "posicoes.json"));

const words = (s: string) => s.split(" ");
const BR14 = words("flamengo palmeiras sao-paulo santos corinthians gremio internacional fluminense vasco cruzeiro atletico-mg bahia botafogo athletico-pr");
const BRT = [...BR14, ...words("mirassol bragantino vitoria-ba coritiba chapecoense remo")];
const SERIEB = words(
  "fortaleza ceara sport-recife juventude goias america-mg criciuma cuiaba crb avai vila-nova novorizontino operario-pr botafogo-sp ponte-preta londrina nautico sao-bernardo",
);
const EUT = words(
  "real-madrid barcelona atletico sevilla valencia villarreal athletic sociedad betis man-city man-utd liverpool chelsea arsenal tottenham newcastle aston-villa west-ham everton juventus inter ac-milan napoli roma lazio atalanta fiorentina bayern dortmund leverkusen leipzig psg marseille lyon monaco lille benfica porto sporting braga ajax psv feyenoord galatasaray fenerbahce besiktas",
);
const CL = words(
  "real-madrid barcelona atletico athletic villarreal man-city liverpool chelsea arsenal tottenham newcastle inter napoli juventus atalanta bayern dortmund leverkusen frankfurt psg marseille monaco benfica sporting psv ajax brugge galatasaray",
);
const POSN: Record<number, string> = {
  1: "Goleiro", 2: "Zagueiro", 3: "Zagueiro", 4: "Lateral-esquerdo", 5: "Lateral-direito", 6: "Volante", 7: "Meio-campo",
  8: "Meio-campo", 9: "Meio-campo", 10: "Meia-atacante", 11: "Ponta-esquerda", 12: "Ponta-direita", 13: "Atacante", 14: "Atacante",
};
// lendas com homônimos: id certo
const PICK: Record<string, number> = { Adriano: 5876, Fred: 31005, Alex: 18537 };
// lendas sem país/posição na base
const MANUAL: Record<string, [string, string]> = {
  "Alfredo Di Stéfano": ["Argentina", "Atacante"], "Carlos Alberto Torres": ["Brasil", "Lateral-direito"], "Ferenc Puskás": ["Hungria", "Atacante"],
  Garrincha: ["Brasil", "Ponta-direita"], "Gerd Müller": ["Alemanha", "Atacante"], "Gérson": ["Brasil", "Meio-campo"], Jairzinho: ["Brasil", "Ponta-direita"],
  "Just Fontaine": ["França", "Atacante"], "Nilton Santos": ["Brasil", "Lateral-esquerdo"], "Pelé": ["Brasil", "Atacante"], Rivellino: ["Brasil", "Meia-atacante"],
  "Tostão": ["Brasil", "Atacante"], "Vavá": ["Brasil", "Atacante"], Zagallo: ["Brasil", "Ponta-esquerda"],
};

const crests = new Set<string>();
const themes: Record<string, { n: string; k: "p" | "t"; items: Item[] }> = {};
const photos: Record<string, Record<string, string>> = {};
const cname = (s: string) => K[s][1];
const posOf = (p: P) => POS[String(p[0])] || [0, 0];
const natpos = (p: P): [string, string] => {
  const ps = POS[String(p[0])];
  return [p[2] != null && p[2] < NAT.length ? NAT[p[2]][0] : "", ps && ps.length > 1 ? POSN[ps[1]] || "" : ""];
};
const cidx = (slug: string) => C.map((c, i) => (c[1] === slug ? i : -1)).filter((i) => i >= 0);

/* ---------- Champions: 4-3-3 pelo valor de mercado ---------- */
const SLOTS: [number[], number][] = [[[1], 1], [[5], 1], [[2, 3], 2], [[4], 1], [[6, 7, 8, 9, 10], 3], [[11, 12, 13, 14], 3]];
const val = (p: P) => AT[String(p[0])] || (POS[String(p[0])] || [0])[0] * 0.3;
function xi(all: P[]): { out: P[]; full: boolean } {
  const ps = all.slice().sort((a, b) => val(b) - val(a));
  const used = new Set<number>();
  const out: P[] = [];
  let full = true;
  for (const [codes, n] of SLOTS) {
    const c = ps.filter((p) => !used.has(p[0]) && posOf(p).length > 1 && codes.includes(posOf(p)[1])).slice(0, n);
    if (c.length < n)
      c.push(...ps.filter((p) => !used.has(p[0]) && !c.includes(p) && posOf(p).length > 2 && posOf(p).slice(2).some((x) => codes.includes(x))).slice(0, n - c.length));
    if (c.length < n) full = false;
    for (const p of c) {
      used.add(p[0]);
      out.push(p);
    }
  }
  for (const p of ps) {
    if (out.length >= 11) break;
    if (!used.has(p[0]) && posOf(p)[1] !== 1) {
      used.add(p[0]);
      out.push(p);
    }
  }
  return { out, full };
}
function players(slugs: string[]): [Item[], Record<string, string>] {
  const items: Item[] = [];
  const ph: Record<string, string> = {};
  for (const s of slugs) {
    const idx = new Set(cidx(s).slice(0, 1));
    const { out, full } = xi(P.filter((p) => idx.has(p[4]) && p[5] >= 2026 && F[String(p[0])]));
    if (!full || out.some((p) => !natpos(p)[1])) {
      console.log("INCOMPLETO", s, out.length);
      continue;
    }
    for (const p of out) {
      items.push(["p" + p[0], p[1], s, cname(s), ...natpos(p)]);
      ph["p" + p[0]] = F[String(p[0])];
      crests.add(s);
    }
  }
  return [items, ph];
}

/* ---------- Brasileirão: elencos e escalação do The Manager ---------- */
const TD = join(TM, "src/game/data");
const MT: Record<string, { players: TmPlayer[] }> = {
  ...json<{ teams: Record<string, { players: TmPlayer[] }> }>(join(TD, "teams.json")).teams,
  ...json<Record<string, { players: TmPlayer[] }>>(join(TD, "serieA_extra_teams.json")),
  ...json<{ teams: Record<string, { players: TmPlayer[] }> }>(join(TD, "prelib.json")).teams,
};
const FACES = json<Record<string, number>>(join(TD, "faces.json"));
const TMNAME: Record<string, string> = {
  flamengo: "Flamengo", palmeiras: "Palmeiras", "sao-paulo": "São Paulo", santos: "Santos", corinthians: "Corinthians", gremio: "Grêmio",
  internacional: "Internacional", fluminense: "Fluminense", vasco: "Vasco da Gama", cruzeiro: "Cruzeiro", "atletico-mg": "Atlético Mineiro",
  bahia: "Bahia", botafogo: "Botafogo", "athletico-pr": "Athletico Paranaense",
};
const GRP: Record<string, string> = { GK: "GK", CB: "DEF", LB: "DEF", RB: "DEF", DMF: "MID", CM: "MID", AM: "MID", LM: "MID", RM: "MID", LW: "ATT", RW: "ATT", SS: "ATT", ST: "ATT" };
const PTN: Record<string, string> = {
  GK: "Goleiro", CB: "Zagueiro", LB: "Lateral-esquerdo", RB: "Lateral-direito", DMF: "Volante", CM: "Meio-campo", AM: "Meia-atacante",
  LM: "Meia-esquerda", RM: "Meia-direita", LW: "Ponta-esquerda", RW: "Ponta-direita", SS: "Segundo atacante", ST: "Atacante",
};
const F433 = ["GK", "LB", "CB", "CB", "RB", "DMF", "CM", "AM", "LW", "ST", "RW"];
// trocas manuais de titular: [clube, sai] -> entra
const BR_SWAP: [string, string, string][] = [["Flamengo", "Nicolás De La Cruz", "Giorgian De Arrascaeta"]];

const byName = new Map<string, P[]>();
for (const p of P) byName.set(p[1], [...(byName.get(p[1]) || []), p]);
// fotos do próprio The Manager entram quando a base do The Fenômeno não tem
const FDIR = join(TM, "public/images/faces");
for (const fn of readdirSync(FDIR)) {
  const ext = extname(fn),
    id = fn.slice(0, -ext.length);
  if (!F[id] && (ext === ".webp" || ext === ".jpg"))
    F[id] = `data:image/${ext === ".webp" ? "webp" : "jpeg"};base64,` + readFileSync(join(FDIR, fn)).toString("base64");
}
const tmPhoto = (pl: TmPlayer): string | null => {
  const tm = FACES[String(pl.id)];
  if (tm && F[String(tm)]) return String(tm);
  const c = (byName.get(pl.name) || []).filter((p) => F[String(p[0])] && p[5] >= 2024);
  return c.length === 1 ? String(c[0][0]) : null;
};
const eff = (p: TmPlayer, slot: string) =>
  p.ovr * (p.pos === slot ? 1 : (p.altPos || []).includes(slot) ? 0.93 : GRP[p.pos] === GRP[slot] ? 0.85 : 0.68);

{
  const it: Item[] = [];
  const ph: Record<string, string> = {};
  for (const [slug, tn] of Object.entries(TMNAME)) {
    const withPh = MT[tn].players.filter((p) => !p.injured && !p.suspended && tmPhoto(p));
    const used = new Set<number>();
    for (const slot of F433) {
      const b = withPh.filter((p) => !used.has(p.id)).reduce((x, y) => (eff(y, slot) > eff(x, slot) ? y : x));
      used.add(b.id);
      const tm = tmPhoto(b)!;
      it.push(["p" + tm, b.name, slug, cname(slug), b.nat, PTN[b.pos]]);
      ph["p" + tm] = F[tm];
      crests.add(slug);
    }
  }
  for (const [tn, out, inn] of BR_SWAP) {
    const slug = Object.keys(TMNAME).find((k) => TMNAME[k] === tn)!;
    const pl = MT[tn].players.find((p) => p.name === inn);
    const tm = pl && tmPhoto(pl);
    const i = it.findIndex((x) => x[2] === slug && x[1] === out);
    if (!pl || !tm || i < 0) throw new Error("troca impossível: " + tn + " " + out + " -> " + inn);
    delete ph[it[i][0]];
    it[i] = ["p" + tm, pl.name, slug, cname(slug), pl.nat, PTN[pl.pos]];
    ph["p" + tm] = F[tm];
  }
  themes.jbr = { n: "Jogadores do Futebol Brasileiro", k: "p", items: it };
  photos.jbr = ph;
}

/* ---------- Champions: ajustes manuais ---------- */
{
  let [it, ph] = players(CL);
  const CL_DROP = new Set(["brugge", "ajax", "psv", "atalanta", "tottenham"]);
  const CL_KEEP: Record<string, string[]> = {
    galatasaray: ["Victor Osimhen"], benfica: ["Anatoliy Trubin", "Richard Ríos", "Vangelis Pavlidis"], sporting: ["Pedro Gonçalves"],
    monaco: ["Vanderson", "Denis Zakaria", "Maghnes Akliouche", "Folarin Balogun", "Ansu Fati"], marseille: ["Igor Paixão"], leverkusen: ["Exequiel Palacios"],
  };
  const CL_REMOVE: Record<string, string[]> = {
    dortmund: ["Joane Gadou", "Carney Chukwuemeka", "Maximilian Beier"], bayern: ["Jonas Urbig"], juventus: ["Zeki Çelik", "Andrea Cambiaso"],
    napoli: ["Sam Beukema", "Miguel Gutiérrez", "Billy Gilmour", "Antonio Vergara"],
  };
  const CL_MOVE: Record<string, string> = { "Karim Adeyemi": "barcelona" };
  const CL_ADD: Record<string, string[]> = { bayern: ["Manuel Neuer", "Joshua Kimmich"] };
  for (const m of [CL_KEEP, CL_REMOVE])
    for (const [c, ns] of Object.entries(m))
      for (const n of ns) if (!it.some((i) => i[1] === n && i[2] === c)) throw new Error("não achei " + c + " " + n);
  it = it.filter((i) => !CL_DROP.has(i[2]) && (!CL_KEEP[i[2]] || CL_KEEP[i[2]].includes(i[1])) && !(CL_REMOVE[i[2]] || []).includes(i[1]));
  for (const i of it)
    if (CL_MOVE[i[1]]) {
      i[2] = CL_MOVE[i[1]];
      i[3] = cname(i[2]);
    }
  for (const [c, ns] of Object.entries(CL_ADD))
    for (const n of ns) {
      const ps = P.filter((p) => p[1] === n && F[String(p[0])]);
      if (ps.length !== 1) throw new Error(n + ": " + ps.length + " encontrados");
      it.push(["p" + ps[0][0], ps[0][1], c, cname(c), ...natpos(ps[0])]);
      ph["p" + ps[0][0]] = F[String(ps[0][0])];
    }
  ph = Object.fromEntries(it.map((i) => [i[0], ph[i[0]]]));
  themes.jcl = { n: "Jogadores da Champions League", k: "p", items: it };
  photos.jcl = ph;
}

/* ---------- times ---------- */
themes.tbr = {
  n: "Times Brasileiros",
  k: "t",
  items: [...BRT.map((s) => [s, cname(s), s, "Série A"]), ...SERIEB.map((s) => [s, cname(s), s, "Série B"])],
};
themes.teu = { n: "Times da Europa", k: "t", items: EUT.map((s) => [s, cname(s), s, K[s][4]]) };
[...BRT, ...SERIEB, ...EUT].forEach((s) => crests.add(s));

/* ---------- lendas ---------- */
{
  const LEG = json<Record<string, string>>(join(HERE, "lendas.json"));
  const it: Item[] = [];
  const ph: Record<string, string> = {};
  for (const [n, s] of Object.entries(LEG)) {
    let key: string, img: string, np: [string, string];
    if (L[n]) {
      key = "l" + it.length;
      img = L[n];
      np = MANUAL[n];
    } else {
      let ps = (byName.get(n) || []).filter((p) => F[String(p[0])]).sort((a, b) => b[6] - a[6]);
      if (PICK[n]) ps = (byName.get(n) || []).filter((p) => p[0] === PICK[n]);
      const p = ps[0];
      key = "p" + p[0];
      img = F[String(p[0])];
      np = natpos(p);
    }
    if (!K[s]) {
      console.log("sem escudo", n, s);
      continue;
    }
    it.push([key, n, s, cname(s), ...np]);
    ph[key] = img;
    crests.add(s);
  }
  themes.len = { n: "Lendas do Futebol", k: "p", items: it };
  photos.len = ph;
}

/* ---------- grava ---------- */
for (const s of crests) if (!E[s]) throw new Error("sem escudo: " + s);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "temas.json"), JSON.stringify({ themes }));
writeFileSync(join(OUT, "escudos.json"), JSON.stringify(Object.fromEntries([...crests].sort().map((s) => [s, E[s]]))));
for (const [t, ph] of Object.entries(photos)) writeFileSync(join(OUT, `fotos-${t}.json`), JSON.stringify(ph));
for (const [t, v] of Object.entries(themes)) console.log(t, v.items.length);
