# Validação do tempo de resposta no navegador

Teste novo: `e2e/tempo-de-resposta.spec.ts`. Config própria: `e2e/playwright.tempo-de-resposta.config.ts`, que herda a config de voz existente (porta 3017, um worker, agente falso, microfone silencioso). A seleção de `test:e2e:voz` permanece igual. **Ainda não executado**: aguarda liberação da máquina; nenhum dev/e2e/LLM foi iniciado nesta etapa de escrita.

`e2e/helpers/voz-falsa.ts` é uma extração do harness de `voz.spec.ts`, com exports, sem mudar os métodos ou rotas existentes. Os seis cenários cobrem fim natural, corte manual e sobreposição, em cada uma das duas salas. A apresentação termina automaticamente; uma fala inicial pede a pergunta controlada, que fica retida no `Audio` falso.

No fim natural, o teste termina o áudio, espera a escuta reativar e mais 1.500 ms e emite a fala falsa. Compara `latenciaMs` com a diferença entre as marcas do navegador, tolerando 700 ms e exigindo pelo menos 1.000 ms. O fallback usado marca o começo no primeiro resultado do reconhecimento; este cenário não mede a demora de transcrição de um serviço real. A IDE é conferida no POST de evento `speech`; o quadro, no lote de eventos `fala` e na gravação montada pelo adaptador real.

O corte manual usa Escape e confere ausência do campo, além do evento de interrupção manual da IDE. Para a sobreposição, `e2e/helpers/scribe-falso.ts` mantém um WebSocket local falso, sem conectar ao servidor ElevenLabs, e injeta blocos PCM no callback do processador de áudio. O detector de interrupção e os callbacks das salas permanecem os do produto. O teste confirma que o áudio foi pausado, a fala chegou ao evento sem latência e, na IDE, que a interrupção foi por `voz`. É estímulo determinístico de energia e transcrição, sem testar qualidade de STT, hardware ou eco real.

Cada cenário anexa `posts-por-rota.json` ao resultado do Playwright, inclusive em falhas. Contém contagem e corpo dos POSTs e eventos capturados, do carregamento da sala até 1.200 ms após a confirmação da fala. IDs do quadro são normalizados no nome da rota. Não se exige igualdade entre um turno interrompido e um normal: os fluxos já são diferentes na main. Comparar **o mesmo cenário** nas duas versões, por rota e corpo; POST adicional exige investigação antes de aprovação. Rascunhos, lotes de eventos, pausas e telemetria estão incluídos; variação na quantidade de lotes deve ser examinada com os eventos e tempos, sem ser descartada automaticamente. A comparação ainda não foi feita.

Após a captura e fora da janela de contagem, o cenário natural do quadro monta a integridade a partir desses eventos, preserva nota geral, recomendação e critérios de um relatório de exemplo e inspeciona o HTML do componente real no navegador, com/sem a medida. Não chama avaliador. Essa conferência é renderização estática complementar: não cobre persistência do relatório salvo, carregamento da rota nem hidratação. A nota técnica do exemplo vem da mesma fixture nas duas montagens.

Após liberação, executar na #124:

```powershell
npx playwright test --config e2e/playwright.tempo-de-resposta.config.ts
```

Para comparar POSTs na main, copiar apenas o spec, a config e os dois helpers novos para o checkout da base. Os adaptadores e componentes já existem na base; o Playwright transpila o spec sem exigir que os tipos antigos declarem `latenciaMs`. Não copiar implementação da #124. Executar com a mesma sequência de gestos:

```powershell
$env:TEMPO_RESPOSTA_BASE = '1'
npx playwright test --config e2e/playwright.tempo-de-resposta.config.ts
Remove-Item Env:TEMPO_RESPOSTA_BASE
```

Esse modo espera ausência da medida na main e omite a tabela nova do relatório. Os estímulos das seis salas e a janela de contagem continuam iguais. Guardar os anexos das duas execuções em diretórios distintos antes que o Playwright sobrescreva a saída. Conferir o total por rota em cada cenário; sem essa comparação, o teste ainda não demonstra ausência de POST adicional.

Não rodar a main e a #124 juntas, nem junto da medição de LLM. Falta também a sessão real em cada sala quando a conta ElevenLabs tiver crédito.
