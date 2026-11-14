# Amostras da voz do Totti

Frase de teste (fala do Totti): "Legal. E se o número de acessos dobrar amanhã, o que você mudaria primeiro?"

- `antes-1.mp3` a `antes-5.mp3`: a frase sem contexto, com velocidade 1,1 (como era antes). Cada arquivo é um pedido separado, então mostra a variação de entonação entre pedidos.
- `depois-1.mp3` a `depois-5.mp3`: a frase com `previous_text` (a fala anterior N) e velocidade pela regra atual (`velocidadeDaFala`: frase curta = 1,1).

Falas anteriores usadas (N):

1. "Oi, tudo bem? Eu sou o Totti e vou conduzir essa conversa com você hoje."
2. "Beleza, vamos começar pelo problema. Dá uma olhada no enunciado e me conta como você pensaria a solução."
3. "Entendi, você colocou um cache na frente do banco."
4. "Hum, certo. E por que essa opção e não um banco replicado?"
5. "A gente está chegando no fim do tempo, então vou te fazer uma última pergunta."

Para regerar (precisa de `ELEVENLABS_API_KEY` em `.env.local`; gasta créditos, são 10 sínteses curtas):

```sh
npm run voz:amostras -- amostras-voz
```

Código: `scripts/amostras-voz.ts`. Voz, modelo e ajustes: `lib/voz/ajustes.ts`.
