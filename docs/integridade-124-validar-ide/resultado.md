# Resultado — conversa da IDE, #124

**sem piora detectada com este tamanho de amostra.** As seis execuções previstas terminaram e contêm os 13 casos, sem substituição ou repetição. Não é uma declaração de equivalência nem autorização de merge.

Critério ajustado e commitado em [protocolo.md](protocolo.md), commit `fe05360`, **antes da primeira chamada**. Execuções de 2026-11-21T18:22:56.750Z a 2026-11-21T18:27:43.588Z. A ordem foi A1–B1 / B2–A2 / A3–B3, um processo de cada vez. A = `0f4efec`, B = `ff7558c`, em worktrees destacados separados. O manifesto registra commit/tree, hashes dos scripts/dependências, Node/npm, parâmetros não secretos e hashes dos logs. Nenhum dev, e2e ou outro benchmark foi executado em paralelo por este executor.

## Todas as execuções

| Ordem / log combinado | Acertos | p50 (ms) | p95 (ms) | Máximo (ms) | Filtro indisponível | Falhas LLM entrevistador | Saída |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [1-A1](1-A1.log) | 12/13 | 3902 | 7004 | 7004 | 5 | 0 | 1 |
| [2-B1](2-B1.log) | 12/13 | 2711 | 6161 | 6161 | 4 | 0 | 1 |
| [3-B2](3-B2.log) | 11/13 | 3959 | 7012 | 7012 | 5 | 2 | 1 |
| [4-A2](4-A2.log) | 12/13 | 2582 | 6626 | 6626 | 5 | 0 | 1 |
| [5-A3](5-A3.log) | 12/13 | 2467 | 7016 | 7016 | 5 | 0 | 1 |
| [6-B3](6-B3.log) | 12/13 | 3883 | 7021 | 7021 | 3 | 3 | 1 |

[Manifesto](execucoes.json) · [Vetores, motivos e estatísticas](resumo.json) · [Eventos de energia](eventos-de-energia.json) · [Hashes de todos os artefatos](sha256.json).

## Critério agregado, definido antes

Base: **36/39**; #124: **35/39**. Fisher unilateral (H1: B < A): **p = 0.500000**. Critério p < 0,05 não acionado.

| Latência agregada | Base (ms) | #124 (ms) | Delta B−A e IC 95% (ms) | IC inteiro acima de zero? |
| --- | --- | --- | --- | --- |
| p50 | 2779 | 3214 | 435 [-327, 1377] | não |
| p95 | 7004 | 7012 | 8 [-867, 534] | não |

As diferenças observadas são as da tabela; a conclusão usa somente os limiares do agregado. Ausência de detecção com esta amostra não demonstra equivalência ou ausência de efeito. Não reclassifica os quatro instrumentos anteriores sob o novo critério.

## Pares, somente descrição

| Par | Acertos A / B | Fisher unilateral | p50: delta e IC 95% (ms) | p95: delta e IC 95% (ms) |
| --- | --- | --- | --- | --- |
| 1 | 12/13 / 12/13 | 0.760000 | -1191 [-1867, 283] | -843 [-867, -409] |
| 2 | 12/13 / 11/13 | 0.500000 | 1377 [-327, 2314] | 386 [-453, 534] |
| 3 | 12/13 / 12/13 | 0.760000 | 1416 [-479, 2044] | 5 [-2501, 717] |

## Falhas e alcance

- 1-A1: pede para encerrar: devia ficar quieto.
- 2-B1: pede para encerrar: devia ficar quieto.
- 3-B2: lendo o enunciado: devia ficar quieto; pede para encerrar: devia encerrar; pede para encerrar: devia ficar quieto.
- 4-A2: pede para encerrar: devia ficar quieto.
- 5-A3: pede para encerrar: devia ficar quieto.
- 6-B3: pede para encerrar: devia encerrar; pede para encerrar: devia ficar quieto.

O código de saída 1 é a asserção final do validador, não uma execução interrompida: foram preservados os JSONs dos casos, resumo e todos os motivos. “Completa” significa que o processo produziu todos os casos e verificações; não significa que todas as chamadas de modelo funcionaram. Os avisos de filtro indisponível e falhas do entrevistador estão contados acima. Os logs do filtro registram chamadas abortadas/timeouts e passagem sem filtro, caminho de fallback existente nas duas versões. Essas falhas não foram apagadas nem convertidas em aprovação operacional dos componentes.

Há uma falha comum na expectativa de silêncio para “pede para encerrar”: A1, A2, A3 e B1 devolvem uma despedida preenchida (`despedida: true`, `silent: false`), que o script conta como resposta indevida. Em B2, “lendo o enunciado” e “pede para encerrar” devolvem a resposta de contingência “Desculpa, me perdi aqui. Pode repetir?”; no encerramento, também falta `despedida`. B3 devolve essa contingência ao pedir encerramento. Os stderr de B2/B3 registram falhas de LLM por chamada abortada; não há atribuição a JSON inválido nem aos sensores da #124. Todos os motivos permanecem na contagem original: várias violações no mesmo caso contam como uma falha. Não foi corrigido teste ou fallback durante a medição.

O monitor não encontrou lacunas de relógio acima de 30 s, e a consulta de eventos de suspensão/retomada no intervalo retornou zero registros. Não houve repetição ou exclusão de execução. Como cada execução tem 13 tempos, seu p95 coincide com o máximo pela definição prévia; no agregado são 39 tempos por versão.

O [grafo estático](grafo.md) tem **79 módulos e somente `lib/contracts.ts` alterado pela #124**. Campos opcionais do contrato não são introduzidos nas falas simuladas. Os novos callbacks de voz/microfone, cálculo dos sinais e UI do relatório não entram no instrumento. O resultado observado não permite atribuir causalmente oscilações aos sensores do navegador.

Fisher é unilateral; os ICs vêm de 20.000 reamostragens pareadas por nome de caso, Mulberry32 seed 20261121. No agregado, cada grupo leva as três rodadas de A/B. São somente 13 casos fixos repetidos: dependência entre casos/chamadas, pouca variação temporal e múltiplos desfechos limitam a inferência; não há controle global de erro de 5% nem teste de equivalência. O código da análise e os vetores estão publicados.

## Pendências

O e2e novo de tempo de resposta **não foi executado**, por orientação da revisão: a suíte de voz na main para na abertura. Aguarda correção separada dos testes, integração e rebase antes de executar/comparar POSTs por rota. O [roteiro do e2e](e2e.md) permanece uma descrição do teste escrito, não resultado. A entrevista real com voz nas duas salas segue pendente por falta de crédito ElevenLabs. Esta medição não valida esses caminhos.

Sem push, PR, tag ou nova chamada de avaliação além das seis execuções autorizadas. Os resultados e o commit são locais para revisão.
