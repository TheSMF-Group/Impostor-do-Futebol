// Roteador do Worker: confere o ingresso e entrega a conexão para a sala (ou para a lista).
import { Sala } from "./sala";
import { Lista } from "./lista";

export { Sala, Lista };

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function assinar(secret: string, dado: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(dado)));
}

/** Ingresso emitido pelo site (/api/ticket): "<expira em ms>.<assinatura>". */
async function ingressoValido(env: Env, t: string | null): Promise<boolean> {
  if (env.SEM_INGRESSO === "1") return true;
  if (!t || !env.IMPOSTOR_SECRET) return false;
  const [exp, sig] = t.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return (await assinar(env.IMPOSTOR_SECRET, "ws:" + exp)) === sig;
}

function cors(env: Env, req: Request): Record<string, string> {
  const o = req.headers.get("origin") || "";
  const ok = env.ORIGENS.split(",").includes(o) || (env.SEM_INGRESSO === "1" && /^http:\/\/localhost(:\d+)?$/.test(o));
  return ok ? { "access-control-allow-origin": o, vary: "origin", "access-control-allow-headers": "content-type" } : { vary: "origin" };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (url.pathname === "/saude") return new Response("ok", { headers: h });

    if (!(await ingressoValido(env, url.searchParams.get("t")))) return new Response("ingresso inválido", { status: 401, headers: h });

    const m = url.pathname.match(/^\/s\/([A-Z]{4})(\/info)?$/);
    if (m) {
      const stub = env.SALA.get(env.SALA.idFromName(m[1]));
      const r: Response = await stub.fetch(req);
      if (r.webSocket) return r; // WebSocket não aceita cabeçalhos extras
      const out = new Response(r.body, r);
      for (const [k, v] of Object.entries(h)) out.headers.set(k, v);
      return out;
    }
    if (url.pathname === "/lista") return env.LISTA.get(env.LISTA.idFromName("global")).fetch(req);
    return new Response("não achei", { status: 404, headers: h });
  },
};
