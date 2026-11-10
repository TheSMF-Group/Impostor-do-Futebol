// Temas, fotos e escudos. A lista de temas carrega no início; fotos e escudos logo depois, em segundo plano.
import type { Theme, ThemeItem, ThemeKey } from "./types";

export const THEME_ORDER: ThemeKey[] = ["jbr", "jcl", "tbr", "teu", "len"];

export let THEMES: Record<string, Theme> = {};
let CRESTS: Record<string, string> = {};
const FOTOS: Record<string, Record<string, string>> = {};
const IDX: Record<string, Record<string, ThemeItem>> = {};

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function loadThemes(): Promise<void> {
  const t = await getJson<{ themes: Record<string, Theme> }>("/data/temas.json");
  THEMES = t?.themes ?? {};
  for (const k in THEMES) {
    IDX[k] = {};
    for (const i of THEMES[k].items) IDX[k][i[0]] = i;
  }
}

let mediaP: Promise<void> | null = null;
/** Fotos e escudos (cerca de 2 MB): carrega uma vez e reaproveita. */
export function loadMedia(): Promise<void> {
  if (!mediaP)
    mediaP = (async () => {
      const [cr, ...fs] = await Promise.all([
        getJson<Record<string, string>>("/data/escudos.json"),
        ...(["jbr", "jcl", "len"] as const).map((k) => getJson<Record<string, string>>(`/data/fotos-${k}.json`)),
      ]);
      CRESTS = cr ?? {};
      (["jbr", "jcl", "len"] as const).forEach((k, i) => (FOTOS[k] = fs[i] ?? {}));
    })();
  return mediaP;
}

export const themeName = (k: string): string => THEMES[k]?.n ?? "";
export const isPlayerTheme = (k: string): boolean => THEMES[k]?.k === "p";
export const itemOf = (k: string, id: string | null | undefined): ThemeItem | null => (id && IDX[k]?.[id]) || null;
export const photoOf = (k: string, id: string | null | undefined): string => (id && FOTOS[k]?.[id]) || "";
export const crestOf = (slug: string | undefined): string => (slug && CRESTS[slug]) || "";
