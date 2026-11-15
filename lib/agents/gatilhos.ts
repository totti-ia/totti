/**
 * Quais eventos da IDE pedem uma análise do código. Quem decide se ela roda é o Analyst; aqui só o gatilho.
 * A rota /api/events e os simuladores usam a mesma regra.
 */
import { linesWrittenBeyondStarter } from "@/lib/agents/fase";
import type { SessionEvent } from "@/lib/contracts";
import { RITMO } from "@/lib/interrupcao/politica";
import type { SessionState } from "@/lib/session/types";

// A conversa conta como gatilho quando termina (blip_closed), não a cada fala.
const ANALYZED_TRIGGERS = new Set<SessionEvent["type"]>(["pause", "run", "paste", "blip_closed"]);
/** Fala solta (fora de balão) longa o bastante para mudar a leitura do Analyst: ele explicou o raciocínio. */
const PALAVRAS_PARA_ANALISAR = 12;

export function disparaAnalise(event: SessionEvent, session: SessionState): boolean {
  if (event.type === "foco" || (event.type === "paste" && event.origem === "editor")) return false;
  if (ANALYZED_TRIGGERS.has(event.type)) return true;
  // Antes da primeira linha de código nenhuma pergunta da análise pode sair (lib/agents/policy.ts): analisar a
  // fala ali só gastava uma chamada.
  const temCodigo = linesWrittenBeyondStarter(session) > 0;
  if (temCodigo && event.type === "speech" && event.role === "candidate" && event.blipId === undefined
    && event.text.trim().split(/\s+/).length >= PALAVRAS_PARA_ANALISAR) return true;
  // Quem digita sem parar nunca gera a pausa da IDE: um snapshot também pede análise quando a última já tem
  // `analiseMaximaSemPausaMs` (política comum de interrupção, lib/interrupcao/politica.ts).
  return temCodigo && event.type === "snapshot" && event.t - (session.analyst.lastRunAt ?? 0) >= RITMO.analiseMaximaSemPausaMs;
}
