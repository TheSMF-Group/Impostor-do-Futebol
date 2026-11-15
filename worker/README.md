# impostor-salas

Servidor das salas online (Cloudflare Worker + Durable Objects). Um `Sala` por código de 4 letras e um `Lista`
global com as salas abertas. O servidor guarda a sala inteira e decide tudo que depende de segredo (sorteio,
impostores, apuração, chute, pontos); cada jogador recebe só o que pode ver (`src/vista.ts`).

- Regras: importa `../src/game/rules.ts` (as mesmas do cliente e do modo local).
- Entrada: `wss://impostor-salas.thefenomeno.com/s/CODIGO?me=&k=&t=` (ingresso `t` emitido por `/api/ticket` do site,
  assinado com `IMPOSTOR_SECRET`, o mesmo valor da Vercel). Só quem está liberado pelo portão recebe ingresso.
- Identidade: `me` público + `k` secreto por aba; o servidor guarda o hash de `k` e recusa quem repetir o `me` sem ele.

```sh
# local: Worker em :8787 sem ingresso, site apontando para ele
cd worker && wrangler dev --var SEM_INGRESSO:1 --port 8787
PUBLIC_SALAS_URL=http://localhost:8787 npm run dev

# produção
cd worker && wrangler deploy
wrangler secret put IMPOSTOR_SECRET   # mesmo valor da env IMPOSTOR_SECRET na Vercel
```
