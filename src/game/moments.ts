// Momentos: avisos grandes em tela cheia quando algo muda na partida
// (contagem 3-2-1, "Deem seus palpites!", "Sua vez!", votação, resultado e chute).
import { closeReveal } from "./card";
import { themeName } from "./data";
import { roundKey, turnOf } from "./rules";
import type { Room } from "./types";
import { sfx, type Sfx } from "./sfx";
import { esc } from "./util";

export interface Moment {
  /** linha pequena em cima */
  k?: string;
  /** texto grande (HTML já escapado) */
  b: string;
  /** linha de baixo */
  s?: string;
  ms?: number;
  /** "white" | "num" | "shake" */
  c?: string;
  ring?: boolean;
  vib?: boolean;
  /** efeito sonoro tocado quando o aviso aparece */
  sfx?: Sfx;
}

let queue: Moment[] = [];
let running = false;
let el: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export const COUNTDOWN: Moment[] = ["3", "2", "1"].map((n) => ({ b: n, ms: 800, c: "num", ring: true, sfx: n === "1" ? "tickHi" : "tick" }));

export function play(list: Moment[], replace = false): void {
  if (replace) queue = [];
  queue.push(...list);
  if (!running || replace) next();
}

export function stop(): void {
  queue = [];
  next();
}

function next(): void {
  clearTimeout(timer);
  const x = queue.shift();
  if (!x) {
    running = false;
    el?.remove();
    el = null;
    return;
  }
  running = true;
  closeReveal();
  if (!el) {
    el = document.createElement("div");
    el.className = "mo";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "assertive");
    el.addEventListener("click", stop);
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="mo-in ${x.c || ""}">${x.ring ? '<span class="ring"></span>' : ""}${x.k ? `<span class="k">${x.k}</span>` : ""}<b>${x.b}</b>${x.s ? `<small>${x.s}</small>` : ""}</div><div class="mo-skip">Toque para pular</div>`;
  sfx(x.sfx);
  if (x.vib) {
    try {
      navigator.vibrate?.(120);
    } catch {
      /* sem vibração */
    }
  }
  timer = setTimeout(next, x.ms || 1500);
}

/** Compara o estado anterior com o novo e enfileira os avisos. Não repete nada ao entrar ou recarregar. */
export function cue(p: Room | null, r: Room, me: string): void {
  if (!p || p.code !== r.code) return;
  // mensagem nova de outra pessoa no chat da votação: só um toque curto
  if (r.status === "vote" && p.rn === r.rn) {
    const k = roundKey(r);
    const old = p.chat?.[k] || {};
    if (Object.entries(r.chat?.[k] || {}).some(([id, m]) => m && !old[id] && m.u !== me)) sfx("msg");
  }
  const nk = (id: string) => esc(r.players?.[id]?.nick || "Alguém");
  const st: Moment[] = [];
  if (r.status === "clues" && r.round && (p.status !== "clues" || p.rn !== r.rn)) {
    st.push({ k: "Rodada " + r.rn, b: "Vai começar", s: "Tema: " + esc(themeName(r.round.cat)), ms: 1300, c: "white", sfx: "intro" });
    st.push(...COUNTDOWN);
    st.push({ b: "Deem seus palpites!", s: "Vire sua carta e pense na sua pista", ms: 1900, c: "shake", sfx: "whistle" });
  }
  if (r.status === "clues" && turnOf(r) === me && (st.length || turnOf(p) !== me || p.status !== "clues"))
    st.push({ k: "Pistas", b: "Sua vez!", s: "Escreva uma palavra só", ms: 1500, c: "white", vib: true, sfx: "turn" });
  if (r.status === "vote" && p.status !== "vote")
    st.push({ k: "Acabaram as pistas", b: "Hora da votação!", s: "Quem é o impostor?", ms: 1900, c: "shake", sfx: "alarm" });
  if (r.status === "result" && p.status !== "result" && r.round) {
    const out = r.result?.[roundKey(r)]?.out,
      imps = r.round.imps;
    st.push({ b: "Contando os votos…", ms: 1300, c: "white", sfx: "roll" });
    if (imps.length === r.round.players.length) st.push({ k: "Rodada caótica", b: "Todo mundo era impostor!", ms: 2200, c: "shake", sfx: "impostor" });
    else if (!out) st.push({ k: "Empate", b: "Ninguém saiu", s: "O impostor escapou", ms: 2000, c: "white", sfx: "innocent" });
    else if (out === "none")
      st.push({ k: "Vocês votaram", b: "Ninguém", s: imps.length ? "Mas tinha impostor…" : "E não tinha mesmo!", ms: 2000, c: "white", sfx: imps.length ? "innocent" : "win" });
    else {
      st.push({ k: "A galera tirou", b: nk(out), ms: 1400, c: "white", ring: true, sfx: "hit" });
      st.push(
        imps.includes(out)
          ? { b: "Era o impostor!", s: out === me ? "Você tem um chute para roubar a vitória" : "Agora ele pode chutar o nome", ms: 2100, c: "shake", vib: true, sfx: "impostor" }
          : { b: "Era inocente!", s: "O impostor venceu", ms: 2000, c: "shake", sfx: "innocent" },
      );
    }
  }
  const g = r.guess?.[roundKey(r)],
    pg = p.guess?.[roundKey(p)];
  if (r.status === "result" && g && !(pg && p.rn === r.rn)) {
    st.push({ k: "Chute do impostor", b: "“" + esc(g.t) + "”", ms: 1500, c: "white", sfx: "roll" });
    st.push(
      g.ok
        ? { b: "Acertou!", s: "O impostor roubou a vitória", ms: 2000, c: "shake", vib: true, sfx: "impostor" }
        : { b: "Errou!", s: "Vitória do elenco", ms: 2000, c: "shake", sfx: "win" },
    );
  }
  if (st.length) play(st);
}
