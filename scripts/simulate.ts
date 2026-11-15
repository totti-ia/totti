/**
 * Entrevistas simuladas, do início ao relatório, sem a IDE. Mede o agente antes e depois de mexer nos prompts.
 * O código de cada perfil é roteirizado; as falas do candidato vêm de um LLM com a persona.
 * Uso: npx tsx scripts/simulate.ts [--only otimiza,trava] [--out sim-runs] [--config config.json] [--duracao 30]
 *      [--linha-do-tempo]
 * Com --config, a entrevista usa o JSON dado (mesma normalização do /api/events) em vez do DEFAULT_CONFIG.
 * --linha-do-tempo: conta as interrupções (balões) e mostra quando e em que momento cada uma apareceu; pula o
 * relatório (economiza a chamada do avaliador). A persona "constante" (30 min de trabalho contínuo) é a feita para isso.
 */
import "./_gasto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { runAnalyst } from "@/lib/agents/analyst";
import { buildAnalystUser } from "@/lib/agents/prompts/analyst";
import { startEvaluation, waitForEvaluation } from "@/lib/agents/evaluator";
import { runInterviewerTurn } from "@/lib/agents/interviewer";
import { faseDaEntrevista } from "@/lib/agents/fase";
import { resumoDoCusto } from "./custo";
import { disparaAnalise } from "@/lib/agents/gatilhos";
import { allPassed, decideBlip, enqueueCola, enqueueKickoff, estadoDaBola, lastBlipDecision, motivoDoConteudo, ritmoDaSessao } from "@/lib/agents/policy";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import { normalizarConfig } from "@/lib/config/store";
import { type Blip, type ChatMessage, InterviewConfig, type Report, type SessionEvent } from "@/lib/contracts";
import { runPythonTests } from "@/lib/execution/python";
import { formatMs } from "@/lib/format";
import { completeJson } from "@/lib/llm";
import { problems as IDE_PROBLEMS } from "@/lib/problems";
import { appendEvent, getOrCreateSession } from "@/lib/session/store";
import type { SessionState } from "@/lib/session/types";
import { imprimirMedicao140, type ResultadoMedicao140 } from "./linha-do-tempo-quadro";
import { motivoDoRitmo, RITMO, RITMO_IDE } from "@/lib/interrupcao/politica";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventInput = DistributiveOmit<SessionEvent, "sessionId" | "t">;

/** Configuração usada em todas as sessões simuladas: DEFAULT_CONFIG, ou o JSON de --config. */
let CONFIG: InterviewConfig = DEFAULT_CONFIG;
/** Duração do relógio simulado: 15 min, ou `CONFIG.durationMin` com --config. */
let DURATION_MIN = 15;
/** --linha-do-tempo: conta e mostra as interrupções, sem gerar o relatório. */
let LINHA_DO_TEMPO = false;
/** --com-relatorio: no modo linha do tempo, gera o relatório também (para medir o custo inteiro da entrevista). */
let COM_RELATORIO = false;
/** O relatório roda testes escondidos em Python: se travar, a simulação segue sem ele. */
const PRAZO_RELATORIO_MS = 4 * 60_000;
const TICK_MS = 1_000;
const PAUSE_MS = 8_000;
/** Cada fala (do candidato ou do agente) "custa" esse tempo de sessão. */
const TURN_MS = 15_000;
const MAX_TURNS = 8;

/** Modelo falso e candidato contínuo para medir os filtros reais da IDE sem rede. */
export function medirOfflineIde(): ResultadoMedicao140 {
  const duracao = 30 * 60_000;
  const criterios = CONFIG.criteria.map((c) => c.id);
  const session = getOrCreateSession(`medicao-140-${Date.now()}`, { ...CONFIG, durationMin: 30 });
  const tempos: number[] = [];
  const ganchos: string[] = [];
  const criteriosPerguntados: string[] = [];
  const provocados = new Set<string>();
  // Cada análise acompanha uma escolha visível no código contínuo; os testes de política cobrem o caso sem gancho.
  const tipos = ["decisao", "raciocinio", "parte_fechada"] as const;
  let maiorIntervaloComLacunaS = 0;
  let falaAte = -1;
  let ultimaFalaAgente: number | undefined;
  let duranteFalaOuTraco = 0;
  const motivosDaEspera: string[] = [];
  const contagemDeBloqueios = new Map<string, number>();
  let motivoAnterior = "a análise ainda não pediu uma pergunta";
  let analisesDoModelo = 0;
  for (let t = 1_000, passo = 0; t < duracao * 0.8; t += TICK_MS, passo++) {
    // O candidato digita por 9 s e pausa por 5 s; snapshots só chegam enquanto ele está trabalhando.
    const ciclo = t % 14_000;
    const emTraco = ciclo < 9_000;
    const paradoHaS = emTraco ? 0 : Math.floor((ciclo - 9_000) / 1_000);
    if (emTraco) session.events.push({ type: "snapshot", sessionId: session.sessionId, t, code: `linha ${passo}`, language: "python", version: passo });
    if (ultimaFalaAgente !== undefined && !session.events.some((e) => e.type === "speech" && e.role === "agent" && e.t === ultimaFalaAgente)) {
      session.events.push({ type: "speech", sessionId: session.sessionId, t: ultimaFalaAgente, role: "agent", text: "Por que escolheu isso?" });
    }
    const emFala = t % 97_000 >= 89_000 && t % 97_000 < 94_000;
    if (emFala) session.events.push({ type: "speech", sessionId: session.sessionId, t, role: "candidate", text: "Estou pensando nessa escolha." });
    const analiseRoda = paradoHaS >= 3 || (emTraco && t % RITMO.analiseMaximaSemPausaMs === 0)
      || t - (tempos.at(-1) ?? 0) >= RITMO_IDE.tetoSemPerguntaMs;
    const gancho = analiseRoda ? tipos[analisesDoModelo++ % tipos.length] : null;
    const pendentes = criterios.filter((c) => !provocados.has(c));
    const prompt = buildAnalystUser({
      fase: "implementando", elapsedLabel: formatMs(t), remainingLabel: formatMs(duracao - t), trigger: "pause", language: "python",
      numberedCode: `1 | linha ${passo}`, conversations: "", recentEvents: [], pendingQuestions: [], uncovered: pendentes.map((id) => `${id}: ${id}`),
      hasWorkingSolution: false,
    });
    const agenda = prompt.split("Critérios ainda não explorados:")[1]?.split("Desafio liberado:")[0] ?? "";
    const criterioId = pendentes.find((id) => agenda.includes(`${id}:`)) ?? criterios[passo % criterios.length];
    const q = {
      id: `medicao-${passo}`, question: `Por que escolheu ${criterioId}?`, followUpTopic: criterioId,
      priority: 1, createdAt: t, status: "queued" as const, criterionId: criterioId, gancho, kind: "sondar" as const,
      parteFechada: gancho === "parte_fechada",
    };
    const bola = estadoDaBola(session, t);
    const conteudo = motivoDoConteudo(session, q, t);
    const ritmo = motivoDoRitmo(ritmoDaSessao(session, t));
    if (bola.espera || conteudo || ritmo) {
      motivoAnterior = bola.espera ?? conteudo ?? ritmo?.texto ?? "aguardando";
      contagemDeBloqueios.set(motivoAnterior, (contagemDeBloqueios.get(motivoAnterior) ?? 0) + 1);
      continue;
    }
    if (gancho === null) { motivoAnterior = "sem análise/gancho neste passo"; contagemDeBloqueios.set(motivoAnterior, (contagemDeBloqueios.get(motivoAnterior) ?? 0) + 1); continue; }
    if (passo % 23 === 0) falaAte = t + 2_000;
    if (t < falaAte) { motivoAnterior = "fala do candidato em andamento"; contagemDeBloqueios.set(motivoAnterior, (contagemDeBloqueios.get(motivoAnterior) ?? 0) + 1); continue; }
    if (ganchos.at(-1) === gancho) { motivoAnterior = "gancho igual ao da pergunta anterior"; contagemDeBloqueios.set(motivoAnterior, (contagemDeBloqueios.get(motivoAnterior) ?? 0) + 1); continue; }
    motivosDaEspera.push(`${formatMs(t)} · intervalo ${tempos.length ? Math.round((t - tempos.at(-1)!) / 1000) : Math.round(t / 1000)} s; bloqueios desde a anterior: ${[...contagemDeBloqueios].map(([m, n]) => `${m} × ${n}`).join(", ") || "nenhum"}`);
    contagemDeBloqueios.clear();
    motivoAnterior = "sem bloqueio anterior";
    if (emFala || emTraco) duranteFalaOuTraco++;
    tempos.push(t);
    ganchos.push(gancho);
    criteriosPerguntados.push(criterioId);
    provocados.add(criterioId);
    session.blips.push({ id: q.id, createdAt: t, preview: criterioId, priority: 1 });
    session.queue.push({ ...q, status: "blipped" });
    session.lastConversationEndedAt = t;
    ultimaFalaAgente = t;
  }
  const ate70 = new Set(criteriosPerguntados.filter((_, i) => tempos[i] <= duracao * 0.7));
  const feitos = new Set(criteriosPerguntados);
  const gaps = tempos.slice(1).map((t, i) => (t - tempos[i]) / 1000);
  maiorIntervaloComLacunaS = gaps.length ? Math.max(...gaps) : (tempos[0] ?? 0) / 1000;
  return {
    sala: "IDE", perguntas: tempos, ganchos, criterios,
    feitasAntesDoTerminei: tempos.filter((t) => t < duracao * 0.8).length,
    maiorIntervaloComLacunaS, percentualAntesDoFechamento: tempos.length ? Math.round(100 * tempos.filter((t) => t < duracao * 0.8).length / tempos.length) : 0,
    criteriosAte70: ate70.size, totalCriterios: criterios.length, naoExploradosNoFim: criterios.length - feitos.size,
    menorIntervaloS: gaps.length ? Math.min(...gaps) : 0, duranteFalaOuTraco,
    ganchosIguaisSeguidos: ganchos.slice(1).filter((g, i) => g === ganchos[i]).length,
    motivosDaEspera,
  };
}

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

const BRUTE = `def two_sum(nums, target):
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            if nums[i] + nums[j] == target:
                return [i, j]
    return []
`;
const BRUTE_BUG = BRUTE.replace("range(i + 1, len(nums))", "range(len(nums))");
const OUTER = `def two_sum(nums, target):
    for i in range(len(nums)):
        pass
`;
const HASH_PARCIAL = `def two_sum(nums, target):
    vistos = {}
    for i, n in enumerate(nums):
        pass
    return []
`;
const HASH = `def two_sum(nums, target):
    vistos = {}
    for i, n in enumerate(nums):
        if target - n in vistos:
            return [vistos[target - n], i]
        vistos[n] = i
    return []
`;

const HASH_BORDA = HASH.replace("    vistos = {}\n", "    if len(nums) < 2:\n        return []\n    vistos = {}\n");

interface Stage {
  /** ms de sessão; com `afterOptimizing`, ms depois de o candidato topar otimizar. */
  at: number;
  code: string;
  run?: boolean;
  paste?: boolean;
  afterOptimizing?: boolean;
  /** Antes de `at`, o candidato fica esse tempo digitando (um snapshot a cada tick): não está parado. */
  typingMs?: number;
}

interface Persona {
  key: string;
  title: string;
  /** Como o candidato fala e o que ele sabe (vai para o LLM do candidato). */
  persona: string;
  stages: Stage[];
  /** Chance de abrir um balão (1 = sempre). */
  opensBlips: number;
  checks: (r: SimResult) => Check[];
}

interface Check {
  label: string;
  pass: boolean;
}

const PERSONAS: Persona[] = [
  {
    key: "otimiza",
    title: "Força bruta de propósito, otimiza quando desafiado",
    persona:
      "Você começa pela força bruta de propósito, para garantir que funciona. Sabe dizer que é O(n²) de tempo e O(1) de memória e por quê. " +
      "Se o entrevistador pedir para melhorar ou otimizar, você topa ('vou tentar') e depois chega na ideia de guardar os números vistos num dicionário, O(n) de tempo e O(n) de memória. " +
      "Explica com clareza, mas sem discursos.",
    stages: [
      { at: 50_000, code: BRUTE },
      { at: 70_000, code: BRUTE, run: true },
      { at: 90_000, code: HASH, afterOptimizing: true },
      { at: 100_000, code: HASH, run: true, afterOptimizing: true },
    ],
    opensBlips: 1,
    checks: (r) => [
      { label: "desafiou a otimizar", pass: r.challenged },
      { label: "fechou o desafio (retorno ou na hora)", pass: r.checkedIn },
      { label: "otimizou no código", pass: r.optimized },
      { label: "complexidade ≥ 3", pass: (score(r.report, "complexidade") ?? 0) >= 3 },
    ],
  },
  {
    key: "trava",
    title: "Força bruta, desafiado a otimizar mas não consegue",
    persona:
      "Você só conhece a força bruta. Sabe dizer que é O(n²) quando perguntado. Você NÃO conhece a técnica de dicionário/hash map " +
      "para esse problema e nunca fala em dicionário, hash, mapa, set ou ordenar. Se pedirem para otimizar, você topa tentar, " +
      "mas não consegue pensar em nada; quando perguntarem como foi, admite que travou. Se oferecerem uma dica, aceita, " +
      "mas mesmo assim só chega a uma ideia vaga ('talvez guardar alguma coisa? não sei'), sem fechar.",
    stages: [
      { at: 50_000, code: BRUTE },
      { at: 70_000, code: BRUTE, run: true },
    ],
    opensBlips: 1,
    checks: (r) => [
      { label: "desafiou a otimizar", pass: r.challenged },
      { label: "fechou o desafio (retorno ou na hora)", pass: r.checkedIn },
      { label: "complexidade ≤ 2", pass: (score(r.report, "complexidade") ?? 4) <= 2 },
    ],
  },
  {
    key: "calado",
    title: "Respostas monossilábicas, bug corrigido depois do teste",
    persona:
      "Você fala muito pouco: respostas de 1 a 4 palavras ('sei lá', 'porque sim', 'acho que funciona'). Não explica raciocínio. " +
      "Se pedirem para otimizar, diz que não sabe.",
    stages: [
      { at: 60_000, code: BRUTE_BUG },
      { at: 80_000, code: BRUTE_BUG, run: true },
      { at: 200_000, code: BRUTE },
      { at: 210_000, code: BRUTE, run: true },
    ],
    opensBlips: 0.7,
    checks: (r) => [{ label: "comunicação ≤ 2", pass: (score(r.report, "comunicacao") ?? 4) <= 2 }],
  },
  {
    key: "forte",
    title: "Vai direto no hashmap e explica tudo",
    persona:
      "Você é experiente. Explica o plano antes de codar: dicionário de vistos em uma passada, O(n) de tempo e O(n) de memória, " +
      "e comenta sozinho casos como repetidos, negativos e por que procurar antes de inserir. Fala com clareza e confiança, 1 a 3 frases.",
    stages: [
      { at: 60_000, code: HASH },
      { at: 75_000, code: HASH, run: true },
    ],
    opensBlips: 1,
    checks: (r) => [{ label: "nota geral ≥ 3", pass: (r.report?.overallScore ?? 0) >= 3 }],
  },
  {
    key: "cola",
    title: "Cola a solução pronta e não sabe explicar",
    persona:
      "Você colou a solução de algum lugar e NÃO entende o código. Antes de colar, não tinha plano ('vou ver aqui'). " +
      "Quando perguntam, responde vago ou errado: acha que o dicionário 'guarda os resultados das somas', não sabe por que procura antes de inserir " +
      "('foi assim que fiz'), e chuta a complexidade ('acho que O(n²)? não sei'). Nunca dá uma explicação correta e completa.",
    stages: [
      { at: 120_000, code: HASH, paste: true },
      { at: 130_000, code: HASH, run: true },
    ],
    opensBlips: 1,
    checks: (r) => [
      { label: "colagem citada no relatório", pass: (r.report?.concerns ?? []).some((c) => /col(a|ou|agem)/i.test(c)) },
      { label: "abordagem ≤ 2", pass: (score(r.report, "abordagem") ?? 4) <= 2 },
    ],
  },
  {
    key: "constante",
    title: "Trabalho contínuo de 30 min: digita, erra, corrige, otimiza e trata casos de borda",
    persona:
      "Você pensa em voz alta só quando perguntado. Começa pela força bruta, erra o início do loop interno e corrige sozinho depois do teste. " +
      "Sabe que é O(n²) e, se pedirem para melhorar, topa e chega no dicionário de vistos, O(n) de tempo e de memória. Respostas de 1 a 3 frases.",
    stages: [
      { at: 70_000, code: OUTER, typingMs: 30_000 },
      { at: 140_000, code: BRUTE_BUG.replace("        if nums[i] + nums[j] == target:\n            return [i, j]\n", ""), typingMs: 40_000 },
      { at: 200_000, code: BRUTE_BUG, typingMs: 30_000 },
      { at: 215_000, code: BRUTE_BUG, run: true },
      { at: 330_000, code: BRUTE, typingMs: 20_000 },
      { at: 345_000, code: BRUTE, run: true },
      { at: 120_000, code: HASH_PARCIAL, typingMs: 40_000, afterOptimizing: true },
      { at: 240_000, code: HASH, typingMs: 50_000, afterOptimizing: true },
      { at: 255_000, code: HASH, run: true, afterOptimizing: true },
      { at: 1_200_000, code: HASH_BORDA, typingMs: 40_000 },
      { at: 1_215_000, code: HASH_BORDA, run: true },
    ],
    opensBlips: 0.9,
    checks: () => [],
  },
  {
    key: "sem-parar",
    title: "Digita o tempo todo, nunca para 8 s (só roda os testes de vez em quando)",
    persona:
      "Você fala pouco e volta logo para o código. Começa pela força bruta, corrige o loop interno depois do teste e, " +
      "se pedirem para melhorar, chega no dicionário de vistos, O(n). Respostas de 1 a 2 frases.",
    stages: [
      { at: 240_000, code: BRUTE_BUG, typingMs: 210_000 },
      { at: 250_000, code: BRUTE_BUG, run: true },
      { at: 480_000, code: BRUTE, typingMs: 225_000 },
      { at: 490_000, code: BRUTE, run: true },
      { at: 900_000, code: HASH, typingMs: 405_000 },
      { at: 910_000, code: HASH, run: true },
      { at: 1_500_000, code: HASH_BORDA, typingMs: 585_000 },
      { at: 1_510_000, code: HASH_BORDA, run: true },
    ],
    opensBlips: 1,
    checks: () => [],
  },
];

// ---------------------------------------------------------------------------
// Candidato simulado
// ---------------------------------------------------------------------------

const CandidateTurn = z.object({
  reply: z.string(),
  /** true quando nesta fala o candidato topou tentar otimizar o código. */
  startsOptimizing: z.boolean(),
});

async function candidateReply(persona: Persona, code: string, messages: ChatMessage[]): Promise<z.infer<typeof CandidateTurn>> {
  const problem = IDE_PROBLEMS["two-sum"];
  const transcript = messages.map((m) => `${m.role === "agent" ? "Entrevistador" : "Você"}: ${m.text}`).join("\n");
  const result = await completeJson({
    role: "fast",
    system: `Você interpreta um CANDIDATO numa entrevista técnica de programação, em português do Brasil informal.
Problema: ${problem.title}: ${problem.statement}
Sua persona: ${persona.persona}
Responda à última fala do entrevistador como esse candidato responderia, em 1 a 3 frases faladas (sem markdown, sem código).
startsOptimizing = true só se nesta fala você topou tentar melhorar/otimizar o código agora.
Responda SOMENTE com JSON: {"reply": string, "startsOptimizing": boolean}`,
    user: `Seu código atual:\n${code}\n\nConversa:\n${transcript}`,
    schema: CandidateTurn,
  });
  return result.data;
}

// ---------------------------------------------------------------------------
// Simulação
// ---------------------------------------------------------------------------

interface SimResult {
  persona: Persona;
  report?: Report;
  error?: string;
  log: string[];
  blips: number;
  conversations: number;
  challenged: boolean;
  checkedIn: boolean;
  optimized: boolean;
  hints: number;
  unexplored: string[];
  /** Linha do tempo das interrupções (balões que apareceram). */
  interruptions: Interruption[];
}

interface Interruption {
  t: number;
  fase: string;
  kind: string;
  /** O que aconteceu logo antes: run verde, pausa, fim de conversa... */
  moment: string;
  /** O candidato tinha digitado há menos de 3 s. */
  typing: boolean;
  preview: string;
  opened: boolean;
}

/** O que aconteceu logo antes do balão, para a linha do tempo. */
function momentBefore(session: SessionState, t: number, keyMoment: string | undefined): string {
  if (keyMoment) return `momento-chave: ${keyMoment.split(" (")[0]}`;
  const last = session.events.filter((e) => e.type !== "speech" && e.type !== "blip_opened").at(-1);
  if (!last) return "início";
  const ago = Math.round((t - last.t) / 1000);
  switch (last.type) {
    case "run":
      return `${ago} s depois de um run ${allPassed(last.result) ? "verde" : "vermelho"}`;
    case "pause":
      return `pausa (${Math.round((last.idleMs + (t - last.t)) / 1000)} s sem digitar)`;
    case "blip_closed":
      return `${ago} s depois de uma conversa`;
    case "snapshot":
      return `${ago} s depois de digitar`;
    case "session_started":
      return `${ago} s depois do início`;
    default:
      return `${ago} s depois de ${last.type}`;
  }
}

/** Resumo da linha do tempo de uma sessão: uma linha por interrupção e os totais. */
function renderTimeline(r: SimResult): string {
  const gaps = r.interruptions.slice(1).map((i, k) => Math.round((i.t - r.interruptions[k].t) / 1000)).sort((a, b) => a - b);
  const byFase = new Map<string, number>();
  for (const i of r.interruptions) byFase.set(i.fase, (byFase.get(i.fase) ?? 0) + 1);
  return [
    `# ${r.persona.key} (${DURATION_MIN} min): ${r.interruptions.length} interrupções · ${[...byFase].map(([f, n]) => `${f} ${n}`).join(", ")}`,
    `  intervalo entre elas: mín ${gaps[0] ?? "–"} s, mediana ${gaps[Math.floor(gaps.length / 2)] ?? "–"} s · digitando: ${r.interruptions.filter((i) => i.typing).length} · abertas ${r.interruptions.filter((i) => i.opened).length}`,
    ...r.interruptions.map(
      (i) => `  [${formatMs(i.t)}] ${i.fase.padEnd(11)} ${i.kind.padEnd(12)} ${i.moment}${i.typing ? " · DIGITANDO" : ""}${i.opened ? "" : " · (ignorado)"} — ${i.preview}`,
    ),
  ].join("\n");
}

function score(report: Report | undefined, id: string): number | undefined {
  const s = report?.criteria.find((c) => c.id === id)?.score;
  return s === null ? undefined : s;
}

const OPTIMIZE_RE = /otimiz|melhorar (a |essa |isso)|mais (rápid|eficiente)|reduzir (o tempo|a complexidade)|dá pra fazer melhor/i;
const CHECKIN_RE = /como foi|conseguiu|chegou (a|em) alguma|e aí,? (o que|como)|pensou em algo/i;

async function simulate(persona: Persona): Promise<SimResult> {
  let simT = 0;
  const sessionId = `sim-${persona.key}-${Date.now()}`;
  const session: SessionState = getOrCreateSession(sessionId, { ...CONFIG, durationMin: DURATION_MIN });
  session.clock = () => simT;

  const res: SimResult = {
    persona,
    log: [],
    blips: 0,
    conversations: 0,
    challenged: false,
    checkedIn: false,
    optimized: false,
    hints: 0,
    unexplored: [],
    interruptions: [],
  };
  const log = (line: string) => res.log.push(`[${formatMs(simT)}] ${line}`);
  const ide = IDE_PROBLEMS["two-sum"];

  let version = 0;
  let code = ide.starters.python;
  let lastEditAt: number | undefined;
  let pausedSinceEdit = true;
  let optimizingSince: number | undefined;
  const done = new Set<Stage>();
  let blipOnScreen: Blip | undefined;
  let lastTypingAt: number | undefined;
  let ultimoMotivo = "";

  async function send(input: EventInput): Promise<void> {
    const event = { ...input, sessionId, t: simT } as SessionEvent;
    appendEvent(session, event);
    if (event.type === "session_started") enqueueKickoff(session, event.t);
    if (event.type === "session_ended" && (!LINHA_DO_TEMPO || COM_RELATORIO)) startEvaluation(session);
    // Como em /api/events: a colagem grande já entra na fila com a pergunta dela.
    if (event.type === "paste") enqueueCola(session, event);
    if (disparaAnalise(event, session)) await runAnalyst(session, event);
    handleBlip(decideBlip(session, simT));
  }

  function handleBlip(r: { blip?: Blip; dismissBlipId?: string }): void {
    if (r.dismissBlipId && blipOnScreen?.id === r.dismissBlipId) {
      log(`balão expirou sem clique: ${blipOnScreen.preview}`);
      blipOnScreen = undefined;
    }
    if (r.blip) {
      blipOnScreen = r.blip;
      res.blips += 1;
      const q = session.queue.find((x) => x.id === r.blip!.id);
      res.interruptions.push({
        t: simT,
        fase: faseDaEntrevista(session),
        kind: q?.kickoff ? "abertura" : (q?.kind ?? "pergunta"),
        moment: momentBefore(session, simT, q?.keyMoment),
        typing: lastTypingAt !== undefined && simT - lastTypingAt < 3_000,
        preview: r.blip.preview,
        opened: false,
      });
      log(`BALÃO: ${r.blip.preview}`);
    }
  }

  async function conversation(blip: Blip): Promise<void> {
    res.conversations += 1;
    await send({ type: "blip_opened", blipId: blip.id });
    const messages: ChatMessage[] = [];
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const hintsBefore = session.hintsUsed;
      const agent = await runInterviewerTurn(session, { blipId: blip.id, messages });
      messages.push({ role: "agent", text: agent.reply });
      await send({ type: "speech", role: "agent", text: agent.reply, blipId: blip.id });
      const grifo = agent.commands.find((c) => c.type === "highlight_range");
      log(`  entrevistador: ${agent.reply}${grifo && grifo.type === "highlight_range" ? ` [grifo ${grifo.startLine}-${grifo.endLine}]` : ""}${session.hintsUsed > hintsBefore ? " [DICA]" : ""}${agent.end ? " [fim]" : ""}`);
      if (OPTIMIZE_RE.test(agent.reply) && turn <= 2) res.challenged = true;
      if (res.challenged && optimizingSince !== undefined && CHECKIN_RE.test(agent.reply)) res.checkedIn = true;
      simT += TURN_MS;
      if (agent.end) break;

      const cand = await candidateReply(persona, code, messages);
      messages.push({ role: "candidate", text: cand.reply });
      await send({ type: "speech", role: "candidate", text: cand.reply, blipId: blip.id });
      log(`  candidato: ${cand.reply}${cand.startsOptimizing ? " [vai otimizar]" : ""}`);
      if (cand.startsOptimizing && optimizingSince === undefined) optimizingSince = simT;
      simT += TURN_MS;
    }
    await send({ type: "blip_closed", blipId: blip.id, reason: "agent" });
  }

  await send({ type: "session_started", configId: session.config.id, problemId: "two-sum", language: "python" });
  log("sessão começou");

  const endAt = DURATION_MIN * 60_000;
  while (simT < endAt) {
    // Etapas do roteiro de código.
    for (const stage of persona.stages) {
      if (done.has(stage)) continue;
      const due = stage.afterOptimizing ? (optimizingSince !== undefined ? optimizingSince + stage.at : Infinity) : stage.at;
      if (simT < due) continue;
      done.add(stage);
      if (stage.code !== code) {
        code = stage.code;
        version += 1;
        await send({ type: "snapshot", code, version, language: "python" });
        if (stage.paste) await send({ type: "paste", chars: code.length, lines: code.split("\n").length, startLine: 1 });
        if (code === HASH && optimizingSince !== undefined) res.optimized = true;
        lastEditAt = simT;
        pausedSinceEdit = false;
        log(stage.paste ? "colou código" : `escreveu código (versão ${version})`);
      }
      if (stage.run) {
        const result = await runPythonTests(ide, code, { tests: ide.visibleTests, runTimeoutMs: 5_000 });
        await send({ type: "run", result });
        log(`rodou: ${result.passed}/${result.total}`);
      }
    }

    // Digitação em andamento (etapas com typingMs): um snapshot por tick, o candidato não está parado.
    for (const stage of persona.stages) {
      if (done.has(stage) || stage.typingMs === undefined) continue;
      const due = stage.afterOptimizing ? (optimizingSince !== undefined ? optimizingSince + stage.at : Infinity) : stage.at;
      if (simT >= due - stage.typingMs && simT < due) {
        version += 1;
        // A rajada de digitação acontece 3 s antes da consulta da política (a IDE consulta a cada poucos segundos e
        // quem digita sem parar ainda tem micro-pausas): sem isso a política só era consultada com a mão no teclado.
        simT -= 3_000;
        await send({ type: "snapshot", code: `${code}# digitando ${version}\n`, version, language: "python" });
        lastTypingAt = simT;
        simT += 3_000;
        lastEditAt = simT;
        pausedSinceEdit = false;
        break;
      }
    }

    // Pausa de 8 s depois de editar, como a IDE.
    if (!pausedSinceEdit && lastEditAt !== undefined && simT - lastEditAt >= PAUSE_MS) {
      pausedSinceEdit = true;
      await send({ type: "pause", idleMs: simT - lastEditAt });
    }

    // Polling do balão (GET /api/blip/pending).
    handleBlip(decideBlip(session, simT));
    // DEBUG_POLITICA=1: registra cada motivo novo da política e o resultado de cada análise (para achar o que segura).
    if (process.env.DEBUG_POLITICA) {
      const motivo = `${lastBlipDecision(session) ?? ""} | análise: ${session.analyst.lastOutcome?.text ?? "-"}`;
      if (motivo !== ultimoMotivo) log(`    · ${motivo}`);
      ultimoMotivo = motivo;
    }
    if (blipOnScreen) {
      const blip = blipOnScreen;
      blipOnScreen = undefined;
      if (Math.random() < persona.opensBlips) {
        const ultima = res.interruptions.at(-1);
        if (ultima) ultima.opened = true;
        log(`abriu o balão`);
        await conversation(blip);
      } else {
        log(`ignorou o balão`);
      }
    }
    simT += TICK_MS;
  }

  await send({ type: "session_ended", reason: "timeout" });
  log("sessão encerrada");
  const status = LINHA_DO_TEMPO && !COM_RELATORIO
    ? undefined
    : await Promise.race([waitForEvaluation(session), new Promise<undefined>((r) => { (setTimeout(r, PRAZO_RELATORIO_MS) as unknown as { unref(): void }).unref(); })]);
  res.report = status?.report;
  res.error = status?.error;
  res.hints = session.hintsUsed;
  // Pelo estado do agente, não só pelo texto: pergunta de desafio aberta e retorno concluído.
  res.challenged ||= session.queue.some((q) => q.kind === "desafio" && q.status === "asked");
  // Desafio fechado: o agente voltou para conferir, ou o candidato já respondeu com a ideia na própria conversa.
  const challengeIds = new Set(session.queue.filter((q) => q.kind === "desafio").map((q) => q.id));
  res.checkedIn ||=
    session.checkIns.some((c) => c.status === "feito") ||
    Object.values(session.coverage).some((c) => c.outcomes.some((o) => o.questionId !== undefined && challengeIds.has(o.questionId)));
  res.unexplored = res.report?.criteria.filter((c) => c.score === null).map((c) => c.id) ?? [];
  log(`check-ins: ${session.checkIns.map((c) => `${c.challenge} (${c.status})`).join("; ") || "nenhum"}`);
  log(`cobertura: ${Object.entries(session.coverage).map(([id, c]) => `${id}=${c.outcomes.map((o) => o.kind).join("/") || c.status}`).join(" ")}`);
  return res;
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

function render(r: SimResult): string {
  const rep = r.report;
  const lines = [
    `# ${r.persona.key}: ${r.persona.title}`,
    "",
    ...r.log,
    "",
    "## Relatório",
    rep
      ? [
          `${rep.recommendation} · ${rep.overallScore}/4`,
          rep.summary,
          ...rep.criteria.map(
            (c) => `- ${c.name}: ${c.score ?? "não explorado"}\n${c.evidence.map((e) => `    [${formatMs(e.t)}] ${e.text}`).join("\n")}`,
          ),
          `Atenção: ${rep.concerns.join(" | ")}`,
        ].join("\n")
      : `falhou: ${r.error}`,
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // sem .env.local: usa as variáveis do ambiente
  }
  const args = process.argv.slice(2);
  if (args.includes("--linha-do-tempo") && args.includes("--offline")) {
    DURATION_MIN = 30;
    const passou = imprimirMedicao140(medirOfflineIde());
    if (!passou) process.exitCode = 1;
    return;
  }
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : undefined;
  const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : "sim-runs";
  if (args.includes("--config")) {
    const configPath = args[args.indexOf("--config") + 1];
    if (!configPath) throw new Error("--config precisa de um caminho para o JSON");
    const raw: unknown = JSON.parse(readFileSync(resolve(configPath), "utf8"));
    CONFIG = normalizarConfig(InterviewConfig.parse(raw));
    DURATION_MIN = CONFIG.durationMin;
  }
  if (args.includes("--duracao")) DURATION_MIN = Number(args[args.indexOf("--duracao") + 1]) || DURATION_MIN;
  LINHA_DO_TEMPO = args.includes("--linha-do-tempo");
  COM_RELATORIO = args.includes("--com-relatorio");
  const personas = PERSONAS.filter((p) => !only || only.includes(p.key));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(outDir, stamp);
  mkdirSync(dir, { recursive: true });

  const results = await Promise.all(
    personas.map((p) =>
      simulate(p).catch((err: unknown): SimResult => ({
        persona: p,
        error: err instanceof Error ? err.message : String(err),
        log: [],
        blips: 0,
        conversations: 0,
        challenged: false,
        checkedIn: false,
        optimized: false,
        hints: 0,
        unexplored: [],
        interruptions: [],
      })),
    ),
  );

  if (LINHA_DO_TEMPO) {
    const texto = results.map((r) => (r.error ? `# ${r.persona.key}: erro ${r.error}` : renderTimeline(r))).join("\n\n");
    for (const r of results) writeFileSync(join(dir, `${r.persona.key}.md`), render(r));
    writeFileSync(join(dir, "linha-do-tempo.txt"), texto);
    console.log(texto);
    // Custo de LLM do processo inteiro: rode uma persona por vez (--only) para ter o custo de cada entrevista.
    console.log(`\ncusto de LLM (${personas.map((p) => p.key).join(", ")}${COM_RELATORIO ? ", com o relatório" : ", sem o relatório"}):\n${resumoDoCusto()}`);
    for (const r of results) if (COM_RELATORIO) console.log(`relatório ${r.persona.key}: ${r.report ? `${r.report.recommendation} · ${r.report.overallScore}/4` : `não saiu (${r.error ?? "prazo"})`}`);
    console.log(`\ntranscrições em ${dir}/`);
    return;
  }

  const rows: string[] = [];
  let failed = 0;
  for (const r of results) {
    writeFileSync(join(dir, `${r.persona.key}.md`), render(r));
    const checks = [
      { label: `todos os critérios explorados${r.unexplored.length ? ` (faltou: ${r.unexplored.join(", ")})` : ""}`, pass: r.unexplored.length === 0 },
      ...r.persona.checks(r),
    ];
    failed += checks.filter((c) => !c.pass).length;
    const crit = r.report?.criteria.map((c) => `${c.id.slice(0, 5)} ${c.score ?? "–"}`).join(" ") ?? `erro: ${r.error}`;
    rows.push(
      `${r.persona.key.padEnd(8)} geral ${r.report?.overallScore ?? "–"} | ${crit} | balões ${r.blips}, conversas ${r.conversations}, dicas ${r.hints}`,
      ...checks.map((c) => `           ${c.pass ? "✓" : "✗"} ${c.label}`),
    );
  }
  const summary = [`config: ${CONFIG.id} (${CONFIG.roleTitle})`, ...rows].join("\n");
  writeFileSync(join(dir, "resumo.txt"), summary);
  console.log(summary);
  console.log(`\ntranscrições em ${dir}/ · ${failed} checagem(ns) falhando`);
}

// Sai explicitamente: timers do agente e da avaliação (Pyodide) seguravam o processo aberto depois do fim.
if (process.argv[1]?.endsWith("simulate.ts")) {
  main()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => process.exit());
}
