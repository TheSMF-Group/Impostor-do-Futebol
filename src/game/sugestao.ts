// Autocomplete do chute do impostor: sugere nomes do tema da rodada, só a partir da 3ª letra
// (antes disso a lista entregaria as cartas). Vale para o chute online (#guessIn) e o local (#lGuess).
import { THEMES } from "./data";
import { esc } from "./util";

export const MIN_LETRAS = 3;
const MAX = 6;

const base = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** nomes do tema que batem com o que foi digitado: começo de palavra primeiro, depois trecho no meio */
export function sugestoes(cat: string, q: string): string[] {
  const b = base(q);
  if (b.replace(/ /g, "").length < MIN_LETRAS) return [];
  const inicio: string[] = [],
    meio: string[] = [];
  const vistos = new Set<string>();
  for (const it of THEMES[cat]?.items ?? []) {
    const nome = it[1];
    if (vistos.has(nome)) continue;
    const n = base(nome);
    if (n === b) continue; // já está escrito inteiro
    if (n.startsWith(b) || n.includes(" " + b)) inicio.push(nome);
    else if (n.includes(b)) meio.push(nome);
    else continue;
    vistos.add(nome);
  }
  const ord = (a: string, z: string) => a.localeCompare(z, "pt");
  return [...inicio.sort(ord), ...meio.sort(ord)].slice(0, MAX);
}

/** caixa de sugestões logo abaixo do campo; vazia até a 3ª letra */
export const sugBoxHTML = (inputId: string, cat: string): string =>
  `<div class="sug" id="${inputId}Sug" data-cat="${esc(cat)}" role="listbox" aria-label="Sugestões" hidden></div>`;

function preenche(input: HTMLInputElement): void {
  const box = document.getElementById(input.id + "Sug");
  if (!box) return;
  const lista = sugestoes(box.dataset.cat || "", input.value);
  box.innerHTML = lista.map((n) => `<button type="button" role="option" data-sug="${esc(n)}">${esc(n)}</button>`).join("");
  box.hidden = !lista.length;
}

/** liga uma vez: digitar atualiza a lista; tocar num nome preenche o campo (não envia o chute) */
export function wireSugestoes(): void {
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "guessIn" || t.id === "lGuess") preenche(t);
  });
  // pointerdown + preventDefault: o campo não perde o foco e o teclado do celular não fecha
  document.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".sug [data-sug]")) e.preventDefault();
  });
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".sug [data-sug]");
    if (!b) return;
    const box = b.parentElement!;
    const input = document.getElementById(box.id.replace(/Sug$/, "")) as HTMLInputElement | null;
    if (!input) return;
    input.value = b.dataset.sug!;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    box.hidden = true;
    input.focus();
  });
}

/** depois de redesenhar a tela, refaz a lista para o texto que já estava no campo */
export function refazSugestao(id: string): void {
  const i = document.getElementById(id) as HTMLInputElement | null;
  if (i) preenche(i);
}
