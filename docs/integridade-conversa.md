# Integridade: sinais da conversa (#124)

Implementação local sobre `123-integridade` (PR #146). Os sinais são calculados no relatório, em `lib/integridade/conversa.ts`, sem modelo, efeito sobre nota ou exposição na sala do candidato.

## Régua inicial

- Eco: pelo menos três respostas começam reproduzindo uma pergunta com seis ou mais palavras. A comparação normaliza acentos e pontuação e exige quatro quintos das palavras em ordem; aceita uma abertura curta como “então você quer saber”. Repetição posterior à explicação não conta.
- Tempo plano: pelo menos três respostas de conversa/confirmação e três técnicas, mediana de pelo menos 4 s, cada medida a no máximo 750 ms da mediana e diferença entre medianas das categorias de no máximo 1 s. Perguntas sem classificação determinística e pedidos de tempo ficam fora. A distribuição mostra quantidade, mediana e intervalo por categoria mesmo sem sinal.
- Bloco sem fala: oito linhas novas e pelo menos 200 caracteres entre duas fotos distantes no máximo 30 s, sem fala nos dois minutos anteriores à foto anterior nem durante a alteração. Exige pelo menos três falas do candidato no restante da entrevista. Fotos esparsas, deslocamento de código e entrevista inteiramente silenciosa não bastam.

Cada evidência guarda o momento para abrir a gravação. Os novos sinais ficam recolhidos quando isolados. Eco e tempo plano podem convergir; bloco sem fala pode convergir com saída de foco próxima. A colagem e a ausência de fala do mesmo bloco não viram provas independentes. A exceção do canário já existente na #123 permanece.

## Captura

`criarTempoDeResposta` só guarda marcas do relógio. A abertura do portão em `lib/presenca/useTranscricao.ts` informa o início do primeiro bloco de voz (antes da transcrição parcial). O navegador de reserva usa o primeiro resultado disponível. As aberturas seguintes do mesmo turno não substituem essa marca. Interrupção, sobreposição e voz já iniciada não produzem medida. Retry e junção de falas preservam a marca da primeira parte.

Na IDE, o fim vem da fila de falas; no quadro, dos players já usados por `lib/sessao/cliente.ts`. Áudio ausente, cancelado ou com erro não produz fim natural. Uma reação retida só passa a valer se tocar; a última gravação efetivamente tocada determina o fim.

`latenciaMs` é opcional nos eventos de fala e nas gravações. Vai no envio de fala que já existia, sem POST adicional. Os critérios existentes que omitem falas livres muito curtas na IDE permanecem. Não vai no contexto do modelo nem no pedido de rascunho; ambos usam o mesmo corpo anterior. O campo fica apenas no registro posterior à confirmação, sem alterar a entrada usada pela antecipação. Gravações antigas continuam aceitas.

## Validação e pendências

TypeScript e os 57 testes de `lib/integridade/` passaram, com rede simulada nos testes que usam os agentes. A suíte cobre sinais, caso honesto, pedido de tempo, dados inválidos, captura anterior ao parcial, interrupção, sobreposição, áudio ausente, substituição/retry e persistência nas duas gravações.

Após a liberação da máquina, foram registradas 20 execuções, em sequência e ordem alternada: benchmarks de conversa e quadro, rascunho nas duas salas, tentativas de transcrição e placares. Uma rodada de placares foi interrompida pela espera moderna do Windows; os originais foram preservados e o par foi retomado após autorização para continuar. O [relatório completo e os logs](integridade-124-medicoes-2026-11-19/resultado.md) mostram pioras observadas e falhas, portanto o critério de ausência de piora não foi atendido. A transcrição não pôde ser medida por falta do corpus de áudio. Falta também conferir `latenciaMs` contra gravações reais das duas salas; esta issue não está pronta para merge.

Quando o PR #146 entrar na main, rebasear esta branch; se ele for barrado, esta issue aguarda junto. Sem push, PR ou tag até ordem do Nícolas.
