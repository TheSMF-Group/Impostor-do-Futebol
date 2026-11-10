// A carta de cada jogador: barra com o botão Virar carta, frente da carta e a virada em tela cheia.
import { crestOf, isPlayerTheme, itemOf, loadMedia, photoOf, themeName } from "./data";
import { S } from "./state";
import { sfx } from "./sfx";
import type { Card } from "./types";
import { dec, esc } from "./util";

export function myCard(): Card | null {
  const r = S.room?.round;
  if (!r) return null;
  const raw = r.cards?.[S.me];
  if (!raw) return null;
  try {
    return JSON.parse(dec(raw)) as Card;
  } catch {
    return null;
  }
}

export function cardBarHTML(): string {
  const c = myCard();
  if (!c) return `<div class="banner center"><b>Você entrou no meio da rodada.</b>Acompanhe e jogue a partir da próxima.</div>`;
  const room = S.room!;
  const seen = S.seenRn === room.rn;
  return `<div class="cardbar${seen ? "" : " pulse"}"><div class="minib" aria-hidden="true">?</div><div class="txt"><b>${seen ? "Sua carta está virada para baixo" : "Sua carta chegou"}</b><span>Tema: ${esc(themeName(room.round!.cat))}. ${seen ? "Pode ver de novo quando quiser." : "Cuidado com quem está do lado."}</span></div><button class="btn btn-red btn-sm${seen ? "" : " pulse"}" type="button" data-act="card">${seen ? "Ver de novo" : "Virar carta"}</button></div>`;
}

/** Frente da carta: foto do jogador ou escudo do time, com o escudo do clube no canto. */
export function faceHTML(c: Card, cat: string): string {
  if (c.imp) {
    const tip = c.tip ? c.tip.split(" · ") : null;
    return `<div class="award-face back cf imp"><div class="px">Impostor</div><p>Você não sabe quem é.<br>Tema: <b>${esc(themeName(cat))}</b></p>${
      c.nat || c.pos
        ? `<div class="hint2">${c.nat ? `<div><small>País</small><b>${esc(c.nat)}</b></div>` : ""}${c.pos ? `<div><small>Posição</small><b>${esc(c.pos)}</b></div>` : ""}</div>`
        : ""
    }${tip ? `<div class="tip">${esc(tip[0])}<small>${esc(tip[1] || "")}</small></div>` : ""}<p style="font-size:12.5px;color:var(--muted)">Escute as pistas e blefe.</p></div>`;
  }
  const it = itemOf(cat, c.id),
    isP = isPlayerTheme(cat),
    ph = isP ? photoOf(cat, c.id) : "",
    cr = it ? crestOf(it[2]) : "";
  const sub = it ? it[3] : "";
  return `<div class="award-face back cf"><div class="cf-top"><small>${esc(themeName(cat))}</small>${isP && cr ? `<img src="${cr}" alt="Escudo ${esc(sub)}">` : ""}</div>
    <div class="cf-ph">${isP ? (ph ? `<img class="p" src="${ph}" alt="">` : "") : cr ? `<img class="big" src="${cr}" alt="">` : ""}</div>
    <div class="cf-nm"><b>${esc(c.w)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div></div>`;
}

/** Carta secreta no resultado (foto ou escudo, nome e clube). */
export function secretHTML(cat: string, id: string | null, name: string): string {
  const it = id ? itemOf(cat, id) : null,
    isP = isPlayerTheme(cat),
    ph = isP && id ? photoOf(cat, id) : "",
    cr = it ? crestOf(it[2]) : "";
  return `<div class="secret"><div class="ph">${ph ? `<img src="${ph}" alt="">` : cr ? `<img class="cr" src="${cr}" alt="">` : ""}</div><div class="tx"><b>${esc(name)}</b>${it ? `<span>${esc(it[3])}</span>` : ""}</div>${isP && cr ? `<img class="crest" src="${cr}" alt="">` : ""}</div>`;
}

const CONF_COLORS = ["#FF2A2A", "#ffffff", "#8B0000", "#ff7a7a"];
const confetti = () =>
  Array.from(
    { length: 30 },
    (_, i) =>
      `<i class="confetti-piece" style="left:${(Math.random() * 100).toFixed(1)}%;width:${6 + Math.floor(Math.random() * 6)}px;height:${10 + Math.floor(Math.random() * 8)}px;background:${CONF_COLORS[i % 4]};animation-duration:${(1.8 + Math.random() * 1.6).toFixed(2)}s;animation-delay:${(Math.random() * 0.6).toFixed(2)}s"></i>`,
  ).join("");

const revKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") closeReveal();
};

export function closeReveal(): void {
  document.querySelectorAll(".rev").forEach((x) => x.remove());
  document.removeEventListener("keydown", revKey);
}

/** Mostra uma carta em tela cheia: verso com "?" e, depois, a virada 3D com brilho e confete. */
export function showCard(face: string, delay: number): void {
  closeReveal();
  const el = document.createElement("div");
  el.className = "rev";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Sua carta");
  el.innerHTML = `<div class="rev-glow"></div>${confetti()}<div class="award-perspective"><div class="award-card"><div class="award-face"><div class="cb-logo"><div class="px">Impostor</div><div class="sc">do Futebol</div></div><div class="cb-q">?</div><div class="cb-dots"><u></u><u></u><u></u></div></div>${face}</div></div><button class="btn btn-white rev-close" type="button" data-x="1">Esconder carta</button>`;
  document.body.appendChild(el);
  sfx("flip", Math.max(0, delay / 1000 - 0.3));
  setTimeout(() => {
    el.querySelector(".award-card")?.classList.add("flipped");
    el.classList.add("on");
  }, delay);
  el.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-x]") || (t === el && el.classList.contains("on"))) closeReveal();
  });
  document.addEventListener("keydown", revKey);
  setTimeout(() => el.querySelector<HTMLButtonElement>(".rev-close")?.focus(), 50);
}

/** Vira a carta deste jogador na rodada atual. */
export async function openReveal(after: () => void): Promise<void> {
  const c = myCard(),
    room = S.room;
  if (!c || !room?.round) return;
  await loadMedia();
  const first = S.seenRn !== room.rn;
  S.seenRn = room.rn;
  S.revRn = room.rn;
  showCard(faceHTML(c, room.round.cat), first ? 1100 : 450);
  after();
}
