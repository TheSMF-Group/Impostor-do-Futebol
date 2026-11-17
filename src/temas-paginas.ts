// Texto das páginas de tema (/temas/<slug>). A lista de cartas vem de public/data/temas.json no build.
import type { ThemeKey } from "./game/types";

export interface TemaPagina {
  k: ThemeKey;
  slug: string;
  /** nome curto para menus */
  curto: string;
  /** frase do <title> e da busca */
  titulo: string;
  descricao: string;
  /** parágrafos de abertura */
  intro: string[];
  /** uma rodada de exemplo: a carta, as pistas do elenco e a do impostor */
  exemplo: { carta: string; pistas: string[]; impostor: string; porque: string };
}

export const TEMAS: TemaPagina[] = [
  {
    k: "jge",
    slug: "jogadores-em-geral",
    curto: "Jogadores em geral",
    titulo: "Impostor do Futebol com jogadores do mundo todo",
    descricao: "Jogue Impostor com jogadores do mundo inteiro: Brasileirão, Europa e seleções. Veja a lista de cartas e crie uma sala grátis.",
    intro: [
      "O tema mais aberto do jogo. A carta pode ser um craque da Champions, um titular do Brasileirão ou aquele argentino que todo mundo conhece do álbum.",
      "É o tema certo para grupo misturado, em que nem todo mundo acompanha a mesma liga. Quem sabe mais dá pistas melhores, mas o impostor também tem mais espaço para blefar.",
    ],
    exemplo: { carta: "Vinicius Junior", pistas: ["drible", "Bola de Ouro", "dança"], impostor: "velocidade", porque: "Velocidade serve para metade dos atacantes do mundo. O impostor escolheu uma pista que não compromete." },
  },
  {
    k: "jbr",
    slug: "jogadores-do-futebol-brasileiro",
    curto: "Futebol brasileiro",
    titulo: "Impostor do Futebol com jogadores do Brasileirão",
    descricao: "Impostor com quem joga no Brasil hoje: elencos de Flamengo, Palmeiras, Corinthians, São Paulo e mais. Lista de cartas e sala grátis.",
    intro: [
      "Só quem está jogando no Brasil agora, brasileiro ou gringo. É o tema de quem vê a rodada do Brasileirão inteira no domingo.",
      "As pistas aqui costumam ser posição, apelido da torcida ou um lance marcante da temporada. O impostor sofre quando o elenco é de um time que o grupo inteiro acompanha.",
    ],
    exemplo: { carta: "Giorgian De Arrascaeta", pistas: ["uruguaio", "camisa 10", "assistência"], impostor: "meia", porque: "Meia é verdade para a carta, mas é genérico demais. Quem dá uma pista assim costuma levar voto." },
  },
  {
    k: "jbs",
    slug: "jogadores-brasileiros",
    curto: "Brasileiros",
    titulo: "Impostor do Futebol com jogadores brasileiros",
    descricao: "Impostor só com jogadores brasileiros, daqui e de fora: seleção, Europa e Brasileirão. Lista de cartas e sala grátis.",
    intro: [
      "Todo mundo aqui é brasileiro, jogando no Brasil ou lá fora. Tem convocado da seleção, titular de time europeu e ídolo de clube grande.",
      "Como a nacionalidade é igual para todas as cartas, a pista \"brasileiro\" não ajuda ninguém. O jeito é falar de posição, estilo e clube antigo sem dizer o nome dele.",
    ],
    exemplo: { carta: "Raphinha", pistas: ["canhoto", "Catalunha", "Gaúcho"], impostor: "seleção", porque: "Seleção vale para quase todas as cartas do tema. Foi a pista mais fraca da rodada." },
  },
  {
    k: "jcl",
    slug: "jogadores-da-champions-league",
    curto: "Champions League",
    titulo: "Impostor do Futebol com jogadores da Champions League",
    descricao: "Impostor com os elencos dos grandes da Europa: Real Madrid, Barcelona, City, PSG, Bayern e mais. Lista de cartas e sala grátis.",
    intro: [
      "Os elencos dos clubes que disputam a Champions League: Real Madrid, Barcelona, Manchester City, PSG, Bayern, Liverpool, Arsenal e outros.",
      "É o tema para quem joga Ultimate Team e vê a terça e a quarta de Champions. As pistas mais traiçoeiras são de seleção e de posição, porque cada time tem vários de cada.",
    ],
    exemplo: { carta: "Erling Haaland", pistas: ["norueguês", "artilheiro", "meditação"], impostor: "camisa 9", porque: "Camisa 9 parece pista de quem sabe, mas serve para dezenas de cartas. O elenco desconfiou." },
  },
  {
    k: "jan",
    slug: "jogadores-antigos",
    curto: "Antigos",
    titulo: "Impostor do Futebol com jogadores antigos",
    descricao: "Impostor com jogadores dos anos 90 e 2000 que todo brasileiro lembra: Robinho, Denílson, Kaká e cia. Lista de cartas e sala grátis.",
    intro: [
      "Jogadores que marcaram os anos 90 e 2000 e que o torcedor brasileiro reconhece de cara. Nada de nome obscuro: são os da Copa, do álbum e do videogame.",
      "Bom para grupo de amigos de idades diferentes. Quem viu jogar dá a pista certeira e quem não viu precisa blefar com o que lembra.",
    ],
    exemplo: { carta: "Denílson", pistas: ["pedalada", "Betis", "comentarista"], impostor: "ponta", porque: "Ponta é verdade, mas quem viu o Denílson jogar fala do drible. A pista entregou o impostor." },
  },
  {
    k: "len",
    slug: "lendas-do-futebol",
    curto: "Lendas",
    titulo: "Impostor do Futebol com lendas do futebol",
    descricao: "Impostor com as lendas: Pelé, Garrincha, Zico, Maradona, Ronaldo Fenômeno e mais. Lista de cartas e sala grátis.",
    intro: [
      "Os maiores de todos os tempos, do Brasil e do mundo. Pelé, Garrincha, Zico, Maradona, Cruyff, Ronaldo Fenômeno e companhia.",
      "É o tema mais fácil para o elenco, porque todo mundo tem uma história sobre cada lenda. Para o impostor, a saída é dar uma pista que caberia em várias.",
    ],
    exemplo: { carta: "Garrincha", pistas: ["pernas tortas", "1962", "alegria"], impostor: "Copa", porque: "Copa do Mundo cabe para quase todas as lendas. O impostor tentou passar despercebido." },
  },
  {
    k: "jgr",
    slug: "gringos-do-brasileirao",
    curto: "Gringos do Brasileirão",
    titulo: "Impostor do Futebol com gringos do Brasileirão",
    descricao: "Impostor só com estrangeiros que jogam no Brasil: argentinos, uruguaios, colombianos e mais. Lista de cartas e sala grátis.",
    intro: [
      "Só os estrangeiros que jogam no Brasil: argentinos, uruguaios, colombianos, paraguaios e quem mais veio para o Brasileirão.",
      "Tema curto e difícil. A nacionalidade ajuda o elenco, mas também ajuda o impostor, que só precisa acertar o país para parecer que sabe.",
    ],
    exemplo: { carta: "Agustín Rossi", pistas: ["argentino", "pênalti", "goleiro"], impostor: "Libertadores", porque: "Libertadores combina com vários gringos do Brasileirão. Foi uma pista segura do impostor." },
  },
  {
    k: "jgo",
    slug: "goleiros",
    curto: "Goleiros",
    titulo: "Impostor do Futebol com goleiros",
    descricao: "Impostor só com goleiros, do Brasil e do mundo. Todo mundo sabe a posição, então a pista tem que ser outra. Lista de cartas e sala grátis.",
    intro: [
      "Todas as cartas são goleiros. A posição não vale como pista, então o elenco precisa falar de defesa famosa, de clube, de seleção ou de jeito de jogar.",
      "Um dos temas mais divertidos para quem acompanha futebol de perto, e um dos mais cruéis para o impostor.",
    ],
    exemplo: { carta: "Alisson", pistas: ["Liverpool", "gol de cabeça", "seleção"], impostor: "luva", porque: "Luva vale para todas as cartas do tema. Foi a pista mais fácil de pegar." },
  },
  {
    k: "tge",
    slug: "clubes-do-mundo",
    curto: "Clubes do mundo",
    titulo: "Impostor do Futebol com clubes do mundo",
    descricao: "Impostor com clubes do Brasil, da Europa e da América do Sul. Veja a lista de times e crie uma sala grátis.",
    intro: [
      "A carta é um time, não um jogador. Pode ser grande do Brasil, da Europa ou da América do Sul.",
      "As pistas mais usadas são cor da camisa, estádio, mascote e rival. O impostor vê só o tema e precisa adivinhar o clube pelas pistas dos outros.",
    ],
    exemplo: { carta: "Boca Juniors", pistas: ["Bombonera", "azul e amarelo", "Riquelme"], impostor: "Libertadores", porque: "Libertadores serve para dezenas de clubes. O impostor tentou se esconder atrás dela." },
  },
  {
    k: "tbr",
    slug: "clubes-brasileiros",
    curto: "Clubes brasileiros",
    titulo: "Impostor do Futebol com clubes brasileiros",
    descricao: "Impostor com os clubes do Brasil: Flamengo, Palmeiras, Corinthians, São Paulo, Grêmio e mais. Lista de times e sala grátis.",
    intro: [
      "Só clubes brasileiros. Todo mundo do grupo tem um time, então a rodada vira provocação.",
      "Cuidado com a pista óbvia: falar a cor da camisa entrega o time para o impostor. A boa pista é a que só quem conhece entende.",
    ],
    exemplo: { carta: "Botafogo", pistas: ["estrela solitária", "Garrincha", "Engenhão"], impostor: "Rio", porque: "Rio de Janeiro vale para quatro grandes. Foi a pista vaga que levou os votos." },
  },
  {
    k: "teu",
    slug: "clubes-europeus",
    curto: "Clubes europeus",
    titulo: "Impostor do Futebol com clubes europeus",
    descricao: "Impostor com os clubes da Europa: Premier League, La Liga, Serie A, Bundesliga e Ligue 1. Lista de times e sala grátis.",
    intro: [
      "Times da Premier League, de La Liga, da Serie A, da Bundesliga, da Ligue 1 e de Portugal.",
      "Bom para quem joga videogame de futebol. Estádio, apelido e ídolo são as pistas que funcionam. País é perigoso, porque ajuda o impostor a chutar.",
    ],
    exemplo: { carta: "Liverpool", pistas: ["Anfield", "You'll Never Walk Alone", "Salah"], impostor: "Inglaterra", porque: "Dizer o país entrega pouco e ajuda o impostor a parecer do elenco. Ainda assim, ficou vago demais." },
  },
  {
    k: "tsa",
    slug: "clubes-sul-americanos",
    curto: "Clubes sul-americanos",
    titulo: "Impostor do Futebol com clubes sul-americanos",
    descricao: "Impostor com os clubes da América do Sul fora do Brasil: Boca, River, Peñarol, Nacional e mais. Lista de times e sala grátis.",
    intro: [
      "Os clubes da Argentina, do Uruguai, do Chile, da Colômbia, do Paraguai e dos vizinhos. É o tema de Libertadores.",
      "Tema curto e difícil, bom para quem já conhece os outros de cor.",
    ],
    exemplo: { carta: "River Plate", pistas: ["Monumental", "faixa vermelha", "Gallardo"], impostor: "Buenos Aires", porque: "Buenos Aires tem vários clubes no tema. O impostor arriscou e ficou no meio do caminho." },
  },
];

export const temaPorChave = (k: string): TemaPagina | undefined => TEMAS.find((t) => t.k === k);
