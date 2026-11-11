// Momentos: avisos grandes em tela cheia quando algo muda na partida
// (contagem 3-2-1, "Deem seus palpites!", "Sua vez!", votação, resultado e chute).
import { closeReveal } from "./card";
import { themeName } from "./data";
import { guessesOf, isElim, roundKey, turnOf } from "./rules";
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
  const reveal = (out: string | null | undefined, imps: string[], after?: string) => {
    if (!out) st.push({ k: "Empate", b: "Ninguém saiu", s: after || "O impostor escapou", ms: 2000, c: "white", sfx: "innocent" });
    else if (out === "none")
      st.push({ k: "Vocês votaram", b: "Ninguém", s: after || (imps.length ? "Mas tinha impostor…" : "E não tinha mesmo!"), ms: 2000, c: "white", sfx: imps.length ? "innocent" : "win" });
    else {
      st.push({ k: "A galera tirou", b: nk(out), ms: 1400, c: "white", ring: true, sfx: "hit" });
      st.push(
        imps.includes(out)
          ? { b: "Era impostor!", s: after || (out === me ? "Você tem um chute para roubar a vitória" : "Agora ele pode chutar a carta"), ms: 2100, c: "shake", vib: true, sfx: "impostor" }
          : { b: "Era inocente!", s: after || "Ponto para o impostor", ms: 2000, c: "shake", sfx: "innocent" },
      );
    }
  };
  const newRound = r.status === "clues" && !!r.round && (p.rn !== r.rn || p.status === "lobby" || p.status === "result");
  if (newRound) {
    st.push({ k: "Rodada " + r.rn, b: "Vai começar", s: "Tema: " + esc(themeName(r.round!.cat)), ms: 1300, c: "white", sfx: "intro" });
    st.push(...COUNTDOWN);
    st.push({ b: "Deem seus palpites!", s: "Vire sua carta e pense na sua pista", ms: 1900, c: "shake", sfx: "whistle" });
  }
  // eliminação: acabou uma etapa e a rodada continua
  const pst = p.round?.stage || 1,
    rst = r.round?.stage || 1;
  if (!newRound && r.status === "clues" && r.round && p.rn === r.rn && rst > pst) {
    const res = r.result?.[roundKey(r) + (pst > 1 ? "s" + pst : "")];
    const left = r.round.imps.length - (r.round.outs || []).filter((o) => o.imp).length;
    st.push({ b: "Contando os votos…", ms: 1300, c: "white", sfx: "roll" });
    reveal(res?.out, r.round.imps, res?.out && r.round.imps.includes(res.out) ? (left === 1 ? "Ainda falta 1 impostor" : "Ainda faltam " + left + " impostores") : "Os impostores seguem no jogo");
    st.push({ k: "Etapa " + rst, b: "Mais uma volta", s: "Uma pista cada, de novo", ms: 1700, c: "shake", sfx: "whistle" });
  }
  if (r.status === "clues" && turnOf(r) === me && (st.length || turnOf(p) !== me || p.status !== "clues"))
    st.push({ k: "Pistas", b: "Sua vez!", s: "Escreva uma palavra só", ms: 1500, c: "white", vib: true, sfx: "turn" });
  if (r.status === "vote" && p.status !== "vote")
    st.push({ k: "Acabaram as pistas", b: "Hora da votação!", s: (r.round?.k || 1) > 1 && !isElim(r) ? "Quem são os impostores?" : "Quem é o impostor?", ms: 1900, c: "shake", sfx: "alarm" });
  if (r.status === "result" && p.status !== "result" && r.round) {
    const res = r.result?.[roundKey(r)],
      imps = r.round.imps;
    st.push({ b: "Contando os votos…", ms: 1300, c: "white", sfx: "roll" });
    if (imps.length === r.round.players.length) st.push({ k: "Rodada caótica", b: "Todo mundo era impostor!", ms: 2200, c: "shake", sfx: "impostor" });
    else if (isElim(r)) {
      reveal(res?.out, imps, res?.end === "caught" ? "Saíram todos os impostores" : " ");
      if (res?.end === "parity") st.push({ b: "Impostores venceram!", s: "O elenco ficou sem maioria", ms: 2200, c: "shake", sfx: "impostor" });
      else st.push({ b: "Hora dos chutes", s: "Cada impostor tenta adivinhar a carta", ms: 1900, c: "white", sfx: "turn" });
    } else {
      const outs = res?.outs || (res?.out && res.out !== "none" ? [res.out] : []);
      if (!outs.length) reveal(res?.out, imps);
      else for (const o of outs) reveal(o, imps, outs.length > 1 ? " " : undefined);
    }
  }
  if (r.status === "result" && p.rn === r.rn) {
    const G = guessesOf(r),
      PG = guessesOf(p);
    for (const [id, g] of Object.entries(G)) {
      if (PG[id]) continue;
      st.push({ k: "Chute de " + nk(id), b: "“" + esc(g.t) + "”", ms: 1500, c: "white", sfx: "roll" });
      st.push(
        g.ok
          ? { b: "Acertou!", s: id === me ? "Você roubou a vitória" : nk(id) + " roubou a vitória", ms: 2000, c: "shake", vib: true, sfx: "impostor" }
          : { b: "Errou!", s: "Ponto para o elenco", ms: 2000, c: "shake", sfx: "win" },
      );
    }
  }
  if (st.length) play(st);
}
