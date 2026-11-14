# Integração de voz

Branch: `henrique-giorgio/voz-integrada`, baseada em `origin/sofia/coding-transcricao` (`fd9ff33`), que já contém a main usada nesta revisão. Preserva a IDE atual, convites, histórico da conversa, fila de falas da Sofia e limites do token.

| Fluxo | Transcrição | Resposta por voz |
| --- | --- | --- |
| Criação da vaga | Descrição e contexto; revisar antes de enviar | Não lê os campos da pessoa |
| Conversa com Totti | Ditado revisável, junto dos anexos/texto existentes | Últimas falas novas; polling não repete áudio |
| Entrevista de código | Contínua: na conversa envia respostas; fora dela vai ao entrevistador, que decide se responde | Saudação, respostas e despedida com legenda; a barra espera o áudio terminar |
| Entrevista no quadro | Contínua, encaminhada à conversa da sessão | Mantém voz, legenda e movimentos; permite silenciar/interromper |
| Páginas de desenvolvimento | Mesmos componentes de entrada | Mesma saída de voz |

Na IDE e no quadro, a síntese prepara o áudio com a escuta ativa e confere o turno novamente antes de reproduzir; a captura pausa durante a reprodução. Nos formulários, iniciar o microfone interrompe a reprodução. Ocultar a aba pausa a escuta; desmontar/encerrar cancela filas e invalida respostas atrasadas. No quadro, falhas de envio conservam a fala e as seguintes para tentar novamente em ordem.

## Conversa no quadro

A abertura explica que o candidato pode avisar quando concluir uma etapa ou pedir um comentário sobre o desenho. Todas as falas, inclusive respostas às perguntas do agente, usam o loop rápido com o grafo atual, os requisitos combinados e a pergunta ativa. Pedidos de feedback recebem observações neutras e, quando pertinente, uma pergunta sobre o que está visível; notas, critérios internos e solução pronta continuam reservados ao processo de avaliação.

Uma pergunta escolhida pela análise pode ser falada numa pausa de pelo menos 900 ms, sem clique obrigatório. Transcrição parcial, som de fala, resposta em andamento e áudio sendo preparado/reproduzido adiam a intervenção. A análise que ficou desatualizada por uma nova fala não inicia uma pergunta. O botão de demonstração continua manual. O Scribe finaliza os trechos após 0,9 s de silêncio, em vez de 1,5 s, conforme o parâmetro [VAD da ElevenLabs](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies). Esse valor controla a detecção de pausa; não garante o tempo total de resposta do LLM e TTS.

O teste adicional `npx tsx --env-file-if-exists=.env.local scripts/validar-conversa.ts` usa o LLM real com seis situações sintéticas. Usa créditos, imprime somente respostas e tempos e verifica intenção de resposta/conclusão da etapa. O teste de navegador cobre intervenção automática, contexto da pergunta ativa e uma continuação parcial que impede a reprodução da resposta pronta.

## Conversa na IDE

A IDE usa as mesmas regras de turno do quadro (`lib/conversa/turnos.ts`). Logo no começo o Totti se apresenta e avisa que o candidato pode pedir um feedback quando terminar uma etapa; sem voz (desligada ou bloqueada pelo navegador), a saudação fica na legenda. Uma pergunta pendente abre a conversa sozinha na primeira pausa de pelo menos 900 ms, sem clique; transcrição parcial, som de fala, digitação recente, resposta em andamento e voz do agente adiam a abertura, e o balão continua clicável. Cada resposta é sintetizada com a escuta ligada e só toca numa pausa (teto de 4 s para som e de 12 s para fala transcrita).

Fora de uma conversa, a fala do candidato vai ao entrevistador (`/api/chat` sem `blipId`), que decide pela intenção: pensando em voz alta, ele só ouve (`listening`) e nada abre; dúvida, pedido de feedback ou etapa concluída abrem a barra com a resposta. Dentro de uma conversa vale o mesmo: quem ainda está pensando não recebe resposta, e quem terminou de responder recebe uma paráfrase neutra, sem a pergunta repetida. Etapa concluída (`concluded`) faz a próxima análise tratar o momento como chave, para a pergunta seguinte já ser sobre o que vem depois. O feedback comenta algo observável no código, sem validar nem corrigir, e grifa o trecho comentado. As recusas e as falas de reserva variam de uma vez para outra. O botão "Chamar entrevistador" abre a conversa para quem prefere escrever.

O teste de navegador da IDE cobre a saudação, a pergunta segurada por uma fala parcial e aberta sozinha na pausa, a fala que só é ouvida, a paráfrase ao fim da resposta e o pedido de feedback fora do balão.

## Mão e desenhos do agente

O campo opcional `visual` aceita composições de até cinco ações: apontar, sublinhar, circular, enquadrar, colchetes, percorrer, comparar, anotar e traço livre. O modelo escolhe as ações em `/analisar` e também nas respostas de `/perguntar`, na mesma chamada que prepara a fala. Os traços livres usam pontos relativos à região de um elemento; o navegador resolve as coordenadas reais. `visual: []` permite conversar sem acrescentar tinta.

O histórico da sala evita repetir a mesma marca no mesmo alvo e informa os gestos recentes ao modelo. Respostas antigas sem esse campo usam gestos variados de apoio; um quadro sem alvo não recebe círculos ou caixas decorativas. Notas procuram espaço livre, e percorrer um fluxo só move o cursor, sem criar conexões técnicas. Ações com IDs inexistentes e planos inválidos são descartados sem perder a resposta falada. As marcas ficam em grupos temporários do agente e não alteram os elementos do candidato.

O teste de navegador verifica colchetes com nota, um traço definido pelo modelo, uma resposta sem desenho e a preservação do desenho original. O smoke test real também exige um plano válido quando o candidato pede explicitamente um destaque.

Ao encerrar o quadro, câmera, microfone e conexão de transcrição são liberados imediatamente. O teste de navegador confirma que as trilhas de mídia terminam.

O merge preserva a revisão atual do plano e o fluxo atual do quadro; não restaura a IDE antiga.

## Configuração após o merge

```dotenv
# Somente no servidor; mesma chave para entrada e saída.
ELEVENLABS_API_KEY=
# Fluxos reais da pré-entrevista e do quadro.
NEXT_PUBLIC_USAR_SERVIDOR=1
```

A voz não é configurável por variável de ambiente: `ELEVENLABS_VOICE_ID` e `ELEVENLABS_MODEL_ID` não são lidos pelo código. Voz (Fernando - Casual), modelo (`eleven_flash_v2_5`) e ajustes ficam fixos em `lib/voz/ajustes.ts`; `app/api/falar/__tests__/route.test.ts` confirma que uma variável com outro valor não troca a voz. Para trocar de voz, altere esse arquivo.

A chave local é `ELEVENLABS_API_KEY`, em `.env.local` (ignorado pelo Git). Merge/push não transporta credenciais: configure a variável também na hospedagem. Os agentes continuam exigindo as chaves de LLM já usadas pelo projeto; ElevenLabs não as substitui.

O token da captura contínua exige sessão real e aceita `contexto=coding` (padrão) ou `contexto=quadro`. Sessões encerradas são recusadas. As rotas de voz/transcrição de formulário têm limites por IP e globais e não armazenam áudio no servidor.

Sem chave, o ditado revisável usa reconhecimento do navegador quando disponível; a escuta contínua recorre a ele quando o Scribe fica indisponível. A síntese também pode usar o navegador. Permissão do microfone, reprodução automática e vozes disponíveis dependem do navegador.

## Voz e escuta (#128)

- **Fim do turno único** (`lib/audio/fimDoTurno.ts`, nas três telas): silêncio contínuo de 3,5 s fecha o turno; fala baixa ou ruído fecha em 8 s; voz alta nunca fecha. Só a energia do microfone decide.
- **Pré-entrevista**: a transcrição usa o mesmo motor das salas (`lib/transcricao/scribe.ts`), com portão de voz, commits e reconexão.
- **Rampa e folga**: a fala sobe de silêncio em 80 ms (`lib/presenca/vozSincronizada.ts`). O MP3 ganha silêncio antes e depois da voz, e o alinhamento é deslocado pelo mesmo tempo (`lib/voz/folga.ts`): 10 quadros (~0,26 s) antes e 8 (~0,21 s) depois; 27 quadros (~0,7 s) antes da primeira fala ou depois de 5 s sem som.
- **Contexto entre falas e velocidade** (`app/api/falar`, `lib/voz/velocidade.ts`): o cliente envia `texto_anterior` e `texto_seguinte` (até 1000 caracteres cada), repassados como `previous_text` e `next_text`. A velocidade é 1,1 para falas de até 200 caracteres e 1,0 acima disso; a rota aceita de 0,7 a 1,2.
- **Reações curtas** (`lib/voz/reacao.ts`): "Hm.", "Uhum.", "Tá." ou "Certo." sozinhas esperam 1,2 s por uma fala seguinte e saem juntas com ela. Se nada vem, toca a gravação de `public/audio/reacoes/` (`hm`, `hum`, `uhum`, `ta`, `certo`). Para gerar candidatas: `npm run voz:reacoes -- <pasta>` (três variantes por reação, para escolher; nada vai para `public/` sozinho).
- **Resposta antecipada** (`lib/conversa/rascunho.ts`): enquanto o candidato fala, o servidor prepara a resposta do Totti a partir do trecho já confirmado. Se o turno fecha com a mesma entrada, a resposta pronta é usada; se ele continuou falando, a chave muda e a resposta sai pelo caminho normal. A espera máxima pelo rascunho é 1,5 s.
- **Como medir a voz**: `npm run voz:amostras -- amostras-voz` gera 10 MP3 (`antes-1..5`, com velocidade 1,1 e sem contexto; `depois-1..5`, com a fala anterior e a velocidade atual) da mesma frase. Os `antes-*` mostram a variação de entonação entre pedidos da mesma frase, sem contexto; os `depois-*` mostram a mesma frase com a fala anterior e a velocidade atual, para comparar ao ouvir. Ver `amostras-voz/LEIAME.md`. Gasta créditos.

## Verificação

```sh
npm run test:voz
npm run test:transcricao
npm run test:rotas
npx tsx --test lib/presenca/tests/vozSincronizada.test.ts lib/sessao/__testes__/*.test.ts
npm run test:e2e:voz
npm run build
```

O teste de navegador usa provedores falsos e áudio fictício. Cobre ditado da vaga/Totti, resposta contínua do candidato, espera pela despedida e encaminhamento da fala no quadro. Não grava nem transmite o microfone real de quem executa o teste.

O smoke test externo é separado e explícito:

```sh
npm run voz:validar
```

Exige FFmpeg e chave válida, gera uma frase sintética pelo TTS e a envia ao Scribe Realtime pelo adaptador do ditado. Usa créditos e não imprime chaves/tokens. No teste real, a frase ‘Olá. Vamos conversar sobre a solução em português.’ voltou como ‘Olá, vamos conversar sobre a solução em português.’. A duração inclui envio do áudio e silêncio de finalização; não mede a latência isolada do modelo.

Ainda cabe uma passagem com microfone/fone reais para avaliar sotaque, termos técnicos, ruído e conforto. A entrada da recrutadora continua revisável; envio automático está aplicado às entrevistas do candidato.
