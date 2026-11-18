// Telas, ações e início do jogo.
import { keepAwake } from "./wake";
import { enterLocal, localActive, wireLocal } from "./local";
import { refazSugestao, sugBoxHTML, wireSugestoes } from "./sugestao";
import { connect, ServerError } from "./backend";
import { cardBarHTML, closeReveal, openReveal, secretHTML } from "./card";
import { THEME_ORDER, THEMES, loadMedia, loadThemes, themeName } from "./data";
import { cue } from "./moments";
import { isMuted, setMuted, unlockOnGesture } from "./sfx";
import {
  activeIds,
  caosLigado,
  catsOf,
  cluesByPlayer,
  genCode,
  guessesOf,
  isElim,
  liveIds,
  maxImps,
  newRoomDoc,
  outcome,
  picksOf,
  ranking,
  roundKey,
  stageKey,
  votesPerPlayer,
  VOTE_TIME,
} from "./rules";
import { S, colorOf, isHost, nickOf } from "./state";
import { CHAT_SLOW_MS, chatEspera, chatKey, ordemDeFala, podeFalar } from "./chat";
import type { ChatMsg, Patch, Room } from "./types";
import { $, dec, esc, ls, now } from "./util";

// Cada tela é uma página de verdade: início (/), sala (/sala/ABCD) e local (/local).
// Trocar de página é o que o visitante pede (criar, entrar, sair), e é aí que o anúncio carrega de novo.
const PAGE = (): string => document.body.dataset.page || "";
const screen = (): "home" | "room" => (S.code && S.room ? "room" : "home");
const ref = () => S.db!.doc("rooms/" + S.code);
const rk = () => roundKey(S.room!);

const ss = {
  get(k: string): string | null {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  take(k: string): string | null {
    try {
      const v = sessionStorage.getItem(k);
      sessionStorage.removeItem(k);
      return v;
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* sem sessionStorage: o aviso se perde */
    }
  },
};

/** Vai para a página da sala. */
const goRoom = (c: string): void => location.assign("/sala/" + c);
/** Volta para o início, com um aviso opcional mostrado lá. */
function goHome(aviso = ""): void {
  if (aviso) ss.set("idf-aviso", aviso);
  location.assign("/?inicio");
}

function homeErr(t: string): void {
  const el = document.getElementById("homeErr");
  if (!el) return;
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
const alertBox = (t: string) => (screen() === "home" || !document.getElementById("roomErr") ? homeErr(t) : roomErr(t));

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
    else if (e instanceof ServerError && !["conexao", "tempo"].includes(e.code)) alertBox(e.message);
    else alertBox("Não deu para salvar. Confira a conexão e tente de novo.");
    return false;
  }
}

const dot = (id: string) =>
  `<span class="dot" style="background:${colorOf(id)}">${esc(nickOf(id)[0]?.toUpperCase() || "?")}</span>`;

/* ---------- início ---------- */
/** Conecta ao servidor das salas; devolve false se não deu. */
async function conectar(): Promise<boolean> {
  const b = await connect();
  if (!b) return false;
  S.db = b.db;
  S.me = b.me;
  S.readOnly = b.readOnly;
  const nick = $<HTMLInputElement>("nick");
  if (nick && !nick.value && b.nick) nick.value = b.nick;
  if (S.readOnly) homeErr("Sua conta só pode ver este jogo. Peça ao dono do jogo para te convidar como Editor para poder jogar.");
  return true;
}

/** Tema escolhido numa página de tema (/?tema=jbr): a sala nova abre só com ele marcado. */
let temaInicial = "";

async function bootHome(): Promise<void> {
  $<HTMLInputElement>("nick").value = ls.get("idf-nick") || "";
  const aviso = ss.take("idf-aviso");
  if (aviso) homeErr(aviso);
  await loadThemes();
  const t = new URLSearchParams(location.search).get("tema") || "";
  if (THEMES[t]) {
    temaInicial = t;
    const note = $("temaNote");
    note.innerHTML = `A sala vai abrir com o tema <b>${esc(THEMES[t].n)}</b>. Na sala de espera dá para juntar outros.`;
    note.hidden = false;
  }
  if (!(await conectar())) {
    $("roomsNote").textContent = "";
    $("rooms").innerHTML = `<div class="empty">Não deu para conectar ao servidor das salas. Confira a internet e recarregue a página.</div>`;
    for (const id of ["createBtn", "joinBtn"]) $<HTMLButtonElement>(id).disabled = true;
    return;
  }
  watchList();
}

/** Tema vindo da página de tema, aplicado quando a sala recém-criada abre. */
let temaPendente = "";

/** Código da sala no endereço (/sala/ABCD). */
const codeFromPath = (): string => (location.pathname.match(/^\/sala\/([A-Za-z]{4})\/?$/)?.[1] || "").toUpperCase();
/** a sala desta página: do endereço, ou (modo streamer, endereço só "/sala") a última sala deste navegador */
const codeDaPagina = (): string => codeFromPath() || (location.pathname.replace(/\/$/, "") === "/sala" ? ss.get("idf-sala") || ls.get("idf-room") || "" : "");

async function bootSala(): Promise<void> {
  const c = codeDaPagina();
  if (!c) return goHome();
  ss.set("idf-sala", c);
  const silent = ss.take("idf-volta") === "1";
  temaPendente = ss.take("idf-tema") || "";
  $<HTMLInputElement>("nick").value = ls.get("idf-nick") || "";
  $<HTMLInputElement>("codeIn").value = c;
  await loadThemes();
  void loadMedia();
  if (!(await conectar())) {
    $("roomView").innerHTML = `<div class="banner"><b>Não deu para conectar ao servidor das salas.</b>Confira a internet e recarregue a página.</div>`;
    return;
  }
  const s = await S.db!.doc("rooms/" + c).get().catch(() => null);
  const r = s?.exists ? s.data() : null;
  if (!r) {
    if (ls.get("idf-room") === c) ls.set("idf-room", null);
    return goHome(silent ? "" : "Não achei a sala " + c + ". Confira o código ou crie uma sala nova.");
  }
  if (r.players?.[S.me]) {
    enterRoom(c, silent);
    return;
  }
  // chegou pelo convite: falta só o apelido
  if (ls.get("idf-room") === c) ls.set("idf-room", null);
  $("scr-room").hidden = true;
  $("scr-join").hidden = false;
  const note = $("inviteNote");
  note.dataset.code = c;
  note.dataset.host = r.players?.[r.host]?.nick || "";
  note.hidden = false;
  paintHide();
  const nick = $<HTMLInputElement>("nick");
  if (nick.value.trim()) void join();
  else nick.focus();
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
          .filter((r): r is Room => !!r && !r.settings?.priv && tnow - (r.updatedAt || 0) < 30 * 60e3 && activeIds(r).length > 0 && !!r.players?.[r.host]);
        $("roomsNote").textContent = list.length ? list.length + (list.length > 1 ? " salas esperando jogadores" : " sala esperando jogadores") : "";
        lastRooms = list;
        paintRooms();
      },
      () => {
        clearTimeout(t);
        $("roomsNote").textContent = "Não deu para carregar as salas.";
      },
    );
}

let lastRooms: Room[] | null = null;
function paintRooms(): void {
  if (!lastRooms) return;
  const list = lastRooms;
  $("rooms").innerHTML = list.length
          ? list
              .map((r) => {
                const n = activeIds(r).length;
                const host = r.players?.[r.host]?.nick || "Anfitrião";
                const cs = r.settings.cats.map((k) => THEMES[k]?.n).filter(Boolean);
                return `<button type="button" class="roomrow" data-code="${esc(r.code)}"><span class="code">${esc(codeTxt(r.code))}</span><span class="info"><b>Sala de ${esc(host)}</b><span>${esc(cs.slice(0, 3).join(", "))}${cs.length > 3 ? "…" : ""}</span></span><span class="cnt">${n}/15</span><span class="go">Entrar →</span></button>`;
              })
              .join("")
          : `<div class="empty">Nenhuma sala aberta agora. Crie a sua e mande o código para a galera.</div>`;
}

/* ---------- modo streamer: ocultar o código ---------- */
const EYE = `<svg class="eye" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>`;
const EYE_OFF = `<svg class="eye" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3.3 2 2 3.3l3.2 3.2C3.4 7.9 2.2 9.8 1.5 12c1.2 2.7 5 7 10.5 7 2 0 3.8-.6 5.3-1.4l3.4 3.4 1.3-1.3L3.3 2zM12 16.5A4.5 4.5 0 0 1 7.5 12c0-.8.2-1.5.5-2.1l1.6 1.6a2 2 0 0 0 2.9 2.9l1.6 1.6c-.6.3-1.3.5-2.1.5zM12 5c-1.3 0-2.5.2-3.6.6l2 2c.5-.1 1-.1 1.6-.1a4.5 4.5 0 0 1 4.5 4.5c0 .5-.1 1.1-.2 1.6l3 3c1.5-1.2 2.6-2.6 3.2-4.1C21.3 9.3 17.5 5 12 5z"/></svg>`;
/** Código como aparece na tela: com o modo streamer ligado, vira pontinhos. */
const codeTxt = (c: string | null = S.code): string => (S.hideCode ? "••••" : c || "");

function paintHide(): void {
  const h = S.hideCode;
  const el = (id: string) => document.getElementById(id);
  const tag = el("roomTag");
  if (tag) {
    tag.innerHTML = `${esc(codeTxt())}${h ? EYE_OFF : EYE}`;
    tag.title = h ? "Código oculto. Toque para mostrar." : "Toque para ocultar o código (modo streamer).";
    tag.setAttribute("aria-label", h ? "Código da sala oculto. Mostrar código" : "Código da sala " + (S.code || "") + ". Ocultar código");
  }
  const hb = el("hideCodesBtn");
  if (hb) {
    hb.textContent = h ? "Mostrar códigos" : "Ocultar códigos";
    hb.setAttribute("aria-pressed", String(h));
  }
  el("codeIn")?.classList.toggle("masked", h);
  const inv = el("inviteNote");
  if (inv && !inv.hidden && inv.dataset.code) {
    const c = inv.dataset.code;
    const host = inv.dataset.host;
    inv.innerHTML = `${host ? `<b>${esc(host)}</b> chamou você para a sala` : "Você foi convidado para a sala"} <b>${esc(codeTxt(c))}</b>`;
    const jb = el("joinBtn");
    if (jb) jb.textContent = h ? "Entrar na sala" : "Entrar na sala " + c;
    const tt = el("joinTitle");
    if (tt) tt.textContent = "Sala " + codeTxt(c);
  }
  // na página da sala o código está no endereço: no modo streamer ele sai da barra (volta pela memória do navegador)
  if (PAGE() === "sala") {
    const c = codeFromPath() || S.code || inv?.dataset.code || "";
    try {
      if (h && location.pathname !== "/sala") history.replaceState(null, "", "/sala");
      else if (!h && c && location.pathname === "/sala") history.replaceState(null, "", "/sala/" + c);
    } catch {
      /* sem history */
    }
  }
}

function setHideCode(v: boolean): void {
  S.hideCode = v;
  ls.set("idf-hide-code", v ? "1" : null);
  paintHide();
  paintRooms();
  render();
}

/* ---------- convite por link ---------- */
const inviteLink = (): string => `${location.origin}/sala/${S.code}`;

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

/** Pública ou privada, escolhida na home antes de criar (lembra a última escolha). */
const privChoice = (): boolean => ls.get("idf-priv") === "1";
function paintVis(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(".vis-op")) b.setAttribute("aria-pressed", String((b.dataset.vis === "priv") === privChoice()));
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
  const doc = newRoomDoc(c, S.me, nick);
  if (privChoice()) doc.settings.priv = true;
  const ok = await write(() => S.db!.doc("rooms/" + c).set(doc));
  if (!ok) {
    btn.disabled = false;
    return;
  }
  ls.set("idf-room", c);
  // o servidor cria a sala com todos os temas; a página da sala aplica o tema escolhido
  if (temaInicial) ss.set("idf-tema", temaInicial);
  goRoom(c);
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
  ls.set("idf-room", c);
  if (PAGE() === "sala") {
    $("scr-join").hidden = true;
    $("scr-room").hidden = false;
    enterRoom(c);
  } else goRoom(c);
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
  keepAwake(true);
  $("roomTag").hidden = false;
  paintHide();
  render();
  let wasIn = false;
  let wt: ReturnType<typeof setTimeout> | null = null;
  const t = setTimeout(() => {
    if (current() && !S.room)
      $("roomView").innerHTML = `<div class="banner"><b>Conectando à sala ${esc(codeTxt(c))}…</b>Está demorando. Confira a conexão.</div><button class="btn btn-ghost btn-block" type="button" data-act="leave">Voltar ao início</button>`;
  }, 10000);
  S.unsubRoom = S.db.doc("rooms/" + c).onSnapshot(
    (s) => {
      clearTimeout(t);
      if (!current()) return;
      const r = s.exists ? s.data() : null;
      if (!r) {
        if (!s.metadata.fromCache) exitRoom(silent ? "" : "Essa sala não existe mais.");
        return;
      }
      if (r.players?.[S.me]) {
        wasIn = true;
        if (wt) clearTimeout(wt);
        wt = null;
      } else if (!s.metadata.fromCache) {
        if (wasIn) {
          exitRoom(motivoSaida(S.room, r, codeTxt(c)));
          return;
        }
        // entrada ainda não confirmada pelo anfitrião (salas MQTT): espera um pouco
        $("roomView").innerHTML = `<p class="note center">Entrando na sala ${esc(c)}… esperando o anfitrião confirmar.</p>`;
        if (!wt)
          wt = setTimeout(() => {
            if (current() && S.code === c && !wasIn) exitRoom(silent ? "" : "O anfitrião da sala " + c + " não respondeu. Tente de novo.");
          }, 12000);
        return;
      }
      const prev = S.room;
      S.room = r;
      if (temaPendente && r.host === S.me && r.status === "lobby") {
        const k = temaPendente;
        temaPendente = "";
        if (THEMES[k]) void write(() => ref().update({ settings: { cats: [k] }, updatedAt: now() }));
      }
      if (S.revRn !== null && (r.rn !== S.revRn || r.status === "lobby")) closeReveal();
      render();
      cue(prev, r, S.me);
    },
    () => {
      clearTimeout(t);
      if (!current()) return;
      exitRoom("Perdi a conexão com a sala. Entre de novo.");
    },
  );
}

/** Sai da sala e volta para o início (com o aviso, se houver). */
/** já saindo da página da sala: a segunda chamada (servidor avisando a saída que a pessoa pediu) não faz nada */
let saindo = false;

/**
 * Por que a pessoa não está mais na sala, para o aviso da tela inicial. Saída por ausência deixa no chat um aviso
 * do sistema com o id dela no fim da chave ("sys-<hora>-<id>"); se a pergunta "Você ainda está aí?" estava aberta,
 * foi falta de resposta, senão foi a conexão que ficou caída. Sem esse aviso, foi o anfitrião (ou outra aba).
 */
function motivoSaida(antes: Room | null, agora: Room, sala: string): string {
  // só o aviso desta saída (quem saiu, voltou e depois foi tirado pelo anfitrião não leva o motivo antigo)
  const porAusencia = Object.values(agora.chat || {}).some((msgs) =>
    Object.keys(msgs || {}).some((k) => k.startsWith("sys-") && k.endsWith("-" + S.me) && parseInt(k.split("-")[1], 36) >= (agora.updatedAt || 0) - 10_000),
  );
  const volta = " Dá para entrar de novo com o código da sala.";
  if (porAusencia && antes?.aqui?.[S.me]) return `Você saiu da sala ${sala} por inatividade: não confirmou em 15 segundos que ainda estava aí.` + volta;
  if (porAusencia) return `Você saiu da sala ${sala} porque ficou mais de 3 minutos sem conexão.` + volta;
  return `Você não está mais na sala ${sala}: o anfitrião tirou você ou você saiu dela em outra aba.`;
}

function exitRoom(aviso = ""): void {
  if (saindo) return;
  saindo = true;
  enterSeq++;
  closeReveal();
  S.unsubRoom?.();
  S.unsubRoom = null;
  S.code = null;
  S.room = null;
  ls.set("idf-room", null);
  keepAwake(false);
  $("roomTag").hidden = true;
  goHome(aviso);
}

/* ---------- telas ---------- */
let turnFocusKey = "";

/** Separa a tela em topo / principal / lateral. No desktop vira duas colunas; no celular empilha. */
function layoutZones(v: HTMLElement): void {
  const kids = [...v.children] as HTMLElement[];
  const top = kids.filter((k) => k.dataset.zone === "top");
  const side = kids.filter((k) => k.dataset.zone === "side");
  const main = kids.filter((k) => !top.includes(k) && !side.includes(k));
  v.classList.toggle("wide", side.length > 0);
  v.querySelectorAll<HTMLElement>("[data-act=start],[data-act=again],[data-act=confirmVote],[data-act=replay]").forEach((b) => b.classList.add("cta"));
  if (!side.length) return;
  const box = (cls: string, items: HTMLElement[]) => {
    const d = document.createElement("div");
    d.className = cls;
    d.append(...items);
    return d;
  };
  v.append(...(top.length ? [box("zone-top", top)] : []), box("zone-main", main), box("zone-side", side));
}
function render(): void {
  if (localActive() || PAGE() !== "sala" || !S.code) return;
  const v = $("roomView");
  const room = S.room;
  if (!room || room.status === "podium") document.getElementById("aquiLayer")?.remove();
  if (!room) {
    v.innerHTML = `<p class="note center">Entrando na sala ${esc(codeTxt())}…</p>`;
    return;
  }
  const focused = (document.activeElement as HTMLElement | null)?.id;
  if (room.status === "podium") {
    // o pódio é uma animação: só desenha de novo se mudar o ranking ou quem é anfitrião
    const key = (room.final?.at || 0) + ":" + room.host;
    if (podiumKey === key) return;
    podiumKey = key;
    v.innerHTML = podiumHTML(room) + `<p class="err center" id="roomErr" hidden></p>`;
    return;
  }
  podiumKey = "";
  const html =
    room.status === "lobby" ? lobbyHTML(room) : room.status === "clues" ? cluesHTML(room) : room.status === "vote" ? voteHTML(room) : room.status === "result" ? resultHTML(room) : "";
  v.innerHTML = html + `<p class="err center" id="roomErr" hidden></p>`;
  aquiLayer(room);
  layoutZones(v);
  const ci = document.getElementById("clueIn") as HTMLInputElement | null;
  if (ci) {
    ci.value = S.draft;
    // chegou a vez da pessoa: já deixa o campo pronto para digitar
    const fk = room.rn + ":" + stageKey(room) + ":" + Object.keys(room.clues?.[stageKey(room)] || {}).length;
    if (focused === "clueIn" || turnFocusKey !== fk) ci.focus({ preventScroll: false });
    turnFocusKey = fk;
  }
  const gi = document.getElementById("guessIn") as HTMLInputElement | null;
  if (gi) {
    gi.value = S.guessDraft;
    if (focused === "guessIn") gi.focus();
    refazSugestao("guessIn");
  }
  const chi = document.getElementById("chatIn") as HTMLInputElement | null;
  if (chi) {
    chi.value = S.chatDraft;
    if (focused === "chatIn") chi.focus();
  }
  if (chi || document.querySelector('[data-act="chat"]')) chatTick();
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
/** até quando o botão fica travado depois de enviar (só para o jogador ver; quem manda é o servidor) */
let chatLivreEm = 0;
let chatLivreChave = "";
let chatTimer = 0;

/** Ms que faltam para poder enviar: vale o maior entre o relógio local do último envio e a última mensagem na sala. */
function chatFalta(room: Room): number {
  return Math.max(0, chatLivreChave === chatKey(room) ? chatLivreEm - Date.now() : 0, chatEspera(room.chat?.[chatKey(room)], S.me, Date.now()));
}

/** Atualiza só o botão enquanto o intervalo corre, sem refazer a tela (não tira o foco do campo). */
function chatTick(): void {
  window.clearTimeout(chatTimer);
  const room = S.room;
  const b = document.querySelector<HTMLButtonElement>('[data-act="chat"]');
  if (!room || !b) return;
  const f = chatFalta(room);
  b.disabled = f > 0;
  b.textContent = f ? `Aguarde ${Math.ceil(f / 1000)}s` : "Enviar";
  if (f) chatTimer = window.setTimeout(chatTick, 250);
}
let chatScroll = 0;

function chatMsgs(room: Room): [string, ChatMsg][] {
  return Object.entries(room.chat?.[chatKey(room)] || {})
    .filter((e): e is [string, ChatMsg] => !!e[1] && typeof e[1].t === "string")
    .sort((a, b) => a[1].at - b[1].at);
}

/** Quem pode escrever: no lobby, qualquer jogador da sala; na partida, quem ainda está no jogo. */
const chatMembro = (room: Room): boolean => podeFalar(room, S.me);

function chatHTML(room: Room, open: boolean): string {
  const list = chatMsgs(room);
  const canSend = open && chatMembro(room);
  const mine = list.filter(([, m]) => m.u === S.me).length;
  const rows = list.length
    ? list
        .map(([, m]) => {
          if (m.sys) return `<div class="msg sys"><p class="note center" style="margin:2px 0;width:100%">${esc(m.t)}</p></div>`;
          const me = m.u === S.me;
          return `<div class="msg${me ? " me" : ""}">${me ? "" : dot(m.u)}<div class="bub"><b style="color:${colorOf(m.u)}">${esc(me ? "Você" : nickOf(m.u))}</b><span>${esc(m.t)}</span></div></div>`;
        })
        .join("")
    : `<p class="note center" style="margin:8px 0">${open ? (room.status === "lobby" ? "Ninguém falou nada ainda. Aproveite para combinar a partida." : "Ninguém falou nada ainda. Explique sua pista ou acuse alguém.") : "Ninguém conversou nesta rodada."}</p>`;
  return `<div class="panel chat${open ? " compact" : ""}"${open ? "" : ' data-zone="side"'}><h3>${open ? "Conversa" : "Conversa da rodada"}</h3><div class="chat-list" id="chatList" aria-live="polite">${rows}</div>${
    canSend
      ? mine >= CHAT_MAX_PER_PLAYER
        ? `<p class="note" style="margin-top:8px">Você chegou ao limite de ${CHAT_MAX_PER_PLAYER} mensagens nesta rodada.</p>`
        : `<div class="myturn" style="margin-top:10px"><input class="field" id="chatIn" maxlength="${CHAT_MAX_LEN}" placeholder="${room.status === "lobby" ? "Escreva para a sala…" : "Explique sua pista…"}" autocomplete="off" aria-label="Mensagem para a sala"><button class="btn btn-red" type="button" data-act="chat" ${chatFalta(room) ? "disabled" : ""}>${chatFalta(room) ? `Aguarde ${Math.ceil(chatFalta(room) / 1000)}s` : "Enviar"}</button></div>`
      : open
        ? `<p class="note" style="margin-top:8px">Só quem ainda está no jogo pode escrever.</p>`
        : ""
  }</div>`;
}

/** Ordem de fala da votação: quem escreveu primeiro no chat; quem ficou calado vai para o fim. A ordem vem do servidor (round.fala). */
function falaHTML(room: Room): string {
  const r = room.round;
  if (!r) return "";
  const ids = liveIds(room);
  const falaram = (r.fala || ordemDeFala(room.chat?.[roundKey(room)], r.players).falaram).filter((id) => ids.includes(id));
  const calados = ids.filter((id) => !falaram.includes(id));
  const li = (id: string, tag: string, mudo = false) =>
    `<li${mudo ? ' class="mudo"' : ""}><b>${tag}</b>${dot(id)}<span>${esc(id === S.me ? "Você" : nickOf(id))}</span></li>`;
  return `<div class="panel" data-zone="side"><h3>Ordem de fala</h3><ol class="fala">${falaram.map((id, i) => li(id, `${i + 1}º`)).join("")}${calados.map((id) => li(id, "não falou", true)).join("")}</ol></div>`;
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
  const sw = (k: "chaos" | "hint" | "guess", t: string, d: string, on = !!s[k]) =>
    `<div class="row"><div><div class="t">${t}</div><div class="d">${d}</div></div><label class="sw"><input type="checkbox" data-act="opt" data-k="${k}" ${on ? "checked" : ""} ${dis} aria-label="${t}"><span></span></label></div>`;
  return `<div class="kicker center">Sala de espera</div>
  <div class="codebox${S.hideCode ? " hidden-code" : ""}"><div><div class="kicker">Código da sala</div><div class="c">${esc(codeTxt())}</div></div><div class="cb-btns"><button class="btn btn-ghost btn-sm" type="button" data-act="hideCode" aria-pressed="${S.hideCode}">${S.hideCode ? EYE + " Mostrar" : EYE_OFF + " Ocultar"}</button><button class="btn btn-white btn-sm" type="button" data-act="copy">Copiar código</button></div></div>
  <p class="note center vis-tag">${s.priv ? "🔒 Sala <b>privada</b>: não aparece na lista, só entra quem tiver o código ou o link." : "🌐 Sala <b>pública</b>: aparece na lista de salas abertas."}</p>
  ${S.hideCode ? `<p class="note center">Modo streamer: o código está oculto nesta tela. Copiar código e link continuam funcionando.</p>` : ""}
  <div class="invite"><button class="btn btn-red" type="button" data-act="copyLink">Copiar link de convite</button><button class="btn btn-wa" type="button" data-act="wa">WhatsApp</button></div>
  <p class="note center" id="copyNote">Mande o link: quem abrir já cai na sala, só falta o apelido.</p>
  ${chatHTML(room, true)}
  <div class="panel"><h3>Jogadores · ${n}/15</h3><div class="players">${ids
    .map(
      (id) =>
        `<div class="pl">${dot(id)}<span class="nm">${esc(nickOf(id))}</span>${id === room.host ? '<span class="tag host">Anfitrião</span>' : ""}${id === S.me ? '<span class="tag">Você</span>' : ""}${h && id !== S.me ? `<button class="x" type="button" data-act="kick" data-id="${esc(id)}" aria-label="Tirar ${esc(nickOf(id))} da sala">×</button>` : ""}</div>`,
    )
    .join("")}</div>
  ${n < 3 ? `<p class="note" style="margin-top:10px">Faltam ${3 - n} para começar.</p>` : ""}</div>
  <div class="panel" data-zone="side"><h3>Regras da rodada${h ? "" : " <span class='note'>(o anfitrião escolhe)</span>"}</h3>
    <div class="row"><div><div class="t">Impostores</div><div class="d">Até ${mi} com ${n} jogador${n > 1 ? "es" : ""}.</div></div><div class="stepper"><button type="button" data-act="imps" data-d="-1" ${!h || s.imps <= 1 ? "disabled" : ""} aria-label="Menos impostores">−</button><output>${Math.min(s.imps, mi)}</output><button type="button" data-act="imps" data-d="1" ${!h || s.imps >= mi ? "disabled" : ""} aria-label="Mais impostores">+</button></div></div>
    ${
      Math.min(s.imps, mi) >= 2
        ? `<div class="row" style="display:block"><div class="t">Tipo de votação</div><div class="d" style="max-width:none;margin-bottom:8px">Vale quando a rodada tem ${Math.min(s.imps, mi)} impostores.</div><div class="modes">${(
            [
              ["multi", "Votação única", `Todo mundo dá as pistas e, no fim, cada um vota em ${Math.min(s.imps, mi)} suspeitos.${s.guess !== false ? " Os impostores pegos chutam a carta." : ""}`],
              ["elim", "Eliminação por rodada", `Uma volta de pistas, votação e sai um. Repete até sair todos os impostores.${s.guess !== false ? " No fim, cada impostor chuta a carta." : ""}`],
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
    ${sw("chaos", "CAOS", "O impostor recebe outro jogador ou time do mesmo tema e nem sabe que é impostor. Uma rodada em seis vira bagunça: ninguém impostor, todo mundo impostor ou um a mais.", caosLigado(s))}
    ${sw("hint", "Dica do impostor", "Uma pista indireta, nunca país, posição nem letras. Jogadores: década de nascimento e um clube de passagem. Times: um ex-jogador e a região.")}
    ${sw("guess", "Chute do impostor pego", s.guess !== false ? "Impostor descoberto ainda tem um chute: se acertar a carta, rouba a vitória." : "Desligado: impostor descoberto já perdeu, sem chute.", s.guess !== false)}
    <div class="row" style="display:block"><div class="t" style="margin-bottom:8px">Temas</div><div class="chips">${THEME_ORDER.filter((k) => THEMES[k])
      .map(
        (k) =>
          `<button type="button" class="chip" data-act="cat" data-k="${k}" aria-pressed="${cats.includes(k)}" ${dis}>${esc(THEMES[k].n)}<small>${THEMES[k].items.length}</small></button>`,
      )
      .join("")}</div></div>
  </div>
  ${scoreboardHTML(room)}
  ${h ? `<button class="btn btn-red btn-block" type="button" data-act="start" ${n < 3 || !cats.length ? "disabled" : ""}>${n < 3 ? "Esperando jogadores…" : !cats.length ? "Escolha um tema" : "Começar partida"}</button>` : `<div class="banner center">Esperando ${esc(nickOf(room.host))} começar a partida.</div>`}
  ${h && Object.keys(room.scores || {}).length ? endRoomHTML() : ""}
  <button class="btn btn-ghost btn-block" type="button" data-act="leave">Sair da sala</button>`;
}

/** Onde a rodada está: pistas, votação, resultado. */
function stepperHTML(room: Room, cur: number): string {
  const st = isElim(room) && room.round ? ` · etapa ${room.round.stage || 1}` : "";
  const labels = ["Pistas", "Votação", "Resultado"];
  return `<div class="stepbar" data-zone="top"><span class="rn">Rodada ${room.rn}${st}</span><ol>${labels
    .map((l, i) => `<li class="${i < cur ? "done" : i === cur ? "cur" : ""}"${i === cur ? ' aria-current="step"' : ""}><b>${i < cur ? "✓" : i + 1}</b><span>${l}</span></li>`)
    .join("")}</ol></div>`;
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
      rows += `<div class="clue now">${dot(id)}<span class="nm">${esc(nickOf(id))}</span><span class="tx" style="color:var(--accent);font-size:14px">${mine ? "Sua vez" : "Pensando…"}</span></div>`;
    else rows += `<div class="clue wait">${dot(id)}<span class="nm">${esc(nickOf(id))}</span><span class="tx">—</span></div>`;
  });
  return `${stepperHTML(room, 0)}
  ${cardBarHTML()}
  ${elimHTML(room)}
  ${
    mine
      ? `<div class="panel turn-mine"><h3>Sua vez de dar a pista</h3><div class="myturn"><input class="field" id="clueIn" maxlength="24" placeholder="Uma palavra" autocomplete="off" aria-label="Sua pista"><button class="btn btn-red" type="button" data-act="clue">Enviar</button></div><p class="note" style="margin-top:8px">Não vale o nome, o clube do jogador nem parte exata do nome.</p></div>`
      : `<div class="banner turn-wait">${dot(turn)}<span>Vez de <b style="display:inline">${esc(nickOf(turn))}</b>. Fiquem de olho nas pistas.</span></div>`
  }
  ${timerHTML(room, mine)}
  ${chatHTML(room, true)}
  <div class="panel" data-zone="side"><h3>Pistas</h3><div class="clues">${rows}</div></div>
  ${manageHTML(room)}
  ${isHost() ? `<div data-zone="side" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" type="button" data-act="skip">Pular a vez de ${esc(nickOf(turn))}</button><button class="btn btn-ghost btn-sm" type="button" data-act="tovote">Ir direto para a votação</button></div>` : ""}
  ${leaveHTML()}`;
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

/* ---------- placar e pódio ---------- */
let podiumKey = "";

function endRoomHTML(): string {
  return S.endAsk
    ? `<div class="banner center"><b>Encerrar a sala e ver o pódio?</b>O placar fecha e ninguém joga mais nesta sala.<div style="display:flex;gap:8px;justify-content:center;margin-top:10px"><button class="btn btn-red btn-sm" type="button" data-act="endYes">Encerrar e ver pódio</button><button class="btn btn-ghost btn-sm" type="button" data-act="endNo">Cancelar</button></div></div>`
    : `<button class="btn btn-ghost btn-block" type="button" data-act="endAsk">🏆 Encerrar sala e ver pódio</button>`;
}

function scoreboardHTML(room: Room): string {
  const rows = ranking(room);
  if (!rows.length || !Object.keys(room.scores || {}).length) return "";
  const last = room.scored?.[roundKey(room)] || {};
  return `<div class="panel board" data-zone="side"><h3>Placar da sala</h3><p class="note" style="margin:-4px 0 10px">Impostor que vence: +3 · Elenco que vence: +1 cada</p><div class="brows">${rows
    .map(
      (x) =>
        `<div class="brow${x.u === S.me ? " me" : ""}"><span class="bpos">${x.pos}º</span><span class="bnm">${esc(x.n)}${room.players?.[x.u] ? "" : ' <span class="note">(saiu)</span>'}</span>${
          room.status === "result" && last[x.u] ? `<span class="bplus">+${last[x.u]}</span>` : ""
        }<span class="bpt">${x.p} pt${x.p === 1 ? "" : "s"}</span></div>`,
    )
    .join("")}</div></div>`;
}

/** Pódio: 3º, 2º e 1º sobem um de cada vez; depois o ranking completo aparece do último para o primeiro. */
function podiumHTML(room: Room): string {
  const list = room.final?.list || [];
  const withPos: (typeof list[number] & { pos: number })[] = [];
  let pos = 0,
    lastP = -1;
  list.forEach((x, i) => {
    if (x.p !== lastP) {
      pos = i + 1;
      lastP = x.p;
    }
    withPos.push({ ...x, pos });
  });
  const slot = (i: number, cls: string, delay: number) => {
    const x = withPos[i];
    if (!x) return `<div class="pcol ${cls} empty"></div>`;
    return `<div class="pcol ${cls}" style="--d:${delay}s"><div class="pwho"><span class="pav" style="background:${colorOf(x.u)}">${esc(x.n[0]?.toUpperCase() || "?")}</span><b>${esc(x.n)}</b><span class="ppts">${x.p} pt${x.p === 1 ? "" : "s"}</span></div><div class="pblock"><span>${x.pos}º</span></div></div>`;
  };
  const base = 7.4;
  const rows = withPos
    .map((x, i) => ({ x, i }))
    .reverse()
    .map(({ x }, k) => ({ x, d: base + k * 0.35 }));
  const sorted = rows.slice().sort((a, b) => a.x.pos - b.x.pos || b.x.p - a.x.p);
  const h = isHost();
  return `<div class="podium">
    <div class="pd-title" style="--d:0s"><span class="px">Fim de jogo</span><small>Sala ${esc(codeTxt())} · ${list.length} jogadores</small></div>
    <div class="pstage">${slot(1, "p2", 3.0)}${slot(0, "p1", 5.0)}${slot(2, "p3", 1.0)}</div>
    <div class="pconf" style="--d:5.4s">${Array.from({ length: 36 }, (_, i) => `<i style="left:${(i * 2.8 + Math.random() * 2).toFixed(1)}%;animation-delay:${(5.4 + Math.random() * 0.8).toFixed(2)}s;animation-duration:${(2 + Math.random() * 1.4).toFixed(2)}s;background:${["#F5C542", "#fff", "#FF2A2A", "#C8CCD4"][i % 4]}"></i>`).join("")}</div>
    <div class="panel board pfull" style="--d:${base - 0.4}s"><h3>Ranking da sala</h3><div class="brows">${sorted
      .map(
        ({ x, d }) =>
          `<div class="brow pr${x.u === S.me ? " me" : ""}" style="--d:${d.toFixed(2)}s"><span class="bpos">${x.pos}º</span><span class="bnm">${esc(x.n)}</span><span class="bpt">${x.p} pt${x.p === 1 ? "" : "s"}</span></div>`,
      )
      .join("")}</div></div>
    <div class="pact" style="--d:${(base + rows.length * 0.35 + 0.2).toFixed(2)}s">${
      h ? `<button class="btn btn-red btn-block" type="button" data-act="replay">Jogar de novo (placar zerado)</button>` : ""
    }<button class="btn btn-ghost btn-block" type="button" data-act="leave">Sair da sala</button></div>
  </div>`;
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

/** A pergunta fica numa camada própria no <body>: dentro da sala, um ancestral com transform prendia o fixed. */
function aquiLayer(room: Room): void {
  let el = document.getElementById("aquiLayer");
  const html = aquiHTML(room);
  if (!html) return void el?.remove();
  if (!el) {
    el = document.createElement("div");
    el.id = "aquiLayer";
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest('[data-act="aqui"]')) void act("aqui");
    });
    document.body.appendChild(el);
  }
  el.innerHTML = html;
}

/** "Você ainda está aí?": deixou passar a vez ou o voto; sem confirmar no prazo, o servidor tira da sala. */
function aquiHTML(room: Room): string {
  const ate = room.aqui?.[S.me];
  if (!ate) return "";
  return `<div class="aqui" role="alertdialog" aria-labelledby="aquiT"><div class="aqui-box">
    <h2 id="aquiT">Você ainda está aí?</h2>
    <p>O seu tempo passou sem resposta. Confirme para continuar na sala.</p>
    <div class="ttimer low" data-end="${ate}" role="timer"><span>Sai da sala em</span><b>${fmtLeft(ate - Date.now())}</b></div>
    <button class="btn btn-red btn-block" type="button" data-act="aqui">Estou aqui</button>
  </div></div>`;
}

/** A cada segundo: atualiza o relógio (quem passa a vez quando o tempo acaba é o servidor). */
function tick(): void {
  for (const el of document.querySelectorAll<HTMLElement>(".ttimer[data-end]")) {
    const left = Number(el.dataset.end) - Date.now();
    const b = el.querySelector("b");
    if (b) b.textContent = fmtLeft(left);
    el.classList.toggle("low", left <= 10000);
  }
}

/** Sair no meio da partida (com confirmação): sempre dá para voltar ao início. */
function leaveHTML(): string {
  return S.leaveAsk
    ? `<div class="panel leaveask" data-zone="side"><p style="margin:0 0 10px"><b>Sair da sala?</b> Você sai desta partida e ela segue sem você.</p><div style="display:flex;gap:8px"><button class="btn btn-red btn-sm" type="button" data-act="leave">Sim, sair</button><button class="btn btn-ghost btn-sm" type="button" data-act="leaveNo">Cancelar</button></div></div>`
    : `<button class="btn btn-ghost btn-block" type="button" data-act="leaveAsk" data-zone="side">Sair da sala</button>`;
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
  return `${stepperHTML(room, 1)}
  <h2 class="big center">${title}</h2>
  ${meter}
  ${room.voteAt ? `<div class="ttimer vtimer" data-end="${room.voteAt + VOTE_TIME * 1000}" role="timer"><span>A votação fecha em</span><b>${fmtLeft(room.voteAt + VOTE_TIME * 1000 - Date.now())}</b></div>` : ""}
  ${chatHTML(room, true)}
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
  ${falaHTML(room)}
  ${manageHTML(room)}
  ${isHost() ? `<button class="btn btn-ghost btn-block" type="button" data-act="close">Encerrar votação agora</button>` : ""}
  ${leaveHTML()}`;
}

/** Anfitrião: tirar jogadores a qualquer momento (offline, saiu da chamada…). */
function manageHTML(room: Room): string {
  if (!isHost()) return "";
  const ids = activeIds(room).filter((id) => id !== S.me);
  if (!ids.length) return "";
  return `<details class="panel manage" data-zone="side" id="manage"${S.manageOpen ? " open" : ""}><summary>Gerenciar jogadores <span class="note">(${ids.length + 1} na sala)</span></summary>
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

/** Dicas que um jogador deu na rodada (por etapa, na eliminação). */
function playerCluesHTML(room: Room, id: string): string {
  const last = room.round?.stage || 1;
  const parts: string[] = [];
  for (let st = 1; st <= last; st++) {
    const k = roundKey(room) + (st > 1 ? "s" + st : "");
    const mine = Object.entries(room.clues?.[k] || {})
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .filter(([, c]) => c.u === id)
      .map(([, c]) => c.t);
    if (!mine.length) continue;
    const label = last > 1 ? `<small>Etapa ${st}</small>` : `<small>Dicas</small>`;
    parts.push(`<span class="rc-row">${label}${mine.map((t) => `<b>${esc(t)}</b>`).join("")}</span>`);
  }
  return `<p class="rclues">${parts.length ? parts.join("") : `<span class="note">Não deu nenhuma dica nesta rodada.</span>`}</p>`;
}

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
  return `${stepperHTML(room, 2)}
  <div class="result ${o.win ? "win" : "lose"}">${o.win ? "" : `<div style="font-family:var(--pixel);color:var(--red);font-size:52px;line-height:.9;text-shadow:3px 3px 0 var(--red-deep)">Impostor</div>`}<h2>${o.title}</h2><p>${o.sub}</p>${r.chaos && r.imps.length && r.imps.length < r.players.length ? `<p>${esc(r.chaos)}</p>` : ""}<p style="margin-top:14px;font-size:13px;opacity:.75">Carta secreta · ${esc(themeName(r.cat))}</p>${o.pending ? `<div class="sw-word">Revelada depois do chute</div>` : secretHTML(r.cat, r.sid ? dec(r.sid) : null, word)}</div>
  ${canGuess && waitFor.length ? `<div class="banner center">Esperando também o chute de ${waitFor.map((id) => esc(nickOf(id))).join(", ")}.</div>` : ""}
  ${canGuess ? `<div class="panel"><h3>Seu chute</h3><div class="myturn"><input class="field" id="guessIn" maxlength="40" placeholder="Quem era o jogador ou time?" autocomplete="off" aria-label="Seu chute"><button class="btn btn-red" type="button" data-act="guess">Chutar</button></div>${sugBoxHTML("guessIn", r.cat)}</div>` : o.pending && waitFor.length ? `<div class="banner center">Esperando o chute de ${waitFor.map((id) => esc(nickOf(id))).join(", ")}…</div>` : ""}
  <div class="panel"><h3>Quem era quem</h3><p class="note" style="margin:-4px 0 10px">Toque num nome para ver as dicas que a pessoa deu.</p><div class="roles">${r.players
    // quem saiu da sala (inclusive por inatividade) não entra na apuração; só o impostor que saiu continua na revelação
    .filter((id) => !!room.players?.[id] || r.imps.includes(id))
    .map((id) => {
      const bad = r.imps.includes(id);
      const gone = !room.players?.[id];
      const v = gone ? 0 : tally[id] || 0;
      const info = gone ? "saiu da sala" : isElim(room) ? (outAt[id] ? "saiu na etapa " + outAt[id] : "ficou até o fim") : v + " voto" + (v === 1 ? "" : "s");
      const gs = G[id] ? ` · chutou “${esc(G[id].t)}” ${G[id].ok ? "✓" : "✗"}` : "";
      const open = S.openClues.includes(id);
      return `<button type="button" class="role${bad ? " bad" : ""}" data-act="clues" data-id="${esc(id)}" aria-expanded="${open}"><span><span class="chev">${open ? "▾" : "▸"}</span> ${esc(nickOf(id))} <span class="note" style="font-weight:500">· ${info}${gs}</span></span><em>${bad ? (decoy ? "Infiltrado · " + esc(decoy) : "Impostor") : "Elenco"}</em></button>${open ? playerCluesHTML(room, id) : ""}`;
    })
    .join("")}</div></div>
  ${scoreboardHTML(room)}
  ${chatMsgs(room).length ? chatHTML(room, false) : ""}
  ${manageHTML(room)}
  ${isHost() ? `<button class="btn btn-red btn-block" type="button" data-act="again">Nova rodada</button><button class="btn btn-ghost btn-block" type="button" data-act="lobby">Voltar para a sala de espera</button>${endRoomHTML()}` : `<div class="banner center">${esc(nickOf(room.host))} começa a próxima rodada ou encerra a sala.</div>`}
  <button class="btn btn-ghost btn-block" type="button" data-act="leave">Sair da sala</button>`;
}

/* ---------- ações ---------- */
/** Pedido que o servidor decide (sorteio, apuração, chute, pontos). */
const send = (a: string, d?: Record<string, unknown>) => write(() => ref().act(a, d));

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
        $("copyNote").textContent = (S.hideCode ? "Código" : "Código " + t) + " copiado. Cole no grupo da galera.";
      } catch {
        $("copyNote").textContent = S.hideCode ? "Não deu para copiar. Toque em Mostrar para ver o código." : "Copie o código: " + t;
      }
      break;
    }
    case "copyLink": {
      const l = inviteLink();
      try {
        await navigator.clipboard.writeText(l);
        $("copyNote").textContent = "Link copiado. Cole no grupo da galera.";
      } catch {
        $("copyNote").textContent = S.hideCode ? "Não deu para copiar. Toque em Mostrar para ver o código." : "Copie o link: " + l;
      }
      break;
    }
    case "hideCode":
      setHideCode(!S.hideCode);
      break;
    case "wa":
      window.open("https://wa.me/?text=" + encodeURIComponent(`Bora jogar Impostor do Futebol! Entra na sala ${S.code}: ${inviteLink()}`), "_blank", "noopener");
      break;
    case "kick":
      await send("kick", { id: b!.dataset.id! });
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
    case "again": {
      S.openClues = [];
      S.draft = "";
      S.guessDraft = "";
      await send("start");
      break;
    }
    case "clues": {
      const id = b!.dataset.id!;
      S.openClues = S.openClues.includes(id) ? S.openClues.filter((x) => x !== id) : S.openClues.concat(id);
      render();
      break;
    }
    case "endAsk":
      S.endAsk = true;
      render();
      break;
    case "endNo":
      S.endAsk = false;
      render();
      break;
    case "endYes":
      S.endAsk = false;
      if (!isHost()) return;
      await send("endYes");
      break;
    case "replay":
      await send("replay");
      break;
    case "lobby":
      await send("lobby");
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
        i = Object.keys(room!.clues?.[stageKey(room!)] || {}).length;
      if (r.order[i] !== S.me) return;
      if (await send("clue", { t })) S.draft = "";
      break;
    }
    case "chat": {
      const t = S.chatDraft.trim().replace(/\s+/g, " ").slice(0, CHAT_MAX_LEN);
      if (!t) {
        roomErr("Escreva uma mensagem antes de enviar.");
        return;
      }
      if (!["lobby", "clues", "vote"].includes(room!.status) || !chatMembro(room!)) return;
      if (chatFalta(room!)) return;
      if (chatMsgs(room!).filter(([, m]) => m.u === S.me).length >= CHAT_MAX_PER_PLAYER) return;
      const id = S.me + "-" + Date.now().toString(36);
      S.chatDraft = "";
      chatStick = true;
      chatLivreEm = Date.now() + CHAT_SLOW_MS;
      chatLivreChave = chatKey(room!);
      chatTick();
      if (!(await upd({ chat: { [chatKey(room!)]: { [id]: { u: S.me, t, at: now() } } }, updatedAt: now() }))) {
        S.chatDraft = t;
        chatLivreEm = 0;
      }
      render();
      break;
    }
    case "skip":
      await send("skip");
      break;
    case "tovote":
      await send("tovote");
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
      await send("kick", { id });
      break;
    }
    case "clueTime":
      await upd({ settings: { clueTime: Number(b!.dataset.k) }, updatedAt: now() });
      break;
    case "vmode":
      await upd({ settings: { voteMode: b!.dataset.k! }, updatedAt: now() });
      break;
    case "close":
      await send("close");
      break;
    case "guess": {
      const t = S.guessDraft.trim();
      if (!t) {
        roomErr("Escreva seu chute.");
        return;
      }
      const o = outcome(room!, (id) => id);
      if (!o.guessers?.includes(S.me) || guessesOf(room!)[S.me]) return;
      if (await send("guess", { t })) S.guessDraft = "";
      break;
    }
    case "leaveAsk":
      S.leaveAsk = true;
      render();
      break;
    case "aqui":
      await send("aqui");
      break;
    case "leaveNo":
      S.leaveAsk = false;
      render();
      break;
    case "leave": {
      S.leaveAsk = false;
      // sai primeiro desta página: a resposta do servidor ("não está mais na sala") chega depois e é ignorada
      const pede = room && S.me && room.players?.[S.me] ? send("leave").catch(() => false) : null;
      enterSeq++;
      S.unsubRoom?.();
      S.unsubRoom = null;
      if (pede) await pede;
      exitRoom();
      break;
    }
  }
}

/* ---------- eventos ---------- */
/** Início: lista de salas, criar e entrar por código. */
function wireHome(): void {
  $("rooms").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".roomrow");
    if (b) {
      $<HTMLInputElement>("codeIn").value = b.dataset.code || "";
      void join();
    }
  });
  $("createBtn").addEventListener("click", () => void create());
  $("joinBtn").addEventListener("click", () => void join());
  $("nick").addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Enter") return;
    if ($<HTMLInputElement>("codeIn").value.length === 4) void join();
    else void create();
  });
  const codeIn = $<HTMLInputElement>("codeIn");
  codeIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void join();
  });
  codeIn.addEventListener("input", () => (codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, "")));
}

/** Topo das telas de jogo: som e regras. */
function wireTopo(): void {
  document.getElementById("homeBtn")?.addEventListener("click", () => window.scrollTo(0, 0));
  S.hideCode = ls.get("idf-hide-code") === "1";
  // no modo local a etiqueta diz "LOCAL": não tem código para esconder
  if (PAGE() === "sala") document.getElementById("roomTag")?.addEventListener("click", () => setHideCode(!S.hideCode));
  unlockOnGesture();
  const muteBtn = document.getElementById("muteBtn");
  if (muteBtn) {
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
  }
  document.getElementById("rulesBtn")?.addEventListener("click", () => {
    const d = $<HTMLDialogElement>("rules");
    try {
      d.showModal();
    } catch {
      d.setAttribute("open", "");
    }
  });
}

/** Sala: convite, partida e todos os botões dentro dela. */
function wireSala(): void {
  setInterval(tick, 1000);
  document.addEventListener(
    "toggle",
    (e) => {
      if ((e.target as HTMLElement).id === "manage") S.manageOpen = (e.target as HTMLDetailsElement).open;
    },
    true,
  );
  wireSugestoes();
  $("joinBtn").addEventListener("click", () => void join());
  $("nick").addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") void join();
  });
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
}

export function startHome(): void {
  wireHome();
  S.hideCode = ls.get("idf-hide-code") === "1";
  paintHide();
  paintVis();
  for (const b of document.querySelectorAll<HTMLButtonElement>(".vis-op"))
    b.addEventListener("click", () => {
      ls.set("idf-priv", b.dataset.vis === "priv" ? "1" : null);
      paintVis();
    });
  $("hideCodesBtn").addEventListener("click", () => setHideCode(!S.hideCode));
  void bootHome();
}

export function startSala(): void {
  wireTopo();
  wireSala();
  void bootSala();
}

export function startLocal(): void {
  wireTopo();
  wireLocal();
  wireSugestoes();
  void enterLocal(() => goHome());
}
