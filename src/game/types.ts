// Formatos compartilhados do jogo: temas, sala (documento sincronizado) e banco.

/** [id, nome, escudo (slug), subtítulo (clube ou liga), país?, posição?] */
export type ThemeItem = [id: string, name: string, crest: string, sub: string, nat?: string, pos?: string];

export interface Theme {
  /** nome exibido */
  n: string;
  /** "p" = jogadores (foto), "t" = times (escudo) */
  k: "p" | "t";
  items: ThemeItem[];
}

export type ThemeKey = "jbr" | "jcl" | "tbr" | "teu" | "len";

export interface Settings {
  imps: number;
  inf: boolean;
  chaos: boolean;
  hint: boolean;
  rounds: number;
  cats: string[];
}

export interface Player {
  nick: string;
  seat: number;
  at: number;
}

export interface Round {
  cat: string;
  secret: string;
  sid?: string;
  decoy: string | null;
  did?: string | null;
  imps: string[];
  chaos: string | null;
  players: string[];
  order: string[];
  laps: number;
  cards: Record<string, string>;
}

export interface Clue {
  u: string;
  t: string;
}

export interface VoteResult {
  out: string | null;
  tally: Record<string, number>;
}

export interface Guess {
  t: string;
  ok: boolean;
}

export type RoomStatus = "lobby" | "clues" | "vote" | "result" | "closed";

export interface Room {
  code: string;
  host: string;
  status: RoomStatus;
  createdAt: number;
  updatedAt: number;
  settings: Settings;
  players: Record<string, Player | null>;
  rn: number;
  round: Round | null;
  clues: Record<string, Record<string, Clue>>;
  votes: Record<string, Record<string, string>>;
  result: Record<string, VoteResult>;
  guess: Record<string, Guess>;
  used: string[];
  /** versão do estado nas salas MQTT */
  _v?: number;
}

/** Carta de cada jogador (guardada embaralhada em round.cards). */
export interface Card {
  w?: string;
  id?: string;
  imp?: 1;
  tip?: string;
  nat?: string;
  pos?: string;
}

/** Atualização parcial: objetos são mesclados, null apaga. */
export type Patch = { [k: string]: unknown };

export interface DocSnap {
  id?: string;
  exists: boolean;
  data(): Room | undefined | null;
  metadata: { fromCache: boolean };
}

export interface QuerySnap {
  docs: DocSnap[];
  metadata: { fromCache: boolean };
}

export interface DocRef {
  get(): Promise<DocSnap>;
  set(d: Room): Promise<void>;
  update(p: Patch): Promise<void>;
  onSnapshot(next: (s: DocSnap) => void, err?: (e: unknown) => void): () => void;
}

export interface Query {
  where(field: string, op: string, value: unknown): Query;
  orderBy(field: string, dir?: string): Query;
  limit(n: number): Query;
  onSnapshot(next: (s: QuerySnap) => void, err?: (e: unknown) => void): () => void;
}

/** O mesmo formato para o banco do claude.ai e para as salas MQTT. */
export interface Db {
  doc(path: string): DocRef;
  collection(path: string): Query;
}
