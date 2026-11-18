// Tipos mínimos do runtime do Workers (o pacote @cloudflare/workers-types não é instalado aqui).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare type DurableObjectState = any;
declare type DurableObjectNamespace = any;
declare type WebSocket = any;
declare const WebSocketPair: any;
declare const WebSocketRequestResponsePair: any;
interface Env {
  SALA: DurableObjectNamespace;
  LISTA: DurableObjectNamespace;
  ORIGENS: string;
  IMPOSTOR_SECRET?: string;
  /** só no wrangler dev: dispensa o ingresso */
  SEM_INGRESSO?: string;
}
interface ResponseInit {
  webSocket?: any;
}
interface Response {
  webSocket?: any;
}
