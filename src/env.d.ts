/// <reference types="astro/client" />

// Quando a página roda dentro do claude.ai, o visualizador oferece window.claude.
interface ClaudeUser {
  id(): Promise<string>;
  name(): Promise<string>;
  can(cap: string): Promise<boolean | null>;
}

interface ClaudeRuntime {
  use(name: "db"): Promise<import("./game/types").Db | null>;
  use(name: "user"): Promise<ClaudeUser | null>;
  use(name: string): Promise<unknown>;
}

interface Window {
  claude?: ClaudeRuntime;
}
