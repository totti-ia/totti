/**
 * Estado interno da sessão (só servidor) e a visão de debug que GET /api/state devolve.
 */
import type { AnalystOutput } from "@/lib/agents/analystSchema";
import type { Fase } from "@/lib/agents/fase";
import type { HiddenTestsResult } from "@/lib/agents/hiddenTests";
import type { Blip, FocusArea, InterviewConfig, LineRange, Report, SessionEvent } from "@/lib/contracts";
import type { LlmStatsSnapshot } from "@/lib/llm";
import type { EstadoFechamento } from "@/lib/totti/fechamento";

/**
 * explicar: justificar uma decisão já tomada no código. sondar: perguntar direto sobre um critério
 * (complexidade, bordas) sem insinuar erro. desafio: pedir para melhorar ou resolver um cenário, só com
 * código funcionando. retorno: voltar a um desafio que o candidato topou ("e aí, como foi?").
 * encerramento: a última conversa, quando o candidato pede para finalizar, com o que ficou pendente.
 * empecilho: o Totti traz uma mudança no problema (lib/agents/empecilho.ts); a primeira fala é o anúncio.
 * cola: ele colou um bloco de código de uma vez; o Totti sempre pede para explicar (lib/agents/policy.ts).
 */
/** run_falhou: a fala curta do Totti depois de um run que falhou (lib/agents/policy.ts `enqueueRunFalhou`). */
export type QuestionKind = "explicar" | "sondar" | "desafio" | "retorno" | "encerramento" | "empecilho" | "cola" | "run_falhou";

/** O bloco que o candidato colou, guardado com a pergunta sobre ele. */
export interface Cola {
  /** Linhas coladas, como entraram (para saber se o trecho ainda está no código). */
  trecho: string;
  linhas: number;
  /** O que ele tinha escrito antes de colar (linhas dele, fora o código inicial). Vazio se não tinha nada. */
  antes: string;
  /** A colagem tomou o lugar do que ele vinha escrevendo. */
  substituiu: boolean;
}

/** Como o candidato se saiu ao ser sondado num critério (ou se mostrou sozinho). */
export type ProbeKind = "espontaneo" | "respondeu_bem" | "parcial" | "errou" | "nao_conseguiu" | "com_dica" | "recusou";

export interface ProbeOutcome {
  t: number;
  criterionId: string;
  kind: ProbeKind;
  note: string;
  questionId?: string;
  source: "analyst" | "interviewer";
}

/** Agenda: cada critério da config precisa ser explorado ao menos uma vez. */
export interface CriterionCoverage {
  status: "nao_explorado" | "em_andamento" | "coberto";
  outcomes: ProbeOutcome[];
}

/** Desafio que o candidato topou: o agente volta depois para ver como foi. */
export interface CheckIn {
  id: string;
  /** Id da pergunta de desafio na fila. */
  challengeId: string;
  criterionId?: string;
  /** O que foi pedido ("melhorar a complexidade de tempo"). */
  challenge: string;
  createdAt: number;
  /** Versão do código quando o candidato topou: o retorno espera o código mudar. */
  versionAtStart: number;
  status: "aguardando" | "na_fila" | "feito";
  /** Retorno de um empecilho (não de um desafio): "e aí, como ficou com a mudança?". */
  empecilhoId?: string;
}

/** O empecilho da sessão, desde que virou balão. Um por sessão. */
export interface EmpecilhoState {
  id: string;
  blipId: string;
  raisedAt: number;
  /** Quando o Totti fez o anúncio (primeira fala da conversa). Antes disso, o candidato ainda não sabe. */
  announcedAt?: number;
}

/** Pergunta preparada pelo Analyst, ainda não necessariamente virou blip. */
export interface QueuedQuestion {
  id: string;
  question: string;
  followUpTopic: string;
  /** 2–5 palavras pro balão ("o loop interno"). Nunca revela o erro. */
  topicLabel?: string;
  priority: number; // 0–1
  highlight?: LineRange;
  createdAt: number; // t da sessão
  /** ignored: o balão expirou sem clique. */
  status: "queued" | "blipped" | "asked" | "stale" | "ignored";
  /** Pergunta fixa de abertura ("me conta como pretende resolver"), não vem do Analyst. */
  kickoff?: boolean;
  /** Momento-chave que gerou a pergunta ("primeiro run verde"): tem algo pra falar ali, então ganha passagem. */
  keyMoment?: string;
  /** Pergunta de foco da vaga (pressão, escala, uso de IA): é de processo, sem trecho de código. */
  focusArea?: FocusArea;
  /**
   * A análise que a gerou viu um trecho coerente pronto (função terminada, primeira versão completa): a pergunta pode
   * sair passado o piso entre perguntas. Sem isso, só no teto (ver `motivoDoConteudo` em policy.ts; #130, item 11).
   */
  parteFechada?: boolean;
  /** Candidato clicou "agora não": a pergunta só volta a partir deste t. */
  snoozedUntil?: number;
  /** Critério da config que a pergunta explora. */
  criterionId?: string;
  kind?: QuestionKind;
  /** Pergunta de retorno: o check-in que ela fecha. */
  checkInId?: string;
  /** Cópia de uma pergunta ignorada que voltou para a fila (só volta uma vez). */
  retried?: boolean;
  /** Fase da entrevista quando a pergunta foi criada: mudou de fase, a pergunta perde o sentido. */
  fase?: Fase;
  /** Encerramento: o que ainda falta perguntar, na ordem (perguntas preparadas e critérios não explorados). */
  closingTopics?: string[];
  /** Pergunta sobre um bloco colado (kind "cola"). */
  cola?: Cola;
}

/** Observação pra rubrica, acumulada ao longo da sessão (o Evaluator lê tudo). */
export interface EvidenceNote {
  t: number;
  criterionId: string;
  note: string;
  source: "analyst" | "interviewer";
}

export interface AnalystStatus {
  state: "idle" | "running";
  lastTrigger?: SessionEvent["type"];
  lastRunAt?: number; // t da sessão
  runs: number;
  /** Última análise do LLM (sem as perguntas, que vão pra fila). */
  insights?: Omit<AnalystOutput, "questions">;
  lastError?: string;
  /** Resultado da última tentativa, em português ("2 perguntas, 1 barrada pelo filtro", "pulada: código igual"). */
  lastOutcome?: { t: number; text: string };
  lastDurationMs?: number;
  /** Custo acumulado em US$ reportado pela Featherless. */
  costUsd: number;
}

/** Avaliação final: começa no session_ended e fica guardada na sessão. */
export interface ReportStatus {
  state: "running" | "done" | "error";
  startedAt: number; // Date.now() no servidor
  durationMs?: number;
  report?: Report;
  hiddenTests?: HiddenTestsResult;
  error?: string;
  costUsd: number;
  /** Número de tentativas encadeadas já iniciadas. */
  attempt?: number;
  /** A tentativa automática da reserva já foi consumida. */
  reservaTentada?: boolean;
  /** Critérios omitidos pela tentativa anterior: nova tentativa ocorre no próximo GET. */
  missingCriteria?: string[];
}

export interface CodeVersion {
  t: number;
  version: number;
  language: string;
  code: string;
}

export interface SessionState {
  sessionId: string;
  config: InterviewConfig;
  startedAt: number; // Date.now() no servidor
  events: SessionEvent[];
  codeHistory: CodeVersion[];
  language: string;
  analyst: AnalystStatus;
  queue: QueuedQuestion[];
  blips: Blip[];
  pendingBlipId?: string;
  hintsUsed: number;
  ended: boolean;
  evidence: EvidenceNote[];
  /** Quando a última conversa (blip ou chamada do candidato) terminou, em t da sessão. */
  lastConversationEndedAt?: number;
  /** Quando o candidato avisou que concluiu uma etapa (t da sessão): a próxima análise trata como momento-chave. */
  etapaConcluidaEm?: number;
  coverage: Record<string, CriterionCoverage>;
  checkIns: CheckIn[];
  empecilho?: EmpecilhoState;
  fechamento?: EstadoFechamento;
  /** Código no início do fechamento, usado para detectar retorno à edição. */
  fechamentoCodigoInicial?: string;
  /** Instante da sessão em que o fechamento começou. */
  fechamentoIniciadoEm?: number;
  /** Balão real da conversa de fechamento. */
  fechamentoBlipId?: string;
  /** Quantas etapas o candidato concluiu antes deste turno. */
  conclusoes?: number;
  /** Quando ele disse por último que concluiu uma etapa (t da sessão). Não é consumido pela análise, como `etapaConcluidaEm`. */
  ultimaConclusaoEm?: number;
  /** Quando ele pediu tempo para pensar pela última vez (t da sessão): conta como fala do Totti para a regra da bola (#130, item 7). */
  pediuTempoEm?: number;
  /** O Totti já disse a reação ao pedido de tempo ("Claro, sem pressa."): nas seguintes ele fica calado. */
  reacaoAoPensarDita?: boolean;
  /** Quando o Totti quebrou o silêncio pela última vez (t da sessão): uma vez por período sem ação do candidato (#130, item 6). */
  silencioQuebradoEm?: number;
  report?: ReportStatus;
  /** Relógio da sessão em ms; só a simulação (scripts/simulate.ts) define. Senão, Date.now() - startedAt. */
  clock?: () => number;
}

/** Resposta de GET /api/state?sessionId=... */
export interface SessionStateView {
  sessionId: string;
  configId: string;
  roleTitle: string;
  language: string;
  latestCode: string;
  version: number;
  eventCount: number;
  lastEvent?: { type: SessionEvent["type"]; t: number };
  analyst: AnalystStatus;
  queue: QueuedQuestion[];
  blips: Blip[];
  pendingBlipId?: string;
  hintsUsed: number;
  ended: boolean;
  evidence: EvidenceNote[];
  coverage: Record<string, CriterionCoverage>;
  checkIns: CheckIn[];
  empecilho?: EmpecilhoState;
  /** Estado da avaliação final (o relatório em si sai em GET /api/report). */
  report?: Omit<ReportStatus, "report">;
  /** Estatísticas dos LLMs (Featherless x OpenRouter) desde o start do servidor. */
  llm?: LlmStatsSnapshot;
}
