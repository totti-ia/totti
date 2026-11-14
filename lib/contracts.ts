/**
 * Contratos compartilhados entre a IDE, o agente e a pré-entrevista.
 * Mudou algo aqui? Avisa o time inteiro — todo mundo depende deste arquivo.
 *
 * Tempos (`t`) são sempre milissegundos desde o início da sessão.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuração da entrevista (gerada pela pré-entrevista com a recrutadora)
// ---------------------------------------------------------------------------

export const FocusArea = z.enum([
  "tecnico", // domínio técnico: algoritmo, complexidade, corretude
  "pressao", // como lida com tempo curto, travadas e provocações
  "escala_produto", // pensa em escala, trade-offs e evolução do produto
  "uso_ia", // como usa IA como ferramenta de trabalho
]);
export type FocusArea = z.infer<typeof FocusArea>;

/**
 * Regra aprendida com o Tech Lead da squad (Memória Viva da Squad, `lib/squad-memory/`). Entra nos prompts
 * do entrevistador e do avaliador; o relatório marca o critério que ela afetou como "aprendido com o time".
 */
export const SquadRule = z.object({
  id: z.string(),
  /** "Penaliza over-engineering: reprovou quem propôs Kafka para volume baixo". */
  text: z.string(),
  effect: z.enum(["valoriza", "penaliza"]),
  /** Id do critério que ela afeta (o mesmo de `Criterion.id`, ou um equivalente da rubrica de system design). */
  criterion: z.string(),
});
export type SquadRule = z.infer<typeof SquadRule>;

export const Criterion = z.object({
  id: z.string(),
  name: z.string(),
  /** O que conta como bom nesse critério — vai direto pro prompt do Evaluator. */
  description: z.string(),
  weight: z.number().positive(),
  focus: FocusArea,
});
export type Criterion = z.infer<typeof Criterion>;

/** Formato da entrevista: código na IDE (estilo NeetCode) ou system design no Excalidraw. */
export const InterviewMode = z.enum(["live_coding", "system_design"]);
export type InterviewMode = z.infer<typeof InterviewMode>;

export const InterviewConfig = z.object({
  id: z.string(),
  /**
   * Vaga a que a config pertence (id da vaga no workspace ou `jobPostingId` do Slack), quando é diferente do `id`.
   * Sem valor: a config é a própria vaga, e o `id` vale como id da vaga. As regras da squad só valem na vaga de
   * onde vieram (ver `vagaDaConfig` em `lib/squad-memory/config.ts`).
   */
  vagaId: z.string().optional(),
  mode: InterviewMode.default("live_coding"),
  roleTitle: z.string(),
  /** Descrição da vaga colada pela recrutadora na pré-entrevista. */
  jobDescription: z.string().optional(),
  seniority: z.enum(["junior", "pleno", "senior"]),
  focus: z.array(z.object({ area: FocusArea, weight: z.number().min(0).max(1) })),
  /** Notas livres da recrutadora ("time pequeno, precisa de autonomia"). */
  recruiterNotes: z.string().default(""),
  /** Instruções de como o Totti conduz a entrevista ("redirecione se errar o escopo"). Não entram na nota. */
  conductNotes: z.array(z.string()).optional(),
  /** Tom que a recrutadora pediu. Sem valor = amigável. */
  tone: z.enum(["amigavel", "desafiador"]).optional(),
  /** Política de dicas: livres = todas as do problema; leves = no máximo 1; nenhuma = nenhuma. Sem valor = livres. */
  hints: z.enum(["livres", "leves", "nenhuma"]).optional(),
  criteria: z.array(Criterion).min(1),
  /** Nível das questões, definido pelo agente conforme a vaga (ver `lib/problems.ts`). */
  difficulty: z.enum(["facil", "medio"]).optional(),
  /** Questão escolhida do banco pelo agente; deve ser do nível `difficulty`. */
  problemId: z.string(),
  /**
   * A recrutadora pediu esta questão pelo nome na pré-entrevista: toda entrevista da vaga abre com ela (não há sorteio),
   * e o pedido vence o nível padrão da senioridade (`difficulty` passa a ser o da questão). Sem valor: sorteio.
   */
  problemaFixado: z.boolean().optional(),
  languages: z.array(z.string()).min(1),
  durationMin: z.number().int().positive().default(30),
  /** Regras ativas da squad quando a entrevista começou. Sem valor: nenhuma regra aprendida. */
  squadRules: z.array(SquadRule).optional(),
});
export type InterviewConfig = z.infer<typeof InterviewConfig>;

// ---------------------------------------------------------------------------
// Execução de código (IDE → agente)
// ---------------------------------------------------------------------------

export const RunCase = z.object({
  name: z.string(),
  passed: z.boolean(),
  input: z.string().optional(),
  expected: z.string().optional(),
  got: z.string().optional(),
  error: z.string().optional(),
});

export const RunResult = z.object({
  passed: z.number().int(),
  total: z.number().int(),
  cases: z.array(RunCase),
  stdout: z.string().default(""),
  stderr: z.string().default(""),
  durationMs: z.number(),
});
export type RunResult = z.infer<typeof RunResult>;

// ---------------------------------------------------------------------------
// Empecilho: o problema muda no meio da entrevista (agente → IDE)
// ---------------------------------------------------------------------------

/** requisito: o comportamento pedido muda. caso_novo: entra um tipo de entrada que antes não existia. */
export const EmpecilhoKind = z.enum(["requisito", "caso_novo"]);
export type EmpecilhoKind = z.infer<typeof EmpecilhoKind>;

/**
 * O conceito que o empecilho exige para o candidato se adaptar. Vocabulário fixo de propósito: o relatório
 * de aprendizado (`Report.learning.change`) guarda por ele ("quanto tempo levou para destravar em valores repetidos").
 * Conceito novo? Acrescente aqui e em CONCEITOS_EMPECILHO.
 */
export const ConceitoEmpecilho = z.enum([
  "entrada_vazia", // a entrada pode vir vazia
  "ausencia_de_resposta", // pode não existir solução: devolver um valor combinado
  "dado_invalido", // leituras inválidas no meio dos dados, que precisam ser ignoradas
  "valores_repetidos", // a premissa de valores distintos caiu
  "parametro_fora_do_limite", // um parâmetro pode passar do limite que o código assumia
  "normalizacao_de_entrada", // limpar ou filtrar a entrada antes de processar
  "caso_base", // a recorrência ganha um caso base ou limite novo
  "criterio_de_desempate", // passa a ter várias respostas válidas e uma regra para escolher uma
]);
export type ConceitoEmpecilho = z.infer<typeof ConceitoEmpecilho>;

/** Nome legível de cada conceito (relatório e prompts). */
export const CONCEITOS_EMPECILHO: Record<ConceitoEmpecilho, string> = {
  entrada_vazia: "tratar entrada vazia",
  ausencia_de_resposta: "tratar quando não existe resposta",
  dado_invalido: "ignorar dados inválidos no meio da entrada",
  valores_repetidos: "lidar com valores repetidos",
  parametro_fora_do_limite: "lidar com parâmetro fora do limite esperado",
  normalizacao_de_entrada: "normalizar a entrada antes de processar",
  caso_base: "redefinir o caso base",
  criterio_de_desempate: "escolher entre várias respostas válidas com uma regra de desempate",
};

/** Teste no formato da IDE: argumentos na ordem da assinatura. */
/** Nome dos testes da mudança na IDE e no RunResult ("Mudança: Sem par"). */
export const PREFIXO_TESTE_MUDANCA = "Mudança: ";

export const TesteIde = z.object({ name: z.string(), args: z.array(z.unknown()), expected: z.unknown() });
export type TesteIde = z.infer<typeof TesteIde>;

/** O que a IDE recebe do empecilho quando o agente o anuncia. Os testes só chegam ao navegador nessa hora. */
export const EmpecilhoPublico = z.object({
  id: z.string(),
  kind: EmpecilhoKind,
  concept: ConceitoEmpecilho,
  /** Título curto para o bloco "Mudança" do enunciado ("Pode não existir par"). */
  title: z.string(),
  /** A regra nova, como vai no enunciado. Pode ter `código` entre crases. */
  statement: z.string(),
  /** Testes novos, somados aos visíveis a partir de agora. */
  tests: z.array(TesteIde),
});
export type EmpecilhoPublico = z.infer<typeof EmpecilhoPublico>;

// ---------------------------------------------------------------------------
// Eventos da sessão (IDE → agente, via POST /api/events)
// ---------------------------------------------------------------------------

const base = { sessionId: z.string(), t: z.number().nonnegative() };

export const SessionEvent = z.discriminatedUnion("type", [
  /** Gravado pelo servidor para contabilizar o uso de LLM. */
  z.object({ ...base, type: z.literal("llm_uso"), papel: z.enum(["fala", "filtro", "analise", "relatorio"]), modelo: z.string(), provedor: z.string(), reserva_disparada: z.boolean(), ms: z.number(), tokens_entrada: z.number(), tokens_saida: z.number(), tokens_cache: z.number().optional(), custo_usd: z.number() }),
  z.object({ ...base, type: z.literal("transcricao_uso"), contexto: z.enum(["quadro", "coding", "pre"]), escuta_id: z.string(), audioEnviadoS: z.number(), sessaoS: z.number(), conexoes: z.number().int(), reconexoes: z.number().int(), final: z.boolean() }),
  z.object({ ...base, type: z.literal("voz_uso"), contexto: z.enum(["quadro", "coding", "pre"]), caracteres: z.number().int(), fala_id: z.string().optional() }),
  z.object({ ...base, type: z.literal("voz_descartada"), contexto: z.enum(["quadro", "coding", "pre"]), caracteres: z.number().int(), fala_id: z.string().optional(), motivo: z.enum(["substituida", "cancelada"]) }),
  z.object({ ...base, type: z.literal("session_started"), configId: z.string(), problemId: z.string(), language: z.string() }),
  /** Código inteiro. Mandar ~1,5 s depois de parar de digitar, ou no máximo a cada 5 s. */
  z.object({ ...base, type: z.literal("snapshot"), code: z.string(), version: z.number().int(), language: z.string() }),
  /** Sem digitar há `idleMs` (a IDE manda a partir de 8 s). */
  z.object({ ...base, type: z.literal("pause"), idleMs: z.number() }),
  z.object({ ...base, type: z.literal("run"), result: RunResult }),
  z.object({ ...base, type: z.literal("paste"), chars: z.number().int(), lines: z.number().int(), startLine: z.number().int() }),
  z.object({ ...base, type: z.literal("speech"), role: z.enum(["candidate", "agent"]), text: z.string(), blipId: z.string().optional() }),
  /** O candidato cortou a fala do Totti (#97): falando por cima ou pelo botão/Esc. `heardChars`: até onde ele ouviu. */
  z.object({ ...base, type: z.literal("speech_interrupted"), by: z.enum(["voz", "manual"]), heardChars: z.number().int().nonnegative() }),
  z.object({ ...base, type: z.literal("hint"), level: z.number().int(), text: z.string() }),
  z.object({ ...base, type: z.literal("blip_opened"), blipId: z.string() }),
  z.object({ ...base, type: z.literal("blip_closed"), blipId: z.string(), reason: z.enum(["agent", "button"]) }),
  /** Candidato clicou "agora não" no balão: a pergunta volta mais tarde. */
  z.object({ ...base, type: z.literal("blip_snoozed"), blipId: z.string() }),
  z.object({ ...base, type: z.literal("language_changed"), language: z.string() }),
  /**
   * O agente anunciou um empecilho (o servidor grava, na hora da fala do Totti). `concept` diz o que ele exige:
   * a F2 mede a adaptação a partir daqui (primeiro run com os testes da mudança passando).
   */
  z.object({
    ...base,
    type: z.literal("empecilho"),
    empecilhoId: z.string(),
    kind: EmpecilhoKind,
    concept: ConceitoEmpecilho,
    title: z.string(),
    blipId: z.string(),
    /** Nomes dos testes da mudança, como aparecem em RunResult.cases. */
    testNames: z.array(z.string()),
  }),
  z.object({ ...base, type: z.literal("session_ended"), reason: z.enum(["timeout", "button"]) }),
]);
export type SessionEvent = z.infer<typeof SessionEvent>;
export type SessionEventType = SessionEvent["type"];

// ---------------------------------------------------------------------------
// Blip: o agente tem uma pergunta (agente → IDE)
// ---------------------------------------------------------------------------

export const LineRange = z.object({ startLine: z.number().int(), endLine: z.number().int() });
export type LineRange = z.infer<typeof LineRange>;

export const Blip = z.object({
  id: z.string(),
  /** Texto curto pro balão ("Tenho uma pergunta sobre seu loop"). Nunca a pergunta inteira. */
  preview: z.string(),
  priority: z.number().min(0).max(1),
  createdAt: z.number(),
  highlight: LineRange.optional(),
  /** Balão de empecilho: a IDE abre a conversa sozinha, sem "agora não", e aplica a mudança na tela. */
  empecilho: EmpecilhoPublico.optional(),
  /**
   * A pergunta perde a vez se o candidato falar bastante antes de ela ser feita (ele pode ter explicado aquilo):
   * a IDE a descarta em vez de pedir licença. Retorno, encerramento e mudança no problema não perdem.
   */
  perdeAVez: z.boolean().optional(),
  /**
   * Pergunta que não espera o assunto aberto acabar (ele colou um bloco de código): se o Totti está esperando a
   * resposta de outra pergunta, a IDE fecha aquela e faz esta.
   */
  passaNaFrente: z.boolean().optional(),
});
export type Blip = z.infer<typeof Blip>;

/** Fase do live coding decidida pelo servidor pelos eventos (lib/agents/fase.ts). A IDE só mostra. */
export const FaseDaEntrevista = z.enum(["entendendo", "implementando", "depurando", "funcionando", "otimizando"]);
export type FaseDaEntrevista = z.infer<typeof FaseDaEntrevista>;

/**
 * Resposta de POST /api/events e de GET /api/blip/pending (a IDE consulta a cada ~3 s).
 * `dismissBlipId`: o balão com esse id foi substituído por outro — a IDE deve tirá-lo da tela.
 * `fase`: a fase de verdade da entrevista, para o painel do problema.
 */
export const EventsResponse = z.object({
  blip: Blip.optional(),
  dismissBlipId: z.string().optional(),
  despedida: z.string().optional(),
  fase: FaseDaEntrevista.optional(),
});
export type EventsResponse = z.infer<typeof EventsResponse>;

/** Resposta de GET /api/blip/:id/context — o que a conversa (voz ou texto) recebe ao abrir. */
export const BlipContext = z.object({
  blip: Blip,
  question: z.string(),
  /** Tema pra aprofundar, sem fugir do assunto ("por que fica pesado com entrada grande"). */
  followUpTopic: z.string(),
  /** Dica leve disponível, usada só se o candidato pedir ajuda. */
  availableHint: z.string().optional(),
  numberedCode: z.string(),
  summary: z.string(),
  focus: z.array(FocusArea),
});
export type BlipContext = z.infer<typeof BlipContext>;

// ---------------------------------------------------------------------------
// Conversa por texto (plano B da voz) — POST /api/chat
// ---------------------------------------------------------------------------

export const ChatMessage = z.object({ role: z.enum(["candidate", "agent"]), text: z.string() });
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatRequest = z.object({
  sessionId: z.string(),
  blipId: z.string().optional(),
  messages: z.array(ChatMessage),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

// ---------------------------------------------------------------------------
// Comandos de editor (agente → IDE)
// ---------------------------------------------------------------------------

export const EditorCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("highlight_range"), startLine: z.number().int(), endLine: z.number().int(), note: z.string().optional() }),
  z.object({ type: z.literal("add_inline_note"), line: z.number().int(), text: z.string() }),
  z.object({ type: z.literal("clear_highlights") }),
]);
export type EditorCommand = z.infer<typeof EditorCommand>;

export const ChatResponse = z.object({
  reply: z.string(),
  /** Grifos pra aplicar antes de mostrar/falar a resposta. */
  commands: z.array(EditorCommand),
  /** true quando o agente encerra a conversa ("Beleza, pode seguir!"). */
  end: z.boolean(),
  /** O agente só está ouvindo (o candidato pensa em voz alta ou continua explicando): reply vem "" e nada é falado. */
  listening: z.boolean().optional(),
  fechamento: z.enum(["anuncio", "perguntas_finais", "ultima_palavra", "despedida", "encerrada"]).optional(),
  /** reply é a despedida, que a IDE deve falar antes de encerrar. */
  despedida: z.boolean().optional(),
  /** O candidato concluiu uma etapa: o agente avança (a próxima pergunta já é sobre o que vem depois). */
  concluded: z.boolean().optional(),
});
export type ChatResponse = z.infer<typeof ChatResponse>;

// ---------------------------------------------------------------------------
// Relatório final (agente → tela da recrutadora)
// ---------------------------------------------------------------------------

export const Evidence = z.object({ t: z.number(), text: z.string() });

export const CriterionScore = z.object({
  id: z.string(),
  name: z.string(),
  /** null = critério não explorado na entrevista: fica de fora da média. */
  score: z.number().int().min(1).max(4).nullable(),
  evidence: z.array(Evidence),
  /** Regras da squad que pesaram neste critério: o relatório mostra "critério aprendido com o time". */
  squadRules: z.array(SquadRule).optional(),
});

/**
 * Um momento em que ele travou, medido pelos eventos (não pelo LLM). Mede só os testes do problema original;
 * a mudança (empecilho) tem a medida dela em `Report.learning.change`.
 */
export const StuckEpisode = z.object({
  startedAt: z.number(),
  /** Primeira execução depois disso com mais testes passando que o melhor até ali (ou todos). null = não destravou até o fim. */
  unstuckAt: z.number().nullable(),
  /**
   * falhas_seguidas: duas ou mais execuções seguidas falhando sem passar em mais testes.
   * parado: 2 min ou mais sem mexer no código e sem conversa, com o código ainda falhando.
   */
  cause: z.enum(["falhas_seguidas", "parado"]),
  /** Execuções falhando entre o começo e o destrave (ou o fim). */
  failedRuns: z.number().int(),
  /** Níveis das dicas que ele recebeu enquanto estava travado. Vazio = destravou (ou não) sem dica. */
  hintLevels: z.array(z.number().int()),
});
export type StuckEpisode = z.infer<typeof StuckEpisode>;

export const Report = z.object({
  sessionId: z.string(),
  configId: z.string(),
  roleTitle: z.string(),
  recommendation: z.enum(["avancar", "talvez", "nao_avancar"]),
  /** Média ponderada dos critérios explorados (score não nulo), de 1 a 4. */
  overallScore: z.number().min(1).max(4),
  criteria: z.array(CriterionScore),
  summary: z.string(),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  /** Pontos pra explorar na próxima etapa do processo. */
  nextSteps: z.array(z.string()),
  /** Como ele se adaptou ao empecilho. Só existe se o Totti chegou a anunciar um. Fora da nota geral. */
  adaptation: z
    .object({
      empecilhoId: z.string(),
      kind: EmpecilhoKind,
      concept: ConceitoEmpecilho,
      title: z.string(),
      announcedAt: z.number(),
      /** Primeiro run, depois do anúncio, com todos os testes da mudança passando. null = não chegou lá. */
      adaptedAt: z.number().nullable(),
      /** Testes da mudança rodados no servidor ao fim (visíveis + escondidos dela). */
      testsPassed: z.number().int(),
      testsTotal: z.number().int(),
      /** null = não deu para observar (ex.: anunciado no último minuto). */
      score: z.number().int().min(1).max(4).nullable(),
      evidence: z.array(Evidence),
    })
    .optional(),
  /**
   * Como ele pensa e aprende: que dica precisou, quanto levou para destravar e como reagiu à mudança.
   * Só no live coding. Fatos medidos pelos eventos; o LLM só dá a nota e as evidências. Fora da nota geral.
   */
  learning: z
    .object({
      hints: z.array(
        z.object({
          t: z.number(),
          level: z.number().int(),
          text: z.string(),
          /** O código já passava nos testes visíveis quando a dica veio (ex.: desafio de otimização): o avanço não se mede pelos testes. */
          codePassing: z.boolean(),
          /** Primeira execução depois da dica com mais testes passando que antes dela (ou todos). null = não avançou (ou codePassing). */
          unstuckAt: z.number().nullable(),
          /** Execuções entre a dica e o avanço (ou o fim). */
          runsAfter: z.number().int(),
        }),
      ),
      /** Quantas dicas a política da vaga deixava dar nesta questão. */
      hintsAvailable: z.number().int(),
      stuck: z.array(StuckEpisode),
      /** Reação à mudança no problema, quando o Totti anunciou uma. */
      change: z
        .object({
          concept: ConceitoEmpecilho,
          announcedAt: z.number(),
          /** Primeiro run com todos os testes da mudança passando (o mesmo de `adaptation.adaptedAt`). */
          adaptedAt: z.number().nullable(),
          /** Execuções depois do anúncio que não passaram nos testes da mudança, até adaptar (ou até o fim). */
          failedAttempts: z.number().int(),
          /** Dicas recebidas entre o anúncio e a adaptação (ou o fim). */
          hintsUsed: z.number().int(),
          /** Quantas vezes ele falou na conversa da mudança (tirar dúvida conta a favor). */
          conversationTurns: z.number().int(),
        })
        .optional(),
      /** null = não houve momento de aprendizado para observar (não travou, sem dica e sem mudança). */
      score: z.number().int().min(1).max(4).nullable(),
      evidence: z.array(Evidence),
    })
    .optional(),
  signals: z.object({
    testsPassed: z.number().int(),
    testsTotal: z.number().int(),
    hintsUsed: z.number().int(),
    pastes: z.number().int(),
    durationMs: z.number(),
  }),
});
export type Report = z.infer<typeof Report>;

// ---------------------------------------------------------------------------
// Gravação da sessão: o que o relatório usa para mostrar cada prova no minuto em que aconteceu
// ---------------------------------------------------------------------------

/**
 * GET /api/report/gravacao?sessionId=... — versões do código, falas, execuções e marcos (dica, colagem,
 * mudança no problema), todos no mesmo relógio das evidências (`t`, ms desde o início). Fica salva em disco
 * junto com o relatório.
 */
export const Gravacao = z.object({
  sessionId: z.string(),
  durationMs: z.number(),
  /** Uma entrada por versão diferente do código, em ordem de tempo. */
  codigo: z.array(z.object({ t: z.number(), language: z.string(), code: z.string() })),
  falas: z.array(z.object({ t: z.number(), role: z.enum(["candidate", "agent"]), text: z.string() })),
  execucoes: z.array(z.object({ t: z.number(), passed: z.number().int(), total: z.number().int() })),
  /** Acontecimentos curtos para dar contexto ("recebeu uma dica", "colou 12 linhas"). */
  marcos: z.array(
    z.object({
      t: z.number(),
      text: z.string(),
      /** Para o gráfico escolher o ícone. Opcional: relatórios salvos antes não têm. */
      tipo: z.enum(["dica", "colagem", "mudanca", "linguagem", "adiou"]).optional(),
    }),
  ),
});
export type Gravacao = z.infer<typeof Gravacao>;

// ---------------------------------------------------------------------------
// Silêncio do candidato (quadro e cérebro precisam concordar: o quadro dispara a análise,
// o prompt do cérebro diz ao modelo o que conta como silêncio). Provisório, para os testes.
// ---------------------------------------------------------------------------

/** Silêncio total (sem desenhar, digitar nem falar) a partir do qual o agente pode quebrá-lo. */
export const SILENCIO_S = 8;
/**
 * Idem no começo (fase REQUISITOS), contado a partir do fim da apresentação. É só a reserva: a primeira pergunta
 * normal vem da análise do desenho, depois que ele começa a desenhar. Com 15 s o Totti perguntava "como você está
 * pensando?" com o candidato ainda lendo o enunciado; num tempo fixo curto, ele podia não ter ideia nenhuma ainda.
 */
export const SILENCIO_INICIAL_S = 120;
/**
 * Em REQUISITOS, depois de o Totti responder uma dúvida dele: o silêncio que devolve a vez ao Totti. Mais curto que o
 * inicial (ali ele já leu o enunciado e está conversando).
 */
export const SILENCIO_REQUISITOS_S = 15;
/** Se o silêncio continua depois de uma análise, o quadro volta a perguntar ao modelo a cada tanto. */
export const SILENCIO_REPETIR_S = 30;
/**
 * Depois de uma fala do Totti, quanto tempo de silêncio total (sem o candidato desenhar nem falar) até ele poder
 * falar de novo. A bola é do candidato: antes disso, só ele a devolve. Vale em todas as fases e cada quebra de
 * silêncio acontece uma vez por período de silêncio (ver `deveForcarAnalise` em lib/sessao/silencio.ts).
 */
export const SILENCIO_SEM_ACAO_S = 60;

// ---------------------------------------------------------------------------
// Ritmo das perguntas do agente: vem da política comum de interrupção (lib/interrupcao/politica.ts), a mesma no
// quadro (navegador e servidor) e no live coding, escalada pela duração da entrevista.
// ---------------------------------------------------------------------------

/**
 * Prazo de uma análise do desenho, no quadro e no servidor. A análise roda em segundo plano e a pergunta ainda espera
 * a pausa do candidato, então vale mais esperar a resposta do que perdê-la: com 8 s, numa entrevista real 7 de 21
 * análises estouraram o prazo, todas com o candidato desenhando, e ele ficou minutos sem ouvir pergunta.
 */
export const PRAZO_ANALISE_DO_DESENHO_MS = 15_000;
