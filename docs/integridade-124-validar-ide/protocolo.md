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

Publicar acertos/total por execução, por par e agregados. Calcular **Fisher exato unilateral**, hipótese alternativa `taxa de acertos B < A`, para cada par e para os 39 casos agregados por versão. Relatar os valores de p sem correção por comparações múltiplas, deixando essa limitação explícita. Os mesmos casos repetidos não são observações independentes; essa limitação afeta a interpretação do teste. Somente o agregado participa do critério abaixo; os pares são descritivos. Não tratar o resultado como prova causal ou teste de equivalência.

## Latência e incerteza

Usar os **13 valores `ms` de cada execução**, correspondentes ao turno completo medido pelo script. Não substituir por tempos do provedor, tempo total do processo nem pela linha resumida `p50/máx`. Incluir casos que falharam nas verificações, quando tenham `ms`; publicar também o máximo e a quantidade de falhas. Execuções incompletas não entram em comparações completas.

Publicar p50 e p95 por execução e agregados; percentil do vetor ordenado `v`: `v[min(n-1, floor(n*p))]`, com p=0,50 ou 0,95. Para cada métrica publicar delta **B−A** e **IC 95% por bootstrap**, 20.000 reamostragens, PRNG Mulberry32 com seed `20261121`, intervalo percentil 2,5–97,5% (mesma definição de percentil). Reiniciar a seed para cada par e para o agregado; em cada réplica usar os mesmos índices sorteados para calcular p50 e p95.

Por par, reamostrar os 13 **pares de casos pelo nome**, com reposição, mantendo A/B juntos. No agregado, reamostrar os 13 nomes de caso como grupos: cada nome leva consigo seus três pares de rodadas, preservando A/B e as repetições; calcular os percentis sobre os 39 valores resultantes de cada versão. Publicar o algoritmo/PRNG, vetores, seed e limites efetivos. Esse IC descreve a variação desses casos/rodadas; não estima toda a variabilidade temporal do provedor nem elimina a dependência entre chamadas. Não usá-lo para afirmar equivalência.

## Critério de piora, ajustado antes da primeira execução

A versão inicial deste protocolo, no commit `a724d26`, barrava qualquer redução observada de acertos ou aumento de p50/p95, em qualquer par ou no agregado, sem considerar a incerteza. **Em 21/11/2026, antes de qualquer execução deste validador**, o critério foi substituído a pedido da revisão, conforme briefing local `124-ajuste-protocolo.md`, e este ajuste é commitado antes da primeira chamada. O motivo é separar oscilação amostral de uma piora detectada pelo procedimento escolhido: as próprias bases idênticas do placar anterior variaram de 6 para 0 falhas e de p95 8006 para 5591 ms, e testar três métricas em três pares aumenta as oportunidades de variação. O protocolo anterior permanece recuperável no histórico; nenhum resultado do validador foi visto para escolher este ajuste.

O critério definitivo deste instrumento usa **somente as amostras agregadas das três rodadas**:

- **Acertos:** piora detectada se o Fisher unilateral em `B < A` der **p < 0,05**.
- **Latência:** piora detectada se o IC 95% por bootstrap da diferença **B−A** ficar **inteiro acima de zero**, no p50 ou no p95. Usar o bootstrap agregado por grupos de casos já definido acima, sem mudar reamostragem, seed ou percentis depois dos números.
- **Completude:** publicar toda execução incompleta ou com erro de infraestrutura. Se faltar uma das três rodadas completas de uma versão, houver vetor ambíguo ou dados insuficientes, a comparação é incompleta e não há conclusão. Não excluir silenciosamente casos/rodadas nem substituir um resultado ruim.
- **Por par:** publicar números, deltas, Fisher e ICs como descrição; eles **não** são critérios de piora.
- **Redação:** se nenhum dos critérios de piora for acionado e os dados estiverem completos, escrever **“sem piora detectada com este tamanho de amostra”**. Não declarar equivalência, ausência de efeito ou aprovação automática.

Os níveis nominais são os acima, sem ajuste por múltiplos desfechos; não se afirma taxa de erro global de 5%. Dependência entre casos/repetições e somente três rodadas limitam a inferência. Esta etapa não apaga nem reclassifica os resultados dos quatro instrumentos anteriores segundo seus critérios originais. Mesmo sem piora detectada aqui, a decisão de merge é do Nícolas e o risco do navegador deve ser avaliado separadamente.

## Alcance do instrumento e publicação

O [grafo de imports](grafo.md) foi inspecionado sem executar o validador: **79 módulos; somente `lib/contracts.ts` foi alterado pela #124 nesse grafo**. Seus campos são opcionais; o validador não gera `latenciaMs`. Os sensores de áudio/microfone, callbacks do navegador e renderização do relatório não entram neste instrumento. O grafo descreve alcance de importação, não prova que toda função importada é executada. Variações medidas devem ser separadas de atribuição causal à implementação.

Preservar todos os resultados, vetores, análises e logs nesta pasta, com índice e SHA-256. “Publicar” significa versionar localmente para revisão; sem push, PR, tag ou comentário remoto. Não executar novas chamadas de LLM antes do aviso de liberação. Entrevista com voz real permanece pendente por falta de crédito da ElevenLabs; o e2e falso complementa a validação, com limites descritos em [e2e.md](e2e.md).
