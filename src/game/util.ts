// Utilidades pequenas usadas em todo o jogo.

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const ls = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* armazenamento bloqueado: segue sem lembrar */
    }
  },
};

export function shuffle<T>(a: readonly T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

/** Embaralha um texto (base64 invertido) para não ficar legível nos dados da sala. */
export const enc = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).split("").reverse().join("");
};

export const dec = (s: unknown): string => {
  try {
    const bin = atob(String(s).split("").reverse().join(""));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
};

export const norm = (s: unknown): string =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export const now = (): number => Date.now();

export const jclone = <T>(o: T): T => (o == null ? o : (JSON.parse(JSON.stringify(o)) as T));

type Obj = { [k: string]: unknown };
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Mescla b dentro de a (como o update do banco): objetos se juntam, o resto substitui. */
export function deepMerge<T extends Obj>(a: T, b: Obj): T {
  const t = a as Obj;
  for (const k in b) {
    const v = b[k];
    if (isObj(v) && isObj(t[k])) deepMerge(t[k] as Obj, v);
    else t[k] = jclone(v);
  }
  return a;
}
