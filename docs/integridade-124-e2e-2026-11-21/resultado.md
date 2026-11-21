# E2E da conversa — #124

**Spec novo: 6/6 na #124 e 6/6 na base; contagens de POSTs iguais por rota nos seis cenários.** A suíte de voz existente teve 3 acertos e 6 falhas; correspondência com a referência: mesmos testes e mesmas asserções.

O commit `5343db3`, criado sobre a main na branch de correção dos testes, foi trazido para a branch como `1147fa3`, sem conflito. Atualiza apenas as âncoras da abertura: “pensa em voz alta” na IDE e `[data-janela-chamada][data-fase="REQUISITOS"]` no quadro. O spec novo usa essas âncoras. O commit local `fd9e3b6` registra essa atualização no spec e a correção da comparação do relatório. Nenhum código de produto ou prompt foi alterado nesta etapa.

Base medida: **5343db307cc6c69455ef380b1445f10fff1cd002**, commit `5343db3` diretamente sobre `0f4efec`, checkout destacado separado, com cópia apenas do spec novo, sua config e os dois helpers. Implementação: **fd9e3b61fd00a057298a62a748a694c628ea31be**. Os quatro arquivos copiados têm SHA-256 idênticos entre as execuções; as configurações usam o mesmo servidor falso, microfone silencioso e um worker. A base roda com `TEMPO_RESPOSTA_BASE=1`.

## Todas as execuções

| Execução | Suíte / versão | Passaram | Falharam | Saída |
| --- | --- | --- | --- | --- |
| [01-tempo-124](01-tempo-124/execucao.log) | tempo / 124 | 5 | 1 | 1 |
| [02-tempo-124](02-tempo-124/execucao.log) | tempo / 124 | 6 | 0 | 0 |
| [03-tempo-base](03-tempo-base/execucao.log) | tempo / base | 6 | 0 | 0 |
| [04-voz-124](04-voz-124/execucao.log) | voz / 124 | 3 | 6 | 1 |

A primeira tentativa foi preservada: 5/6 passaram. O cenário natural do quadro já havia conferido latência e gravação e falhou ao comparar o cabeçalho do relatório: o teste capturava `innerText`, mas a asserção usava `textContent`, cujo espaçamento é diferente. A correção adiciona `useInnerText: true`, mantendo o conteúdo esperado. O spec completo foi repetido na #124 e, depois, copiado sem diferenças para a base. Não houve alteração de produto para obter aprovação.

## Captura e POSTs

| Cenário | #124 / base | `latenciaMs` na resposta da #124 | Campo na base? | POSTs iguais? |
| --- | --- | --- | --- | --- |
| ide: fim natural mede a primeira fala sem criar um envio de medida | passed / passed | 1573 ms | não | sim |
| ide: corte manual não envia latência | passed / passed | ausente | não | sim |
| ide: voz sobreposta dispara o detector e não envia latência | passed / passed | ausente | não | sim |
| quadro: fim natural mede a primeira fala sem criar um envio de medida | passed / passed | 1578 ms | não | sim |
| quadro: corte manual não envia latência | passed / passed | ausente | não | sim |
| quadro: voz sobreposta dispara o detector e não envia latência | passed / passed | ausente | não | sim |

Fim natural: o áudio falso é terminado pelo teste, a escuta reativa e aguarda-se mais 1.500 ms antes da fala falsa. Compara-se a medida às marcas do relógio no navegador, com tolerância de 700 ms. O corte manual usa Escape. A sobreposição usa Scribe/WebSocket local e PCM injetado no callback do processador, atravessando o detector real e os callbacks das duas salas. Confere-se também `speech_interrupted.by` na IDE.

Na IDE, a resposta foi conferida no evento `speech` enviado. No quadro, no lote `fala` e no adaptador real que monta a gravação. O campo não aparece no corpo de `/api/chat` ou `/perguntar`, incluindo rascunhos, nos cenários capturados.

| Sala (cada um dos três cenários) | Rota POST | Base | #124 |
| --- | --- | --- | --- |
| ide | `/api/chat` | 4 | 4 |
| ide | `/api/events` | 5 | 5 |
| ide | `/api/falar` | 7 | 7 |
| quadro | `/api/falar` | 3 | 3 |
| quadro | `/api/sessoes` | 1 | 1 |
| quadro | `/api/sessoes/:id/eventos` | 3 | 3 |
| quadro | `/api/sessoes/:id/perguntar` | 4 | 4 |

Os totais acima valem individualmente para fim natural, corte e sobreposição: os anexos dos seis cenários foram comparados, não apenas uma amostra. **Total nas seis janelas: 81 POSTs na base e 81 na #124.** A janela começa na navegação e termina 1.200 ms após a fala confirmada aparecer no evento; a renderização estática do relatório fica depois dessa janela. A contagem inclui criação, pré-síntese, rascunhos e lotes de eventos que ocorreram nela. IDs de sessão do quadro são normalizados no nome da rota. Não se afirma contagem de toda a vida da página, incluindo desmontagem/telemetria final. Os JSONs preservam corpos e eventos completos.

Na primeira tentativa, o corte manual do quadro teve quatro lotes de eventos em vez de três. Conferi os corpos: são os mesmos oito eventos, na mesma ordem (`fase`, `fala`, `fala`, `fase`, `fala`, `fala`, `fala`, `fala`); na primeira tentativa a segunda `fase` foi enviada sozinha, e na execução 02 veio no primeiro lote. A linha do tempo envia o que está pendente a cada cinco segundos. Esse resultado permanece publicado. A comparação solicitada usa o mesmo spec corrigido nas duas versões (execuções 02 e 03), que teve três lotes em cada cenário e igualdade em todas as rotas, sem nova mudança ou repetição após olhar a contagem da base.

## Relatório

O cenário natural do quadro usa os eventos capturados para montar Integridade e renderiza o componente de relatório de produção com/sem `latenciaMs`. A tabela de perguntas técnicas mostra a mediana coletada; nota geral **3,3/4**, critérios e recomendação permanecem iguais. Também se compara o cabeçalho renderizado. É uma conferência estática complementar no navegador, sem avaliador LLM: não cobre leitura de um relatório salvo nem hidratação da rota.

## Suíte de voz após a extração

Referência: [log de `5343db3`](referencia-voz-5343db3.log), fornecido pelo revisor. Nova execução: [log](04-voz-124/execucao.log) e [JSON](04-voz-124/playwright.json). A comparação é por nome de teste e asserção, pois os números de linha mudaram ao extrair o helper.

| Teste | Estado |
| --- | --- |
| recrutadora dita a vaga e conversa com Totti sem repetir voz no polling | passed |
| IDE: conversa só por voz, sem barra lateral; a pergunta sai na pausa e o grifo some quando o assunto fecha | failed |
| IDE: fala livre com pedido de feedback é respondida por voz e o grifo sai depois | passed |
| IDE: no meio do código o Totti pede licença; 'espera um pouquinho' adia a pergunta | failed |
| IDE: Finalizar abre a última conversa por voz, e o Totti se despede antes de encerrar | failed |
| quadro encaminha transcrição para a conversa da sessão | failed |
| quadro pergunta na pausa, responde no loop rápido e aguarda a continuação da fala | failed |
| mão compõe gestos e traços livres, pode só falar e preserva o desenho do candidato | failed |
| abrir o microfone enquanto o Totti prepara a voz cancela a fala, que não toca depois do ditado | passed |

As falhas conhecidas são a pergunta não falada na IDE, pedido de licença, texto de despedida da IDE, heading de encerramento do quadro, instrução antiga antes do início no quadro e quantidade de gestos. Elas já constam na referência da main corrigida. O helper extraído mantém os métodos e rotas originais; esta etapa não tenta reparar comportamentos/expectativas fora do escopo da #124.

## Evidência e limites

[Comparação estruturada](comparacao.json) · [Índice](indice.md) · [Executor](executar.mjs) · [Comparador](comparar.mjs) · [Hashes](sha256.json). Cada execução contém JSON original do Playwright, log, comando/horários/commit, hashes e cópia dos testes usados. Os anexos de POSTs estão em arquivos próprios e no JSON original. Os vídeos, screenshots e traces de falha ficam em `.cate/evidencias-124-e2e/<execução>` no clone principal, com os caminhos completos no manifesto/JSON; não foram sobrescritos.

A [comparação textual da extração](extracao-verificada.json) confirma que os nove testes e os métodos do harness são os mesmos de `5343db3`, além dos exports e fim de arquivo. A [checagem de tipos](checks.json) passou com `tsc --noEmit --incremental false`; o código de produto continua igual ao commit `ff7558c`.

Uma execução por vez. Voz, reconhecimento/transcrição e agente são falsos: sem chamada nova de LLM ou uso de crédito ElevenLabs. A validação exercita a integração do navegador sob esses estímulos; a entrevista com áudio real nas duas salas permanece pendente por falta de crédito. Nenhum push, PR ou tag.
