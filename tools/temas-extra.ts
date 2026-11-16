// Temas derivados e listas curadas por cima dos temas-base de public/data (jbr, jcl, tbr, teu, len).
//   node --experimental-strip-types tools/temas-extra.ts
// Pode rodar de novo: apaga o que gerou antes e refaz.
// Fontes (as pastas do build-data.ts não existem mais):
//   ~/theconnections/dados.js   banco do Conecte: id do Transfermarkt, nacionalidade, posição, clubes por temporada
//   ~/assets/faces-big/<tm>.jpg retratos 300x390;  ~/assets/clubs/clubes.json + png  escudos
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Item = string[]; // [id, nome, escudo, subtítulo, país?, posição?]
interface Theme { n: string; k: "p" | "t"; items: Item[] }

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "../public/data");
const ASSETS = join(homedir(), "assets");
const json = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const T = json<{ themes: Record<string, Theme> }>(join(DATA, "temas.json")).themes;
const CRESTS = json<Record<string, string>>(join(DATA, "escudos.json"));
const FOTOS: Record<string, string> = {};
for (const k of ["jbr", "jcl", "len"]) Object.assign(FOTOS, json(join(DATA, `fotos-${k}.json`)));
const EXT_PATH = join(DATA, "fotos-ext.json");
const EXT: Record<string, string> = {};

/* ---------- cortes pedidos (pouco conhecidos): saem de todos os temas, inclusive dos temas-base ---------- */
const TIRAR = new Set(["Alessandro Buongiorno", "Ilya Zabarnyi", "Jérémy Jacquet", "Jordan Barrera", "Josip Stanisic", "Kaio Pantaleão", "Kerwin Vargas"]);
for (const k of ["jbr", "jcl", "len"]) T[k].items = T[k].items.filter((i) => !TIRAR.has(i[1]));

/* ---------- limpa o que este script gerou antes ---------- */
const DERIVED = ["jge", "jbs", "jan", "jgr", "jgo", "tge", "tsa"];
for (const k of DERIVED) delete T[k];
const TEU_EXTRA = "celtic rangers olympiacos panathinaikos shakhtar dynamo-kyiv red-star-belgrade dinamo-zagreb salzburg basel anderlecht wolfsburg werder stuttgart gladbach frankfurt leeds nottm-forest leicester wolves parma bologna torino nice saint-etienne".split(" ");
T.teu.items = T.teu.items.filter((i) => !TEU_EXTRA.includes(i[0]));

/* ---------- clubes do pacote de assets ---------- */
interface Clube { arquivo: string; id: string; clube: string; pais: string; liga: string }
const CLUBES = json<Clube[]>(join(ASSETS, "clubs/clubes.json"));
const CB = Object.fromEntries(CLUBES.map((c) => [c.id, c]));
const tmp = mkdtempSync(join(tmpdir(), "imp-"));
let n = 0;
/** imagem -> data URI webp (cwebp) */
function webp(src: string, w: number, h: number, q: number): string {
  const out = join(tmp, `${n++}.webp`);
  execFileSync("cwebp", ["-quiet", "-q", String(q), "-resize", String(w), String(h), "-m", "6", src, "-o", out]);
  return "data:image/webp;base64," + readFileSync(out).toString("base64");
}
function crest(slug: string): string {
  if (CRESTS[slug]) return slug;
  const c = CB[slug];
  if (!c) throw new Error("clube sem escudo: " + slug);
  CRESTS[slug] = webp(join(ASSETS, "clubs", c.arquivo), 96, 96, 82);
  return slug;
}
const NOME_CLUBE: Record<string, string> = {};
for (const k of ["tbr", "teu"]) for (const i of T[k].items) NOME_CLUBE[i[0]] = i[1];
for (const k of ["jbr", "jcl", "len"]) for (const i of T[k].items) NOME_CLUBE[i[2]] ??= i[3];
const clubName = (slug: string) => NOME_CLUBE[slug] ?? CB[slug]?.clube ?? slug;
const PAIS: Record<string, string> = {
  argentina: "Argentina", uruguai: "Uruguai", chile: "Chile", colombia: "Colômbia", paraguai: "Paraguai", peru: "Peru", equador: "Equador",
  mexico: "México", "estados-unidos": "Estados Unidos", "arabia-saudita": "Arábia Saudita", egito: "Egito", "africa-do-sul": "África do Sul",
  tunisia: "Tunísia", marrocos: "Marrocos", japao: "Japão", "coreia-do-sul": "Coreia do Sul", catar: "Catar",
};

/* ---------- banco do Conecte ---------- */
const D = JSON.parse(readFileSync(join(homedir(), "theconnections/dados.js"), "utf8").replace(/^const DADOS = /, "").trim().replace(/;$/, "")) as {
  clubs: string[]; clubsCurto: string[]; players: [string, string, number, number, number, number[], string, number, number][];
  nats: [string, string][]; poss: string[]; stars: number[];
};
const NS = 47, BASE = 1980;
const STAR = new Map(D.stars.map((ix, r) => [ix, r]));
const POS_PT: Record<string, string> = { Lateral: "Lateral", Meia: "Meio-campo", Ponta: "Ponta", Volante: "Volante", Atacante: "Atacante", Goleiro: "Goleiro", Zagueiro: "Zagueiro", "Líbero": "Zagueiro" };
const porNome = new Map<string, number[]>();
D.players.forEach((p, ix) => {
  if (!p[6]) return;
  const k = norm(p[0]);
  porNome.set(k, [...(porNome.get(k) || []), ix]);
});
const ultima = (ix: number) => Math.max(...D.players[ix][5].map((c) => (c % NS) + BASE));
/** jogador do Conecte pelo nome: o mais famoso, depois o mais recente */
/** o CDN do Transfermarkt tem três formatos de nome de arquivo: "123-...", "s_123_..." e "123.png" */
const tmDe = (f: string) => f.match(/^(?:s_)?(\d+)/)?.[1] ?? "";
/** retrato 300x390; sem ele, o de 100x130 */
const retrato = (tm: string) => [join(ASSETS, "faces-big", tm + ".jpg"), join(ASSETS, "faces", tm + ".png")].find((f) => existsSync(f)) ?? null;
function conecte(nome: string, tm?: string): number | null {
  const c = (porNome.get(norm(nome)) || []).filter((ix) => (!tm || tmDe(D.players[ix][6]) === tm) && retrato(tmDe(D.players[ix][6])));
  if (!c.length) return null;
  c.sort((a, b) => (STAR.get(a) ?? 1e9) - (STAR.get(b) ?? 1e9) || ultima(b) - ultima(a));
  return c[0];
}

/* ---------- itens que já existem (reaproveita id, foto e escudo) ---------- */
const BASEP = ["jbr", "jcl", "len"];
const existente = new Map<string, Item>();
for (const k of BASEP) for (const i of T[k].items) if (!existente.has(norm(i[1]))) existente.set(norm(i[1]), i);

const faltou: string[] = [];
/** "Nome|clube"; "Nome=Nome na base|clube" quando a base grafa diferente; "Nome#id do TM|clube" para homônimos */
function jogador(spec: string, tema: string): Item | null {
  const [cab, slug] = spec.split("|");
  const [nomeTm, busca0] = cab.split("=");
  const [nome, tmFix] = nomeTm.split("#");
  const busca = busca0 ?? nome;
  const ja = existente.get(norm(nome));
  if (ja) return slug ? [ja[0], ja[1], crest(slug), clubName(slug), ja[4] ?? "", ja[5] ?? ""] : ja.slice();
  const ix = conecte(busca, tmFix);
  if (ix == null) {
    faltou.push(`${tema}: ${nome}`);
    return null;
  }
  const p = D.players[ix];
  const tm = tmDe(p[6]);
  const id = "p" + tm;
  if (!FOTOS[id] && !EXT[id]) EXT[id] = webp(retrato(tm)!, 150, 195, 74);
  if (!slug) throw new Error("sem clube: " + nome);
  return [id, nome, crest(slug), clubName(slug), D.nats[p[7]]?.[0] ?? "", POS_PT[D.poss[p[8]]] ?? ""];
}
const lista = (specs: string[], tema: string) => specs.map((s) => jogador(s, tema)).filter((x): x is Item => !!x);
const unico = (its: Item[]) => {
  const v = new Set<string>();
  return its.filter((i) => !v.has(i[0]) && v.add(i[0]));
};

/* ---------- Jogadores Antigos: aposentados que o público brasileiro de hoje reconhece (Brasileirão, Copas desde 2002,
   grandes da Europa de 2005 a 2020); sem repetir as Lendas. Nome dos anos 90 que só o fã antigo lembra fica de fora. ---------- */
const ANTIGOS = [
  "Robinho|santos",
  "Denílson#7660|betis",
  "Edílson#130295|corinthians",
  "Marcelinho Carioca|corinthians",
  "Vampeta|corinthians",
  "Elano|santos",
  "Diego|flamengo",
  "Alexandre Pato|ac-milan",
  "Júlio César|inter",
  "Maicon|inter",
  "Juan#1599|flamengo",
  "Emerson|roma",
  "Taffarel=Claudio Taffarel|gremio",
  "Kléberson|flamengo",
  "Edmílson#5343|barcelona",
  "Belletti=Juliano Belletti|barcelona",
  "Sylvinho|barcelona",
  "Daniel Alves=Dani Alves|barcelona",
  "Ramires|chelsea",
  "Anderson|man-utd",
  "Hernanes|lazio",
  "Felipe Melo|palmeiras",
  "Grafite|wolfsburg",
  "Vágner Love|corinthians",
  "Nilmar|internacional",
  "Djalminha|palmeiras",
  "Juninho Paulista|vasco",
  "Ricardinho#13833|corinthians",
  "Fernandinho|man-city",
  "Willian|chelsea",
  "David Luiz|chelsea",
  "Roberto Firmino|liverpool",
  "Oscar|chelsea",
  "Juan Sebastián Verón|estudiantes",
  "Marcelo Gallardo|river",
  "Carlos Tevez|boca",
  "Javier Mascherano|barcelona",
  "Diego Milito|inter",
  "Martín Palermo|boca",
  "Claudio Caniggia|boca",
  "Diego Simeone|atletico",
  "Ezequiel Lavezzi|napoli",
  "Gonzalo Higuaín|real-madrid",
  "Darío Conca|fluminense",
  "Andrés D'Alessandro|internacional",
  "Álvaro Recoba|inter",
  "Sebastián Abreu|botafogo",
  "Diego Lugano|sao-paulo",
  "Edinson Cavani|psg",
  "Jorge Valdivia|palmeiras",
  "Dejan Petković|flamengo",
  "Michael Ballack|bayern",
  "Ruud van Nistelrooy|man-utd",
  "Patrick Kluivert|barcelona",
  "Edgar Davids|juventus",
  "Edwin van der Sar|man-utd",
  "Robin van Persie|arsenal",
  "Gennaro Gattuso|ac-milan",
  "Filippo Inzaghi|ac-milan",
  "Christian Vieri|inter",
  "Marco Materazzi|inter",
  "Daniele De Rossi|roma",
  "David Trezeguet|juventus",
  "Claude Makélélé|real-madrid",
  "Robert Pires|arsenal",
  "Lilian Thuram|juventus",
  "Franck Ribéry|bayern",
  "Nicolas Anelka|chelsea",
  "Eric Cantona|man-utd",
  "Fernando Morientes|real-madrid",
  "Guti|real-madrid",
  "Xabi Alonso|liverpool",
  "Cesc Fàbregas|arsenal",
  "David Silva|man-city",
  "Santi Cazorla|villarreal",
  "Ashley Cole|chelsea",
  "Jamie Carragher|liverpool",
  "Peter Crouch|liverpool",
  "Gary Neville|man-utd",
  "Mesut Özil|arsenal",
  "Lukas Podolski|arsenal",
  "Rui Costa|ac-milan",
  "Ricardo Quaresma|porto",
  "Henrik Larsson|celtic",
  "Yaya Touré|man-city",
  "Michael Essien|chelsea",
  "Jay-Jay Okocha|psg",
  "Emmanuel Adebayor|arsenal",
  "Park Ji-sung=Ji-sung Park|man-utd",
  "Wesley Sneijder|inter",
  "Eden Hazard|chelsea",
  "Mario Balotelli|inter",
  "Paolo Guerrero|corinthians",
  "Jô|corinthians",
  "Renato Augusto|corinthians",
  "Lucas Leiva|liverpool",
  "Diego Tardelli|atletico-mg",
  "Thiago Neves|fluminense",
  "Walter Montillo|cruzeiro",
  "Mario Götze|dortmund",
  "Arjen Robben|bayern",
];

/* ---------- craques atuais fora das listas de clube ---------- */
const ATUAIS = [
  "Lionel Messi|inter-miami", "Cristiano Ronaldo|al-nassr", "Karim Benzema|al-hilal", "Luis Suárez|inter-miami", "Mohamed Salah|liverpool",
  "Kevin De Bruyne|napoli", "Robert Lewandowski|chicago-fire", "Luka Modrić|ac-milan", "Antoine Griezmann|orlando-city", "Son Heung-min=Heung-min Son|lafc",
  "Sadio Mané|al-nassr", "Riyad Mahrez|al-ahli-sa", "Bruno Fernandes|man-utd", "Bernardo Silva|real-madrid", "Rodri|man-city",
  "Virgil van Dijk|liverpool", "Paulo Dybala|roma", "Ángel Di María|rosario-central", "Thomas Müller|vancouver", "Toni Kroos|real-madrid",
  "Rafael Leão|ac-milan", "Christian Pulisic|ac-milan", "Victor Osimhen|galatasaray", "Romelu Lukaku|napoli", "Nico Williams|athletic",
  "João Félix|al-nassr", "Rodrigo De Paul|inter-miami", "Kalidou Koulibaly|al-hilal", "Rúben Neves|al-hilal", "Theo Hernández|al-hilal",
];
const BR_ATUAIS = [
  "Casemiro|inter-miami", "Alisson|liverpool", "Ederson|fenerbahce", "Marquinhos|psg", "Éder Militão|real-madrid", "Gabriel Martinelli|arsenal",
  "Gabriel Jesus|arsenal", "Richarlison|tottenham", "Endrick|real-madrid", "Philippe Coutinho|vasco", "Antony|betis", "Matheus Cunha|man-utd",
  "Savinho|man-city", "Bremer|juventus", "Danilo|flamengo", "Douglas Luiz|juventus", "Fabinho|al-ittihad", "Arthur|gremio",
  "Malcom#323704|al-hilal", "Vitor Roque|palmeiras", "João Gomes|aston-villa", "André|wolves", "Andreas Pereira|palmeiras", "Wesley|roma",
  "Luiz Henrique#800175|botafogo", "Igor Paixão|marseille", "Vinicius Junior|real-madrid",
];
const GOLEIROS_EXTRA = ["Gianluigi Donnarumma|man-city", "Emiliano Martínez|aston-villa", "Marc-André ter Stegen|barcelona", "Mike Maignan|ac-milan", "Yassine Bounou|al-hilal", "David de Gea|fiorentina", "Keylor Navas|pumas"];

const antigos = unico(lista(ANTIGOS, "jan")).filter((i) => !T.len.items.some((l) => l[0] === i[0]));
const atuais = lista(ATUAIS, "jge");
const brAtuais = lista(BR_ATUAIS, "jbs");
const golsExtra = lista(GOLEIROS_EXTRA, "jgo");
const todosP = unico([...T.jbr.items, ...T.jcl.items, ...atuais, ...brAtuais, ...T.len.items, ...antigos]);

T.jge = { n: "Jogadores em Geral", k: "p", items: todosP };
T.jbs = { n: "Jogadores Brasileiros", k: "p", items: todosP.filter((i) => i[4] === "Brasil") };
T.jan = { n: "Jogadores Antigos", k: "p", items: antigos };
T.jgr = { n: "Gringos do Brasileirão", k: "p", items: T.jbr.items.filter((i) => i[4] && i[4] !== "Brasil") };
T.jgo = { n: "Goleiros", k: "p", items: unico([...todosP.filter((i) => i[5] === "Goleiro"), ...golsExtra]) };

/* ---------- clubes ---------- */
T.tbr.n = "Clubes Brasileiros";
T.teu.n = "Clubes Europeus";
for (const s of TEU_EXTRA) T.teu.items.push([s, clubName(s), crest(s), CB[s].liga]);
const SULAM = "boca river racing independiente san-lorenzo estudiantes velez rosario-central penarol nacional-uru danubio defensor colo-colo u-de-chile u-catolica olimpia cerro-porteno libertad-py ldu-quito barcelona-sc independiente-valle emelec atl-nacional millonarios america-cali junior-barranquilla deportivo-cali alianza-lima universitario sporting-cristal".split(" ");
T.tsa = { n: "Clubes Sul-Americanos", k: "t", items: SULAM.map((s) => [s, clubName(s), crest(s), PAIS[CB[s].pais]]) };
const MUNDO = "america chivas cruz-azul monterrey tigres pumas inter-miami la-galaxy lafc al-hilal al-nassr al-ittihad al-ahli-sa al-ahly zamalek mamelodi-sundowns esperance-tunis raja-ca kashima-antlers jeonbuk-hyundai-motors".split(" ");
T.tge = {
  n: "Clubes do Mundo",
  k: "t",
  items: [...T.tbr.items.filter((i) => i[3] === "Série A"), ...T.teu.items, ...T.tsa.items, ...MUNDO.map((s) => [s, clubName(s), crest(s), PAIS[CB[s].pais]])],
};

/* ---------- grava ---------- */
const ORDEM = ["jge", "jbr", "jbs", "jcl", "jan", "len", "jgr", "jgo", "tge", "tbr", "teu", "tsa"];
const out: Record<string, Theme> = {};
for (const k of ORDEM) out[k] = T[k];
for (const t of Object.values(out)) for (const i of t.items) if (!CRESTS[i[2]]) throw new Error("sem escudo: " + i[2]);
for (const k of ["jge", "jbs", "jan", "jgr", "jgo"]) for (const i of out[k].items) if (!FOTOS[i[0]] && !EXT[i[0]]) throw new Error("sem foto: " + i[1]);
writeFileSync(join(DATA, "temas.json"), JSON.stringify({ themes: out }));
writeFileSync(join(DATA, "escudos.json"), JSON.stringify(Object.fromEntries(Object.keys(CRESTS).sort().map((s) => [s, CRESTS[s]]))));
writeFileSync(EXT_PATH, JSON.stringify(EXT));
for (const [k, t] of Object.entries(out)) console.log(k.padEnd(4), String(t.items.length).padStart(4), t.n);
console.log("fotos novas", Object.keys(EXT).length, "escudos", Object.keys(CRESTS).length);
if (faltou.length) console.log("NÃO ACHEI (" + faltou.length + "):\n  " + faltou.join("\n  "));
