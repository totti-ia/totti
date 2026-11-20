# #124 — rebase e itens para a minha revisão

## Rebase: liberado

O #146 entrou na main em 19/11 (`0f4efec`). A árvore é a mesma da base medida (`ff85b662…`), e `c91d3ce` é pai de `0f4efec`, então `git rebase origin/main` só reaplica os seus commits.

Depois do rebase, confira:
- `git diff 78b30d2 <novo commit do código>` sai vazio no produto;
- `tsc` e `test:integridade` continuam passando.

Sem push, PR ou tag.

## Itens a–c

a. **Caminho do relatório e dos logs** (ok, `e5a0bc2`). Explique o par adicional: qual execução caiu, em que ponto, por quê (suspensão do Windows?) e se o par refeito seguiu a mesma ordem. O par que caiu continua publicado.

b. **Critérios** como ficaram registrados e quando: antes ou depois da primeira execução. Se algum foi ajustado no meio, mostre o antes e o depois.

c. **Números por rodada**:
- bench-conversa, bench-quadro e validar-conversa-ide, com Fisher unilateral nos acertos e IC 95% por bootstrap da diferença de p50 e p95;
- placar das execuções que valeram, métrica por métrica, nas duas versões.

## Itens d–f

Você já está fazendo:
- d: tipo e local das cinco falhas;
- e: grafo de imports, e se `latenciaMs` ou algum campo novo chega a prompt ou contexto do modelo;
- f: taxa de rascunho usado, base contra #124.

## Leitura

O critério não atendido fica registrado como não atendido. Não releia o critério depois de ver os números nem rode mais rodadas atrás de um resultado melhor. A decisão vai para o Nícolas.

Referência do #146: as duas execuções da main tiveram 0 e 7 falhas do Totti, com o p95 do `/perguntar` em 4301 e 8010 ms. Diferenças desse tamanho já apareceram entre execuções do mesmo código. Isso não anula o critério. Deixe no relatório, separados:
- o resultado registrado;
- o que o código da #124 consegue ou não afetar, pelo grafo e pelas falhas.

Nada que chame LLM até a minha revisão. Quando terminar, me avise pelo caminho do relatório atualizado.
