import { uncoveredCriteria } from "@/lib/agents/coverage";
import { abordagemParaRever, PERGUNTA_DE_REVISAO, startClosing } from "@/lib/agents/policy";
import { aoVoltarATrabalhar } from "@/lib/totti/fechamento";
import type { PerguntaFinal } from "@/lib/totti/fechamento";
import type { SessionState } from "@/lib/session/types";
import type { EstadoFechamento } from "@/lib/totti/fechamento";
import type { SessionEvent } from "@/lib/contracts";

export const MIN_LINHAS_PARA_VOLTA = 3;

/** Pergunta final de um critério sem evidência que não tem pergunta preparada. Só os técnicos de id conhecido
 * (corretude sai dos testes): comunicação, pressão e os critérios próprios da vaga ficam fora, porque uma pergunta
 * montada do nome soava robótica. */
export const PERGUNTA_DO_CRITERIO: Record<string, string> = {
  complexidade: "Qual é o custo de tempo e de memória da sua solução? E o que acontece com uma entrada bem grande?",
  bordas: "Que casos de borda você testaria nessa solução, tipo entrada vazia ou valores repetidos?",
  abordagem: "Por que você escolheu essa abordagem e não outra?",
};
export const MIN_CARACTERES_PARA_VOLTA = 80;

/** Decide sem efeitos colaterais se um evento de código suspende o fechamento. */
export function linhasAlteradas(antes: string, depois: string): number {
  const a = antes.split("\n"); const b = depois.split("\n");
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => a[i] !== b[i]).filter(Boolean).length;
}

export function caracteresAlterados(antes: string, depois: string): number {
  let inicio = 0;
  while (inicio < antes.length && inicio < depois.length && antes[inicio] === depois[inicio]) inicio++;
  let fimA = antes.length - 1; let fimB = depois.length - 1;
  while (fimA >= inicio && fimB >= inicio && antes[fimA] === depois[fimB]) { fimA--; fimB--; }
  return Math.max(fimA - inicio + 1, fimB - inicio + 1);
}

export function voltouATrabalhar(estado: EstadoFechamento, evento: SessionEvent, codigoInicial: string): boolean {
  if (!["anuncio", "perguntas_finais", "ultima_palavra"].includes(estado.etapa)) return false;
  const codigo = evento.type === "snapshot" ? evento.code : undefined;
  const mudouMuito = codigo !== undefined && (linhasAlteradas(codigoInicial, codigo) >= MIN_LINHAS_PARA_VOLTA || caracteresAlterados(codigoInicial, codigo) >= MIN_CARACTERES_PARA_VOLTA);
  return mudouMuito && aoVoltarATrabalhar(estado) === null;
}

/** Reúne na ordem da política as perguntas prontas e os pontos pendentes do fechamento legado. */
export function candidatasDoFechamento(session: SessionState, t: number): PerguntaFinal[] {
  const elegiveis = session.queue.filter((q) => q.status === "queued" || q.status === "blipped");
  const copia: SessionState = { ...session, queue: elegiveis.map((q) => ({ ...q })), blips: [...session.blips], events: [...session.events], evidence: [...session.evidence], pendingBlipId: session.pendingBlipId };
  const blip = startClosing(copia, t);
  const closing = blip && copia.queue.find((q) => q.id === blip.id);
  if (!closing) return [];
  const candidatas: PerguntaFinal[] = [];
  // Abordagem pior que a melhor conhecida ou justificativa fraca: o Totti não redirecionou durante a implementação
  // (decisão de produto), então pergunta primeiro se ele mudaria algo olhando agora.
  if (abordagemParaRever(session)) candidatas.push({ pergunta: PERGUNTA_DE_REVISAO, origem: "revisao", prioridade: 1 });
  const cola = copia.queue.find((q) => q.kind === "cola" && q.status === "stale");
  if (cola) candidatas.push({ pergunta: "Você colou esse trecho. De onde veio e como ele funciona?", origem: "colagem", apontar: cola.highlight });
  const prepared = copia.queue.filter((q) => q.kind !== "encerramento" && q.status === "stale" && q.kind !== "cola");
  for (const q of prepared) candidatas.push({ pergunta: q.question, origem: "analise", apontar: q.highlight });
  // Critério descoberto com pergunta preparada: entra a pergunta preparada.
  const idsCobertos = new Set(uncoveredCriteria(session));
  for (const q of elegiveis.filter((item) => item.criterionId && idsCobertos.has(item.criterionId) && item.question.trim())) {
    if (!candidatas.some((c) => c.pergunta === q.question)) candidatas.push({ pergunta: q.question, origem: "criterio", apontar: q.highlight });
  }
  // Critério sem evidência e sem pergunta preparada: entra com a pergunta escrita à mão, por último.
  const comPergunta = new Set(elegiveis.map((q) => q.criterionId));
  for (const id of idsCobertos) {
    const pergunta = PERGUNTA_DO_CRITERIO[id];
    if (pergunta && !comPergunta.has(id) && !candidatas.some((c) => c.pergunta === pergunta)) candidatas.push({ pergunta, origem: "criterio" });
  }
  return candidatas;
}

/**
 * Ele pediu para encerrar (ou disse que terminou a entrevista): até MAX_PERGUNTAS_AO_PEDIR_FIM perguntas antes da
 * despedida (#130, item 9). Só a revisão da abordagem (a abordagem errada é revista no fechamento, item 4) e os
 * critérios da recrutadora ainda sem evidência; as perguntas da análise ficam de fora. O núcleo corta pelo máximo e
 * pelo tempo.
 */
export function candidatasDoPedidoDeFim(session: SessionState, t: number): PerguntaFinal[] {
  if (session.ended) return [];
  return candidatasDoFechamento(session, t).filter((c) => c.origem === "revisao" || c.origem === "criterio");
}
