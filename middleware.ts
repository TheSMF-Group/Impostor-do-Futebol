// Portão de acesso do Impostor do Futebol (Vercel Routing Middleware).
// Antes da abertura só entra quem tem chave; o resto vê a contagem regressiva em /espera.
// Roda antes dos arquivos estáticos, então /data e /img também ficam atrás do portão.
import { next, rewrite } from "@vercel/functions/middleware";

export const config = { matcher: "/:path*" };

const COOKIE = "impostor_key";
// 16/11/2026 21h em Brasília (UTC-3). Troque com IMPOSTOR_OPEN_AT (ISO) sem mexer no código.
const DEFAULT_OPEN_AT = "2026-11-17T00:00:00Z";

// Públicos mesmo com o portão fechado: a própria página de espera e o que ela usa.
const PUBLIC = [/^\/espera\/?$/, /^\/_astro\//, /^\/bode\.png$/, /^\/img\/mascote\//, /^\/favicon/];

const enc = new TextEncoder();
const norm = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function token(secret: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(norm(key)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validKeys(): string[] {
  return (process.env.IMPOSTOR_KEYS ?? "").split(",").map(norm).filter(Boolean);
}

// Limite de tentativas por IP (melhor esforço, por instância).
const fails = new Map<string, { n: number; t: number }>();
function limited(ip: string): boolean {
  const f = fails.get(ip);
  return !!f && Date.now() - f.t < 10 * 60_000 && f.n >= 8;
}
function fail(ip: string) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.t >= 10 * 60_000) fails.set(ip, { n: 1, t: Date.now() });
  else f.n++;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const secret = process.env.IMPOSTOR_SECRET ?? "";
  const keys = validKeys();

  // Troca de chave por cookie.
  if (url.pathname === "/api/chave") {
    if (request.method !== "POST") return json({ ok: false }, 405);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?";
    if (limited(ip)) return json({ ok: false, erro: "Muitas tentativas. Espere uns minutos." }, 429);
    let chave = "";
    try {
      chave = String(((await request.json()) as { chave?: unknown }).chave ?? "");
    } catch {
      /* corpo inválido */
    }
    if (!secret || !norm(chave) || !keys.includes(norm(chave))) {
      fail(ip);
      return json({ ok: false, erro: "Chave inválida." }, 401);
    }
    const t = await token(secret, chave);
    return json({ ok: true }, 200, {
      "set-cookie": `${COOKIE}=${t}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  // Já aberto para todos?
  const openAt = Date.parse(process.env.IMPOSTOR_OPEN_AT || DEFAULT_OPEN_AT);
  if (Date.now() >= openAt) return next();

  // Portão aberto para quem tem a chave (cookie assinado).
  const cookie = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${COOKIE}=([0-9a-f]+)`))?.[1];
  if (cookie && secret) {
    for (const k of keys) if ((await token(secret, k)) === cookie) return next();
  }

  if (PUBLIC.some((r) => r.test(url.pathname))) return next();

  // Navegação: mostra a espera. Qualquer outra coisa (dados, imagens, api): 401.
  const wantsHtml = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) {
    return rewrite(new URL("/espera", request.url), {
      headers: { "x-impostor-gate": "1", "cache-control": "no-store" },
    });
  }
  return new Response("Acesso restrito.", { status: 401, headers: { "x-impostor-gate": "1", "cache-control": "no-store" } });
}
