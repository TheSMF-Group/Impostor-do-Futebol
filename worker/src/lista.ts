// Lista de salas abertas (esperando jogadores). Cada sala avisa aqui quando muda; quem está na home assina por WebSocket.
import type { Room } from "../../src/game/types";

const VALIDADE = 30 * 60_000;

export class Lista {
  ctx: DurableObjectState;
  salas = new Map<string, Room>();

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    // o "ping" de 25 s do navegador é respondido pela Cloudflare sem acordar o objeto
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.ctx.blockConcurrencyWhile(async () => {
      const s = (await this.ctx.storage.get("salas")) as [string, Room][] | undefined;
      if (s) this.salas = new Map(s);
    });
  }

  lista(): Room[] {
    const t = Date.now();
    // sala privada (modo streamer) não entra na lista: o código só chega a quem recebeu o convite
    for (const [c, r] of this.salas) if (t - r.updatedAt > VALIDADE || r.status !== "lobby" || r.settings?.priv) this.salas.delete(c);
    return [...this.salas.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/atualiza") {
      const { code, room } = (await req.json()) as { code: string; room: Room | null };
      if (room && room.status === "lobby" && !room.settings?.priv) this.salas.set(code, room);
      else this.salas.delete(code);
      await this.ctx.storage.put("salas", [...this.salas]);
      this.difunde();
      return new Response("ok");
    }
    if (req.headers.get("upgrade") === "websocket") {
      const par = new WebSocketPair();
      this.ctx.acceptWebSocket(par[1]);
      par[1].send(JSON.stringify({ t: "list", rooms: this.lista() }));
      return new Response(null, { status: 101, webSocket: par[0] });
    }
    return new Response("não achei", { status: 404 });
  }

  difunde(): void {
    const msg = JSON.stringify({ t: "list", rooms: this.lista() });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* conexão caiu */
      }
    }
  }

  webSocketMessage(ws: WebSocket, m: string): void {
    if (m === "ping") ws.send("pong");
  }
}
