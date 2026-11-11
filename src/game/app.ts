// Telas, ações e início do jogo.
import { connect } from "./backend";
import { cardBarHTML, closeReveal, openReveal, secretHTML } from "./card";
import { THEME_ORDER, THEMES, loadMedia, loadThemes, themeName } from "./data";
import { cue } from "./moments";
import { isMuted, setMuted, unlockOnGesture } from "./sfx";
import {
  activeIds,
  catsOf,
  cluesByPlayer,
  elimPatch,
  genCode,
  guessOk,
  guessesOf,
  isElim,
  liveIds,
  maxImps,
  newRoomDoc,
  newRoundPatch,
  outcome,
  picksOf,
  roundKey,
  stageKey,
  tallyVotes,
  votesPerPlayer,
} from "./rules";
import { S, colorOf, isHost, nickOf } from "./state";
import type { ChatMsg, Patch, Room } from "./types";
import { $, dec, esc, ls, now } from "./util";

const screen = (): "home" | "room" => (S.code ? "room" : "home");
const ref = () => S.db!.doc("rooms/" + S.code);
const rk = () => roundKey(S.room!);

function homeErr(t: string): void {
  const el = $("homeErr");
  el.textContent = t || "";
  el.hidden = !t;
}
function roomErr(t: string): void {
  const el = document.getElementById("roomErr");
  if (el) {
    el.textContent = t;
    el.hidden = false;
  }
}
const alertBox = (t: string) => (screen() === "home" ? homeErr(t) : roomErr(t));

/** Grava no banco e mostra um aviso amigável se der errado. */
async function write(fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "invalid_argument") {
      S.readOnly = true;
      alertBox("Sua conta não pode jogar aqui. Peça ao dono do jogo para te convidar como Editor.");
    } else if (code === "quota_exceeded") alertBox("O jogo atingiu o limite de salas. Avise o dono do jogo.");
    else alertBox("Não deu para salvar. Confira a conexão e tente de novo.");
    return false;
  }
}

const dot = (id: string) =>
  `<span class="dot" style="background:${colorOf(id)}">${esc(nickOf(id)[0]?.toUpperCase() || "?")}</span>`;

/* ---------- início ---------- */
async function boot(): Promise<void> {
  $<HTMLInputElement>("nick").value = ls.get("idf-nick") || "";
  await loadThemes();
  void loadMedia();
  render();
  const b = await connect();
  if (!b) {
    noDb();
    return;
  }
  S.db = b.db;
  S.me = b.me;
  S.readOnly = b.readOnly;
  const nick = $<HTMLInputElement>("nick");
  if (!nick.value && b.nick) nick.value = b.nick;
  if (S.readOnly) homeErr("Sua conta só pode ver este jogo. Peça ao dono do jogo para te convidar como Editor para poder jogar.");
  watchList();
  const saved = ls.get("idf-room");
  if (saved) enterRoom(saved, true);
}

function noDb(): void {
  $("roomsNote").textContent = "";
  $("rooms").innerHTML = `<div class="empty">Não deu para conectar ao servidor das salas. Confira a internet e recarregue a página.</div>`;
  for (const id of ["createBtn", "joinBtn"]) $<HTMLButtonElement>(id).disabled = true;
}

/* ---------- lista de salas ---------- */
function watchList(): void {
  if (S.unsubList || !S.db) return;
  const t = setTimeout(() => ($("roomsNote").textContent = "Não deu para carregar as salas ainda."), 10000);
  S.unsubList = S.db
    .collection("rooms")
    .where("status", "==", "lobby")
    .orderBy("updatedAt", "desc")
    .limit(20)
    .onSnapshot(
      (s) => {
        if (!s.metadata.fromCache) clearTimeout(t);
        const tnow = Date.now();
        const list = s.docs
          .map((d) => d.data())
          .filter((r): r is Room => !!r && tnow - (r.updatedAt || 0) < 30 * 60e3 && activeIds(r).length > 0 && !!r.players?.[r.host]);
        $("roomsNote").textContent = list.length ? list.length + (list.length > 1 ? " salas esperando jogadores" : " sala esperando jogadores") : "";
        $("rooms").innerHTML = list.length
          ? list
              .map((r) => {
                const n = activeIds(r).length;
                const host = r.players?.[r.host]?.nick || "Anfitrião";
                const cs = r.settings.cats.map((k) => THEMES[k]?.n).filter(Boolean);
                return `<button type="button" class="roomrow" data-code="${esc(r.code)}"><span class="code">${esc(r.code)}</span><span class="info"><b>Sala de ${esc(host)}</b><span>${esc(cs.slice(0, 3).join(", "))}${cs.length > 3 ? "…" : ""}</span></span><span class="cnt">${n}/15</span><span class="go">Entrar →</span></button>`;
              })
              .join("")
          : `<div class="empty">Nenhuma sala aberta agora. Crie a sua e mande o código para a galera.</div>`;
      },
      () => {
        clearTimeout(t);
        $("roomsNote").textContent = "Não deu para carregar as salas.";
      },
    );
}

/* ---------- criar / entrar ---------- */
function getNick(): string | null {
  const el = $<HTMLInputElement>("nick");
  const n = el.value.trim();
  if (!n) {
    homeErr("Escreva seu apelido antes.");
    el.focus();
    return null;
  }
  ls.set("idf-nick", n);
  return n;
}

async function create(): Promise<void> {
  homeErr("");
  const nick = getNick();
  if (!nick || !S.db) return;
  const btn = $<HTMLButtonElement>("createBtn");
  btn.disabled = true;
  let c = genCode();
  for (let i = 0; i < 4; i++) {
    const s = await S.db.doc("rooms/" + c).get().catch(() => null);
    if (!s || !s.exists) break;
    c = genCode();
  }
  const ok = await write(() => S.db!.doc("rooms/" + c).set(newRoomDoc(c, S.me, nick)));
  btn.disabled = false;
  if (ok) enterRoom(c);
}

async function join(): Promise<void> {
  homeErr("");
  const c = $<HTMLInputElement>("codeIn").value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(c)) {
    homeErr("O código tem 4 letras.");
    return;
  }
  const nick = getNick();
  if (!nick || !S.db) return;
  const s = await S.db.doc("rooms/" + c).get().catch(() => null);
  const r = s?.exists ? s.data() : null;
  if (!r) {
    homeErr("Não achei a sala " + c + ". Confira o código.");
    return;
  }
  const mine = r.players?.[S.me];
  if (!mine) {
    if (activeIds(r).length >= 15) {
      homeErr("Essa sala já está cheia.");
      return;
    }
    const seat = Math.max(-1, ...Object.values(r.players || {}).filter((p) => !!p).map((p) => p!.seat)) + 1;
    const ok = await write(() => S.db!.doc("rooms/" + c).update({ players: { [S.me]: { nick, seat, at: now() } }, updatedAt: now() }));
    if (!ok) return;
  } else if (mine.nick !== nick) void write(() => S.db!.doc("rooms/" + c).update({ players: { [S.me]: { nick } } }));
  enterRoom(c);
}

/** Cada entrada numa sala ganha um número; timers de entradas antigas não fazem nada. */
let enterSeq = 0;

function enterRoom(c: string, silent = false): void {
  if (!S.db) return;
  const my = ++enterSeq;
  const current = () => my === enterSeq;
  S.unsubRoom?.();
  S.code = c;
  S.room = null;
  S.seenRn = null;
  closeReveal();
  ls.set("idf-room", c);
  const tag = $("roomTag");
  tag.textContent = c;
  tag.hidden = false;
  render();
  let wasIn = false;
  let wt: ReturnType<typeof setTimeout> | null = null;
  const t = setTimeout(() => {
    if (current() && !S.room)
      $("roomView").innerHTML = `<div class="banner"><b>Conectando à sala ${esc(c)}…</b>Está demorando. Confira a conexão.</div><button class="btn btn-ghost btn-block" type="button" data-act="leave">Voltar ao início</button>`;
  }, 10000);
  S.unsubRoom = S.db.doc("rooms/" + c).onSnapshot(
    (s) => {
      clearTimeout(t);
      if (!current()) return;
      const r = s.exists ? s.data() : null;
      if (!r) {
        if (!s.metadata.fromCache) {
          exitRoom();
          if (!silent) homeErr("Essa sala não existe mais.");
        }
        return;
      }
      if (r.players?.[S.me]) {
        wasIn = true;
        if (wt) clearTimeout(wt);
        wt = null;
      } else if (!s.metadata.fromCache) {
        if (wasIn) {
          exitRoom();
          homeErr("Você não está mais na sala " + c + ".");
          return;
        }
        // entrada ainda não confirmada pelo anfitrião (salas MQTT): espera um pouco
        $("roomView").innerHTML = `<p class="note center">Entrando na sala ${esc(c)}… esperando o anfitrião confirmar.</p>`;
        if (!wt)
          wt = setTimeout(() => {
            if (current() && S.code === c && !wasIn) {
              exitRoom();
              homeErr(silent ? "" : "O anfitrião da sala " + c + " não respondeu. Tente de novo.");
            }
          }, 12000);
        return;
      }
      const prev = S.room;
      S.room = r;
      if (S.revRn !== null && (r.rn !== S.revRn || r.status === "lobby")) closeReveal();
      render();
      autoClose();
      cue(prev, r, S.me);
    },
    () => {
      clearTimeout(t);
      if (!current()) return;
      exitRoom();
      homeErr("Perdi a conexão com a sala. Entre de novo.");
    },
  );
}

function exitRoom(): void {
  enterSeq++;
  closeReveal();
  S.unsubRoom?.();
  S.unsubRoom = null;
  S.code = null;
  S.room = null;
  ls.set("idf-room", null);
  $("roomTag").hidden = true;
  render();
}

/* ---------- telas ---------- */
function render(): void {
  $("scr-home").hidden = screen() !== "home";
  $("scr-room").hidden = screen() !== "room";
  if (screen() !== "room") return;
  const v = $("roomView");
  const room = S.room;
  if (!room) {
    v.innerHTML = `<p class="note center">Entrando na sala ${esc(S.code)}…</p>`;
    return;
  }
  const focused = (document.activeElement as HTMLElement | null)?.id;
  const html =
    room.status === "lobby" ? lobbyHTML(room) : room.status === "clues" ? cluesHTML(room) : room.status === "vote" ? voteHTML(room) : room.status === "result" ? resultHTML(room) : "";
  v.innerHTML = html + `<p class="err center" id="roomErr" hidden></p>`;
  const ci = document.getElementById("clueIn") as HTMLInputElement | null;
  if (ci) {
    ci.value = S.draft;
    if (focused === "clueIn") ci.focus();
  }
  const gi = document.getElementById("guessIn") as HTMLInputElement | null;
  if (gi) {
    gi.value = S.guessDraft;
    if (focused === "guessIn") gi.focus();
  }
  const chi = document.getElementById("chatIn") as HTMLInputElement | null;
  if (chi) {
    chi.value = S.chatDraft;
    if (focused === "chatIn") chi.focus();
  }
  // a conversa abre já na mensagem mais nova, a menos que a pessoa tenha subido para ler
  const cl = document.getElementById("chatList");
  if (cl) {
    if (chatStick) cl.scrollTop = cl.scrollHeight;
    else cl.scrollTop = chatScroll;
    cl.addEventListener("scroll", () => {
      chatScroll = cl.scrollTop;
      chatStick = cl.scrollHeight - cl.scrollTop - cl.clientHeight < 40;
    });
  }
}

/* ---------- chat da votação ---------- */
const CHAT_MAX_LEN = 140;
const CHAT_MAX_PER_PLAYER = 30;
let chatStick = true;
let chatScroll = 0;

function chatMsgs(room: Room): [string, ChatMsg][] {
  return Object.entries(room.chat?.[roundKey(room)] || {})
    .filter((e): e is [string, ChatMsg] => !!e[1] && typeof e[1].t === "string")
    .sort((a, b) => a[1].at - b[1].at);
}

function chatHTML(room: Room, open: boolean): string {
  const list = chatMsgs(room);
  const canSend = open && liveIds(room).includes(S.me);
  const mine = list.filter(([, m]) => m.u === S.me).length;
  const rows = list.length
    ? list
        .map(([, m]) => {
          const me = m.u === S.me;
          return `<div class="msg${me ? " me" : ""}">${me ? "" : dot(m.u)}<div class="bub"><b style="color:${colorOf(m.u)}">${esc(me ? "Você" : nickOf(m.u))}</b><span>${esc(m.t)}</span></div></div>`;
        })
        .join("")
    : `<p class="note center" style="margin:8px 0">${open ? "Ninguém falou nada ainda. Explique sua pista ou acuse alguém." : "Ninguém conversou nesta votação."}</p>`;
  return `<div class="panel chat"><h3>${open ? "Conversa" : "Conversa da votação"}</h3><div class="chat-list" id="chatList" aria-live="polite">${rows}</div>${
    canSend
      ? mine >= CHAT_MAX_PER_PLAYER
        ? `<p class="note" style="margin-top:8px">Você chegou ao limite de ${CHAT_MAX_PER_PLAYER} mensagens nesta rodada.</p>`
        : `<div class="myturn" style="margin-top:10px"><input class="field" id="chatIn" maxlength="${CHAT_MAX_LEN}" placeholder="Explique sua pista…" autocomplete="off" aria-label="Mensagem para a sala"><button class="btn btn-red" type="button" data-act="chat">Enviar</button></div>`
      : open
        ? `<p class="note" style="margin-top:8px">Só quem ainda está no jogo pode escrever.</p>`
        : ""
  }</div>`;
}

function lobbyHTML(room: Room): string {
  const ids = activeIds(room),
    h = isHost(),
    s = room.settings,
    n = ids.length,
    mi = maxImps(n);
  const dis = h ? "" : "disabled";
  const cats = catsOf(room);
  const elimSet = Math.min(s.imps, mi) >= 2 && s.voteMode === "elim";
  const sw = (k: "inf" | "chaos" | "hint", t: string, d: string) =>
    `<div class="row"><div><div class="t">${t}</div><div class="d">${d}</div></div><label class="sw"><input type="checkbox" data-act="opt" data-k="${k}" ${s[k] ? "checked" : ""} ${dis} aria-label="${t}"><span></span></label></div>`;
  return `<div class="kicker center">Sala de espera</div>
  <div class="codebox"><div><div class="kicker">Código da sala</div><div class="c">${esc(S.code)}</div></div><button class="btn btn-white btn-sm" type="button" data-act="copy">Copiar código</button></div>
  <p class="note center" id="copyNote">Mande o código para a galera. Cada um entra pelo link do jogo no próprio celular.</p>
  <div class="panel"><h3>Jogadores · ${n}/15</h3><div class="players">${ids
    .map(
      (id) =>
        `<div class="pl">${dot(id)}<span class="nm">${esc(nickOf(id))}</span>${id === room.host ? '<span class="tag host">Anfitrião</span>' : ""}${id === S.me ? '<span class="tag">Você</span>' : ""}${h && id !== S.me ? `<button class="x" type="button" data-act="kick" data-id="${esc(id)}" aria-label="Tirar ${esc(nickOf(id))} da sala">×</button>` : ""}</div>`,
    )
    .join("")}</div>
  ${n < 3 ? `<p class="note" style="margin-top:10px">Faltam ${3 - n} para começar.</p>` : ""}</div>
  <div class="panel"><h3>Regras da rodada${h ? "" : " <span class='note'>(o anfitrião escolhe)</span>"}</h3>
    <div class="row"><div><div class="t">Impostores</div><div class="d">Até ${mi} com ${n} jogador${n > 1 ? "es" : ""}.</div></div><div class="stepper"><button type="button" data-act="imps" data-d="-1" ${!h || s.imps <= 1 ? "disabled" : ""} aria-label="Menos impostores">−</button><output>${Math.min(s.imps, mi)}</output><button type="button" data-act="imps" data-d="1" ${!h || s.imps >= mi ? "disabled" : ""} aria-label="Mais impostores">+</button></div></div>
    ${
      Math.min(s.imps, mi) >= 2
        ? `<div class="row" style="display:block"><div class="t">Tipo de votação</div><div class="d" style="max-width:none;margin-bottom:8px">Vale quando a rodada tem ${Math.min(s.imps, mi)} impostores.</div><div class="modes">${(
            [
              ["multi", "Votação única", `Todo mundo dá as pistas e, no fim, cada um vota em ${Math.min(s.imps, mi)} suspeitos. Os impostores pegos chutam a carta.`],
              ["elim", "Eliminação por rodada", "Uma volta de pistas, votação e sai um. Repete até sair todos os impostores. No fim, cada impostor chuta a carta."],
            ] as const
          )
            .map(
              ([k, t, d2]) =>
                `<button type="button" class="mode" data-act="vmode" data-k="${k}" aria-pressed="${(s.voteMode || "multi") === k}" ${dis}><b>${t}</b><span>${d2}</span></button>`,
            )
            .join("")}</div></div>`
        : ""
    }
    <div class="row"><div><div class="t">Tempo para dar dica</div><div class="d">Acabou o tempo, a vez passa para o próximo.</div></div><div class="seg">${CLUE_TIMES.map(
      ([v, t]) => `<button type="button" data-act="clueTime" data-k="${v}" aria-pressed="${(s.clueTime || 0) === v}" ${dis}>${t}</button>`,
    ).join("")}</div></div>
    <div class="row"><div><div class="t">Voltas de pistas</div><div class="d">${elimSet ? "Na eliminação, cada etapa tem uma volta de pistas." : "Quantas pistas cada um dá antes da votação."}</div></div><div class="stepper"><button type="button" data-act="rounds" data-d="-1" ${!h || elimSet || s.rounds <= 1 ? "disabled" : ""} aria-label="Menos voltas">−</button><output>${elimSet ? 1 : s.rounds}</output><button type="button" data-act="rounds" data-d="1" ${!h || elimSet || s.rounds >= 3 ? "disabled" : ""} aria-label="Mais voltas">+</button></div></div>
    ${sw("inf", "Infiltrado", "O impostor recebe outro jogador ou time do mesmo tema e nem sabe que é impostor.")}
    ${sw("chaos", "Rodada caótica", "Uma rodada em seis vira bagunça: ninguém impostor, todo mundo impostor ou um a mais.")}
    ${sw("hint", "Dica do impostor", "Jogadores: o impostor vê o país e a posição. Times: a primeira letra e o tamanho do nome.")}
    <div class="row" style="display:block"><div class="t" style="margin-bottom:8px">Temas</div><div class="chips">${THEME_ORDER.filter((k) => THEMES[k])
      .map(
        (k) =>
          `<button type="button" class="chip" data-act="cat" data-k="${k}" aria-pressed="${cats.includes(k)}" ${dis}>${esc(THEMES[k].n)}<small>${THEMES[k].items.length}</small></button>`,
      )
      .join("")}</div></div>
  </div>
  ${h ? `<button class="btn btn-red btn-block" type="button" data-act="start" ${n < 3 || !cats.length ? "disabled" : ""}>${n < 3 ? "Esperando jogadores…" : !cats.length ? "Escolha um tema" : "Começar partida"}</button>` : `<div class="banner center">Esperando ${esc(nickOf(room.host))} começar a partida.</div>`}
  <button class="btn btn-ghost btn-block" type="button" data-act="leave">Sair da sala</button>`;
}

function cluesHTML(room: Room): string {
  const r = room.round!,
    list = room.clues?.[stageKey(room)] || {},
    order = r.order,
    idx = Object.keys(list).length;
  const turn = order[idx];
  const mine = turn === S.me;
  const perRound = Math.max(1, Math.round(order.length / (r.laps || 1)));
  let rows = "";
  order.forEach((id, i) => {
    if (i % perRound === 0 && r.laps > 1) rows += `<div class="kicker" style="margin-top:${i ? 8 : 0}px">Volta ${i / perRound + 1}</div>`;
    const c = list[i];
    if (c) rows += `<div class="clue">${dot(id)}<span class="nm">${esc(nickOf(id))}</span><span class="tx">${esc(c.t)}</span></div>`;
    else if (i === idx)
      rows += `<div class="clue now">${dot(id)}<span class="nm">${esc(nickOf(id))}</span><span class="tx" style="color:var(--red);font-size:14px">${mine ? "Sua vez" : "Pensando…"}</span></div>`;
    else rows += `<div class="clue wait">${dot(id)}<span class="nm">${esc(nickOf(id))}</span><span class="tx">—</span></div>`;
  });
  return `<div class="kicker center">Rodada ${room.rn} · ${isElim(room) ? "etapa " + (r.stage || 1) + " · pistas" : "pistas"}</div>
  ${cardBarHTML()}
  ${elimHTML(room)}
  ${
    mine
      ? `<div class="panel"><h3>Sua vez de dar a pista</h3><div class="myturn"><input class="field" id="clueIn" maxlength="24" placeholder="Uma palavra" autocomplete="off" aria-label="Sua pista"><button class="btn btn-red" type="button" data-act="clue">Enviar</button></div><p class="note" style="margin-top:8px">Não vale o nome, o clube do jogador nem parte exata do nome.</p></div>`
      : `<div class="banner center">Vez de <b style="display:inline">${esc(nickOf(turn))}</b>. Fiquem de olho nas pistas.</div>`
  }
  ${timerHTML(room, mine)}
  <div class="panel"><h3>Pistas</h3><div class="clues">${rows}</div></div>
  ${manageHTML(room)}
  ${isHost() ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" type="button" data-act="skip">Pular a vez de ${esc(nickOf(turn))}</button><button class="btn btn-ghost btn-sm" type="button" data-act="tovote">Ir direto para a votação</button></div>` : ""}`;
}

/** Eliminação: quem já saiu e se era impostor. */
function elimHTML(room: Room): string {
  if (!isElim(room)) return "";
  const outs = room.round?.outs || [];
  const gone = !liveIds(room).includes(S.me) && room.round!.players.includes(S.me);
  const left = room.round!.imps.length - outs.filter((o) => o.imp).length;
  return `${gone ? `<div class="banner center"><b>Você foi eliminado.</b>Acompanhe o resto da rodada. Você não dá mais pistas nem vota.</div>` : ""}${
    outs.length
      ? `<div class="panel"><h3>Eliminados</h3><div class="roles">${outs
          .map((o) => `<div class="${o.imp ? "bad" : ""}"><span>${esc(nickOf(o.u))} <span class="note" style="font-weight:500">· etapa ${o.st}</span></span><em>${o.imp ? "Impostor" : "Inocente"}</em></div>`)
          .join("")}</div><p class="note" style="margin-top:8px">Ainda ${left === 1 ? "falta 1 impostor" : "faltam " + left + " impostores"}.</p></div>`
      : ""
  }`;
}

/** Suspeitos que aparecem marcados: o rascunho enquanto não confirmou ou está trocando; senão o voto gravado. */
function myPicks(room: Room): { picks: string[]; confirmed: boolean } {
  const sk = stageKey(room),
    k = votesPerPlayer(room);
  const saved = picksOf(room.votes?.[sk]?.[S.me]);
  const confirmed = voteDone(saved, k);
  if (S.voteDraft?.k !== sk) {
    S.voteDraft = { k: sk, picks: [] };
    S.voteEdit = false;
  }
  if (confirmed && !S.voteEdit) return { picks: saved, confirmed: true };
  // tira do rascunho quem não está mais na votação
  const live = liveIds(room);
  S.voteDraft.picks = S.voteDraft.picks.filter((x) => x === "none" || live.includes(x));
  return { picks: S.voteDraft.picks, confirmed: false };
}

/* ---------- tempo para dar dica ---------- */
const CLUE_TIMES: [number, string][] = [
  [120, "2 min"],
  [60, "1 min"],
  [30, "30 seg"],
  [0, "Ilimitado"],
];

/** Fim da vez atual (ms) ou null quando o tempo é ilimitado. */
function turnEnd(room: Room): number | null {
  const t = room.settings?.clueTime || 0;
  if (!t || room.status !== "clues" || !room.turnAt) return null;
  return room.turnAt + t * 1000;
}

function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function timerHTML(room: Room, mine: boolean): string {
  const end = turnEnd(room);
  if (!end) return "";
  const left = end - Date.now();
  return `<div class="ttimer${mine ? " mine" : ""}${left <= 10000 ? " low" : ""}" id="turnTimer" data-end="${end}" role="timer"><span>${mine ? "Seu tempo" : "Tempo da vez"}</span><b>${fmtLeft(left)}</b></div>`;
}

let skipKey = "";
/** A cada segundo: atualiza o relógio e, no anfitrião, passa a vez quando o tempo acaba. */
function tick(): void {
  const el = document.getElementById("turnTimer");
  if (el) {
    const left = Number(el.dataset.end) - Date.now();
    const b = el.querySelector("b");
    if (b) b.textContent = fmtLeft(left);
    el.classList.toggle("low", left <= 10000);
  }
  const room = S.room;
  if (!room || !isHost()) return;
  const end = turnEnd(room);
  if (!end || Date.now() < end + 1000) return;
  const sk = stageKey(room),
    i = Object.keys(room.clues?.[sk] || {}).length,
    who = room.round?.order[i];
  const key = sk + ":" + i;
  if (!who || skipKey === key) return;
  skipKey = key;
  const last = i === room.round!.order.length - 1;
  void write(() =>
    ref().update({ clues: { [sk]: { [i]: { u: who, t: "(tempo esgotado)" } } }, updatedAt: now(), turnAt: now(), ...(last ? { status: "vote" } : {}) }),
  );
}

function voteHTML(room: Room): string {
  const r = room.round!,
    vs = room.votes?.[stageKey(room)] || {},
    ids = liveIds(room),
    k = votesPerPlayer(room),
    inRound = ids.includes(S.me),
    { picks: my, confirmed } = myPicks(room);
  const voted = ids.filter((id) => voteDone(picksOf(vs[id]), k));
  const done = voted.length,
    pct = ids.length ? Math.round((done / ids.length) * 100) : 0;
  const byP = cluesByPlayer(room);
  const title = k > 1 ? `Quem são os ${k} impostores?` : isElim(room) ? "Quem sai agora?" : "Quem é o impostor?";
  const ready = voteDone(my, k);
  const locked = !inRound || confirmed;
  const meter = `<div class="vmeter${done === ids.length ? " full" : ""}" aria-live="polite">
    <div class="vm-top"><div class="vm-n"><b>${done}</b><span>/${ids.length}</span></div><div class="vm-l">${done === ids.length ? "Todo mundo votou!" : done === 1 ? "pessoa já votou" : "pessoas já votaram"}</div></div>
    <div class="vm-bar"><i style="width:${pct}%"></i></div>
    <div class="vm-who">${ids.map((id) => `<span class="${voted.includes(id) ? "ok" : ""}" title="${esc(nickOf(id))}">${voted.includes(id) ? "✓ " : ""}${esc(nickOf(id))}</span>`).join("")}</div>
  </div>`;
  let action = "";
  if (inRound) {
    if (confirmed)
      action = `<div class="vconf"><b>✓ Voto confirmado</b><span>${my.includes("none") ? "Você votou em ninguém." : "Você votou em " + my.map((id) => esc(nickOf(id))).join(" e ") + "."}</span><button class="btn btn-ghost btn-sm" type="button" data-act="revote">Trocar voto</button></div>`;
    else
      action = `<button class="btn btn-red btn-block vconfirm" type="button" data-act="confirmVote" ${ready ? "" : "disabled"}>${
        ready ? "Confirmar voto" : k > 1 ? `Escolha ${k} suspeitos (${my.length}/${k})` : "Escolha um suspeito"
      }</button>`;
  } else action = `<div class="banner center">Você está só assistindo esta votação.</div>`;
  return `<div class="kicker center">Rodada ${room.rn} · ${isElim(room) ? "etapa " + (r.stage || 1) + " · " : ""}votação</div>
  <h2 class="big center">${title}</h2>
  ${meter}
  ${cardBarHTML()}
  ${elimHTML(room)}
  <div class="votes${locked ? " locked" : ""}">${ids
    .map(
      (id) =>
        `<button type="button" class="vote" data-act="vote" data-id="${esc(id)}" aria-pressed="${my.includes(id)}" ${locked ? "disabled" : ""}>${dot(id)}<span>${esc(nickOf(id))}<br><em>${esc((byP[id] || []).join(" · ") || "sem pista")}</em></span></button>`,
    )
    .join("")}
  <button type="button" class="vote" data-act="vote" data-id="none" aria-pressed="${my.includes("none")}" ${locked ? "disabled" : ""} style="grid-column:1/-1;justify-content:center"><span style="flex:none">${isElim(room) ? "Ninguém sai agora" : "Ninguém é impostor"}</span></button></div>
  ${action}
  ${chatHTML(room, true)}
  ${manageHTML(room)}
  ${isHost() ? `<button class="btn btn-ghost btn-block" type="button" data-act="close">Encerrar votação agora</button>` : ""}`;
}

/** Anfitrião: tirar jogadores a qualquer momento (offline, saiu da chamada…). */
function manageHTML(room: Room): string {
  if (!isHost()) return "";
  const ids = activeIds(room).filter((id) => id !== S.me);
  if (!ids.length) return "";
  return `<details class="panel manage" id="manage"${S.manageOpen ? " open" : ""}><summary>Gerenciar jogadores <span class="note">(${ids.length + 1} na sala)</span></summary>
  <p class="note" style="margin:8px 0 10px">Use para tirar quem caiu ou ficou offline. A partida segue sem a pessoa.</p>
  <div class="players">${ids
    .map(
      (id) =>
        `<div class="pl">${dot(id)}<span class="nm">${esc(nickOf(id))}</span>${
          S.kickAsk === id
            ? `<button class="btn btn-red btn-sm" type="button" data-act="kickYes" data-id="${esc(id)}">Confirmar</button><button class="btn btn-ghost btn-sm" type="button" data-act="kickNo">Cancelar</button>`
            : `<button class="btn btn-ghost btn-sm" type="button" data-act="kickAsk" data-id="${esc(id)}">Remover</button>`
        }</div>`,
    )
    .join("")}</div></details>`;
}

/** Um voto está completo com k suspeitos ou com "Ninguém". */
const voteDone = (picks: string[], k: number): boolean => picks.includes("none") || picks.length >= k;

function resultHTML(room: Room): string {
  const r = room.round!,
    res = room.result?.[rk()],
    o = outcome(room, (id) => esc(nickOf(id))),
    word = dec(r.secret),
    decoy = r.decoy ? dec(r.decoy) : "";
  const G = guessesOf(room);
  const canGuess = !!o.pending && !!o.guessers?.includes(S.me) && !G[S.me];
  const waitFor = (o.guessers || []).filter((id) => id !== S.me);
  const tally = res?.tally || {};
  const outAt: Record<string, number> = {};
  for (const x of r.outs || []) outAt[x.u] = x.st;
  return `<div class="kicker center">Rodada ${room.rn} · resultado</div>
  <div class="result ${o.win ? "win" : "lose"}">${o.win ? "" : `<div style="font-family:var(--pixel);color:var(--red);font-size:52px;line-height:.9;text-shadow:3px 3px 0 var(--red-deep)">Impostor</div>`}<h2>${o.title}</h2><p>${o.sub}</p>${r.chaos && r.imps.length && r.imps.length < r.players.length ? `<p>${esc(r.chaos)}</p>` : ""}<p style="margin-top:14px;font-size:13px;opacity:.75">Carta secreta · ${esc(themeName(r.cat))}</p>${o.pending ? `<div class="sw-word">Revelada depois do chute</div>` : secretHTML(r.cat, r.sid ? dec(r.sid) : null, word)}</div>
  ${canGuess && waitFor.length ? `<div class="banner center">Esperando também o chute de ${waitFor.map((id) => esc(nickOf(id))).join(", ")}.</div>` : ""}
  ${canGuess ? `<div class="panel"><h3>Seu chute</h3><div class="myturn"><input class="field" id="guessIn" maxlength="40" placeholder="Quem era o jogador ou time?" autocomplete="off" aria-label="Seu chute"><button class="btn btn-red" type="button" data-act="guess">Chutar</button></div></div>` : o.pending && waitFor.length ? `<div class="banner center">Esperando o chute de ${waitFor.map((id) => esc(nickOf(id))).join(", ")}…</div>` : ""}
  <div class="panel"><h3>Quem era quem</h3><div class="roles">${r.players
    .map((id) => {
      const bad = r.imps.includes(id);
      const v = tally[id] || 0;
      const info = isElim(room) ? (outAt[id] ? "saiu na etapa " + outAt[id] : "ficou até o fim") : v + " voto" + (v === 1 ? "" : "s");
      const gs = G[id] ? ` · chutou “${esc(G[id].t)}” ${G[id].ok ? "✓" : "✗"}` : "";
      return `<div class="${bad ? "bad" : ""}"><span>${esc(nickOf(id))} <span class="note" style="font-weight:500">· ${info}${gs}</span></span><em>${bad ? (decoy ? "Infiltrado · " + esc(decoy) : "Impostor") : "Elenco"}</em></div>`;
    })
    .join("")}</div></div>
  ${chatMsgs(room).length ? chatHTML(room, false) : ""}
  ${manageHTML(room)}
  ${isHost() ? `<button class="btn btn-red btn-block" type="button" data-act="again">Nova rodada</button><button class="btn btn-ghost btn-block" type="button" data-act="lobby">Voltar para a sala de espera</button>` : `<div class="banner center">${esc(nickOf(room.host))} começa a próxima rodada.</div>`}
  <button class="btn btn-ghost btn-block" type="button" data-act="leave">Sair da sala</button>`;
}

/* ---------- ações ---------- */
async function closeVote(): Promise<void> {
  if (S.closing || !S.room) return;
  S.closing = true;
  const room = S.room;
  const patch: Patch = isElim(room) ? elimPatch(room) : { status: "result", result: { [rk()]: tallyVotes(room) }, updatedAt: now() };
  await write(() => ref().update(patch));
  S.closing = false;
}

/** O anfitrião fecha a votação quando todo mundo votou. */
function autoClose(): void {
  const room = S.room;
  if (!room || room.status !== "vote" || !isHost() || !room.round) return;
  const vs = room.votes?.[stageKey(room)] || {},
    k = votesPerPlayer(room);
  if (liveIds(room).every((id) => voteDone(picksOf(vs[id]), k) || !room.players?.[id])) void closeVote();
}

/** Tira alguém da sala. Durante as pistas, a vez dele é pulada e a ordem segue sem ele. */
function kickPatch(room: Room, id: string): Patch {
  const p: Patch = { players: { [id]: null }, updatedAt: now() };
  const r = room.round;
  if (!r || (room.status !== "clues" && room.status !== "vote")) return p;
  const round: Patch = {};
  if (r.alive) round.alive = r.alive.filter((x) => x !== id);
  if (room.status === "clues") {
    const idx = Object.keys(room.clues?.[stageKey(room)] || {}).length;
    const order = r.order.slice(0, idx).concat(r.order.slice(idx).filter((x) => x !== id));
    round.order = order;
    if (order[idx] !== r.order[idx]) p.turnAt = now();
    if (order.length <= idx) p.status = "vote";
  }
  if (room.status === "vote") {
    // quem tinha votado em quem saiu precisa votar de novo (e o voto de quem saiu deixa de contar)
    const sk = stageKey(room),
      vs = room.votes?.[sk] || {},
      clear: Patch = {};
    for (const [voter, v] of Object.entries(vs)) if (voter === id || picksOf(v).includes(id)) clear[voter] = null;
    if (Object.keys(clear).length) p.votes = { [sk]: clear };
  }
  if (Object.keys(round).length) p.round = round;
  return p;
}

async function act(a: string, b?: HTMLElement): Promise<void> {
  const room = S.room;
  if (!room && a !== "leave") return;
  const s = room?.settings;
  const d = Number(b?.dataset.d || 0);
  const upd = (p: Patch) => write(() => ref().update(p));
  switch (a) {
    case "copy": {
      const t = S.code || "";
      try {
        await navigator.clipboard.writeText(t);
        $("copyNote").textContent = "Código " + t + " copiado. Cole no grupo da galera.";
      } catch {
        $("copyNote").textContent = "Copie o código: " + t;
      }
      break;
    }
    case "kick":
      await upd({ players: { [b!.dataset.id!]: null }, updatedAt: now() });
      break;
    case "imps": {
      const n = activeIds(room!).length;
      const v = Math.max(1, Math.min(maxImps(n), Math.min(s!.imps, maxImps(n)) + d));
      await upd({ settings: { imps: v }, updatedAt: now() });
      break;
    }
    case "rounds":
      await upd({ settings: { rounds: Math.max(1, Math.min(3, s!.rounds + d)) }, updatedAt: now() });
      break;
    case "opt":
      await upd({ settings: { [b!.dataset.k!]: (b as HTMLInputElement).checked }, updatedAt: now() });
      break;
    case "cat": {
      const k = b!.dataset.k!,
        cur = catsOf(room);
      await upd({ settings: { cats: cur.includes(k) ? cur.filter((x) => x !== k) : cur.concat(k) }, updatedAt: now() });
      break;
    }
    case "start":
    case "again":
      S.draft = "";
      S.guessDraft = "";
      await upd(newRoundPatch(room!));
      break;
    case "lobby":
      await upd({ status: "lobby", updatedAt: now() });
      break;
    case "card":
      await openReveal(render);
      break;
    case "clue": {
      const t = S.draft.trim().replace(/\s+/g, " ");
      if (!t) {
        roomErr("Escreva uma pista antes de enviar.");
        return;
      }
      const r = room!.round!,
        sk = stageKey(room!),
        i = Object.keys(room!.clues?.[sk] || {}).length;
      if (r.order[i] !== S.me) return;
      const last = i === r.order.length - 1;
      if (await upd({ clues: { [sk]: { [i]: { u: S.me, t } } }, updatedAt: now(), turnAt: now(), ...(last ? { status: "vote" } : {}) })) S.draft = "";
      break;
    }
    case "chat": {
      const t = S.chatDraft.trim().replace(/\s+/g, " ").slice(0, CHAT_MAX_LEN);
      if (!t) {
        roomErr("Escreva uma mensagem antes de enviar.");
        return;
      }
      if (room!.status !== "vote" || !liveIds(room!).includes(S.me)) return;
      if (chatMsgs(room!).filter(([, m]) => m.u === S.me).length >= CHAT_MAX_PER_PLAYER) return;
      const id = S.me + "-" + Date.now().toString(36);
      S.chatDraft = "";
      chatStick = true;
      if (!(await upd({ chat: { [rk()]: { [id]: { u: S.me, t, at: now() } } }, updatedAt: now() }))) S.chatDraft = t;
      render();
      break;
    }
    case "skip": {
      const r = room!.round!,
        sk = stageKey(room!),
        i = Object.keys(room!.clues?.[sk] || {}).length;
      const last = i === r.order.length - 1;
      await upd({ clues: { [sk]: { [i]: { u: r.order[i], t: "(pulou a vez)" } } }, updatedAt: now(), turnAt: now(), ...(last ? { status: "vote" } : {}) });
      break;
    }
    case "tovote":
      await upd({ status: "vote", updatedAt: now() });
      break;
    case "vote": {
      // só marca no aparelho; o voto vale quando a pessoa toca em Confirmar voto
      const id = b!.dataset.id!,
        k = votesPerPlayer(room!);
      if (!liveIds(room!).includes(S.me)) return;
      const cur = myPicks(room!);
      if (cur.confirmed) return;
      let picks = cur.picks.filter((x) => x !== "none");
      if (id === "none") picks = cur.picks.includes("none") ? [] : ["none"];
      else if (picks.includes(id)) picks = picks.filter((x) => x !== id);
      else if (k === 1) picks = [id];
      else if (picks.length >= k) {
        roomErr(`Você já escolheu ${k} suspeitos. Toque num deles para desmarcar.`);
        return;
      } else picks.push(id);
      S.voteDraft = { k: stageKey(room!), picks };
      render();
      break;
    }
    case "confirmVote": {
      const k = votesPerPlayer(room!),
        sk = stageKey(room!),
        picks = myPicks(room!).picks;
      if (!liveIds(room!).includes(S.me) || !voteDone(picks, k)) return;
      if (await upd({ votes: { [sk]: { [S.me]: picks.join(",") } }, updatedAt: now() })) S.voteEdit = false;
      render();
      break;
    }
    case "revote": {
      const sk = stageKey(room!);
      S.voteDraft = { k: sk, picks: picksOf(room!.votes?.[sk]?.[S.me]) };
      S.voteEdit = true;
      render();
      break;
    }
    case "kickAsk":
      S.kickAsk = b!.dataset.id!;
      render();
      break;
    case "kickNo":
      S.kickAsk = null;
      render();
      break;
    case "kickYes": {
      const id = b!.dataset.id!;
      S.kickAsk = null;
      if (!isHost() || id === S.me) return;
      await upd(kickPatch(room!, id));
      break;
    }
    case "clueTime":
      await upd({ settings: { clueTime: Number(b!.dataset.k) }, updatedAt: now() });
      break;
    case "vmode":
      await upd({ settings: { voteMode: b!.dataset.k! }, updatedAt: now() });
      break;
    case "close":
      await closeVote();
      break;
    case "guess": {
      const t = S.guessDraft.trim();
      if (!t) {
        roomErr("Escreva seu chute.");
        return;
      }
      const o = outcome(room!, (id) => id);
      if (!o.guessers?.includes(S.me) || guessesOf(room!)[S.me]) return;
      const ok = guessOk(t, dec(room!.round!.secret), room!.round!.cat);
      if (await upd({ guess: { [rk()]: { [S.me]: { t, ok } } }, updatedAt: now() })) S.guessDraft = "";
      break;
    }
    case "leave": {
      if (room && S.me && room.players?.[S.me]) {
        const rest = activeIds(room).filter((id) => id !== S.me);
        const patch: Patch = { players: { [S.me]: null }, updatedAt: now() };
        if (room.host === S.me && rest.length) patch.host = rest[0];
        if (!rest.length) patch.status = "closed";
        await upd(patch);
      }
      exitRoom();
      break;
    }
  }
}

/* ---------- eventos ---------- */
function wire(): void {
  setInterval(tick, 1000);
  document.addEventListener(
    "toggle",
    (e) => {
      if ((e.target as HTMLElement).id === "manage") S.manageOpen = (e.target as HTMLDetailsElement).open;
    },
    true,
  );
  $("rooms").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".roomrow");
    if (b) {
      $<HTMLInputElement>("codeIn").value = b.dataset.code || "";
      void join();
    }
  });
  $("createBtn").addEventListener("click", () => void create());
  $("joinBtn").addEventListener("click", () => void join());
  const codeIn = $<HTMLInputElement>("codeIn");
  codeIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void join();
  });
  codeIn.addEventListener("input", () => (codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, "")));
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "clueIn") S.draft = t.value;
    if (t.id === "guessIn") S.guessDraft = t.value;
    if (t.id === "chatIn") S.chatDraft = t.value;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const id = (e.target as HTMLElement).id;
    if (id === "clueIn") void act("clue");
    if (id === "guessIn") void act("guess");
    if (id === "chatIn") void act("chat");
  });
  const view = $("roomView");
  view.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!b || b.tagName === "INPUT") return;
    void act(b.dataset.act!, b);
  });
  view.addEventListener("change", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLInputElement>("input[data-act]");
    if (b) void act(b.dataset.act!, b);
  });
  $("homeBtn").addEventListener("click", () => window.scrollTo(0, 0));
  unlockOnGesture();
  const muteBtn = $("muteBtn");
  const paintMute = () => {
    const m = isMuted();
    muteBtn.textContent = m ? "Som: desligado" : "Som: ligado";
    muteBtn.setAttribute("aria-pressed", String(m));
  };
  paintMute();
  muteBtn.addEventListener("click", () => {
    setMuted(!isMuted());
    paintMute();
  });
  $("rulesBtn").addEventListener("click", () => {
    const d = $<HTMLDialogElement>("rules");
    try {
      d.showModal();
    } catch {
      d.setAttribute("open", "");
    }
  });
}

export function start(): void {
  wire();
  void boot();
}
