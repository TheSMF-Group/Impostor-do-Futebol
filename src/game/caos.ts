import type { Settings } from "./types.ts";

/** CAOS = impostor infiltrado + rodadas caóticas. Salas antigas com o "Infiltrado" avulso ligado também valem como CAOS. */
export const caosLigado = (s: Pick<Settings, "chaos" | "inf">): boolean => !!(s.chaos || s.inf);
