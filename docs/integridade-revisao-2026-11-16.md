# Revisão e medições da integridade — PR #146 / issue #123

## Correções verificadas

- O quadro escreve o desafio no Excalidraw. Agora também oferece o enunciado selecionável num painel recolhido. A cópia de 60 ou mais caracteres usa a mesma captura da IDE: acrescenta o canário apenas à área de transferência. A frase do canário não entra no DOM, na cena ou nos prompts.
- A pré-checagem comum às duas salas informa a consulta a sintaxe, a regra de IA e os registros (colagens, saídas da janela, código, desenho e fala). Explica que câmera, tela e teclas não são gravadas e os sinais não alteram a nota. O lobby alternativo do quadro também mostra a regra.
- A recrutadora escolhe no plano entre resolver sem IA (padrão) e permitir IA com explicação do uso. A escolha persiste em revisões concorrentes e é excluída dos dados enviados ao extrator. Testes comparam os prompts antes/depois da escolha.
- Os alertas determinísticos de injeção saíram tanto de `concerns` na IDE quanto de `pontos_a_aprofundar` no quadro. A evidência com minuto continua em Integridade, sem destaque quando isolada. Notas e recomendações são preservadas.
- O commit `9253418` permanece ancestral da branch. O foco pendente continua no evento de encerramento existente, sem POST adicional. Nenhuma chamada de LLM, prompt de entrevista ou gatilho de análise foi acrescentado.

## Validação local

- `npm run test:integridade`: 57 aprovados, incluindo avaliação com LLM simulado, sem rede e com contagem de chamadas.
- `test:pre-entrevista`: 349; `test:ide`: 151; `test:relatorio`: 28; `test:rotas`: 111; `test:agente`: 825; `test:interrupcao`: 120; `test:seguranca`: 8; `test:sessao`: 4. Todos aprovados.
- `npx tsc --noEmit` e `npm run build`: aprovados. Lint sem erros, com avisos preexistentes.
- Chromium: cópia do enunciado com canário fora do DOM/cena/falas; pré-checagens das duas salas; fluxo honesto de início, edição e encerramento sem destaque nos eventos usados pelo relatório. Três casos aprovados em execuções direcionadas. APIs e áudio simulados nesses testes.

## Método das medições reais

Referência: `origin/main` em `0cdffdd468e7155564637bbe7fc415946a717dff`, num worktree separado. Implementação medida: `d29f86ce09fd1d20bb31cbb85b9e7dc4c768c6ac`. O validador da IDE rodou em `f1fead7`, que acrescenta somente testes de navegador, sem mudar código de produto. A main remota foi conferida novamente no fim e continuava no mesmo SHA.

Foi usado o `.env.local` do clone principal com `ARMAZENAMENTO=memoria`, nas duas versões. Scripts e parâmetros idênticos, executados sequencialmente por versão. `bench-conversa` usa uma rodada, `bench-quadro` duas. Nenhuma alteração nos scripts, modelos ou prompts para obter aprovação.

```powershell
$env:ARMAZENAMENTO='memoria'
npx tsx --env-file=.env.local scripts/bench-conversa.ts featherless:google/gemma-4-26B-A4B-it
npx tsx --env-file=.env.local scripts/bench-quadro.ts featherless:google/gemma-4-26B-A4B-it
npm run placar:quadro -- --rotulo integridade-123-main # repetir com rotulo integridade-123-pr na branch
npx tsx --env-file=.env.local scripts/validar-conversa-ide.ts
```

Os dois benchmarks selecionam explicitamente o modelo Featherless de 26B usado na medição anterior. Não cobrem a matriz inteira de modelos opcionais. O placar usa seus modelos e personas padrão. Sem `--pago`, o próprio `_gasto.ts` desliga a OpenRouter: os números não medem o fallback pago de produção. A validação real de voz dependente de créditos ElevenLabs ficou de fora; as quatro medições de texto foram tentadas em ambas as versões.

São amostras de LLM e rede, em máquina de desenvolvimento compartilhada com verificações locais. Não estabelecem causalidade nem equivalência estatística. Falhas de provedor e timeouts não contam como melhora. O critério explícito da issue continua valendo: piora observada ou comparação incompleta impede merge.

## Resultados

| Medição | main | PR |
| --- | --- | --- |
| `bench-conversa` | 8/14; p50 3.915 ms; p95 8.018 ms | 9/14; p50 2.030 ms; p95 8.024 ms |
| `bench-quadro` | 0/2 aprovadas; p50 2.605 ms; p95 11.379 ms; 0 erros; 20 chamadas | 0/2 aprovadas; p50 2.016 ms; p95 4.070 ms; 0 erros; 19 chamadas |
| `placar:quadro` | Sem placar final: erro de provedor após 385 s | Sem placar final: limite total de 1.200 s atingido, juiz sem avaliação |
| `validar-conversa-ide` | p50 2.869 ms; máximo 7.012 ms; 1 caso com falha em 13 | p50 4.505 ms; máximo 7.016 ms; 2 casos com falha em 13 |

`bench-conversa` teve falhas de provedor nas duas versões. O p95 do PR aumentou 6 ms. A medição anterior já publicada no PR (10/14 na main e 9/14 na branch) permanece no histórico; esta rodada não apaga aquela evidência. No quadro, as duas versões falharam na quantidade mínima de perguntas; zero erros de análise reportados pelo benchmark não significa que a simulação foi aprovada.

O placar da main teve 13/18 casos fixos aprovados, mas parou na segunda persona com `resposta da featherless sem choices[0].message`, antes do juiz. No PR, foram 15/18 casos fixos aprovados e as três personas chegaram ao juiz; nenhuma avaliação voltou. Houve sete timeouts de 90 s nas tentativas do juiz antes de atingir o limite total de 20 minutos e encerrar a árvore de processos dessa medição. Esses acertos parciais não são o placar final e não autorizam comparação de qualidade.

Na IDE, ambas as versões falharam em ficar em silêncio no pedido de encerramento; o PR também respondeu à leitura do enunciado. O p50 aumentou 1.636 ms e o máximo aumentou 4 ms. Há falhas de provedor/respostas de reserva nos logs; não é possível atribuir essas diferenças à implementação. Os scripts não foram alterados para contornar os casos reprovados.

Os números e metadados das oito execuções estão em [integridade-medicoes-2026-11-16.json](integridade-medicoes-2026-11-16.json). Logs completos ficaram em `.cate/medicoes-123/` no clone principal. O worktree temporário da referência foi removido após verificar que estava limpo e retirar somente a junction de `node_modules`; os worktrees de implementação foram preservados.

## Decisão

Merge bloqueado. Além da piora observada no p95 de conversa, falta um placar completo válido nas duas versões. Branches, worktrees de implementação e issue #123 devem ser preservados. Issues #124 e #125 não foram alteradas.
