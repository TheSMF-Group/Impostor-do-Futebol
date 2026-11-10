// @ts-check
import { defineConfig } from "astro/config";

// Site estático: o Vercel detecta o preset Astro e publica a pasta dist.
export default defineConfig({
  site: "https://impostor-do-futebol.vercel.app",
  build: { inlineStylesheets: "auto" },
});
