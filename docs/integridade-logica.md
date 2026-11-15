# Integridade — lógica e servidor (#123)

Implementação na branch local `123-integridade-logica`, a partir de `1559ce0` (main com #139). Nenhum prompt ou arquivo em `components/` foi alterado.

## Contrato e integração com a captura

- `paste.origem`, `snapshot.escrita`, evento IDE `foco` e tipos do relatório seguem o contrato combinado. O primeiro commit, `dcc3159`, contém apenas esses contratos.
- Ajuste posterior combinado: na IDE, `snapshot.foco` opcional leva até 200 saídas (`SaidaDeFoco`), no POST do snapshot que já sai. O evento `foco` fica para o único envio final das sobras. O relatório reúne as duas fontes sem duplicar, e a presença do campo não altera o gatilho de análise do snapshot. O quadro continua com seu lote genérico anterior.
- `lib/integridade/canario.ts` pode ser importado diretamente no navegador. O nome usa hash FNV-1a determinístico e prefixo raro `aux_qv`; a frase é bilíngue. A detecção exige o identificador inteiro e só gera sinal para código ou desenho, não para fala.
- `foco` da IDE retorna imediatamente depois de registrar/persistir. Não consulta fila, analista, filtro ou fala. Reenvios não duplicam o evento. No quadro, `eventosDaMaquina("foco", ...)` devolve uma lista vazia.
- Colagem `editor` não entra na fila nem dispara análise. Origem `fora` explícita vence coincidência com linhas antigas. Sem origem, fila e relatório compartilham a inferência anterior (pelo menos cinco linhas com conteúdo e menos de 70% já existentes).
- Na IDE, `gravacaoDaSessao` monta o bloco e o salva no campo opcional `Gravacao.integridade`; o schema preserva esse campo na leitura do relatório salvo. Gravações antigas continuam válidas. O adaptador ainda pode recuperar canário e injeção dos textos antigos.
- No quadro, textos das caixas e anotações estão nos eventos `desenho`, em `dados.grafo`. A página do relatório usa os eventos já carregados com `listarEventos`. `relatorioDoQuadro` recebe o bloco num segundo argumento opcional, preservando as chamadas anteriores. O relógio começa na primeira fase, como `montarRelatorio`, ou na criação como reserva.
- Os exemplos têm destaques: foco + colagem na IDE; canário no quadro. Nenhum deles muda nota ou recomendação.
- O alerta de injeção também aparece no bloco. O comportamento existente de `concerns`/pontos a aprofundar foi preservado.

## Critérios determinísticos

São escolhas de implementação dentro do contrato, sem classificar o candidato:

- Descartar ausências de duração zero ou inválida; unir intervalos sobrepostos de `blur` e `visibilitychange`.
- Escrita linear: pelo menos 200 caracteres digitados numa janela de até 60 s, trecho sem pausa de pelo menos 120 caracteres, no máximo 5% apagados e nenhum retorno a linhas anteriores. Os contadores são somados entre snapshots.
- Um intervalo com colagem ou que atravesse uma ausência não sustenta uma afirmação sobre bloco digitado após a volta. Essa escolha evita atribuir linhas coladas ou tempo anterior à saída à digitação posterior.
- Convergência: foco + atividade nos 30 s seguintes ao retorno; preferir o sinal de bloco após saída. Escrita linear e bloco após saída nunca convergem entre si, pois derivam da mesma escrita. Canário pode ter destaque sozinho.
- Sem campos novos nem sinais verificáveis: `null`. Com coleta nova, mas sem sinais: listas vazias.

## Validação

Executada em 14/11/2026, nesta worktree:

- `npx tsc --noEmit`: passou.
- `npm run lint`: passou, zero erros e 13 avisos preexistentes; nenhum aviso nos arquivos novos.
- Runner efetivo do repositório: `npx tsx --test --test-reporter=tap` sobre os 174 arquivos `*.test.ts` de `lib`, `app`, `scripts` e `components`, exceto `supabase.integration.test.ts`: **2.372 testes passaram, zero falhas**.
- Testes novos em `lib/integridade/__tests__/`: contrato antigo, contadores, origem da colagem e inferência legada, foco nas duas rotas, reenvio, duração/minuto, convergência, independência, entrevista honesta, canário nas duas salas, isolamento dos prompts, injeção, gravação e preservação de nota/recomendação.
- Após o ajuste de `snapshot.foco`: TypeScript e lint passaram novamente; 50 testes focados de integridade, colagem e adaptadores passaram. Cobrem o limite de 200 saídas, união das fontes sem duplicação, persistência e gatilho do snapshot antes, no limite e depois do prazo, com e sem código do candidato.
- Runner confirmado pelo Claude: o projeto usa `node:test` + `node:assert/strict`, executados por `tsx --test`. Os testes de integridade já seguem esse padrão e têm o script `npm run test:integridade`. A solicitação inicial de Vitest foi corrigida; ele não é requisito de validação desta entrega e não foi adicionado às dependências.

## Medições com modelo real ainda pendentes

Esta worktree não contém `.env.local`; `FEATHERLESS_API_KEY` e `OPENROUTER_API_KEY` também não estão no ambiente. Os quatro scripts foram tentados, sem chamadas de modelo bem-sucedidas:

| Script | Resultado observado |
|---|---|
| `bench-conversa.ts featherless:google/gemma-4-26B-A4B-it` | 0/13 casos, falhas de provedor |
| `bench-quadro.ts featherless:mistralai/Mistral-Small-3.2-24B-Instruct-2506` | 0/2 simulações, 12 erros, 0 chamadas |
| `npm run placar:quadro -- --rotulo integridade-logica --so casos` | 0/18 casos, 18 falhas de provedor, 0 falas julgadas |
| `validar-conversa-ide.ts` | chave Featherless ausente; 6 verificações falharam sobre a resposta de reserva |

Os tempos dessas falhas não medem latência do agente e não servem de comparação. Antes de mergear a issue completa, falta rodar antes/depois com os provedores configurados, incluindo o placar completo. Os logs locais ficam em `test-results/integridade/` e o placar em `test-results/placar-quadro/`.
