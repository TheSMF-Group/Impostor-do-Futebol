// O que cada jogador pode ver da sala. O servidor guarda tudo; quem está de fora recebe só o que já é público.
import type { Room } from "../../src/game/types.ts";
import { ordemDeFala } from "../../src/game/chat.ts";
import { jclone } from "../../src/game/util.ts";

const MASK = "?";

/** Cópia da sala para um jogador: sem a carta dos outros, sem a carta secreta e sem os impostores até o resultado. */
export function vistaPara(room: Room, me: string): Room {
  const v = jclone(room) as Room;
  v.used = [];
  const r = v.round;
  // ordem de fala: só quem escreveu e quando, o mesmo que o chat já mostra a todos; não depende de quem é impostor
  if (r) r.fala = ordemDeFala(room.chat?.["r" + room.rn], r.players).falaram;
  const revealed = v.status === "result" || v.status === "podium";
  if (r && !revealed) {
    const mine = r.cards?.[me];
    r.cards = mine ? { [me]: mine } : {};
    r.secret = "";
    r.sid = "";
    r.decoy = null;
    r.did = null;
    r.chaos = null;
    // na eliminação, quem já saiu foi revelado (round.outs); o resto vira "?" só para contar quantos faltam
    const out = new Set((r.outs || []).filter((o) => o.imp).map((o) => o.u));
    r.imps = r.imps.map((id) => (out.has(id) ? id : MASK));
  }
  if (!revealed) {
    // voto dos outros: só se sabe que votou (e quantos nomes tem), não em quem
    for (const [sk, vs] of Object.entries(v.votes || {})) {
      for (const [u, val] of Object.entries(vs || {})) {
        if (u === me || val == null) continue;
        const n = String(val).split(",").filter(Boolean).length;
        v.votes[sk][u] = Array.from({ length: Math.max(1, n) }, () => MASK).join(",");
      }
    }
  }
  return v;
}

/** Resumo de sala aberta para a lista da home (mesmo formato de Room, só com o necessário). */
export function resumoPublico(room: Room): Room {
  const players: Room["players"] = {};
  for (const [id, p] of Object.entries(room.players || {})) if (p) players[id] = { nick: p.nick, seat: p.seat, at: p.at };
  return {
    code: room.code,
    host: room.host,
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    settings: { ...room.settings },
    players,
    rn: room.rn,
    round: null,
    clues: {},
    votes: {},
    result: {},
    guess: {},
    used: [],
  };
}
