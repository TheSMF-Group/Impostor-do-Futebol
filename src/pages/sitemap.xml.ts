// Mapa do site para o Google: início, regras, modo local e as páginas de tema.
import type { APIRoute } from "astro";
import { TEMAS } from "../temas-paginas";

const SITE = "https://impostor.thefenomeno.com";

export const GET: APIRoute = () => {
  const paths = ["/", "/como-jogar", "/temas", "/local", ...TEMAS.map((t) => `/temas/${t.slug}`)];
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml" } });
};
