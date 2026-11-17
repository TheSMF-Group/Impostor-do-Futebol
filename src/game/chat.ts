// Regras puras do chat da sala: intervalo mínimo entre mensagens e ordem de fala. O servidor aplica; o cliente só mostra.
import type { ChatMsg } from "./types.ts";

type Msgs = Record<string, ChatMsg | null> | null | undefined;

/** Chave do chat: o do lobby é separado do da rodada ("lobby" x "r3"), então o limite por jogador e a ordem de fala nunca se misturam. */
export const chatKey = (r: { status: string; rn: number }): string => (r.status === "lobby" ? "lobby" : "r" + r.rn);

/** Quem pode escrever: no lobby, qualquer jogador da sala; nas pistas e na votação, quem ainda está no jogo; no resto, ninguém. */
export function podeFalar(
  room: { status: string; players?: Record<string, unknown>; round?: { alive?: string[] | null; players: string[] } | null },
  me: string,
): boolean {
  if (!room.players?.[me]) return false;
  if (room.status === "lobby") return true;
  if (room.status !== "clues" && room.status !== "vote") return false;
  return (room.round?.alive || room.round?.players || []).includes(me);
}

/** Intervalo mínimo entre duas mensagens do mesmo jogador (slowmode). */
export const CHAT_SLOW_MS = 3000;

/** Quantos ms o jogador ainda precisa esperar para falar de novo (0 = pode enviar). */
export function chatEspera(msgs: Msgs, me: string, agora: number): number {
  let ultima = -Infinity;
  for (const m of Object.values(msgs || {})) if (m && m.u === me && typeof m.at === "number" && m.at > ultima) ultima = m.at;
  return Math.max(0, ultima + CHAT_SLOW_MS - agora);
}

/**
 * Ordem de fala da rodada: quem escreveu primeiro no chat vem primeiro (pela 1ª mensagem de cada um).
 * `calados` são os jogadores de `ids` que não escreveram nada, na ordem em que `ids` os lista.
 */
export function ordemDeFala(msgs: Msgs, ids: string[]): { falaram: string[]; calados: string[] } {
  const primeira = new Map<string, { at: number; k: string }>();
  for (const [k, m] of Object.entries(msgs || {})) {
    if (!m || typeof m.t !== "string" || !ids.includes(m.u)) continue;
    const p = primeira.get(m.u);
    if (!p || m.at < p.at || (m.at === p.at && k < p.k)) primeira.set(m.u, { at: m.at, k });
  }
  const falaram = [...primeira.entries()].sort((a, b) => a[1].at - b[1].at || (a[1].k < b[1].k ? -1 : 1)).map(([u]) => u);
  return { falaram, calados: ids.filter((id) => !primeira.has(id)) };
}
