# Protocolo antes/depois — #124

Definido antes das execuções em 19/11/2026, após liberação da máquina e da Featherless.

- Base A: `c91d3ce65c802dfd40f342c88f456a118d4f8f40` (branch `123-integridade`, PR #146 ainda aberto).
- Implementação B: `78b30d2` (branch `124-sinais-conversa`).
- Worktree de referência destacado e separado; mesmos scripts, dependências e `.env.local` do clone principal. Não usar main enquanto o PR #146 não for integrado.
- `ARMAZENAMENTO=memoria`. Sem OpenRouter paga nas medições de LLM: `_gasto.ts` mantém o comportamento padrão. Nenhuma chave publicada.
- Uma execução por vez. Duas rodadas por instrumento de texto, ordem A–B / B–A. Sem aquecimento descartado, sem escolher a melhor execução e sem retentativas externas para substituir resultados ruins.
- `bench-conversa.ts featherless:google/gemma-4-26B-A4B-it`, `RODADAS=1`.
- `bench-quadro.ts featherless:google/gemma-4-26B-A4B-it`, `RODADAS=2`.
- `medir-rascunho.ts sala ide`, uma rodada completa de oito falas por área, antecedência padrão de 2600 ms. Pré-entrevista fora do escopo da #124.
- `placar-quadro/index.ts --rotulo <execução>`, todos os casos e as três personas padrão, sem modificar juiz, rubrica, limites ou prompts.
- `medir-transcricao.ts --pago`: uma tentativa em cada versão. A pasta `fixtures/transcricao` só tem o roteiro, sem pares de áudio e referência; registrar a impossibilidade, sem fabricar áudios para preencher o requisito.

Limites de segurança por execução, predefinidos e iguais nas duas versões: conversa 10 min, quadro 15 min, rascunho 20 min, placar 45 min e transcrição 2 min. Se atingidos, preservar logs/progresso e classificar a execução como incompleta. O limite total do placar não reduz os 15 min por tentativa já previstos pelo juiz.

Todos os logs, metadados, erros e artefatos gerados serão preservados nesta pasta. “Publicar” aqui significa preparar os arquivos versionados para revisão local: nada de push, comentário remoto, PR ou tag sem ordem do Nícolas.

Qualquer piora observada ou medição necessária incompleta impede declarar a issue pronta para merge. Oscilações externas não serão atribuídas automaticamente à implementação.
