// Onde ficam as salas: no Worker do Impostor (um Durable Object por sala, autoridade no servidor).
// O cliente fala por WebSocket. Mantém o formato antigo de "banco" (doc / onSnapshot / update) e ganha act(),
// para os pedidos que o servidor decide (sortear, apurar, chutar, pontuar).
import type { Db, DocRef, DocSnap, Patch, Query, QuerySnap, Room } from "./types";

const BASE: string = (import.meta.env.PUBLIC_SALAS_URL as string | undefined) || "https://impostor-salas.thefenomeno.com";
const WS_BASE = BASE.replace(/^http/, "ws");

export interface Backend {
  db: Db;
  me: string;
  nick?: string;
  readOnly: boolean;
}

/** Erro devolvido pelo servidor (ex.: "cheia", "vez", "proibido"). */
export class ServerError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Identidade por aba: id público + segredo, para ninguém se passar por outro jogador. */
function identity(): { me: string; k: string } {
  const rnd = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  try {
    let me = sessionStorage.getItem("idf-uid");
    let k = sessionStorage.getItem("idf-key");
    if (!me || !k || !/^[a-z0-9]{6,24}$/i.test(me)) {
      me = "u" + rnd(11);
      k = rnd(24);
      sessionStorage.setItem("idf-uid", me);
      sessionStorage.setItem("idf-key", k);
    }
    return { me, k };
  } catch {
    return { me: "u" + rnd(11), k: rnd(24) };
  }
}

let ticket = "";
let ticketAt = 0;
/** Ingresso assinado pelo site (só quem está liberado recebe). Em desenvolvimento local não existe e o Worker dispensa. */
async function getTicket(): Promise<string> {
  if (ticket && Date.now() - ticketAt < 30 * 60_000) return ticket;
  try {
    const r = await fetch("/api/ticket", { cache: "no-store" });
    if (r.ok) {
      ticket = ((await r.json()) as { t: string }).t;
      ticketAt = Date.now();
    }
  } catch {
    /* sem ingresso: o Worker decide */
  }
  return ticket;
}

type Msg = { t: string; r?: Room; rooms?: Room[]; id?: number; c?: string; m?: string };

/** Uma conexão (sala ou lista) com reconexão automática. */
class Conn {
  ws: WebSocket | null = null;
  listeners = new Set<(m: Msg) => void>();
  onFail = new Set<() => void>();
  pending = new Map<number, { ok: () => void; no: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  seq = 0;
  tries = 0;
  closed = false;
  ready: Promise<void> | null = null;
  ping: ReturnType<typeof setInterval> | null = null;
  idle: ReturnType<typeof setTimeout> | null = null;
  last: Msg | null = null;

  constructor(private path: (t: string) => string, private params: () => string) {}

  async open(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      void (async () => {
        const t = await getTicket();
        const ws = new WebSocket(`${WS_BASE}${this.path(t)}${this.params()}${t ? "&t=" + encodeURIComponent(t) : ""}`);
        this.ws = ws;
        ws.onopen = () => {
          this.tries = 0;
          resolve();
          this.ping ||= setInterval(() => ws.readyState === 1 && ws.send("ping"), 25_000);
        };
        ws.onmessage = (e) => {
          if (e.data === "pong") return;
          let m: Msg;
          try {
            m = JSON.parse(e.data as string) as Msg;
          } catch {
            return;
          }
          if (m.t === "ack" || m.t === "err") {
            const p = this.pending.get(m.id ?? -1);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(m.id!);
              m.t === "ack" ? p.ok() : p.no(new ServerError(m.c || "erro", m.m || "Erro."));
            }
            return;
          }
          this.last = m;
          for (const f of [...this.listeners]) f(m);
        };
        ws.onclose = () => {
          this.ws = null;
          this.ready = null;
          if (this.ping) clearInterval(this.ping);
          this.ping = null;
          for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.no(new ServerError("conexao", "Conexão perdida."));
          }
          this.pending.clear();
          if (this.closed) return;
          // o servidor encerra de propósito quando manda none/exists/denied: sem reconexão
          if (this.last && ["none", "exists", "denied"].includes(this.last.t)) return;
          if (++this.tries > 12) {
            reject(new Error("falhou"));
            this.onFail.forEach((f) => f());
            return;
          }
          setTimeout(() => !this.closed && this.listeners.size && void this.open().catch(() => {}), Math.min(4000, 400 * this.tries));
        };
        ws.onerror = () => {
          if (ws.readyState !== 1 && this.tries === 0) reject(new Error("falhou"));
        };
      })();
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  async request(msg: Record<string, unknown>): Promise<void> {
    await this.open();
    const id = ++this.seq;
    return new Promise<void>((ok, no) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        no(new ServerError("tempo", "O servidor demorou para responder."));
      }, 10_000);
      this.pending.set(id, { ok, no, timer });
      this.ws?.send(JSON.stringify({ ...msg, id }));
    });
  }

  listen(f: (m: Msg) => void): () => void {
    this.listeners.add(f);
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    void this.open().catch(() => this.onFail.forEach((g) => g()));
    if (this.last && this.ws) f(this.last);
    return () => {
      this.listeners.delete(f);
      if (!this.listeners.size) this.close();
    };
  }

  /** Fecha se ninguém ouvir em 15 s (a entrada por update() abre antes de existir ouvinte). */
  soltaSeOcioso(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => !this.listeners.size && this.close(), 15_000);
  }

  close(): void {
    this.closed = true;
    if (this.ping) clearInterval(this.ping);
    try {
      this.ws?.close();
    } catch {
      /* já fechou */
    }
  }
}

const conns = new Map<string, Conn>();
const creating = new Map<string, string>();

function db(me: string, k: string): Db {
  const sala = (code: string): Conn => {
    let c = conns.get(code);
    if (!c || c.closed) {
      const nick = creating.get(code);
      c = new Conn(
        () => `/s/${code}`,
        () => `?me=${me}&k=${k}${nick ? "&create=1&nick=" + encodeURIComponent(nick) : ""}`,
      );
      conns.set(code, c);
      c.soltaSeOcioso();
    }
    return c;
  };
  const snap = (r: Room | null): DocSnap => ({ exists: !!r, data: () => r, metadata: { fromCache: false } });
  return {
    doc(path: string): DocRef {
      const code = path.split("/")[1];
      return {
        async get() {
          const t = await getTicket();
          const r = await fetch(`${BASE}/s/${code}/info?me=${me}${t ? "&t=" + encodeURIComponent(t) : ""}`, { cache: "no-store" });
          if (!r.ok) throw new ServerError("rede", "Não deu para falar com o servidor.");
          const j = (await r.json()) as { exists: boolean; room: Room | null };
          return snap(j.exists ? j.room : null);
        },
        async set(room: Room) {
          creating.set(code, room.players?.[room.host]?.nick || "Jogador");
          conns.get(code)?.close();
          conns.delete(code);
          await sala(code).open();
        },
        async update(p: Patch) {
          await sala(code).request({ t: "patch", p });
        },
        async act(a: string, d?: Record<string, unknown>) {
          await sala(code).request({ t: "do", a, d: d || {} });
        },
        onSnapshot(next, err) {
          const c = sala(code);
          const off = c.listen((m) => {
            if (m.t === "room" && m.r) next(snap(m.r));
            else if (m.t === "none" || m.t === "exists") next(snap(null));
            else if (m.t === "denied") err?.(new ServerError("denied", "Identidade recusada."));
          });
          c.onFail.add(() => err?.(new ServerError("conexao", "Sem conexão.")));
          return () => {
            off();
            creating.delete(code);
            conns.delete(code);
          };
        },
      };
    },
    collection(): Query {
      const q: Query = {
        where: () => q,
        orderBy: () => q,
        limit: () => q,
        onSnapshot(next, err) {
          const c = new Conn(() => "/lista", () => "?me=" + me);
          const off = c.listen((m) => {
            if (m.t !== "list") return;
            const docs = (m.rooms || []).map((r) => snap(r));
            next({ docs, metadata: { fromCache: false } } as QuerySnap);
          });
          c.onFail.add(() => err?.(new ServerError("conexao", "Sem conexão.")));
          return off;
        },
      };
      return q;
    },
  };
}

/** Conecta (a conexão de verdade abre quando a pessoa cria, entra ou olha a lista). */
export async function connect(): Promise<Backend | null> {
  const { me, k } = identity();
  return { db: db(me, k), me, readOnly: false };
}
