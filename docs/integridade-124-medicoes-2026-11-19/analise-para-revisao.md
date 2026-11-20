# Leitura para a revisão da #124

Esta análise atende à [solicitação de revisão](solicitacao-revisao.md). Foi feita depois das medições, sem novas chamadas de LLM. O resultado registrado e o alcance causal do código são tratados separadamente. O critério original continua não atendido.

## Registro dos critérios e mudança do plano

O critério “qualquer piora barra o merge” já constava da issue e do briefing recebidos antes da implementação. O [protocolo](protocolo.md) foi escrito nesta sessão antes de iniciar o executor às 19:30Z de 19/11: A–B / B–A, uma execução por vez, scripts e modelos iguais, todas as tentativas preservadas, transcrição com corpus real, limites nominais de 10/15/20/45 min conforme o instrumento. Não havia margem numérica de tolerância nem regra baseada em significância estatística. Esse critério não foi ajustado depois dos números.

O protocolo foi versionado junto das evidências depois das execuções; não há commit ou hash publicado antes da primeira medição. O registro anterior é o arquivo e a sequência da sessão. Datas de criação dos arquivos atuais não servem como prova de pré-registro, porque o rebase pode recriá-los.

A mudança posterior foi operacional e está no [adendo](retomada.md): depois de confirmar a espera moderna do Windows e receber “pode seguir”, repetir o par interrompido na mesma ordem B–A, com os mesmos parâmetros, acrescentando um monitor que para a sequência ao detectar pausa maior que 30 s. A mudança não relaxa o critério nem apaga a execução B2 que falhou na validação do juiz. Fisher e bootstrap foram pedidos nesta revisão, depois dos resultados; são análises exploratórias, não novos critérios de aprovação.

`validar-conversa-ide.ts` não constava do protocolo original da #124 e não foi executado. Ele foi acrescentado ao pedido de revisão quando já havia a instrução de não chamar mais LLM. Não há números dessa #124 para esse instrumento; os da #146 não foram reaproveitados como se fossem desta branch.

## Números e incerteza das amostras

O [resultado completo](resultado.md) mantém os números de cada execução. O [JSON estatístico](estatistica-exploratoria.json) e seu [código](estatistica-exploratoria.mjs) registram o cálculo reproduzível.

Fisher é unilateral, com hipótese alternativa de taxa de acerto B menor que A, tabela `[[acertos B, erros B], [acertos A, erros A]]`. Bootstrap: 20000 reamostragens com reposição, seed 20261119, intervalo percentil de 2,5% a 97,5%, diferença B menos A em ms. A reamostragem é independente por chamada; não modela dependência entre turnos/personas e não corrige comparações múltiplas. Os casos são fixos e repetidos; a leitura inferencial também tem essa limitação. Nenhum p-valor ou IC libera o critério originalmente registrado.

### Bench-conversa

| Par | Acertos A | Acertos B | Fisher unilateral | Δ p50 (ms) | Δ p95 (ms) |
| --- | --- | --- | --- | --- | --- |
| A1–B2 | 10/14 | 10/14 | 0,6612 | +529 | −488 |
| B3–A4 | 10/14 | 8/14 | 0,3473 | +1150 | +1543 |
| Agrupado, descritivo | 20/28 | 18/28 | 0,3877 | — | — |

**IC bootstrap indisponível neste instrumento.** `bench-conversa.ts` chama `rodarCasos(..., { silencioso: true })` e imprime só percentis, acertos e textos das falhas. Os tempos individuais de cada caso não foram salvos. Tempos das chamadas ao provedor não equivalem ao tempo total do caso, que pode envolver mais de uma geração e guardas. Não reconstruí um vetor fictício a partir de p50/p95 nem rodei nova amostra para preencher essa falta.

### Bench-quadro

| Par | Simulações aprovadas A | Simulações aprovadas B | Fisher unilateral | Δ p50 e IC 95% (ms) | Δ p95 e IC 95% (ms) |
| --- | --- | --- | --- | --- | --- |
| A1–B2 | 1/2 | 1/2 | 0,8333 | −1706 [−2182; −116] | −400 [−3144; +666] |
| B3–A4 | 2/2 | 0/2 | 0,1667 | −215 [−829; +389] | −1167 [−1248; −445] |
| Agrupado, descritivo | 3/4 | 1/4 | 0,2429 | — | — |

Aqui o vetor é recuperável: o benchmark usa `r.durationMs`, que o logger de `openaiCompat.ts` também imprime. As análises desse instrumento têm `in=6071`; os vetores extraídos dessa assinatura foram conferidos contra a quantidade de chamadas e os p50/p95 de **cada uma das quatro execuções**, com igualdade exata. Vetores e verificações estão no código/JSON estatístico.

Na segunda rodada, o vetor B tem dez chamadas concluídas contra doze da base, além de dois erros. O bootstrap descreve apenas as chamadas que concluíram, como o próprio benchmark; o p95 menor não transforma as falhas em ganho.

### Placar do par válido da retomada

O [comparador do projeto](comparacao-retomada.log) aceitou os arquivos completos. Todos os valores de qualidade e violações, com suas diferenças, estão nesse log e nos JSON originais. A nota média é 4,23 nas duas versões, mas as dimensões e violações variam. Casos fixos: 15/18 em cada uma; Fisher unilateral 0,6709.

| Medida | A6 | B5 | Δ B−A e IC bootstrap 95% (ms) |
| --- | --- | --- | --- |
| /perguntar p50 | 2596 | 2528 | −68 [−718; +392] |
| /perguntar p95 | 5591 | 8014 | +2423 [−829; +3251] |
| Análise p50 | 4669 | 4207 | −462 [−1161; +464] |
| Análise p95 | 10051 | 9419 | −632 [−7138; +9389] |

Os intervalos do placar incluem zero. Isso mostra a incerteza sob a reamostragem usada, não demonstra equivalência nem anula as pioras registradas. Falhas por prazo/provedor: zero em A6 e cinco em B5.

## As cinco falhas: localização e limite do diagnóstico

As cinco estão nas conversas de B5; nenhum caso fixo dessa execução foi classificado como falha de provedor. A [extração estruturada](cinco-falhas.json) traz o texto imediatamente anterior do candidato e a coordenada por persona/turno no JSON original.

| Persona | Turno | Fase | Caminho | Tempo (ms) | Evidência persistida |
| --- | --- | --- | --- | --- | --- |
| senior_claro | 13 | ALTO_NIVEL | perguntar | 8020 | `falhou: true`, fala vazia |
| junior_nervoso | 8 | REQUISITOS | perguntar | 8006 | `falhou: true`, fala vazia |
| junior_nervoso | 30 | APROFUNDAMENTO | perguntar | 8014 | `falhou: true`, fala vazia |
| vago_testador | 21 | APROFUNDAMENTO | perguntar | 8008 | `falhou: true`, fala vazia |
| vago_testador | 22 | APROFUNDAMENTO | analise | 15017 | `falhou: true`, `status: ok`, silêncio de reserva |

Os quatro tempos perto de 8 s e o de 15 s são **compatíveis com os limites de prazo** do cliente principal e da análise (`PRAZO_PADRAO_MS=8000`, `PRAZO_ANALISE_DO_DESENHO_MS=15000`). Mas o simulador constrói `deps` com `log: () => {}` e serializa somente `falhou`, não `ErroLlm.codigo` nem `diagnostico.ajustes`. Portanto, o tipo exato — `timeout`, `invalido`, rede etc. — **não pode ser comprovado a partir dos artefatos existentes**. Não há evidência registrada de JSON inválido do Gemma nessas cinco falhas. Também não se pode garantir que não tenha havido erro de formato antes do prazo.

Isso é diferente da falha **comprovada** do juiz Kimi em B2, cujo erro de enum está no log. Para distinguir definitivamente o tipo das cinco falhas seria necessário persistir o diagnóstico em uma medição futura; isso não foi feito agora, respeitando a proibição de novas chamadas.

## Alcance causal do código da #124

O [grafo de imports](grafo-imports.log), gerado com a [ferramenta indicada pela revisão](grafo-imports.mjs), encontra:

| Entrada | Módulos no grafo | Arquivos alterados pela #124 no grafo |
| --- | --- | --- |
| bench-conversa.ts | 49 | lib/contracts.ts |
| bench-quadro.ts | 49 | lib/contracts.ts |
| placar-quadro/index.ts | 54 | lib/contracts.ts |
| medir-rascunho.ts | 144 | lib/contracts.ts |

`lib/contracts.ts` acrescenta campos opcionais nos schemas de evento/gravação e os tipos de sinal. Não modifica o schema de resposta do modelo nem os prompts. Os novos sensores de voz, relógio, cálculo em `lib/integridade/` e UI do relatório **não entram nesses grafos**. O grafo indica alcance de importação, não prova execução de cada função importada.

Nos caminhos medidos, os dados simulados não introduzem `latenciaMs`. Nos caminhos reais das salas:

- IDE: `tomarLatencia` lê a marca, mas `mensagensDe` produz somente `{ role, text }`; o corpo final e o rascunho usam `corpoDoChat`. O campo só é anexado ao evento `speech` posterior à confirmação, que já era enviado.
- Quadro: a conversa usada pelo modelo recebe `{ quem, texto }`; a medida fica em `registrar("fala", ...)`, sem entrar em `montarContextoDaFala` ou em `/perguntar`. A chave do quadro continua usando apenas os campos de contexto já existentes.
- IDE: os eventos históricos fazem parte da chave da sessão. Uma latência já registrada pode compor o histórico da chave, mas o evento da fala atual continua sendo enviado **depois** da confirmação; não é um campo divergente acrescido entre rascunho e confirmação. Não foi criado POST adicional.
- Gravação e bloco de Integridade usam os novos campos para exibir evidências. Eles não são acrescentados a mensagens, sistema, contexto de entrevista ou schema de saída enviado ao LLM.

Assim, a inspeção não oferece um mecanismo em que os novos sensores/sinais da #124 mudem as falas desses quatro instrumentos. Ela não mede o custo dos callbacks no navegador e não substitui a validação com áudio real.

Há variação grande mesmo entre as duas bases completas medidas aqui, que usam a mesma árvore: A1 teve seis falhas e p95 8006 ms; A6 teve zero e p95 5591 ms. A revisão da #146 também informou duas execuções da mesma main com zero/sete falhas e p95 4301/8010 ms; isso é contexto fornecido pela revisão, não nova medição desta tarefa. Esses fatos tornam a atribuição causal incerta, **sem mudar o critério nem transformar o resultado em aprovação**.

## Rascunho usado

| Área | A, rodada 1 | B, rodada 1 | B, rodada 2 | A, rodada 2 | Soma dos pares válidos A / B |
| --- | --- | --- | --- | --- | --- |
| Quadro | 7/7 | 8/8 | 8/8 | 7/8 | 14/15 (93,3%) / 16/16 (100%) |
| IDE | 8/8 | 7/8 | 8/8 | 7/8 | 15/16 (93,75%) / 15/16 (93,75%) |

No quadro, uma fala da primeira base teve erro e não compõe o denominador de pares completos; considerando as 16 falas previstas, a base teve 14 usos em 16 tentativas. A queda da IDE em B1 está preservada, assim como a queda em A2. O script não simula o caminho de captura que acrescenta `latenciaMs`, portanto estas taxas não bastam para provar a coerência do campo em entrevistas reais.

## Rebase e validação local

Após o aviso de liberação da revisão, a branch foi rebaseada na main `0f4efec` sem conflito. A árvore da base medida `c91d3ce` é exatamente a da main (`ff85b662…`). O código `78b30d2` reaplicado como `ff7558c` e a documentação `e5a0bc2` reaplicada como `aa60087` mantiveram suas árvores idênticas. A validade histórica das medições não foi alterada pelo rebase.

[Metadados da verificação](rebase-e-validacao.json): `npm run test:integridade` passou com 72 testes, incluindo os 57 de `lib/integridade/`; `tsc --noEmit --incremental false` passou. Os testes de agentes usam rede simulada. Nenhuma medição ou chamada real de LLM foi acrescentada durante esta revisão.

Continuam pendentes: o IC de bench-conversa por falta de vetor unitário; validar-conversa-ide não executado; corpus de transcrição; conferência de latência com áudio real; tipo tipado das cinco falhas não preservado pelo simulador. Não há aprovação de merge ou autorização de push, PR ou tag.
