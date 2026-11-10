// Efeitos sonoros originais, gerados na hora com Web Audio (sem arquivos de áudio).
// O navegador só libera som depois do primeiro toque na página; antes disso, play() não faz nada.

export type Sfx =
  | "intro" // "Vai começar": subida grave
  | "tick" // 3, 2
  | "tickHi" // 1
  | "whistle" // "Deem seus palpites!": apito de juiz
  | "turn" // "Sua vez!"
  | "alarm" // "Hora da votação!"
  | "roll" // "Contando os votos…": rufar
  | "hit" // nome de quem saiu
  | "impostor" // impostor pego / impostor venceu: acorde sombrio
  | "innocent" // tiraram alguém do elenco
  | "win" // vitória do elenco
  | "flip"; // carta virando

const KEY = "idf-mute";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(m: boolean): void {
  try {
    if (m) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
  if (master) master.gain.value = m ? 0 : 0.8;
}

/** Cria o contexto de áudio no primeiro toque. Chame uma vez ao iniciar a página. */
export function unlockOnGesture(): void {
  const go = () => {
    ensure();
    void ctx?.resume();
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, go, { once: true, passive: true });
}

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = isMuted() ? 0 : 0.8;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

/* ---------- blocos ---------- */

function env(g: GainNode, t: number, a: number, peak: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone(type: OscillatorType, f0: number, t: number, dur: number, peak = 0.3, f1?: number, a = 0.01): OscillatorNode {
  const c = ctx!,
    o = c.createOscillator(),
    g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, a, peak, dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function noise(t: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1?: number, q = 1): void {
  const c = ctx!,
    s = c.createBufferSource(),
    f = c.createBiquadFilter(),
    g = c.createGain();
  s.buffer = noiseBuf;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, 0.005, peak, dur);
  s.connect(f).connect(g).connect(master!);
  s.start(t);
  s.stop(t + dur + 0.05);
}

function boom(t: number, peak = 0.9): void {
  tone("sine", 140, t, 0.7, peak, 38, 0.005);
  noise(t, 0.25, 0.35, "lowpass", 900, 120);
}

/* ---------- sons ---------- */

const SOUNDS: Record<Sfx, (t: number) => void> = {
  intro: (t) => {
    tone("sawtooth", 55, t, 1.1, 0.12, 110, 0.4);
    tone("sawtooth", 55.6, t, 1.1, 0.12, 111, 0.4);
    noise(t, 1.0, 0.12, "bandpass", 300, 3000, 2);
  },
  tick: (t) => {
    tone("square", 660, t, 0.12, 0.12);
    noise(t, 0.04, 0.2, "highpass", 4000);
  },
  tickHi: (t) => {
    tone("square", 990, t, 0.2, 0.14);
    noise(t, 0.04, 0.2, "highpass", 4000);
  },
  whistle: (t) => {
    // apito: tom agudo com trinado rápido, em duas sopradas
    for (const [st, du] of [
      [0, 0.18],
      [0.24, 0.55],
    ]) {
      const o = tone("sine", 2900, t + st, du, 0.22, undefined, 0.02);
      const lfo = ctx!.createOscillator(),
        lg = ctx!.createGain();
      lfo.frequency.value = 38;
      lg.gain.value = 140;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t + st);
      lfo.stop(t + st + du + 0.05);
      noise(t + st, du, 0.05, "bandpass", 2900, undefined, 4);
    }
  },
  turn: (t) => {
    tone("triangle", 784, t, 0.18, 0.25);
    tone("triangle", 1175, t + 0.12, 0.3, 0.25);
  },
  alarm: (t) => {
    for (let i = 0; i < 4; i++) {
      tone("square", 520, t + i * 0.32, 0.15, 0.1);
      tone("square", 390, t + i * 0.32 + 0.16, 0.15, 0.1);
    }
  },
  roll: (t) => {
    for (let i = 0; i < 18; i++) noise(t + i * 0.06, 0.07, 0.08 + i * 0.012, "bandpass", 180 + i * 6, undefined, 1.5);
  },
  hit: (t) => {
    boom(t, 0.8);
    noise(t, 0.6, 0.15, "highpass", 6000, 2000);
  },
  impostor: (t) => {
    boom(t);
    // acorde menor dissonante descendo, com dois osciladores desafinados por nota
    for (const f of [110, 130.8, 155.6, 233]) {
      tone("sawtooth", f, t, 1.6, 0.06, f * 0.94, 0.03);
      tone("sawtooth", f * 1.008, t, 1.6, 0.06, f * 0.94, 0.03);
    }
  },
  innocent: (t) => {
    [392, 370, 349, 262].forEach((f, i) => tone("triangle", f, t + i * 0.28, i === 3 ? 0.9 : 0.3, 0.22));
  },
  win: (t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone("square", f, t + i * 0.11, i === 3 ? 0.7 : 0.16, 0.1));
    noise(t + 0.3, 1.4, 0.08, "bandpass", 1200, 800, 0.6); // torcida
  },
  flip: (t) => {
    noise(t, 0.35, 0.25, "bandpass", 600, 4000, 1.2);
    [1568, 2093, 2637].forEach((f, i) => tone("sine", f, t + 0.35 + i * 0.07, 0.4, 0.08));
  },
};

export function sfx(name: Sfx | undefined, delay = 0): void {
  if (!name || isMuted()) return;
  const c = ensure();
  if (!c || c.state !== "running") return;
  SOUNDS[name](c.currentTime + 0.02 + delay);
}
