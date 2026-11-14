// Relatório de exemplo (só em desenvolvimento, em /relatorio/exemplo): para revisar o visual e tirar
// imagens para o pitch sem precisar rodar uma entrevista inteira. Dados inventados.
import type { RelatorioVisto } from "./relatorio";

export const RELATORIO_EXEMPLO: RelatorioVisto = {
  sessaoId: "exemplo",
  candidatoId: "Marina Duarte",
  area: "system design",
  problema: "Encurtador de URL",
  enunciado:
    "Projete um serviço como o bit.ly: recebe uma URL longa e devolve uma curta. Quem acessa a curta é redirecionado. No quadro, mostre a arquitetura de ponta a ponta: as peças do sistema (clientes, serviços, bancos de dados, filas), como elas se ligam e o caminho de um link, da criação até o redirecionamento. Não precisa desenhar telas.",
  realizadaEm: "7 de novembro, 15:02",
  duracao: "34 min",
  perguntas: 4,
  notaGeral: 2.8,
  recomendacao: "avancar_com_ressalvas",
  criterios: [
    {
      id: "requisitos",
      nome: "Levantamento de requisitos",
      nota: 4,
      significado: "Pergunta escala, latência e retenção antes de desenhar e usa as respostas nas escolhas.",
      justificativa:
        "Antes de desenhar, perguntou a escala de leitura e por quanto tempo os links ficam guardados. Usou a proporção de 100 leituras por escrita para justificar o cache mais tarde.",
      provas: [
        { tipo: "fala", momento: "01:12", texto: "Antes de desenhar: quantos acessos por segundo a gente espera, e é mais leitura ou escrita?" },
        { tipo: "fala", momento: "01:40", texto: "Os links expiram ou ficam para sempre?" },
      ],
    },
    {
      id: "componentes_fluxo",
      nome: "Componentes e fluxo",
      nota: 3,
      significado: "Os componentes principais estão lá e o fluxo de ponta a ponta faz sentido.",
      justificativa:
        "Desenhou cliente, API, gerador de códigos e banco, com o caminho do redirecionamento separado do de criação. Faltou explicar o que acontece quando o código não existe.",
      provas: [{ tipo: "desenho", momento: "06:30", elementos: ["Cliente", "API", "Gerador de código", "Postgres"], imagem: null, observacao: "leitura e criação em caminhos separados" }],
    },
    {
      id: "escalabilidade",
      nome: "Escalabilidade",
      nota: 2,
      significado: "Reconhece o gargalo quando provocado, mas a solução fica vaga.",
      justificativa:
        "O banco único só foi questionado depois da pergunta do entrevistador. A resposta trouxe um cache, sem dizer o que vai nele nem como é invalidado.",
      aprendidoComOTime: [{ texto: "Penaliza quem escolhe o banco sem estimar o volume de escrita", efeito: "penaliza", origem: "vaga" }],
      provas: [
        { tipo: "desenho", momento: "12:05", elementos: ["Postgres"], imagem: null, observacao: "banco único, sem cache, recebendo toda a leitura" },
        { tipo: "fala", momento: "13:20", texto: "Dá para colocar um Redis na frente... guardando os mais acessados." },
      ],
    },
    {
      id: "dados_consistencia",
      nome: "Dados e consistência",
      nota: 3,
      significado: "Escolhe o modelo de dados com justificativa e trata colisão.",
      justificativa: "Explicou a geração de códigos em base62 a partir de um contador, o que evita colisão sem consultar o banco.",
      provas: [{ tipo: "fala", momento: "09:48", texto: "uso um contador e converto para base62, aí nunca repete" }],
    },
    {
      id: "tradeoffs",
      nome: "Trade-offs",
      nota: null,
      significado: null,
      justificativa: "Sem evidência suficiente para atribuir nota a este critério.",
      provas: [],
    },
    {
      id: "comunicacao",
      nome: "Comunicação",
      nota: 3,
      significado: "Explica o raciocínio enquanto desenha e responde de forma direta.",
      justificativa: "Narrou as decisões enquanto desenhava e respondeu às perguntas sem rodeios.",
      provas: [{ tipo: "fala", momento: "05:10", texto: "vou separar a leitura da escrita porque o volume é muito diferente" }],
    },
  ],
  pontosFortes: [
    "Levantou requisitos antes de desenhar, sem ser provocada.",
    "Geração de código sem colisão, bem justificada.",
  ],
  pontosAAprofundar: [
    "Estratégia de cache: o que entra, por quanto tempo e como invalida.",
    "Trade-offs não apareceram: vale perguntar consistência × disponibilidade.",
  ],
  resumoDaSolucao:
    "Um encurtador com API de criação e redirecionamento. Os links ficam num banco relacional, e a leitura passa por um cache na frente do banco. A geração do código é um contador com codificação em base 62.",
  resumoDaEntrevista:
    "Levantou os requisitos antes de desenhar e explicou as decisões enquanto desenhava. Faltou estimar o volume de leituras e comparar consistência com disponibilidade. Na mudança de 10x no volume, foi direto ao banco e à réplica de leitura, mas não revisou o cache.",
  briefing:
    "Boa base e ótimo levantamento de requisitos. Na próxima conversa, aprofunde cache e trade-offs de consistência: foi onde ela precisou de ajuda.",
  desenhoFinal: null,
  provasConferidas: 7,
  ajustes: ["evidência de fala descartada em tradeoffs: citação não encontrada", "nota de tradeoffs removida: sem evidência"],
  demonstracao: true,
  adaptacao: {
    mudanca: "Mudança: volume 10x (1 bilhão de URLs/mês)",
    momento: "18:40",
    nota: 3,
    significado: "Achou onde a mudança pega no desenho, ajustou essa parte e explicou o impacto",
    justificativa:
      "Foi direto ao banco: dividiu os links por faixa de código e acrescentou réplicas de leitura. Refez a conta do código curto, mas não revisou o que acontece com o cache com dez vezes mais acessos.",
    provas: [
      { tipo: "fala", momento: "19:05", texto: "Com dez vezes mais escrita, um banco só não aguenta: vou dividir os links pelo começo do código." },
      { tipo: "fala", momento: "20:10", texto: "Sete caracteres ainda dão conta, são uns três trilhões de combinações." },
    ],
    desenhosDepois: 3,
    falasDepois: 5,
  },
  eliminatorios: [
    {
      regra: "Cobrar o cliente duas vezes",
      status: "atendida",
      justificativa: "Explicou que a gravação usa uma chave de idempotência, então uma nova tentativa não cobra de novo.",
      provas: [{ tipo: "fala", momento: "21:10", texto: "Se der timeout, eu tento de novo com a mesma chave, aí não cobra duas vezes." }],
    },
  ],
};

const SEM_PROVA = "Sem evidência suficiente para atribuir nota a este critério.";
const semProva = (id: string, nome: string) => ({ id, nome, nota: null, significado: null, justificativa: SEM_PROVA, provas: [] });

/**
 * Caso da issue #89 (só em desenvolvimento, em /relatorio/exemplo-encerrado): entrevista de 15 min encerrada pelo
 * candidato aos 8 min, 2 de 6 critérios com prova. Mostra como o relatório trata a falha do entrevistador e a
 * entrevista curta: nada de culpa, recomendação "evidência insuficiente" e "o que faltou" com fatos.
 */
export const RELATORIO_EXEMPLO_ENCERRADO: RelatorioVisto = {
  ...RELATORIO_EXEMPLO,
  sessaoId: "exemplo-encerrado",
  candidatoId: "Rafael Nunes",
  duracao: "8 min",
  perguntas: 2,
  notaGeral: 2,
  recomendacao: "evidencia_insuficiente",
  criterios: [
    {
      id: "requisitos",
      nome: "Requisitos e escopo",
      nota: 2,
      significado: "Perguntou pouco, esqueceu a escala",
      justificativa: "Pediu o volume antes de desenhar e usou o número combinado no quadro; não perguntou sobre retenção nem latência.",
      provas: [{ tipo: "fala", momento: "01:12", texto: "Me fala um pouco do volume, então." }],
    },
    {
      id: "componentes_fluxo",
      nome: "Componentes e fluxo",
      nota: 2,
      significado: "Os componentes estão lá, mas o fluxo fica solto",
      justificativa: "Desenhou API, banco e cache e ligou cliente, API e banco; o cache ficou sem ligação.",
      provas: [{ tipo: "desenho", momento: "04:00", elementos: ["API", "Postgres"], imagem: null, observacao: null }],
    },
    semProva("escalabilidade", "Escalabilidade"),
    semProva("dados_consistencia", "Dados e consistência"),
    semProva("tradeoffs", "Trade-offs"),
    semProva("comunicacao", "Comunicação"),
  ],
  pontosFortes: [],
  pontosAAprofundar: [
    "Escalabilidade: sem prova nesta entrevista. Sinal esperado que não apareceu: o candidato falar de pico de acesso e de crescimento.",
    "Dados e consistência: sem prova nesta entrevista; vale perguntar diretamente sobre isso.",
    "Trade-offs: sem prova nesta entrevista; vale perguntar diretamente sobre isso.",
    "Comunicação: não houve fala do candidato explicando ou respondendo algo de conteúdo; vale ouvi-lo explicar a solução.",
  ],
  resumoDaSolucao: "API na frente de um Postgres, com um cache para a leitura.",
  resumoDaEntrevista: "Houve prova em 2 de 6 critérios: Requisitos e escopo (2 de 4), Componentes e fluxo (2 de 4). A entrevista durou 8 de 15 minutos; 4 de 6 critérios ficaram sem prova.",
  briefing:
    "Sem evidência suficiente para recomendar avançar ou não avançar. A entrevista durou 8 de 15 minutos; 4 de 6 critérios ficaram sem prova. Sem prova: Escalabilidade, Dados e consistência, Trade-offs, Comunicação. Vale cobrir esses pontos na próxima conversa.",
  provasConferidas: 2,
  ajustes: [
    "evidência de fala descartada em Comunicação: pedido de repetição ou esclarecimento não é prova",
    "nota de Comunicação removida: sem evidência",
    "menos da metade dos critérios com evidência: recomendação neutra",
  ],
  adaptacao: null,
};

/** Entrevista inteira e 4 de 6 critérios com prova e nota baixa: "Não avançar" vale (/relatorio/exemplo-nao-avancar). */
export const RELATORIO_EXEMPLO_NAO_AVANCAR: RelatorioVisto = {
  ...RELATORIO_EXEMPLO_ENCERRADO,
  sessaoId: "exemplo-nao-avancar",
  duracao: "14 min",
  notaGeral: 1.5,
  recomendacao: "nao_avancar",
  criterios: [
    RELATORIO_EXEMPLO_ENCERRADO.criterios[0],
    RELATORIO_EXEMPLO_ENCERRADO.criterios[1],
    {
      id: "escalabilidade",
      nome: "Escalabilidade",
      nota: 1,
      significado: "Não considerou carga",
      justificativa: "Disse que um servidor aguenta qualquer quantidade de acessos, sem estimar o volume.",
      provas: [{ tipo: "fala", momento: "10:05", texto: "Um servidor deve aguentar qualquer quantidade." }],
    },
    semProva("dados_consistencia", "Dados e consistência"),
    {
      id: "tradeoffs",
      nome: "Trade-offs",
      nota: 1,
      significado: "Não justifica escolhas",
      justificativa: "Escolheu o banco sem comparar com outra opção.",
      provas: [{ tipo: "fala", momento: "11:30", texto: "Escolhi o banco porque gosto dele." }],
    },
    semProva("comunicacao", "Comunicação"),
  ],
  pontosAAprofundar: [
    "Dados e consistência: sem prova nesta entrevista; vale perguntar diretamente sobre isso.",
    "Comunicação: não houve fala do candidato explicando ou respondendo algo de conteúdo; vale ouvi-lo explicar a solução.",
  ],
  resumoDaEntrevista: "Houve prova em 4 de 6 critérios: Requisitos e escopo (2 de 4), Componentes e fluxo (2 de 4), Escalabilidade (1 de 4), Trade-offs (1 de 4). A entrevista durou 14 de 15 minutos; 2 de 6 critérios ficaram sem prova.",
  briefing:
    "A entrevista durou 14 de 15 minutos; 2 de 6 critérios ficaram sem prova. Sem prova: Dados e consistência, Comunicação. As notas baixas em Escalabilidade e Trade-offs se apoiam em falas do próprio candidato.",
  provasConferidas: 4,
  ajustes: [],
};
