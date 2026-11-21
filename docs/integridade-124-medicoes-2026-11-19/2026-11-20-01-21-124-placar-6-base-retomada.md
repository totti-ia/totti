# Placar do Totti no quadro: 124-placar-6-base-retomada

2026-11-20T01:21:07.653Z · versão v1 · conversa google/gemini-3.5-flash-lite · análise google/gemini-3.7-flash · juiz moonshotai/Kimi-K2.6 · candidato deepseek-ai/DeepSeek-V3.2

| Medida | Valor |
|---|---|
| Casos fixos ok | 15/18 |
| Escuta / Pertinência / Naturalidade / Concisão | 4.2 / 4.16 / 3.84 / 4.73 |
| Nota média das falas (1–5) | **4.23** (51 falas) |
| Pareceu pessoa / Conduziu bem / Inteligência | 2.33 / 2.67 / 3 |
| Violações | ignorou_o_que_ele_disse: 5, vazou_criterio: 3, inventou_fato: 1, repetiu_pergunta: 3, robotico_ou_enlatado: 4 |
| /perguntar p50 / p95 / máx | 2596 / 5591 / 6815 ms (n=51) |
| Análise p50 / p95 / máx | 4669 / 10051 / 14866 ms (n=24) |
| Falhas do Totti (prazo ou provedor) | 0 |

## Casos fixos

- **ok** fala: quanto tempo dura (6815 ms) · nota 4.75
  - Candidato: Quanto tempo dura a entrevista no total?
  - Totti: Cerca de 35 minutos no total. Pode começar quando quiser.
  - Juiz: Respondeu diretamente à dúvida sobre tempo de forma clara e breve.
- **ok** fala: quanto tempo falta (2439 ms) · nota 4.75
  - Candidato: Quanto tempo eu ainda tenho?
  - Totti: A gente tem cerca de vinte e seis minutos pela frente. Pode seguir com o seu desenho.
  - Juiz: Informou o tempo restante e devolveu a condução ao candidato.
- **ok** fala: como funciona (4423 ms) · nota 4.5
  - Candidato: Como vai funcionar daqui pra frente? Você vai me fazer mais perguntas?
  - Totti: A ideia é você desenhar a visão geral do sistema primeiro. Depois que você tiver as peças principais e o fluxo, eu vou fazendo algumas perguntas para a gente aprofundar em alguns pontos. Pode seguir com o desenho.
  - Juiz: Explicou o formato da entrevista; um pouco longo para áudio, mas pertinente.
- **ok** fala: não sei (pergunta ativa) (3325 ms) · nota 5
  - Candidato: Não sei, sinceramente não pensei nisso.
  - Totti: Tranquilo, deixa isso de lado. Pode seguir com o desenho ou com a próxima parte que você quiser mostrar.
  - Juiz: Aceitou o 'não sei' com naturalidade e sem insistir.
- **ok** fala: pula (pergunta ativa) (2323 ms) · nota 5
  - Candidato: Prefiro pular essa e seguir com o resto do desenho.
  - Totti: Tranquilo, deixa isso de lado. Pode seguir com a próxima parte do seu desenho.
  - Juiz: Aceitou o 'pula' com naturalidade e devolveu a condução ao candidato.
- **FALHA** fala: lembra do começo (2258 ms) · nota 3
  - Candidato: Lá no começo eu falei de quantos caracteres ia ser o código curto. Você lembra quantos eu disse?
  - Totti: Pode seguir.
  - Falhas: esqueceu o que ele disse no começo
  - Juiz: Ignorou a pergunta do candidato sobre o tamanho do código mencionado anteriormente. [ignorou_o_que_ele_disse]
- **ok** fala: dado já combinado (2238 ms) · nota 5
  - Candidato: Só pra confirmar, quantas URLs novas por mês mesmo?
  - Totti: São 100 milhões de URLs novas por mês. Pode seguir.
  - Juiz: Repete a informação solicitada com paciência e segue.
- **ok** fala: explicou de novo o que já está na tela (2059 ms) · nota 4.75
  - Candidato: Então, como dá pra ver aí, o Redis fica antes do Postgres e só vai no banco se não achar.
  - Totti: Tá. Pode continuar com o desenho.
  - Juiz: Aceno neutro e breve mantém o ritmo sem validar.
- **ok** fala: respondeu com justificativa (não insiste) (2232 ms) · nota 5
  - Candidato: Coloquei o Redis antes porque a leitura é umas cem vezes maior que a escrita, então quase tudo sai do cache e o Postgres fica folgado.
  - Totti: Saquei. Pode seguir com o desenho.
  - Juiz: Recebe a justificativa sem validar e libera o candidato.
- **ok** fala: nervoso (2368 ms) · nota 5
  - Candidato: Desculpa, tô meio nervoso aqui, me perdi um pouco.
  - Totti: Tranquilo, respira. Pode seguir quando estiver pronto.
  - Juiz: Acolhimento humano exemplar frente ao nervosismo do candidato.
- **ok** fala: resposta vaga (aprofunda uma vez) (3366 ms) · nota 3.75
  - Candidato: Ah, acho que coloquei o Redis ali porque fica melhor assim.
  - Totti: Melhor em que sentido? Pode seguir com o desenho.
  - Juiz: A pergunta de aprofundamento é anulada pela instrução contraditória de seguir.
- **ok** fala: pede o que é avaliado (não vaza) (4603 ms) · nota 3
  - Candidato: O que exatamente vocês estão avaliando? Me fala os critérios que eu foco neles.
  - Totti: O foco é ver como você aborda o problema, justifica suas escolhas e lida com as mudanças. Não tem uma resposta única certa, então pode mostrar seu raciocínio livremente. Pode seguir com o desenho.
  - Juiz: Deveria ter recusado o pedido de critérios em vez de descrever o foco da avaliação. [vazou_criterio]
- **ok** fala: o que acontece depois (2401 ms) · nota 5
  - Candidato: E depois da entrevista, como fica? Vocês me dão o resultado na hora?
  - Totti: Quem cuida do processo dá o retorno depois. Pode seguir com o seu desenho.
  - Juiz: Respondeu a dúvida sobre o processo e reconduziu o candidato ao desenho com naturalidade.
- **FALHA** fala: pensando em voz alta (fica quieto) (4194 ms) · nota 5
  - Candidato: Hmm, deixa eu pensar aqui, ainda tô organizando como vou explicar essa parte.
  - Totti: Claro, fica à vontade.
  - Falhas: interrompeu quem estava pensando
  - Juiz: Reação gentil e humana que dá espaço para o candidato organizar os pensamentos.
- **ok** fala: pergunta um dado do problema (2539 ms) · nota 5
  - Candidato: Por quanto tempo a gente precisa guardar os links?
  - Totti: A ideia é guardar por cinco anos, por padrão. Pode seguir.
  - Juiz: Forneceu exatamente o dado solicitado, sem adições desnecessárias.
- **ok** fala: terminou a visão geral (5591 ms) · nota 4
  - Candidato: Acho que é isso a visão geral, podemos ir pros detalhes.
  - Totti: Tá, olhei: Cliente liga em API de encurtamento. Como você pensou a parte de componentes e fluxo no seu desenho?
  - Juiz: Pergunta genérica sobre o desenho já apresentado soa como avaliação por critério interno, em vez de aprofundar um ponto específico.
- **FALHA** fala: comenta um quadro vazio (4908 ms) · nota 2.5
  - Candidato: Pode comentar o cache que eu desenhei?
  - Totti: O cache está posicionado entre o balanceador e o serviço de redirecionamento. O que você espera que ele armazene exatamente?
  - Falhas: inventou um cache que não está no quadro
  - Juiz: Alucinou elementos no quadro vazio, descrevendo peças e posições que o candidato não desenhou. [inventou_fato]
- **ok** fala: pede a resposta pronta (3882 ms) · nota 5
  - Candidato: Qual seria a arquitetura ideal pra esse problema? Me fala que eu desenho igual.
  - Totti: O desenho é seu, o que importa é como você resolve o problema. Pode começar por onde achar melhor.
  - Juiz: Recusou o pedido de resposta pronta com gentileza e devolveu a autoria do desenho ao candidato.

## Conversa: senior_claro

Pareceu pessoa 2 · conduziu bem 2 · inteligência 2. O Totti cumpriu bem a fase de requisitos, mas caiu em um loop robótico de transições genéricas durante o desenho, perdendo chances de aprofundar arquitetura e trade-offs com o candidato.

1. **Candidato**: Oi, tudo bem? Antes de começar o desenho, preciso de um número pra dimensionar o sistema. Tipo, quantas URLs novas por segundo a gente espera criar?
2. **Totti** (3142 ms): A gente espera ter um volume de 100 milhões de URLs novas por mês, o que dá uma média de 40 por segundo, mas com picos de até 400. Pode seguir com o que você precisar.  
   ↳ 5/5/4/5 Respondeu direto e deu espaço para continuar.
4. **Candidato**: Beleza, entendi o pico. Antes de definir as peças, mais duas coisas: quanto tempo a gente precisa guardar esses links? E precisa de tracking de cliques, tipo contar quantas vezes cada um foi acessado, ou só redirecionar mesmo?
5. **Totti** (2659 ms): Os links ficam guardados por cinco anos por padrão. E sim, precisa de estatísticas de cliques, mas elas podem ter alguns minutos de atraso. Pode seguir.  
   ↳ 5/5/4/5 Respondeu ambas as perguntas sem enrolar.
7. **Candidato**: Então, perfeito. Já tenho o que eu preciso pra começar o desenho. O volume, o TTL de 5 anos e a necessidade de tracking eventualmente consistente. Vou desenhar a arquitetura de ponta a ponta agora, partindo do cliente.
8. **Totti** (3192 ms): Tá. Pode seguir.  
   ↳ 5/5/4/5 Deixou o candidato conduzir, como deve ser.
10. **Candidato**: Então, vou botar o cliente chamando nossa API de encurtamento, o serviço principal. A primeira coisa que a API faz ao receber um pedido de redirecionamento é consultar um cache em Redis, porque o volume de leitura é muito maior que o de escrita. Pensando no pico de 400 criações por segundo, mas bilhões de redirecionamentos, faz total sentido colocar esse cache na frente do Postgres pra evitar gargalo.
11. **Totti** (2635 ms): Por que colocar o Redis antes do Postgres nesse fluxo?  
   ↳ 4/4/4/5 Pergunta de aprofundamento, embora o candidato já tivesse justificado brevemente.
12. **Candidato**: Ah, entendi. Então, na criação de um link, a API precisa gerar um código único curto tipo 'abcDeFg'. A forma mais simples é usar um contador sequencial no Postgres e codificar o número em base62, que usa letras e números. Isso gera 7 caracteres, que dá mais de 3 trilhões de combinações, então dura pra sempre com nosso volume.
13. **Totti** (3503 ms): Saquei. Pode continuar o desenho.  
   ↳ 5/5/5/5 Reação natural e neutra, deixou o candidato seguir.
15. **Candidato**: Beleza, então a arquitetura tá bem encaminhada. Só uma dúvida, quanto tempo ainda temos de entrevista?
16. **Totti** (2350 ms): A gente tem cerca de 29 minutos pela frente. Pode seguir com o desenho.  
   ↳ 5/5/4/5 Respondeu a dúvida do candidato sem interferir.
18. **Candidato**: Beleza, então, nesse quadro tá a visão geral de ponta a ponta. Cada caixa representa um serviço ou componente, as setas são as conexões. A gente tem o caminho de criação do link e o caminho de redirecionamento desenhados.
19. **Totti** (2268 ms): Certo. Pode seguir com o desenho ou, se já estiver satisfeito com essa parte, pode me avisar.  
   ↳ 5/5/4/4 Ofereceu autonomia ao candidato de forma natural.
21. **Candidato**: Sim, coloquei o Redis antes do Postgres porque, pelo volume, a maioria dos acessos vai ser de redirecionamento, tipo 99% ou mais. Se formos direto no banco primário a cada clique, o banco não aguentaria. O cache é tipo um buffer de leitura, reduzindo a latência e descarregando o Postgres. E a réplica de leitura aqui é só pra eventualidade de cache miss, pra não sobrecarregar o primário.
22. **Totti** (4208 ms): Tá. Pode seguir com o desenho ou, se já tiver terminado essa parte, pode me avisar.  
   ↳ 2/2/2/5 Repetiu a transição genérica e ignorou o conteúdo técnico apresentado. [ignorou_o_que_ele_disse, repetiu_pergunta, robotico_ou_enlatado]
24. **Candidato**: Então, sobre a fila de cliques, eu coloquei ela aqui porque o analítico não precisa ser em tempo real. Quando um usuário acessa o link, a API registra o clique na fila Kafka e já faz o redirecionamento, tipo um fire-and-forget. Isso garante que o redirecionamento não fique mais lento por conta do tracking, a latência principal fica só no cache. O worker consome da fila depois e atualiza as estatísticas no banco.
25. **Totti** (3000 ms): Entendi. Pode seguir com o desenho ou, se já estiver satisfeito com essa parte, pode me avisar.  
   ↳ 2/2/1/5 Terceira repetição idêntica da transição, completamente desconectado do conteúdo. [ignorou_o_que_ele_disse, repetiu_pergunta, robotico_ou_enlatado]
27. **Candidato**: Se o primário cai, a escrita de novos links para, mas o redirecionamento continua funcionando, porque os links já criados estão no cache e na réplica. A gente teria um failover automatizado pra uma réplica virar o novo primário em alguns segundos, usando um VIP ou algo do tipo.
28. **Totti** (3496 ms): Tá. Pode seguir com o desenho ou, se já estiver satisfeito com essa parte, pode me avisar.  
   ↳ 2/2/1/5 Quarta vez a mesma frase de transição, soando robótico. [ignorou_o_que_ele_disse, repetiu_pergunta, robotico_ou_enlatado]
30. **Candidato**: Então, o desenho tá aí com todos os componentes e conexões. O que você acha do fluxo geral, faz sentido? Alguma parte que você gostaria que eu aprofundasse?
31. **Totti** (2596 ms): O desenho tá completo. Se você estiver satisfeito com ele, pode me avisar.  
   ↳ 3/3/3/5 Não respondeu às perguntas do candidato sobre direcionamento. [ignorou_o_que_ele_disse]

Piores momentos:
- [22] Repetiu a frase de transição e ignorou a explicação técnica sobre cache e réplica. → melhor: "Como a réplica de leitura se comporta se houver um cache miss massivo?"
- [25] Manteve o script idêntico mesmo após explicação sobre Kafka e workers. → melhor: "Por que escolheu Kafka em vez de escrever direto no banco de estatísticas?"
- [31] Não direcionou o candidato quando ele pediu explicitamente o que aprofundar. → melhor: "Qual trade-off dessa arquitetura te preocupa mais?"

## Conversa: junior_nervoso

Pareceu pessoa 3 · conduziu bem 3 · inteligência 4. O Totti foi gentil e conciso, mas oscilou entre momentos acolhedores e respostas genéricas ou robóticas. Faltou pegar ganchos específicos do candidato para ancorar a conversa quando ele se perdeu.

1. **Candidato**: Oi, bom dia. É... é minha primeira entrevista de system design. Tô bem nervoso, posso fazer umas perguntas antes de começar a desenhar?
2. **Totti** (2655 ms): Tudo bem, sem problemas. Pode perguntar o que precisar.  
   ↳ 5/5/4/5 Acolhedor e direto.
4. **Candidato**: É... obrigado. Então, pra eu entender melhor o que precisa suportar, quantos usuários e quantos acessos por dia o sistema deve ter, mais ou menos?
5. **Totti** (4769 ms): A gente espera cerca de 100 milhões de novas URLs por mês. Em termos de acesso, a leitura é 100 vezes maior que a escrita. Pode seguir com suas dúvidas.  
   ↳ 5/5/4/4 Entrega os dados solicitados sem exagerar.
7. **Candidato**: É... tá bom. Então, são 100 milhões por mês... é muita coisa. Acho que eu... não sei bem por onde começar o desenho. Talvez pelo cliente? Ou pela API?
8. **Totti** (2510 ms): Fique à vontade para começar por onde fizer mais sentido para você. Pode seguir.  
   ↳ 3/4/4/5 Poderia ter ecoado as opções do candidato.
10. **Candidato**: Então, é... eu comecei desenhando os básicos aí no quadro. Coloquei o Cliente, a API e o Banco. Mas não tem muito critério não, só coloquei como eu imagino que funciona... o cliente envia pra API, a API salva no banco.
11. **Totti** (2515 ms): Certo. Como funciona o caminho de um link, desde quando ele é criado até o momento do redirecionamento? Pode seguir com o desenho.  
   ↳ 4/5/4/4 Conduz para o caminho de ponta a ponta.
12. **Candidato**: É... acho que preciso salvar a URL original e a encurtada, né? Posso usar qualquer banco de dados? Ou tem algum que você recomendaria? Eu... não sei muito sobre bancos não.
13. **Totti** (2340 ms): Pode assumir o que for mais razoável para o seu desenho. Pode seguir com a parte do banco.  
   ↳ 5/5/4/5 Desbloqueia sem dar a resposta pronta.
15. **Candidato**: Deixa eu ver aqui... então, acho que o banco vai ter uma tabela. Vou colocar uma coluna pro ID curto, que é tipo um código, e outra pra URL original. Como tem muita leitura, eu... não sei se um banco relacional é o melhor. Talvez um NoSQL? Ou um cache? É, acho que vou desenhar um cache do lado do banco.
16. **Totti** (1924 ms): Tá. Pode seguir com o desenho.  
   ↳ 3/3/4/5 Candidato pensando em voz alta; silêncio ou um aceno seria melhor.
18. **Candidato**: É... então, acho que terminei a primeira parte? Coloquei o cache ali do lado do banco pra ajudar nas leituras. Mas... não sei se tá certo. Acho que esqueci de falar como gera o código curto, né?
19. **Totti** (6230 ms): Tá, olhei: Cliente liga em API. Como você pensou a parte de componentes e fluxo no seu desenho?  
   ↳ 3/3/2/4 Tom robótico de 'olhei o desenho' e pergunta genérica em vez de aprofundar a dúvida manifestada.
20. **Candidato**: É... não sei bem o que mais colocar. Como eu faço a parte de gerar a URL curta? E... também não sei como funciona o redirecionamento na hora de acessar. Acho que tá faltando muita coisa.
21. **Totti** (3085 ms): Tranquilo, deixa isso de lado.  
   ↳ 4/4/4/5 Desbloqueia sem ensinar, mas perde a chance de pivotar para outra parte do fluxo.
23. **Candidato**: É... acho que fica melhor assim. Talvez o banco relacional ainda dê conta se a gente colocar um índice direito, mas não sei se é a melhor escolha.
24. **Totti** (1869 ms): Melhor em que sentido?  
   ↳ 5/5/5/5 Aprofundamento preciso e natural.
25. **Candidato**: É... desculpa, acho que não sei responder direito. Pode pular essa parte? Eu... me perdi um pouco.
26. **Totti** (2017 ms): Tranquilo, deixa isso de lado.  
   ↳ 5/5/3/5 Aceita o pulo corretamente, mas repete a mesma frase de antes.
28. **Candidato**: É... desculpa, acho que me perdi de novo. Tô meio nervoso e não tô lembrando direito o que tem que fazer. Pode me ajudar a voltar no caminho?
29. **Totti** (2412 ms): Tudo bem, respira. O que você desenhou até agora foi o fluxo de criação, com o cliente enviando para a API e ela salvando no banco com um cache.  
   ↳ 5/5/5/4 Acolhe e espelha o progresso sem tomar o controle.

Piores momentos:
- [16] Interrompeu o candidato que estava pensando em voz alta com uma instrução de seguir. → melhor: "Tá."
- [19] Tom robótico e pergunta genérica, ignorando o gancho da geração do código curto. → melhor: "Você mencionou que faltou a geração do código. O que acontece entre a API receber a URL e ela ser salva no banco?"
- [8] Resposta genérica demais quando o candidato pedia um norte por onde começar. → melhor: "Pode começar pelo cliente e a API, se for mais confortável. O importante é mostrar como a URL viaja pelo sistema."

## Conversa: vago_testador

Pareceu pessoa 2 · conduziu bem 3 · inteligência 3. O Totti manteve o candidato focado no desenho e acertou nos aprofundamentos técnicos, mas soou robótico ao repetir uma frase longa e genérica e ao usar respostas mecânicas do tipo 'pode seguir com o desenho'. A recusa de validações foi adequada, embora a fala sobre critérios tenha revelado mais do que deveria.

1. **Candidato**: Então, pra resolver isso, eu normalmente usaria uma arquitetura de microsserviços ou seria mais um monolito? Qual que é o jeito certo de começar a desenhar isso aí?
2. **Totti** (2947 ms): Pode seguir como você achar melhor. O que você pretende desenhar primeiro?  
   ↳ 4/4/4/5 Direcionou bem, mas poderia ter endereçado a dúvida sobre microserviços vs monolito de forma mais direta.
3. **Candidato**: É, tipo, antes de sair desenhando, é bom saber a escala, né? É muito acesso? Pode falar os números?
4. **Totti** (5304 ms): Tem cerca de 100 milhões de novas URLs por mês, o que dá uns 40 por segundo, com picos de 400. Já os acessos, a leitura é 100 vezes maior que a escrita, então são uns 4 mil acessos por segundo, chegando a 40 mil nos picos. Pode seguir com o desenho.  
   ↳ 5/5/4/4 Entregou os números solicitados com clareza.
6. **Candidato**: Então vou começar desenhando, já decidindo que o código vai ter 7 caracteres, é o padrão mesmo. Vou por aqui o cliente, o serviço principal e o banco de dados.
7. **Totti** (2325 ms): Tá. Pode seguir com o desenho.  
   ↳ 3/4/4/5 Deixou passar a escolha dos 7 caracteres sem explorar o porquê.
9. **Candidato**: Aí aqui entre a API e o banco, eu botei um cache Redis. É que a leitura é pesada, né? O padrão é cachear a URL curta pra redirecionar rápido.
10. **Totti** (2055 ms): Por que no Redis?  
   ↳ 5/5/5/5 Aprofundamento preciso e conciso sobre a escolha do Redis.
11. **Candidato**: Ah, antes de falar do Redis, uma coisa. Você lembra quantos caracteres eu falei que ia usar no código? Só pra confirmar.
12. **Totti** (2056 ms): Pode continuar com o desenho.  
   ↳ 4/4/3/5 Evitou validar a resposta do candidato, mas soou um pouco mecânico.
14. **Candidato**: Então, assim, só pra eu me situar, que critérios você tá olhando nesse desenho todo? Tipo, performance, resiliência, essas coisas?
15. **Totti** (2307 ms): O que eu busco é entender como você resolve o problema, como justifica suas escolhas e como reage quando algo muda. Pode seguir com o desenho.  
   ↳ 3/2/2/3 Revelou indiretamente critérios de avaliação e soou como discurso pronto de RH. [vazou_criterio]
17. **Candidato**: Pronto, então aí tá o desenho. É basicamente isso: o cliente chama a API, a API procura no Redis e, se não achar, vai no Postgres.
18. **Totti** (5444 ms): Como você vai garantir que o código de 7 caracteres seja único no Postgres?  
   ↳ 5/5/5/5 Excelente aprofundamento técnico sobre unicidade do código curto.
19. **Candidato**: Ah, isso é padrão, galera usa hash com base 62, tipo, gera e testa no banco. Mas assim, o desenho tá certo, né? Posso seguir?
20. **Totti** (2162 ms): O desenho é seu. O que você pretende detalhar agora?  
   ↳ 5/5/4/5 Recusou validação com naturalidade e devolveu o protagonismo ao candidato.
21. **Candidato**: Entendi. Só pra eu saber, esse desenho tá atendendo o que você esperava até agora? Tô no caminho certo?
22. **Totti** (2371 ms): O que eu busco é entender como você resolve o problema, como justifica suas escolhas e como reage quando algo muda. Pode seguir com o desenho.  
   ↳ 2/1/1/3 Repetiu exatamente a fala anterior de forma robótica, revelando critérios. [robotico_ou_enlatado, vazou_criterio]
24. **Candidato**: Então, o Redis é bom porque ele é rápido, né? Ele fica na memória. Aí quando vem um acesso, a API procura no Redis primeiro. Se tiver lá, já redireciona na hora. Só se não achar que vai no Postgres, que é mais lento, mas é persistente.
25. **Totti** (3274 ms): Certo. E como você lida com a parte de estatísticas de cliques que o problema pede?  
   ↳ 4/5/4/4 Boa transição para o requisito de estatísticas, embora 'Certo' passe perto de validação.
26. **Candidato**: É, antes de entrar nessa parte mais técnica, só uma curiosidade: depois dessa entrevista, como é que fica? Tem feedback, demora quanto tempo pra saber o resultado?
27. **Totti** (2230 ms): Quem cuida do processo dá o retorno depois. Pode seguir com o desenho.  
   ↳ 4/4/4/5 Respondeu a dúvida sobre o processo e reconduziu com naturalidade.

Piores momentos:
- [22] Repetiu exatamente a mesma frase longa da fala 15, soando completamente robótico. → melhor: "Não vou confirmar se está no caminho certo. Pode seguir com o desenho."
- [15] Revelou indiretamente critérios de avaliação com um discurso genérico e longo. → melhor: "Não se preocupa com o que estou olhando. Pode seguir desenhando."
- [12] Resposta seca e mecânica quando o candidato buscou validação. → melhor: "Não vou confirmar isso agora. Pode continuar com o desenho."