// Mantém a tela acesa durante a partida (Wake Lock). Sem suporte, não faz nada.
type Sentinel = { release(): Promise<void>; addEventListener(t: string, f: () => void): void };
let lock: Sentinel | null = null;
let wanted = false;

async function grab(): Promise<void> {
  if (!wanted || lock || document.visibilityState !== "visible") return;
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<Sentinel> } };
    const l = await nav.wakeLock?.request("screen");
    if (!l) return;
    lock = l;
    l.addEventListener("release", () => (lock = null));
  } catch {
    /* bateria fraca ou sem permissão: segue sem */
  }
}

document.addEventListener("visibilitychange", () => void grab());

export function keepAwake(on: boolean): void {
  wanted = on;
  if (on) void grab();
  else {
    void lock?.release().catch(() => {});
    lock = null;
  }
}
