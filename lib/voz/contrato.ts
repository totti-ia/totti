import { z } from "zod";

export const AlinhamentoVoz = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number().finite().nonnegative()),
  character_end_times_seconds: z.array(z.number().finite().nonnegative()),
}).refine((a) => a.characters.length > 0
  && a.characters.length === a.character_start_times_seconds.length
  && a.characters.length === a.character_end_times_seconds.length
  && a.character_end_times_seconds.every((fim, i) => fim >= a.character_start_times_seconds[i])
  && a.character_start_times_seconds.every((inicio, i, lista) => i === 0 || inicio >= lista[i - 1]));

export const RespostaVoz = z.object({ audio_base64: z.string().min(1), alinhamento: AlinhamentoVoz });

/** A ElevenLabs aceita até esse tamanho de texto anterior ou seguinte; a rota recusa mais que isso. */
export const MAXIMO_CONTEXTO_DA_FALA = 1000;

/**
 * Texto vizinho para a prosódia: o fim da fala anterior ou o começo da seguinte, no máximo do contrato, sem separar um
 * par UTF-16. Usado pelos dois caminhos de voz (quadro e sala de system design).
 */
export function trechoDeContexto(texto: string | undefined, doFim: boolean): string | undefined {
  if (!texto) return undefined;
  let trecho = doFim ? texto.slice(-MAXIMO_CONTEXTO_DA_FALA) : texto.slice(0, MAXIMO_CONTEXTO_DA_FALA);
  if (doFim && /^[\uDC00-\uDFFF]/u.test(trecho)) trecho = trecho.slice(1);
  if (!doFim && /[\uD800-\uDBFF]$/u.test(trecho)) trecho = trecho.slice(0, -1);
  return trecho.trim() || undefined;
}

/** Vizinhas e ritmo de uma fala: o que a ElevenLabs usa para soar contínua de uma parte para a outra. */
export type ContextoDaFala = { texto_anterior?: string; texto_seguinte?: string; velocidade?: number };
