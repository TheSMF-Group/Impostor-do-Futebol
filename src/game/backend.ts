// Onde ficam as salas.
// - Dentro do claude.ai: banco do próprio artifact (window.claude).
// - Fora (Vercel): MQTT em broker público. Cada sala é uma mensagem retida com o estado inteiro;
//   só o anfitrião grava. Os outros mandam o pedaço que mudou para <sala>/in e o anfitrião aplica.
import type { MqttClient } from "mqtt";
import type { Db, DocRef, DocSnap, Patch, Query, QuerySnap, Room } from "./types";
import { deepMerge, jclone } from "./util";

const MQ_BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];
const MQ_NS = "impostor-do-futebol/v1/rooms/";

export interface Backend {
  db: Db;
  me: string;
  nick?: string;
  readOnly: boolean;
}

/** Tenta o claude.ai; se não houver, usa MQTT. Devolve null se nada conectar. */
export async function connect(): Promise<Backend | null> {
  const c = window.claude;
  if (c?.use) {
    const [db, user] = await Promise.all([c.use("db"), c.use("user")]);
    if (db && user) {
      const me = await user.id();
      const name = await user.name();
      const w = await user.can("data.write");
      return { db, me, nick: name ? name.split(" ")[0].slice(0, 18) : undefined, readOnly: w === false };
    }
  }
  const me = localId();
  const db = await mqttDb(me).catch(() => null);
  return db ? { db, me, readOnly: false } : null;
}

/** Id por aba: duas abas no mesmo aparelho contam como jogadores diferentes. */
function localId(): string {
  let id: string | null = null;
  try {
    id = sessionStorage.getItem("idf-uid");
  } catch {
    /* sem armazenamento */
  }
  if (!id) {
    id = "u" + Math.random().toString(36).slice(2, 12);
    try {
      sessionStorage.setItem("idf-uid", id);
    } catch {
      /* sem armazenamento */
    }
  }
  return id;
}

async function openClient(uid: string): Promise<MqttClient> {
  const { default: mqtt } = await import("mqtt");
  for (const url of MQ_BROKERS) {
    const c = mqtt.connect(url, {
      clientId: "idf_" + uid + "_" + Math.random().toString(36).slice(2, 6),
      clean: true,
      connectTimeout: 6000,
      reconnectPeriod: 2000,
      keepalive: 20,
    });
    const ok = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 7000);
      c.once("connect", () => {
        clearTimeout(t);
        res(true);
      });
      c.once("error", () => {
        clearTimeout(t);
        res(false);
      });
    });
    if (ok) return c;
    c.end(true);
  }
  throw { code: "upstream_error" };
}

async function mqttDb(uid: string): Promise<Db> {
  const client = await openClient(uid);
  const docs = new Map<string, Room | null>();
  const subs = new Map<string, Set<() => void>>();
  const lists = new Set<() => void>();
  const ready = new Map<string, { p: Promise<void>; ok: (() => void) | null }>();
  const vers = new Map<string, number>();

  const fire = (code: string) => {
    subs.get(code)?.forEach((f) => f());
    lists.forEach((f) => f());
  };
  const pub = (code: string, st: Room | null) => {
    const cur = docs.get(code);
    const v = Math.max(cur?._v ?? 0, st?._v ?? 0, vers.get(code) ?? 0) + 1;
    vers.set(code, v);
    if (st && st.status === "closed") st = null;
    if (st) st._v = v;
    docs.set(code, st);
    client.publish(MQ_NS + code, st ? JSON.stringify(st) : "", { retain: true, qos: 1 });
    fire(code);
  };

  client.on("message", (topic, buf) => {
    if (!topic.startsWith(MQ_NS)) return;
    const [code, kind] = topic.slice(MQ_NS.length).split("/");
    if (!/^[A-Z]{4}$/.test(code)) return;
    if (kind === "in") {
      const st = docs.get(code);
      if (!st || st.host !== uid) return;
      try {
        const p = JSON.parse(buf.toString()) as unknown;
        if (p && typeof p === "object") {
          deepMerge(st as unknown as Patch, p as Patch);
          st.updatedAt = Date.now();
          pub(code, st);
        }
      } catch {
        /* mensagem inválida */
      }
      return;
    }
    if (kind) return;
    const txt = buf.toString();
    let st: Room | null = null;
    if (txt) {
      try {
        st = JSON.parse(txt) as Room;
      } catch {
        st = null;
      }
    }
    // ignora versões antigas (inclusive o eco das próprias publicações chegando atrasado)
    const nv = st ? st._v ?? 0 : Infinity;
    if (nv < (vers.get(code) ?? 0)) return;
    if (st) vers.set(code, nv);
    docs.set(code, st);
    const r = ready.get(code);
    if (r?.ok) {
      r.ok();
      r.ok = null;
    }
    fire(code);
  });
  client.subscribe(MQ_NS + "+", { qos: 1 });

  const ensure = (code: string): Promise<void> => {
    const have = ready.get(code);
    if (have) return have.p;
    const r: { p: Promise<void>; ok: (() => void) | null } = { p: Promise.resolve(), ok: null };
    r.p = new Promise<void>((ok) => {
      r.ok = ok;
      setTimeout(() => {
        if (r.ok) {
          if (!docs.has(code)) docs.set(code, null);
          r.ok();
          r.ok = null;
        }
      }, 4000);
    });
    ready.set(code, r);
    client.subscribe([MQ_NS + code, MQ_NS + code + "/in"], { qos: 1 });
    return r.p;
  };
  const snap = (code: string): DocSnap => {
    const st = docs.get(code) ?? null;
    return { id: code, exists: !!st, data: () => jclone(st), metadata: { fromCache: false } };
  };
  const codeOf = (path: string) => String(path).split("/")[1];

  return {
    doc(path): DocRef {
      const code = codeOf(path);
      return {
        async get() {
          await ensure(code);
          return snap(code);
        },
        async set(d) {
          await ensure(code);
          pub(code, jclone(d));
        },
        async update(p) {
          await ensure(code);
          const st = docs.get(code);
          if (!st) throw { code: "not_found" };
          if (st.host === uid) {
            deepMerge(st as unknown as Patch, p);
            pub(code, st);
          } else
            await new Promise<void>((ok, no) =>
              client.publish(MQ_NS + code + "/in", JSON.stringify(p), { qos: 1 }, (e) => (e ? no(e) : ok())),
            );
        },
        onSnapshot(next) {
          const f = () => next(snap(code));
          let set = subs.get(code);
          if (!set) {
            set = new Set();
            subs.set(code, set);
          }
          set.add(f);
          void ensure(code).then(f);
          return () => set.delete(f);
        },
      };
    },
    collection(): Query {
      const w: [string, unknown][] = [];
      let lim = 20;
      const q: Query = {
        where(f, _op, v) {
          w.push([f, v]);
          return q;
        },
        orderBy() {
          return q;
        },
        limit(n) {
          lim = n;
          return q;
        },
        onSnapshot(next) {
          const f = () => {
            const list = [...docs.entries()]
              .filter((e): e is [string, Room] => !!e[1] && w.every(([k, v]) => (e[1] as unknown as Patch)[k] === v))
              .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
              .slice(0, lim)
              .map(([c]) => snap(c));
            const s: QuerySnap = { docs: list, metadata: { fromCache: false } };
            next(s);
          };
          lists.add(f);
          setTimeout(f, 1500);
          return () => lists.delete(f);
        },
      };
      return q;
    },
  };
}
