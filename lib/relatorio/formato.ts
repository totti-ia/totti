// Formatação pequena e pura do relatório.

/** "50 s", "2 min", "1 min 50 s": mais fácil de ler que 01:50 quando é uma duração. */
export function duracaoCurta(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const resto = s % 60;
  return resto === 0 ? `${m} min` : `${m} min ${resto} s`;
}

/** "mm:ss" -> milissegundos; null se não for um minuto válido. */
export function momentoParaMs(momento: string | null | undefined): number | null {
  const m = /^(\d{1,3}):(\d{2})$/.exec(momento ?? "");
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

/** Duração de entrevista para o cabeçalho: "34 min", "1 h 5 min"; null para menos de 30 s. */
export function duracaoDaEntrevista(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 30_000) return null;
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Singular ou plural: plural(2, "dica", "dicas") = "2 dicas". */
export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}
