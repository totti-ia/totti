/**
 * Fase da entrevista e memória das conversas: o que o candidato está fazendo agora e o que ele já disse.
 * As perguntas do agente precisam fazer sentido para quem está nessa fase, então quem decide a fase é o
 * código (pelos eventos), não o LLM: estável, barato e igual entre execuções.
 */
import { allPassed } from "@/lib/agents/policy";
import type { FaseDaEntrevista, SessionEvent } from "@/lib/contracts";
import { latestCode } from "@/lib/session/store";
import type { SessionState } from "@/lib/session/types";
import { getProblem } from "@/problems";

/**
 * entendendo: ainda não escreveu nada além do código inicial (lendo, montando o plano).
 * implementando: escrevendo, ainda sem nenhum run verde.
 * depurando: o último run falhou.
 * funcionando: o último run passou em tudo e ele não mexeu depois.
 * otimizando: já funcionou e ele voltou a mexer (sozinho ou num desafio que topou).
 */
export type Fase = FaseDaEntrevista;

type RunEvent = Extract<SessionEvent, { type: "run" }>;

export function faseDaEntrevista(session: SessionState): Fase {
  const lastRun = session.events.filter((e): e is RunEvent => e.type === "run").at(-1);
  if (lastRun === undefined) return linesWrittenBeyondStarter(session) === 0 ? "entendendo" : "implementando";
  if (!allPassed(lastRun.result)) return "depurando";
  const changedAfterRun = session.codeHistory.some((v) => v.t > lastRun.t);
  const challengeOpen = session.checkIns.some((c) => c.status === "aguardando");
  return changedAfterRun || challengeOpen ? "otimizando" : "funcionando";
}

/** Linhas não vazias do código atual que não estavam no código inicial da linguagem. */
export function linesWrittenBeyondStarter(session: SessionState): number {
  const starter = getProblem(session.config.problemId).public.starters[session.language] ?? "";
  const starterLines = new Set(starter.split("\n").map((l) => l.trim()));
  return latestCode(session)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !starterLines.has(l)).length;
}

/** O que o candidato provavelmente está pensando em cada fase e que tipo de pergunta cabe ali (vai pro Analyst). */
export const GUIA_DA_FASE: Record<Fase, string> = {
  entendendo:
    "Ele está lendo o enunciado e montando o plano. Só cabe pergunta sobre como ele entendeu o problema ou o que pretende fazer. Nada sobre código.",
  implementando:
    "Ele está concentrado escrevendo a primeira versão, e o código ainda está pela metade: isso é normal, não é erro. Se perguntar, pergunte sobre a INTENÇÃO do trecho que ele acabou de escrever ou do próximo passo que ele está montando (\"o que você está montando aqui?\"). Nada de complexidade, bordas ou otimização ainda: ele nem terminou.",
  depurando:
    "Um teste falhou e ele está tentando entender por quê. No primeiro erro, deixe ele olhar. Se continua falhando ou parou, a pergunta natural é sobre o raciocínio dele diante do resultado: o que ele esperava que saísse, o que está olhando agora. Fale do resultado como ele viu (\"rodou e não passou\"), nunca nomeie o erro, a linha ou um caso.",
  funcionando:
    "O código passou em todos os testes visíveis. É o momento de olhar a solução como um todo: custo de tempo e memória, como se comporta com entradas grandes ou diferentes, por que escolheu esse caminho. Se não for a melhor abordagem conhecida, cabe um desafio para melhorar.",
  otimizando:
    "A solução já funcionou e ele voltou a mexer para melhorar. Ele está no meio de uma ideia: só pergunte se for sobre a mudança que ele está fazendo agora (o que está tentando, por que acha que melhora).",
};

/** Uma conversa já aberta pelo candidato: a pergunta e o que cada um disse. */
export interface ConversaFeita {
  pergunta: string;
  falas: { quem: "candidato" | "entrevistador"; texto: string }[];
}

/** Rótulo da conversa livre em `conversasFeitas`. */
export const CONVERSA_LIVRE = "(conversa livre: o candidato falou sem uma pergunta sua)";
/** Falas fora de balão que entram como contexto (as mais recentes). */
const MAX_FALAS_LIVRES = 10;

/**
 * Conversas que já aconteceram (balões abertos), na ordem, com as falas gravadas nos eventos. A conversa
 * livre (fora de balão, com o microfone aberto) vem no fim, com as falas mais recentes.
 */
export function conversasFeitas(session: SessionState): ConversaFeita[] {
  const livres = session.events
    .flatMap((e) =>
      e.type === "speech" && e.blipId === undefined
        ? [{ quem: e.role === "candidate" ? ("candidato" as const) : ("entrevistador" as const), texto: e.text }]
        : [],
    )
    .slice(-MAX_FALAS_LIVRES);
  return [...conversasDeBalao(session), ...(livres.length ? [{ pergunta: CONVERSA_LIVRE, falas: livres }] : [])];
}

function conversasDeBalao(session: SessionState): ConversaFeita[] {
  return session.queue
    .filter((q) => q.status === "asked")
    .map((q) => ({
      pergunta: q.question,
      falas: session.events.flatMap((e) =>
        e.type === "speech" && e.blipId === q.id
          ? [{ quem: e.role === "candidate" ? ("candidato" as const) : ("entrevistador" as const), texto: e.text }]
          : [],
      ),
    }));
}

/** Conversas em texto corrido para os prompts. Falas longas são cortadas; as conversas mais antigas saem primeiro. */
export function formatarConversas(conversas: ConversaFeita[], maxConversas = 6): string {
  if (conversas.length === 0) return "(nenhuma ainda)";
  return conversas
    .slice(-maxConversas)
    .map((c, i) => {
      const falas = c.falas.map((f) => `  ${f.quem}: ${cortar(f.texto, 280)}`).join("\n");
      return `${i + 1}. Pergunta: ${c.pergunta}\n${falas || "  (sem resposta)"}`;
    })
    .join("\n");
}

/** Região do código que mudou entre duas versões ("linhas 4–7"), ou undefined se não mudou. */
export function regiaoAlterada(antes: string, depois: string): string | undefined {
  if (antes === depois) return undefined;
  const a = antes.split("\n");
  const b = depois.split("\n");
  let inicio = 0;
  while (inicio < a.length && inicio < b.length && a[inicio] === b[inicio]) inicio++;
  let fimA = a.length - 1;
  let fimB = b.length - 1;
  while (fimA >= inicio && fimB >= inicio && a[fimA] === b[fimB]) {
    fimA--;
    fimB--;
  }
  if (fimB < inicio) return `apagou linhas perto da linha ${inicio + 1}`;
  return inicio === fimB ? `linha ${inicio + 1}` : `linhas ${inicio + 1}–${fimB + 1}`;
}

function cortar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}
