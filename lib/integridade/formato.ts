// Formato dos números da integridade (#123): serve ao servidor (textos dos sinais) e à tela (resumo do bloco).

/** "40 s", "1 min 5 s", "3 min". */
export function duracao(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  const resto = s % 60;
  return resto ? `${min} min ${resto} s` : `${min} min`;
}
