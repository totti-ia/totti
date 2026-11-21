# Protocolo antes/depois — #124, conversa da IDE

Definido em 21/11/2026, antes de qualquer execução de `validar-conversa-ide` para a #124. Este arquivo será commitado antes da liberação da máquina e antes da primeira chamada. A execução depende do aviso de liberação do responsável pela regressão no navegador. Nenhuma execução deste protocolo foi feita ao escrevê-lo.

- Base A: `0f4efec3d6546569f8e68942fd72052b64271bc5`.
- Implementação B: `ff7558c865a35f646c80b089d6ff2e448438e342`.
- Worktrees separados e destacados nesses commits. A branch de trabalho contém documentação e testes posteriores; a medição continua usando os dois commits acima, sem incorporar ajustes novos silenciosamente.
- Mesmos scripts, dependências, configuração da vaga, problema e ambiente nas duas versões; registrar SHA-256 dos scripts e lockfile, versões de Node/npm, commit/tree e configurações não secretas antes de começar. Usar a mesma `.env.local` do clone, sem publicar chaves nem seus hashes.
- `ARMAZENAMENTO=memoria`, `CONVERSA_FEATHERLESS_MODEL=google/gemma-4-26B-A4B-it`, `FEATHERLESS_CONCURRENCY=2`, `PAGO=0`, `AGENTE_FAKE=0`. Remover `SO_CASOS` e `DEBUG_FILA` do ambiente. Sem `--offline`, `--pago` ou OpenRouter; a trava `_gasto.ts` remove a chave da OpenRouter. Manter os outros modelos e parâmetros iguais e registrá-los. Prompts, schemas de saída e critérios do script não mudam.
- Comando em cada worktree: `node --import tsx --env-file-if-exists=.env.local scripts/validar-conversa-ide.ts`. As variáveis explícitas acima devem ser aplicadas depois de carregar o ambiente ou já estar definidas no processo pai, prevalecendo sobre o arquivo.
- Três rodadas completas, em sequência: **A1–B1 / B2–A2 / A3–B3**. São seis processos, um de cada vez. Sem dev, e2e ou outro uso da conta/máquina durante a medição. Não excluir aquecimento, casos, rodadas, falhas ou respostas inconvenientes.
- Cada processo roda os **13 casos** originais, uma vez. Total previsto: 39 casos por versão. A abertura do balão é feita pelo script antes do cronômetro desse caso; publicar seu custo no log se disponível, mas não somá-lo artificialmente ao `ms` do turno.
- Limite externo por execução: **10 minutos**. Preservar código de saída, stdout, stderr, horários UTC, duração de parede e todos os JSONs por caso, inclusive os de execuções incompletas. Não desligar timers internos nem alterar limites do produto.
- Monitorar lacunas de relógio maiores que 30 s, além de suspensão/retomada do Windows. Uma suspensão invalida latências daquele processo; os resultados originais continuam publicados. Parar a sequência e registrar a causa. Não substituir nem repetir um par sem registrar uma emenda ao protocolo antes da repetição.

## Acertos e falhas

Um caso conta como acerto somente se passar **todas** as verificações originais do script: responder ou ouvir, despedida, restrições de conteúdo, comentário, grifo e devolução da vez quando aplicáveis. Um caso com várias violações conta como uma falha, preservando todos os motivos.

O script imprime o JSON de cada caso antes de validar e termina com uma asserção que concatena os motivos, prefixados pelo nome do caso. Guardar os dois canais completos e reconstruir o vetor de acertos pelos nomes exatos dos 13 casos e pelos motivos dessa asserção. Conferir manualmente o mapeamento publicado. Saída 0 exige 13 JSONs e zero motivos; saída 1 só permite estatística completa quando os 13 JSONs e a asserção final forem recuperáveis. Exceção anterior, timeout ou mapeamento ambíguo tornam a execução incompleta; não transformar ausência de diagnóstico em acerto.

Publicar acertos/total por execução, por par e agregados. Calcular **Fisher exato unilateral**, hipótese alternativa `taxa de acertos B < A`, para cada par e para os 39 casos agregados por versão. Relatar os valores de p sem correção por comparações múltiplas, deixando essa limitação explícita. Os mesmos casos repetidos não são observações independentes; Fisher será um resumo exploratório, não prova causal ou teste de equivalência.

## Latência e incerteza

Usar os **13 valores `ms` de cada execução**, correspondentes ao turno completo medido pelo script. Não substituir por tempos do provedor, tempo total do processo nem pela linha resumida `p50/máx`. Incluir casos que falharam nas verificações, quando tenham `ms`; publicar também o máximo e a quantidade de falhas. Execuções incompletas não entram em comparações completas.

Publicar p50 e p95 por execução e agregados; percentil do vetor ordenado `v`: `v[min(n-1, floor(n*p))]`, com p=0,50 ou 0,95. Para cada métrica publicar delta **B−A** e **IC 95% por bootstrap**, 20.000 reamostragens, PRNG Mulberry32 com seed `20261121`, intervalo percentil 2,5–97,5% (mesma definição de percentil). Reiniciar a seed para cada par e para o agregado; em cada réplica usar os mesmos índices sorteados para calcular p50 e p95.

Por par, reamostrar os 13 **pares de casos pelo nome**, com reposição, mantendo A/B juntos. No agregado, reamostrar os 13 nomes de caso como grupos: cada nome leva consigo seus três pares de rodadas, preservando A/B e as repetições; calcular os percentis sobre os 39 valores resultantes de cada versão. Publicar o algoritmo/PRNG, vetores, seed e limites efetivos. Esse IC descreve a variação desses casos/rodadas; não estima toda a variabilidade temporal do provedor nem elimina a dependência entre chamadas. Não usá-lo para afirmar equivalência.

## Critério de piora, fixado antes dos números

O critério continua **nenhuma piora observada**. Qualquer redução de acertos, aumento de p50 ou aumento de p95 de B contra A, em um dos três pares ou no agregado, impede declarar ausência de piora neste instrumento. Falha nova de infraestrutura, execução incompleta, dados ambíguos ou ausência de uma comparação necessária também impedem a conclusão. Não há margem de tolerância nem descarte da pior rodada. Melhoras em outra métrica não compensam uma piora.

Fisher e os ICs qualificam a incerteza; `p >= 0,05` ou IC que inclui zero **não** convertem piora observada em aprovação. Esta etapa não apaga os resultados nem relaxa o critério dos quatro instrumentos anteriores. Mesmo um resultado sem piora aqui não basta para liberar o merge: a decisão é do Nícolas e o risco do navegador deve ser avaliado separadamente.

## Alcance do instrumento e publicação

O [grafo de imports](grafo.md) foi inspecionado sem executar o validador: **79 módulos; somente `lib/contracts.ts` foi alterado pela #124 nesse grafo**. Seus campos são opcionais; o validador não gera `latenciaMs`. Os sensores de áudio/microfone, callbacks do navegador e renderização do relatório não entram neste instrumento. O grafo descreve alcance de importação, não prova que toda função importada é executada. Variações medidas devem ser separadas de atribuição causal à implementação.

Preservar todos os resultados, vetores, análises e logs nesta pasta, com índice e SHA-256. “Publicar” significa versionar localmente para revisão; sem push, PR, tag ou comentário remoto. Não executar novas chamadas de LLM antes do aviso de liberação. Entrevista com voz real permanece pendente por falta de crédito da ElevenLabs; o e2e falso complementa a validação, com limites descritos em [e2e.md](e2e.md).
