/**
 * Reação pura: uma fala que é só "Hm.", "Uhum.", "Tá." ou "Certo.". Sozinha, sintetizada pela ElevenLabs, soa seca,
 * então a regra é: a reação espera ESPERA_DA_REACAO_MS por uma fala seguinte do Totti e as duas saem juntas; se nada
 * vem, toca uma gravação curta pré-gerada (public/audio/reacoes/<slug>.mp3). Sem a gravação, a reação some em silêncio.
 * Os dois caminhos de voz usam esta regra (lib/voz/filaDeFalas.ts e lib/sessao/useEntrevista.ts).
 */

/** Quanto a reação espera uma fala seguinte antes de tocar a gravação sozinha. */
export const ESPERA_DA_REACAO_MS = 1200;

/** Normaliza para comparar: sem espaços nas pontas, minúsculas, sem acento e sem pontuação final. */
function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[.!…]+$/u, "");
}

/**
 * O slug da gravação se o texto é só uma reação; null para qualquer outra fala ("Hum, certo." e "Por quê?" não são).
 */
export function slugDaReacao(texto: string): string | null {
  const limpo = normalizar(texto);
  if (!/^(h+m+|hum+|uhum+|u+hum|ta|certo)$/u.test(limpo)) return null;
  if (/^h+m+$/u.test(limpo)) return "hm";
  if (/^hum+$/u.test(limpo)) return "hum";
  if (/^u+hum+$/u.test(limpo)) return "uhum";
  return limpo === "ta" ? "ta" : "certo";
}

/** A reação e a fala seguinte numa fala só. A reação ganha ponto final se não tem pontuação ("Hm" vira "Hm."). */
export function juntarReacao(reacao: string, seguinte: string): string {
  const base = reacao.trim();
  const pontuada = /[.!…]$/u.test(base) ? base : `${base}.`;
  return `${pontuada} ${seguinte.trim()}`;
}

/** Onde está a gravação da reação (servida pelo próprio app). */
export function urlDaReacao(slug: string): string {
  return `/audio/reacoes/${slug}.mp3`;
}
