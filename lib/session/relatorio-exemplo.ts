/**
 * Relatório de exemplo de live coding (só fora de produção, em `/report?sessionId=exemplo`): serve para revisar
 * o relatório e tirar imagens para o pitch sem fazer uma entrevista inteira. Dados inventados.
 *
 * As regras da squad não são fixas: saem da Memória Viva da Squad no momento em que a página abre, do mesmo jeito
 * que o avaliador faria se a entrevista terminasse agora. Como uma regra só vale na vaga de onde veio, entram só as
 * da vaga desta entrevista: a Backend Pleno da config padrão (`DEFAULT_CONFIG.vagaId`, a vaga da demo).
 */
import { DEFAULT_CONFIG } from "@/lib/config/default";
import type { Gravacao, Report } from "@/lib/contracts";
import { INTEGRIDADE_EXEMPLO } from "@/lib/integridade/exemplo";
import { regrasDaVaga, vagaDaConfig } from "@/lib/squad-memory/config";
import { regrasDoCriterio } from "@/lib/squad-memory/prompt";

export const ID_EXEMPLO = "exemplo";

/** O exemplo vale também em produção (demo); desliga com DESATIVAR_RELATORIO_EXEMPLO=1. */
export function exemploHabilitado(sessionId: string | null): boolean {
  return sessionId === ID_EXEMPLO && process.env.DESATIVAR_RELATORIO_EXEMPLO !== "1";
}

const min = (m: number, s = 0) => (m * 60 + s) * 1000;

const BASE: Report = {
  sessionId: ID_EXEMPLO,
  configId: ID_EXEMPLO,
  roleTitle: "Desenvolvedor(a) Backend Pleno",
  recommendation: "avancar",
  overallScore: 3.3,
  criteria: [
    {
      id: "abordagem",
      name: "Entendimento e abordagem",
      score: 4,
      evidence: [
        { t: min(0, 45), text: "Antes de codar, perguntou se sempre existe resposta e se os números podem repetir." },
        { t: min(2, 30), text: "Explicou o plano: guardar cada número num dicionário com o índice e procurar o complemento." },
      ],
    },
    {
      id: "complexidade",
      name: "Complexidade",
      score: 3,
      evidence: [
        { t: min(2, 30), text: "Disse que a força bruta é O(n²) e que o dicionário deixa em O(n) de tempo e O(n) de memória." },
      ],
    },
    {
      id: "corretude",
      name: "Corretude e código",
      score: 4,
      evidence: [
        { t: min(7, 30), text: "Corrigiu a ordem de inserção no dicionário depois do primeiro teste falhar e passou em todos." },
        { t: min(31, 0), text: "Passou em 9 de 10 testes escondidos; o que falhou foi o caso grande com números negativos." },
      ],
    },
    {
      id: "bordas",
      name: "Casos de borda",
      score: 3,
      evidence: [{ t: min(9, 20), text: "Citou a lista vazia quando o Totti perguntou, mas não escreveu um teste para ela." }],
    },
    {
      id: "comunicacao",
      name: "Comunicação e resposta a dicas",
      score: 3,
      evidence: [
        { t: min(15, 30), text: "Usou a dica sem pedir a resposta: voltou ao fim do laço e achou o retorno que faltava." },
        { t: min(20, 10), text: "Narrou o que ia testar antes de rodar e resumiu o que mudou no código." },
      ],
    },
    {
      id: "pressao_adaptacao",
      name: "Pressão e adaptação",
      score: 3,
      evidence: [
        { t: min(15, 10), text: "Com o teste da mudança falhando, disse o que ia olhar primeiro e não reescreveu tudo." },
      ],
    },
  ],
  summary:
    "Entendeu o problema antes de codar e chegou na solução O(n) com o dicionário, explicando o custo. Adaptou-se à mudança em menos de 3 minutos, com uma dica. Ponto de atenção: cita casos de borda, mas não os transforma em teste sem ser provocada.",
  strengths: [
    "Perguntou sobre repetição e ausência de resposta antes de escrever código.",
    "Explicou a troca de O(n²) para O(n) e o custo de memória.",
    "Usou a dica como pista, sem pedir a resposta pronta.",
  ],
  concerns: ["Citou a lista vazia, mas não escreveu o teste.", "Falhou no teste escondido grande com números negativos."],
  nextSteps: [
    "Pedir para escrever os testes de borda antes de codar a próxima solução.",
    "Explorar como ela depura um teste grande que falha.",
  ],
  adaptation: {
    empecilhoId: "two-sum-sem-resposta",
    kind: "requisito",
    concept: "ausencia_de_resposta",
    title: "Pode não existir par: devolva [-1, -1]",
    announcedAt: min(14, 0),
    adaptedAt: min(16, 40),
    testsPassed: 3,
    testsTotal: 3,
    score: 3,
    evidence: [
      {
        t: min(16, 40),
        text: "Acrescentou o retorno [-1, -1] no fim do laço e os testes da mudança passaram sem quebrar os antigos.",
      },
    ],
  },
  learning: {
    hints: [
      {
        t: min(15, 30),
        level: 1,
        text: "O que a função devolve hoje quando o laço termina sem achar o par?",
        codePassing: false,
        unstuckAt: min(16, 40),
        runsAfter: 1,
      },
    ],
    hintsAvailable: 2,
    stuck: [],
    change: {
      concept: "ausencia_de_resposta",
      announcedAt: min(14, 0),
      adaptedAt: min(16, 40),
      failedAttempts: 1,
      hintsUsed: 1,
      conversationTurns: 2,
    },
    score: 3,
    evidence: [{ t: min(15, 30), text: "Com a dica de nível 1, destravou em pouco mais de um minuto e numa execução só." }],
  },
  signals: { testsPassed: 9, testsTotal: 10, hintsUsed: 1, pastes: 0, durationMs: min(32, 0) },
};

const CODIGO_INICIAL = `def two_sum(nums: list[int], target: int) -> list[int]:
    pass
`;

const CODIGO_COM_BUG = `def two_sum(nums: list[int], target: int) -> list[int]:
    vistos = {}
    for i, n in enumerate(nums):
        vistos[n] = i
        if target - n in vistos:
            return [vistos[target - n], i]
`;

const CODIGO_CERTO = `def two_sum(nums: list[int], target: int) -> list[int]:
    vistos = {}
    for i, n in enumerate(nums):
        if target - n in vistos:
            return [vistos[target - n], i]
        vistos[n] = i
`;

const CODIGO_ADAPTADO = `def two_sum(nums: list[int], target: int) -> list[int]:
    vistos = {}
    for i, n in enumerate(nums):
        if target - n in vistos:
            return [vistos[target - n], i]
        vistos[n] = i
    return [-1, -1]
`;

export const GRAVACAO_EXEMPLO: Gravacao = {
  integridade: INTEGRIDADE_EXEMPLO,
  sessionId: ID_EXEMPLO,
  durationMs: min(32, 0),
  codigo: [
    { t: 0, language: "python", code: CODIGO_INICIAL },
    { t: min(6, 10), language: "python", code: CODIGO_COM_BUG },
    { t: min(7, 20), language: "python", code: CODIGO_CERTO },
    { t: min(16, 20), language: "python", code: CODIGO_ADAPTADO },
  ],
  falas: [
    { t: min(0, 20), role: "agent", text: "Oi! Hoje é o Two Sum. Pode pensar em voz alta, eu vou acompanhando." },
    { t: min(0, 45), role: "candidate", text: "Antes de codar: sempre existe resposta? E os números podem repetir?" },
    { t: min(1, 5), role: "agent", text: "Por enquanto, sempre existe exatamente uma resposta. Pode haver repetidos." },
    {
      t: min(2, 30),
      role: "candidate",
      text: "Força bruta seria O(n²). Vou guardar cada número num dicionário com o índice e procurar o complemento: fica O(n).",
    },
    { t: min(9, 0), role: "agent", text: "E se a lista vier vazia?" },
    { t: min(9, 20), role: "candidate", text: "Com lista vazia o laço nem roda. Dá para cobrir, sim." },
    { t: min(14, 0), role: "agent", text: "Mudou o requisito: agora pode não existir par. Nesse caso, devolva [-1, -1]." },
    { t: min(15, 10), role: "candidate", text: "Tá, o teste novo quebrou. Vou olhar primeiro o que sai quando não acha." },
    { t: min(15, 30), role: "agent", text: "O que a função devolve hoje quando o laço termina sem achar o par?" },
    { t: min(15, 50), role: "candidate", text: "Ah, devolve None. Falta o retorno depois do laço." },
    {
      t: min(20, 10),
      role: "candidate",
      text: "Vou rodar de novo com um caso de repetidos, o [3, 3] com alvo 6, para garantir.",
    },
  ],
  execucoes: [
    { t: min(6, 40), passed: 3, total: 4 },
    { t: min(7, 30), passed: 4, total: 4 },
    { t: min(15, 0), passed: 5, total: 7 },
    { t: min(16, 40), passed: 7, total: 7 },
    { t: min(20, 30), passed: 7, total: 7 },
  ],
  marcos: [
    { t: min(14, 0), text: "Mudança no problema: pode não existir par", tipo: "mudanca" },
    { t: min(15, 30), text: "Recebeu uma dica (nível 1)", tipo: "dica" },
  ],
};

/** O relatório de exemplo, com as regras da vaga que estão ativas agora em cada critério com nota. */
export function relatorioExemplo(): Report {
  const regras = regrasDaVaga(vagaDaConfig(DEFAULT_CONFIG));
  return {
    ...BASE,
    criteria: BASE.criteria.map((c) => {
      const daqui = c.score === null ? [] : regrasDoCriterio(regras, c.id);
      return daqui.length ? { ...c, squadRules: daqui } : c;
    }),
  };
}
