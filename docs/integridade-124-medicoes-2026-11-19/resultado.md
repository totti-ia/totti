# Medições antes/depois da #124

**Critério de ausência de piora não atendido; a #124 não está pronta para merge.** Foram registradas 20 execuções: 18 previstas inicialmente e duas adicionais após suspensão documentada do Windows. Há pioras observadas em conversa, quadro e no par válido de placares da retomada. A transcrição continua sem corpus de áudio e a conferência de `latenciaMs` com gravações reais permanece pendente.

Todas as tentativas, inclusive erros e interrupções, estão no [índice com logs completos](indice.md), no [manifesto original](execucoes.json), no [manifesto da retomada](retomada.json) e no [resumo estruturado](resumo.json). Nenhum resultado anterior foi substituído.

A [análise para revisão](analise-para-revisao.md) separa alcance causal do código, diagnóstico das cinco falhas, Fisher unilateral e bootstrap exploratório, com suas limitações e lacunas. Não foram feitas novas chamadas de LLM para essa análise.

## Referência e método

O protocolo foi escrito antes das execuções em [protocolo.md](protocolo.md). A é a base `c91d3ce` (`123-integridade`, PR #146); B é a implementação `78b30d2`. A main não foi usada nem houve rebase, porque o #146 ainda aguardava decisão.

Duas rodadas em ordem A–B / B–A para cada instrumento de texto. Uma execução por vez, mesmos scripts e dependências, mesmo ambiente local e armazenamento em memória. Os [hashes registrados](ambiente.json) confirmam scripts e lockfile idênticos entre as versões. Benchmarks escolhem explicitamente o modelo Featherless `google/gemma-4-26B-A4B-it`. As medições de LLM mantêm a OpenRouter paga desligada pelo comportamento padrão do script; não medem esse fallback de produção. O cabeçalho do placar conserva os nomes de modelos configurados (Gemini), enquanto as chamadas efetivas do Totti aparecem nos logs como Gemma na Featherless; juiz e candidato usam os modelos padrão do placar. Horários dos manifestos e arquivos são UTC.

A rodada inversa de placares atravessou espera moderna do Windows e ficou inválida para desempenho. Após o Nícolas autorizar continuar, o par foi repetido em B–A, conforme o [adendo da retomada](retomada.md), sem alterar scripts ou modelos. Os originais continuam preservados. Na retomada, um monitor encerra a sequência se detectar pausa maior que 30 s; nenhuma interrupção foi registrada nas duas novas execuções.

## Conversa

| Ordem | Versão | Acertos | p50 (ms) | p95 (ms) |
| --- | --- | --- | --- | --- |
| 1 | A | 10/14 | 3010 | 8269 |
| 2 | B | 10/14 | 3539 | 7781 |
| 3 | B | 8/14 | 4116 | 8011 |
| 4 | A | 10/14 | 2966 | 6468 |

A #124 teve p50 maior nos dois pares, com piora de acertos e p95 na rodada inversa. A amostra não estabelece causalidade; o requisito de ausência de piora não pode ser afirmado.

## Análise do quadro

| Ordem | Versão | Simulações aprovadas | Erros | Chamadas de análise concluídas | p50 (ms) | p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A | 1/2 | 0 | 12 | 4087 | 5628 |
| 2 | B | 1/2 | 0 | 12 | 2381 | 5228 |
| 3 | B | 0/2 | 2 | 10 | 2868 | 2987 |
| 4 | A | 2/2 | 0 | 12 | 3083 | 4154 |

As latências menores da execução B com erros não são evidência de melhora: faltam chamadas concluídas e a qualidade caiu. Os motivos de reprovação estão nos logs completos.

## Rascunho

Antecedência de 2600 ms, oito falas por área em cada execução. `n` é a quantidade de pares normal/antecipado concluídos, não o número de falas previstas.

| Execução | Área | n | Normal p50/p95 (ms) | Antecipado p50/p95 (ms) | Reaproveitamento mostrado pelo script | Falas com erro |
| --- | --- | --- | --- | --- | --- | --- |
| 1 A | Quadro | 7 | 2842 / 3772 | 4 / 726 | 100% | 1 |
| 1 A | IDE | 8 | 2472 / 4517 | 159 / 1240 | 100% | 0 |
| 2 B | Quadro | 8 | 2080 / 2671 | 3 / 290 | 100% | 0 |
| 2 B | IDE | 8 | 2170 / 3453 | 1 / 6016 | 88% | 0 |
| 3 B | Quadro | 8 | 1916 / 2421 | 3 / 10 | 100% | 0 |
| 3 B | IDE | 8 | 2442 / 3648 | 5 / 200 | 100% | 0 |
| 4 A | Quadro | 8 | 2215 / 2797 | 3 / 5341 | 88% | 0 |
| 4 A | IDE | 8 | 2325 / 3466 | 1 / 7269 | 88% | 0 |

Na IDE, a soma dos pares válidos é 15/16 rascunhos usados nas duas versões. No quadro, são 14/15 pares válidos usados na base e 16/16 na implementação; uma fala da base não teve par completo. Há quedas e aumentos nos tempos de cada execução: o agregado não apaga essas diferenças. Na fala 8 da IDE em B2, o log registra duas chamadas abortadas ao LLM e confirmação com rascunho novo (6016 ms).

O script de rascunho exercita os caminhos do servidor; não simula a captura de voz no navegador nem acrescenta `latenciaMs` aos eventos de uma entrevista real. A comparação não basta para validar o campo na gravação.

## Transcrição e gravação

Uma tentativa por versão, B antes de A. Ambas saíram com código 1 e “Nenhuma frase com .txt de referência na pasta.” Só existe o roteiro em `fixtures/transcricao`: nenhuma transcrição foi enviada ao serviço e não há WER comparável. `--pago` foi passado porque o script exige o sinalizador; não chegou à chamada de token ou transcrição.

A coerência de `latenciaMs` com áudio real das duas salas também continua pendente. Os testes determinísticos do portão, do player e da persistência já passaram, mas não substituem essa conferência.

## Placar

| Execução | Versão | Estado | Total (s) | Casos fixos | Nota média | /perguntar p50/p95 (ms) | Análise p50/p95 (ms) | Falhas por prazo/provedor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A | Completo | 2036 | 15/18 | 4,27 | 2642 / 8006 | 5345 / 15010 | 6 |
| 2 | B | Incompleto: seis casos sem nota | 2254 | 14/18 | 4,25 **parcial** | 2736 / 6068 | 3746 / 12870 | 2 |
| 3 | B | Limite excedido; espera moderna | 3270 | Sem placar final | — | Inválido | Inválido | — |
| 4 | A | Limite excedido; espera moderna | 3929 | Sem placar final | — | Inválido | Inválido | — |
| 5, retomada | B | Completo, sem interrupção | 1904 | 15/18 | 4,23 | 2528 / 8014 | 4207 / 9419 | 5 |
| 6, retomada | A | Completo, sem interrupção | 1892 | 15/18 | 4,23 | 2596 / 5591 | 4669 / 10051 | 0 |

Na execução B2, o lote dos casos 13–18 ficou sem nota: o juiz retornou `interrompeu_quem_pensa`, fora do enum permitido (`interrompeu_quem_pensava`). A tentativa de reparo do próprio cliente não resolveu. As três conversas receberam avaliação, mas o processo terminou com código 1 e a média abrange só 45 falas. A [comparação inicial foi recusada pelo próprio script](comparacao-inicial.log); não comparar essa média parcial com as 51 falas julgadas da primeira base. O validador e a rubrica não foram alterados.

### Interrupção do ambiente

Os [eventos Kernel-Power](interrupcoes-do-sistema.json) registram entrada em espera moderna por fechamento da tampa às 21:12:49Z, transição intermediária às 21:49:04Z e saída às 22:54:33Z. As execuções 3 e 4 atravessaram esses intervalos. Timers não encerraram os processos no instante nominal durante a suspensão; por isso o tempo de parede excedeu os 45 min configurados. A execução B3 preservou o progresso até o juiz; a A4 não passou do primeiro caso, com uma espera de 3925197 ms e falha de rede. Não usar esses tempos como latência do agente ou regressão da implementação.

### Par válido da retomada

A [comparação da retomada](comparacao-retomada.log) terminou com código 0: os arquivos são completos e comparáveis estruturalmente. Isso não é aprovação do critério de desempenho. Base A6 contra implementação B5:

- Casos fixos: 15/18 em ambas; média geral: 4,23 em ambas.
- /perguntar: p50 de 2596 para 2528 ms; **p95 de 5591 para 8014 ms** (aumento de 2423 ms).
- Análise: p50 de 4669 para 4207 ms; p95 de 10051 para 9419 ms.
- **Falhas por prazo/provedor: de 0 para 5.**
- Escuta: de 4,20 para 4,13; concisão: de 4,73 para 4,72. Pertinência e naturalidade subiram levemente.
- Violações: menos ocorrências de ignorar fala, vazar critério e repetir pergunta; mais ocorrências de soar robótico (4 para 5), validar a resposta (0 para 3) e insistir após “não sei” (0 para 1).

O script mostra melhora em algumas medidas e piora em outras. A regra da issue exige ausência de piora: não foi satisfeita. LLM, rede e trajetórias das entrevistas variam; estas amostras não estabelecem que a #124 causou as diferenças. O código medido permaneceu em `78b30d2`, sem mudanças nos prompts ou nos instrumentos para obter aprovação.

## Validação e entrega local

- Implementação: 57 testes de `lib/integridade/` e TypeScript aprovados antes das medições. Após o rebase, o script completo `test:integridade` passou com 72 testes e o TypeScript passou novamente. Nenhuma alteração posterior no conteúdo do produto.
- Logs completos, JSON, Markdown, progresso interrompido, executores, metadados e comparações preservados no índice. Os hashes em `sha256.json` conferem os bytes; a pasta desativa conversão de fim de linha para conservar as saídas.
- Comparações por `--comparar` só leem os placares e não fazem novas chamadas de LLM. A comparação inicial recusada também foi preservada.
- Os quatro artefatos finais gerados na referência foram conferidos por hash contra as cópias desta pasta (`backup-do-worktree.json`). Depois de verificar que a referência estava limpa, foram removidos somente sua junction de dependências e o worktree temporário. O worktree da implementação foi preservado.
- O corpus de transcrição e as gravações reais das duas salas continuam necessários. Nenhum caminho adicional de áudio foi informado.
- O PR #146 entrou na main com a mesma árvore da base medida. Após o aviso de liberação, foi feito rebase sem conflito e sem mudança de árvore do produto. Branch local preservada, sem push, PR, tag ou alteração de issue remota; o critério não atendido continua impedindo declarar a #124 pronta.
