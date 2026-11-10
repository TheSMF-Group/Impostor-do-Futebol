# Impostor do Futebol

Jogo de impostor com tema de futebol, para jogar com a galera, cada um do próprio celular.
Feito em **Astro + TypeScript**.

**Jogar:** https://impostor-do-futebol.vercel.app · **Animações:** https://impostor-do-futebol.vercel.app/animacoes

## Como funciona

1. Alguém cria a sala e manda o código de 4 letras. Os outros entram pelo código.
2. Contagem 3, 2, 1 e "Deem seus palpites!". Cada um toca em **Virar carta**: o elenco vê o jogador ou time secreto, com foto e escudo. O impostor vê a tela vermelha (com dica de país e posição, se ligada).
3. Na sua vez ("Sua vez!"), cada um escreve uma pista de uma palavra.
4. "Hora da votação!": todo mundo vota. Se o impostor cair, ainda tem um chute para roubar a vitória.

Temas: Jogadores do Futebol Brasileiro, Jogadores da Champions League, Times Brasileiros (Série A e B), Times da Europa e Lendas do Futebol.

Opções do anfitrião: número de impostores, voltas de pistas, Infiltrado, Rodada caótica, Dica do impostor e temas.

## Rodar

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # checa os tipos (astro check) e gera dist/
```

## Estrutura

```
src/
  pages/index.astro        página do jogo
  pages/animacoes.astro    demonstração de todas as animações
  layouts/Layout.astro     <head>, fontes
  styles/global.css        visual (preto e vermelho)
  game/
    app.ts                 telas, ações e início
    rules.ts               regras puras: sorteio da rodada, votos, resultado, chute
    backend.ts             salas: banco do claude.ai ou MQTT (broker público)
    card.ts                carta, frente com foto/escudo e virada 3D
    moments.ts             avisos em tela cheia (3-2-1, Sua vez!, votação, resultado)
    data.ts                temas, fotos e escudos (carregados de public/data)
    state.ts, types.ts, util.ts
public/
  data/                    temas.json, escudos.json, fotos-*.json (gerados)
  img/mascote/             mascote da página inicial em camadas
tools/
  build-data.ts            gera public/data a partir dos repositórios locais
  lendas.json              lendas e o clube do escudo
  arte/camadas.py          recorte do mascote (script de imagem usado uma vez, Python/PIL)
```

## Dados

`npm run data` lê os repositórios locais e regrava `public/data`:

- `~/Documents/thefenomeno-jogos`: fotos, escudos, jogadores da Champions e lendas.
- `~/Downloads/gloria-eterna-astro` (The Manager): elencos e titulares do Brasileirão (4-3-3 pelo overall) e fotos extras.

Ajustes manuais ficam em `tools/build-data.ts` (`BR_SWAP`, `CL_DROP`, `CL_KEEP`, `CL_REMOVE`, `CL_MOVE`, `CL_ADD`, `PICK`, `MANUAL`).

## Salas online

- No site (Vercel), as salas usam MQTT em broker público (EMQX, com HiveMQ de reserva). O anfitrião guarda o estado da sala; os outros mandam as mudanças e ele aplica. O anfitrião precisa ficar com o jogo aberto.
- Dentro do claude.ai, o jogo usa o banco do próprio artifact.

## Publicar

```bash
npx vercel deploy --prod
```
