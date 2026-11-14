// Modo Local: um celular só, passando de mão em mão. Reaproveita as regras do jogo online
// (sorteio, votos, resultado, pontos); aqui só muda a navegação, que é toda no mesmo aparelho.
import { loadMedia, loadThemes, THEMES, THEME_ORDER, themeName } from "./data";
import { closeReveal, faceHTML, secretHTML, showCard } from "./card";
import { activeIds, catsOf, guessOk, maxImps, newRoomDoc, newRoundPatch, outcome, ranking, roundKey, scorePatch, stageKey, tallyVotes, votesPerPlayer } from "./rules";
import { sfx } from "./sfx";
import { COLORS } from "./state";
import type { Card, Room } from "./types";
import { $, dec, deepMerge, esc, ls, now } from "./util";

type Phase = "setup" | "pass" | "discuss" | "ballot" | "result" | "final";

const L = {
  names: [] as string[],
  room: null as Room | null,
  phase: "setup" as Phase,
  /** vez de quem no passa-passa (índice em activeIds) */
  idx: 0,
  /** o que a tela de passar o celular está pedindo */
  mode: "reveal" as "reveal" | "vote",
  /** alguém pediu para rever a carta durante a conversa */
  recheck: null as string | null,
  picks: [] as string[],
  discussSecs: 180,
  discussEnd: 0,
  scoredKey: "",
  err: "",
};

let onExit: () => void = () => {};
let timer: ReturnType<typeof setInterval> | null = null;

const ids = (): string[] => activeIds(L.room!);
const nick = (id: string): string => L.room?.players?.[id]?.nick || "?";
const colorOf = (id: string): string => COLORS[(L.room?.players?.[id]?.seat ?? 0) % COLORS.length];
const dot = (id: string, big = false): string =>
  `<span class="dot${big ? " dot-big" : ""}" style="background:${colorOf(id)}">${esc(nick(id)[0]?.toUpperCase() || "?")}</span>`;
const rk = (): string => roundKey(L.room!);
const view = (): HTMLElement => $("localView");

/* ---------- entrada e saída ---------- */
export async function enterLocal(exit: () => void): Promise<void> {
  onExit = exit;
  if (!Object.keys(THEMES).length) await loadThemes();
  void loadMedia();
  if (!L.names.length) {
    let saved: string[] = [];
    try {
      saved = JSON.parse(ls.get("idf-local-names") || "[]");
    } catch {
      /* sem nomes salvos */
    }
    L.names = saved.length >= 3 ? saved.slice(0, 15) : ["", "", "", ""];
  }
  const room = newRoomDoc("LOCAL", "p0", "");
  room.players = {};
  room.settings = { ...room.settings, voteMode: "multi", rounds: 1, clueTime: 0 };
  L.room = room;
  L.phase = "setup";
  L.err = "";
  $("scr-home").hidden = true;
  $("scr-room").hidden = true;
  $("scr-local").hidden = false;
  const tag = $("roomTag");
  tag.textContent = "LOCAL";
  tag.hidden = false;
  window.scrollTo(0, 0);
  render();
}

export function exitLocal(): void {
  if (timer) clearInterval(timer);
  timer = null;
  closeReveal();
  L.room = null;
  $("scr-local").hidden = true;
  $("roomTag").hidden = true;
  onExit();
}

export const localActive = (): boolean => !$("scr-local").hidden;

/* ---------- partida ---------- */
function applyPlayers(): boolean {
  const room = L.room!;
  const clean = L.names.map((n) => n.trim().replace(/\s+/g, " ").slice(0, 18)).filter(Boolean);
  if (clean.length < 3) {
    L.err = "Coloque pelo menos 3 jogadores.";
    return false;
  }
  const seen: Record<string, number> = {};
  const final = clean.map((n) => {
    const k = n.toLowerCase();
    seen[k] = (seen[k] || 0) + 1;
    return seen[k] > 1 ? `${n} ${seen[k]}` : n;
  });
  room.players = Object.fromEntries(final.map((n, i) => [`p${i}`, { nick: n, seat: i, at: 0 }]));
  ls.set("idf-local-names", JSON.stringify(clean));
  return true;
}

function newRound(): void {
  const room = L.room!;
  const n = ids().length;
  room.settings.imps = Math.min(room.settings.imps, maxImps(n));
  const sc = room.status === "result" ? scorePatch(room, true) : null;
  if (sc) deepMerge(room as never, sc);
  deepMerge(room as never, newRoundPatch(room));
  L.phase = "pass";
  L.mode = "reveal";
  L.idx = 0;
  L.recheck = null;
  L.picks = [];
  L.err = "";
  window.scrollTo(0, 0);
  render();
}

function goDiscuss(): void {
  L.phase = "discuss";
  L.discussEnd = L.discussSecs ? now() + L.discussSecs * 1000 : 0;
  render();
}

function finishVotes(): void {
  const room = L.room!;
  const res = tallyVotes(room);
  deepMerge(room as never, { status: "result", result: { [rk()]: res }, updatedAt: now() });
  L.phase = "result";
  window.scrollTo(0, 0);
  render();
}

async function showMyCard(id: string): Promise<void> {
  const room = L.room!;
  const raw = room.round!.cards[id];
  let c: Card;
  try {
    c = JSON.parse(dec(raw)) as Card;
  } catch {
    return;
  }
  await loadMedia();
  showCard(faceHTML(c, room.round!.cat), 750, () => {
    if (L.recheck) {
      L.recheck = null;
      L.phase = "discuss";
    } else {
      L.idx++;
      if (L.idx >= ids().length) {
        goDiscuss();
        return;
      }
    }
    render();
  });
}

/* ---------- telas ---------- */
const fmt = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

function stepper(): string {
  const labels = ["Cartas", "Conversa", "Votação", "Resultado"];
  const cur = L.phase === "pass" && L.mode === "reveal" ? 0 : L.phase === "discuss" ? 1 : L.phase === "ballot" || (L.phase === "pass" && L.mode === "vote") ? 2 : 3;
  return `<div class="stepbar"><span class="rn">Rodada ${L.room!.rn}</span><ol>${labels
    .map((l, i) => `<li class="${i < cur ? "done" : i === cur ? "cur" : ""}"><b>${i < cur ? "✓" : i + 1}</b><span>${l}</span></li>`)
    .join("")}</ol></div>`;
}

function setupHTML(): string {
  const room = L.room!;
  const s = room.settings;
  const n = L.names.map((x) => x.trim()).filter(Boolean).length;
  const mi = maxImps(Math.max(3, n));
  const cats = catsOf(room);
  const sw = (k: "inf" | "chaos" | "hint", t: string, d: string) =>
    `<div class="row"><div><div class="t">${t}</div><div class="d">${d}</div></div><label class="sw"><input type="checkbox" data-l="opt" data-k="${k}" ${s[k] ? "checked" : ""} aria-label="${t}"><span></span></label></div>`;
  const times: [number, string][] = [[120, "2 min"], [180, "3 min"], [300, "5 min"], [0, "Sem tempo"]];
  return `<div class="zone-top"><div class="kicker center">Modo local · um celular</div></div>
  <div class="zone-main">
    <div class="panel"><h3>Quem vai jogar · ${n}/15</h3>
      <p class="note" style="margin:-4px 0 12px">Escreva os nomes na ordem em que vão sentar. De 3 a 15 pessoas.</p>
      <div class="lnames">${L.names
        .map(
          (nm, i) =>
            `<div class="lname"><span class="dot" style="background:${COLORS[i % COLORS.length]}">${esc((nm.trim()[0] || String(i + 1)).toUpperCase())}</span><input class="field" data-l="name" data-i="${i}" value="${esc(nm)}" maxlength="18" placeholder="Jogador ${i + 1}" autocomplete="off" aria-label="Nome do jogador ${i + 1}">${
              L.names.length > 3 ? `<button class="x" type="button" data-l="rm" data-i="${i}" aria-label="Tirar jogador ${i + 1}">✕</button>` : ""
            }</div>`,
        )
        .join("")}</div>
      ${L.names.length < 15 ? `<button class="btn btn-ghost btn-sm" type="button" data-l="add" style="margin-top:10px">+ Adicionar jogador</button>` : ""}
    </div>
    <p class="err center" id="localErr" ${L.err ? "" : "hidden"}>${esc(L.err)}</p>
    <button class="btn btn-red btn-block cta" type="button" data-l="start" ${n < 3 || !cats.length ? "disabled" : ""}>${n < 3 ? "Faltam jogadores (mínimo 3)" : !cats.length ? "Escolha um tema" : "Começar partida"}</button>
    <button class="btn btn-ghost btn-block" type="button" data-l="exit">Voltar ao início</button>
  </div>
  <div class="zone-side"><div class="panel"><h3>Regras da rodada</h3>
    <div class="row"><div><div class="t">Impostores</div><div class="d">Até ${mi} com ${Math.max(3, n)} jogadores.</div></div><div class="stepper"><button type="button" data-l="imps" data-d="-1" ${s.imps <= 1 ? "disabled" : ""} aria-label="Menos impostores">−</button><output>${Math.min(s.imps, mi)}</output><button type="button" data-l="imps" data-d="1" ${s.imps >= mi ? "disabled" : ""} aria-label="Mais impostores">+</button></div></div>
    <div class="row"><div><div class="t">Tempo de conversa</div><div class="d">Depois que todo mundo viu a carta.</div></div><div class="seg">${times
      .map(([v, t]) => `<button type="button" data-l="time" data-k="${v}" aria-pressed="${L.discussSecs === v}">${t}</button>`)
      .join("")}</div></div>
    ${sw("inf", "Infiltrado", "O impostor recebe outro jogador ou time do mesmo tema e nem sabe que é impostor.")}
    ${sw("chaos", "Rodada caótica", "Uma rodada em seis vira bagunça: ninguém impostor, todo mundo impostor ou um a mais.")}
    ${sw("hint", "Dica do impostor", "Jogadores: o impostor vê o país e a posição. Times: a primeira letra e o tamanho do nome.")}
    <div class="row" style="display:block"><div class="t" style="margin-bottom:8px">Temas</div><div class="chips">${THEME_ORDER.filter((k) => THEMES[k])
      .map((k) => `<button type="button" class="chip" data-l="cat" data-k="${k}" aria-pressed="${cats.includes(k)}">${esc(THEMES[k].n)}<small>${THEMES[k].items.length}</small></button>`)
      .join("")}</div></div>
  </div></div>`;
}

function passHTML(): string {
  const list = ids();
  const reveal = L.mode === "reveal";
  const id = L.recheck || list[L.idx];
  const total = list.length;
  const prog = L.recheck ? "" : `<div class="lprog" aria-label="${L.idx + 1} de ${total}">${list.map((_, i) => `<i class="${i < L.idx ? "done" : i === L.idx ? "cur" : ""}"></i>`).join("")}</div>`;
  return `${stepper()}
  <div class="panel pass">
    <p class="kicker">${reveal ? (L.recheck ? "Rever a carta" : "Passe o celular") : "Hora de votar"}</p>
    ${dot(id, true)}
    <h2 class="pname">${esc(nick(id))}</h2>
    <p class="note">${reveal ? "Só " + esc(nick(id)) + " olha a tela. Os outros viram o rosto." : "Voto secreto: só " + esc(nick(id)) + " olha a tela."}</p>
    ${prog}
    <button class="btn btn-red btn-block" type="button" data-l="${reveal ? "card" : "ballot"}" data-id="${esc(id)}">${reveal ? "Sou " + esc(nick(id)) + ", ver minha carta" : "Sou " + esc(nick(id)) + ", votar"}</button>
    ${L.recheck ? `<button class="btn btn-ghost btn-block" type="button" data-l="back">Cancelar</button>` : ""}
  </div>`;
}

function discussHTML(): string {
  const r = L.room!.round!;
  const first = r.order[0];
  return `${stepper()}
  <div class="panel pass">
    <p class="kicker">Todo mundo já viu a carta</p>
    <p class="note" style="margin:0">Comecem pela pessoa:</p>
    ${dot(first, true)}
    <h2 class="pname">${esc(nick(first))}</h2>
    <p class="note">Cada um diz uma pista em voz alta, sem falar o nome nem o clube. Depois conversem e votem.</p>
    ${L.discussEnd ? `<div class="ttimer" id="dTimer"><span>Tempo de conversa</span><b>${fmt(L.discussEnd - now())}</b></div>` : ""}
    <button class="btn btn-red btn-block cta" type="button" data-l="tovote">Ir para a votação</button>
    <details class="panel manage" style="text-align:left;width:100%"><summary>Alguém esqueceu a carta?</summary>
      <p class="note" style="margin:8px 0 10px">Passe o celular só para a pessoa e toque no nome dela.</p>
      <div class="players">${ids().map((id) => `<button class="pl" type="button" data-l="recheck" data-id="${esc(id)}" style="border:0;color:var(--fg);text-align:left;width:100%;cursor:pointer">${dot(id)}<span class="nm">${esc(nick(id))}</span><span class="tag">Ver carta</span></button>`).join("")}</div>
    </details>
  </div>`;
}

function ballotHTML(): string {
  const room = L.room!;
  const list = ids();
  const me = list[L.idx];
  const k = votesPerPlayer(room);
  const ready = L.picks.includes("none") || L.picks.length >= k;
  const others = list.filter((id) => id !== me);
  return `${stepper()}
  <div class="kicker center">${esc(nick(me))}, em quem você vota?</div>
  <h2 class="big center">${k > 1 ? `Quem são os ${k} impostores?` : "Quem é o impostor?"}</h2>
  <div class="votes">${others
    .map((id) => `<button type="button" class="vote" data-l="pick" data-id="${esc(id)}" aria-pressed="${L.picks.includes(id)}">${dot(id)}<span>${esc(nick(id))}</span></button>`)
    .join("")}
  <button type="button" class="vote" data-l="pick" data-id="none" aria-pressed="${L.picks.includes("none")}" style="grid-column:1/-1;justify-content:center"><span style="flex:none">Ninguém é impostor</span></button></div>
  <p class="err center" id="localErr" ${L.err ? "" : "hidden"}>${esc(L.err)}</p>
  <button class="btn btn-red btn-block cta" type="button" data-l="confirm" ${ready ? "" : "disabled"}>${ready ? "Confirmar voto e passar o celular" : k > 1 ? `Escolha ${k} suspeitos (${L.picks.length}/${k})` : "Escolha um suspeito"}</button>`;
}

function rankHTML(title: string, showPlus: boolean): string {
  const room = L.room!;
  const rows = ranking(room);
  const last = room.scored?.[rk()] || {};
  if (!rows.length) return "";
  return `<div class="panel board"><h3>${title}</h3><p class="note" style="margin:-4px 0 10px">Impostor que vence: +3 · Elenco que vence: +1 cada</p><div class="brows">${rows
    .map(
      (x) =>
        `<div class="brow"><span class="bpos">${x.pos}º</span><span class="bnm">${esc(x.n)}</span>${showPlus && last[x.u] ? `<span class="bplus">+${last[x.u]}</span>` : ""}<span class="bpt">${x.p} pt${x.p === 1 ? "" : "s"}</span></div>`,
    )
    .join("")}</div></div>`;
}

function resultHTML(): string {
  const room = L.room!;
  const r = room.round!;
  const o = outcome(room, (id) => esc(nick(id)));
  const word = dec(r.secret);
  const decoy = r.decoy ? dec(r.decoy) : "";
  const tally = room.result?.[rk()]?.tally || {};
  const g = o.pending ? o.guessers![0] : "";
  if (!o.pending && L.scoredKey !== rk()) {
    L.scoredKey = rk();
    const sc = scorePatch(room);
    if (sc) deepMerge(room as never, sc);
  }
  const bad = (id: string) => r.imps.includes(id);
  return `${stepper()}
  <div class="result ${o.win ? "win" : "lose"}">${o.win ? "" : `<div style="font-family:var(--pixel);color:var(--red);font-size:52px;line-height:.9;text-shadow:3px 3px 0 var(--red-deep)">Impostor</div>`}<h2>${o.title}</h2><p>${o.sub}</p>${
    o.pending ? "" : `<div class="kicker" style="margin-top:8px">Carta secreta · ${esc(themeName(r.cat))}</div>${secretHTML(r.cat, dec(r.sid || ""), word)}`
  }${decoy && !o.pending ? `<p style="margin-top:8px;font-size:13px">O infiltrado recebeu: <b>${esc(decoy)}</b></p>` : ""}${r.chaos && !o.pending ? `<p style="margin-top:6px;font-size:13px">${esc(r.chaos)}</p>` : ""}</div>
  ${
    o.pending
      ? `<div class="panel turn-mine"><h3>${esc(nick(g))}, chute a carta</h3><p class="note" style="margin:-2px 0 10px">Você foi pego. Se acertar o ${r.cat && THEMES[r.cat]?.k === "p" ? "jogador" : "time"}, rouba a vitória. Diga em voz alta ou escreva.</p><div class="myturn"><input class="field" id="lGuess" maxlength="40" placeholder="Quem era o jogador ou time?" autocomplete="off" aria-label="Seu chute"><button class="btn btn-red" type="button" data-l="guess" data-id="${esc(g)}">Chutar</button></div><button class="btn btn-ghost btn-sm" type="button" data-l="skipguess" data-id="${esc(g)}" style="margin-top:10px">Não quero chutar</button></div>`
      : ""
  }
  <div class="panel"><h3>Quem era quem</h3><div class="roles">${r.players
    .map((id) => {
      const v = tally[id] || 0;
      return `<div class="${bad(id) ? "bad" : ""}"><span>${esc(nick(id))} <span class="note" style="font-weight:500">· ${v} voto${v === 1 ? "" : "s"}</span></span><em>${bad(id) ? "Impostor" : "Elenco"}</em></div>`;
    })
    .join("")}</div></div>
  ${o.pending ? "" : rankHTML("Placar", true)}
  ${o.pending ? "" : `<button class="btn btn-red btn-block cta" type="button" data-l="again">Próxima rodada</button><button class="btn btn-ghost btn-block" type="button" data-l="final">Encerrar e ver o ranking</button><button class="btn btn-ghost btn-block" type="button" data-l="setup">Mudar jogadores ou regras</button>`}`;
}

function finalHTML(): string {
  return `<div class="kicker center">Fim de jogo</div>
  <h2 class="big center">Ranking final</h2>
  ${rankHTML("Placar da noite", false)}
  <button class="btn btn-red btn-block cta" type="button" data-l="replay">Jogar de novo (placar zerado)</button>
  <button class="btn btn-ghost btn-block" type="button" data-l="exit">Voltar ao início</button>`;
}

function render(): void {
  const v = view();
  v.className = "col";
  const html =
    L.phase === "setup" ? setupHTML() : L.phase === "pass" ? passHTML() : L.phase === "discuss" ? discussHTML() : L.phase === "ballot" ? ballotHTML() : L.phase === "result" ? resultHTML() : finalHTML();
  v.innerHTML = html;
  if (L.phase === "setup") v.classList.add("wide");
  if (timer) clearInterval(timer);
  timer = null;
  if (L.phase === "discuss" && L.discussEnd) {
    let buzzed = false;
    timer = setInterval(() => {
      const el = document.getElementById("dTimer");
      if (!el) return;
      const left = L.discussEnd - now();
      el.querySelector("b")!.textContent = fmt(left);
      el.classList.toggle("low", left <= 15000);
      if (left <= 0 && !buzzed) {
        buzzed = true;
        sfx("tickHi");
        try {
          navigator.vibrate?.([200, 100, 200]);
        } catch {
          /* sem vibração */
        }
      }
    }, 500);
  }
  if (L.phase === "result") document.getElementById("lGuess")?.focus();
}

/* ---------- eventos ---------- */
export function wireLocal(): void {
  const v = view();
  v.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.l === "name") {
      L.names[Number(t.dataset.i)] = t.value;
      // atualiza só o contador e o botão, sem perder o foco do campo
      const n = L.names.map((x) => x.trim()).filter(Boolean).length;
      const btn = v.querySelector<HTMLButtonElement>('[data-l="start"]');
      if (btn) {
        btn.disabled = n < 3 || !catsOf(L.room!).length;
        btn.textContent = n < 3 ? "Faltam jogadores (mínimo 3)" : "Começar partida";
      }
      const dotEl = t.previousElementSibling as HTMLElement | null;
      if (dotEl) dotEl.textContent = (t.value.trim()[0] || String(Number(t.dataset.i) + 1)).toUpperCase();
      const h = v.querySelector(".panel h3");
      if (h) h.textContent = `Quem vai jogar · ${n}/15`;
    }
  });
  v.addEventListener("keydown", (e) => {
    const t = e.target as HTMLInputElement;
    if (e.key !== "Enter" || e.isComposing) return;
    if (t.id === "lGuess") void act("guess", v.querySelector<HTMLElement>('[data-l="guess"]')!);
    if (t.dataset?.l === "name") {
      e.preventDefault();
      const i = Number(t.dataset.i);
      const next = v.querySelector<HTMLInputElement>(`[data-l="name"][data-i="${i + 1}"]`);
      if (next) next.focus();
      else if (L.names.length < 15 && t.value.trim()) {
        L.names.push("");
        render();
        v.querySelector<HTMLInputElement>(`[data-l="name"][data-i="${L.names.length - 1}"]`)?.focus();
      }
    }
  });
  v.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-l]");
    if (!b || b.tagName === "INPUT") return;
    void act(b.dataset.l!, b);
  });
  v.addEventListener("change", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-l="opt"]');
    if (b) void act("opt", b);
  });
}

async function act(a: string, b: HTMLElement): Promise<void> {
  const room = L.room;
  if (!room) return;
  const s = room.settings;
  switch (a) {
    case "exit":
      exitLocal();
      break;
    case "add":
      if (L.names.length < 15) L.names.push("");
      render();
      v_focusLast();
      break;
    case "rm":
      L.names.splice(Number(b.dataset.i), 1);
      render();
      break;
    case "imps":
      s.imps = Math.max(1, s.imps + Number(b.dataset.d));
      render();
      break;
    case "time":
      L.discussSecs = Number(b.dataset.k);
      render();
      break;
    case "opt":
      (s as unknown as Record<string, boolean>)[b.dataset.k!] = (b as HTMLInputElement).checked;
      break;
    case "cat": {
      const k = b.dataset.k!,
        cur = catsOf(room);
      s.cats = cur.includes(k) ? cur.filter((x) => x !== k) : cur.concat(k);
      render();
      break;
    }
    case "start":
      L.err = "";
      if (!applyPlayers()) {
        render();
        return;
      }
      room.status = "lobby";
      room.rn = 0;
      room.scores = null;
      room.scored = null;
      room.used = [];
      room.result = {};
      room.votes = {};
      room.guess = {};
      newRound();
      break;
    case "card":
      await showMyCard(b.dataset.id!);
      break;
    case "recheck":
      L.recheck = b.dataset.id!;
      L.mode = "reveal";
      L.phase = "pass";
      render();
      break;
    case "back":
      L.recheck = null;
      L.phase = "discuss";
      render();
      break;
    case "tovote":
      L.phase = "pass";
      L.mode = "vote";
      L.idx = 0;
      L.picks = [];
      room.status = "vote";
      room.votes[stageKey(room)] = {};
      render();
      break;
    case "ballot":
      L.phase = "ballot";
      L.picks = [];
      L.err = "";
      render();
      break;
    case "pick": {
      const id = b.dataset.id!,
        k = votesPerPlayer(room);
      let p = L.picks.filter((x) => x !== "none");
      if (id === "none") p = L.picks.includes("none") ? [] : ["none"];
      else if (p.includes(id)) p = p.filter((x) => x !== id);
      else if (k === 1) p = [id];
      else if (p.length >= k) {
        L.err = `Você já escolheu ${k} suspeitos. Toque num deles para desmarcar.`;
        render();
        return;
      } else p.push(id);
      L.picks = p;
      L.err = "";
      render();
      break;
    }
    case "confirm": {
      const me = ids()[L.idx];
      room.votes[stageKey(room)][me] = L.picks.join(",");
      L.picks = [];
      L.idx++;
      if (L.idx >= ids().length) finishVotes();
      else {
        L.phase = "pass";
        render();
      }
      break;
    }
    case "guess":
    case "skipguess": {
      const id = b.dataset.id!;
      const t = a === "skipguess" ? "—" : (document.getElementById("lGuess") as HTMLInputElement).value.trim();
      if (!t) {
        L.err = "Escreva seu chute.";
        render();
        return;
      }
      const ok = a === "skipguess" ? false : guessOk(t, dec(room.round!.secret), room.round!.cat);
      deepMerge(room as never, { guess: { [rk()]: { [id]: { t, ok } } } });
      L.err = "";
      render();
      break;
    }
    case "again":
      newRound();
      break;
    case "setup":
      room.status = "lobby";
      L.phase = "setup";
      L.err = "";
      render();
      break;
    case "final": {
      const sc = room.status === "result" ? scorePatch(room, true) : null;
      if (sc) deepMerge(room as never, sc);
      L.phase = "final";
      window.scrollTo(0, 0);
      render();
      break;
    }
    case "replay":
      room.scores = null;
      room.scored = null;
      room.used = [];
      room.rn = 0;
      room.result = {};
      room.votes = {};
      room.guess = {};
      room.status = "lobby";
      newRound();
      break;
  }
}

function v_focusLast(): void {
  const inputs = view().querySelectorAll<HTMLInputElement>('[data-l="name"]');
  inputs[inputs.length - 1]?.focus();
}
