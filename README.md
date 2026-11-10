# Impostor do Futebol

Jogo de impostor com tema de futebol, para jogar com a galera, cada um do próprio celular.

**Jogar:** https://impostor-do-futebol.vercel.app

## Como funciona

1. Alguém cria a sala e manda o código de 4 letras. Os outros entram pelo código.
2. Cada um toca em **Virar carta**: o elenco vê o jogador ou time secreto, com foto e escudo. O impostor vê a tela vermelha (com dica de país e posição, se ligada).
3. Na sua vez, cada um escreve uma pista de uma palavra.
4. Todo mundo vota. Se o impostor cair, ainda tem um chute para roubar a vitória.

Temas: Jogadores do Futebol Brasileiro, Jogadores da Champions League, Times Brasileiros (Série A e B), Times da Europa e Lendas do Futebol.

Opções do anfitrião: número de impostores, voltas de pistas, Infiltrado, Rodada caótica, Dica do impostor e temas.

## Estrutura

- `index.html`: o jogo inteiro numa página só (dados, fotos e escudos embutidos). É o que vai para o Vercel.
- `_fonte/src.html`: código do jogo, sem os dados.
- `_fonte/build.py`: monta os temas a partir dos repositórios do The Fenômeno (fotos, escudos, Champions, lendas) e do The Manager (elencos e titulares do Brasileirão, Série A e B). Ajustes manuais da Champions em `CL_DROP`, `CL_KEEP`, `CL_REMOVE`, `CL_MOVE`, `CL_ADD`; do Brasileirão em `BR_SWAP`.
- `_fonte/lendas.json`: lendas e o clube do escudo.
- `_fonte/pack.py`: embute dados e arte no HTML final.
- `_fonte/camadas.py` e `_fonte/arte_*.webp`: recorte do mascote da página inicial.
- `_fonte/animacoes.html`: demonstração de todas as animações.

## Salas online

- No Vercel, as salas usam MQTT em broker público (EMQX, com HiveMQ de reserva). O anfitrião guarda o estado da sala; os outros mandam as mudanças e ele aplica. O anfitrião precisa ficar com o jogo aberto.
- Dentro do claude.ai, o jogo usa o banco do próprio artifact.

## Atualizar

```bash
cd _fonte
python3 build.py <pasta-de-dados>   # caminhos dos repositórios locais no topo do arquivo
python3 pack.py <pasta-raiz>        # gera impostor-do-futebol.html
```

Envolva o HTML gerado em `<!doctype html>…` como `index.html` e publique:

```bash
npx vercel deploy --prod
```
