// Estado da página (deste aparelho).
import type { Db, Room } from "./types";

export const S = {
  db: null as Db | null,
  me: "",
  code: null as string | null,
  room: null as Room | null,
  unsubRoom: null as (() => void) | null,
  unsubList: null as (() => void) | null,
  /** rodada em que este jogador já virou a carta */
  seenRn: null as number | null,
  /** rodada da carta aberta na tela */
  revRn: null as number | null,
  draft: "",
  guessDraft: "",
  readOnly: false,
  closing: false,
};

const COLORS = [
  "#E51B1B", "#F28C28", "#D4A017", "#2E9E5B", "#1E88E5", "#7E57C2", "#D81B60", "#00897B",
  "#6D4C41", "#546E7A", "#C0CA33", "#8E24AA", "#3949AB", "#F4511E", "#43A047",
];

export const nickOf = (id: string): string => S.room?.players?.[id]?.nick || "Saiu";
export const colorOf = (id: string): string => COLORS[(S.room?.players?.[id]?.seat ?? 0) % COLORS.length];
export const isHost = (): boolean => !!S.room && S.room.host === S.me;
