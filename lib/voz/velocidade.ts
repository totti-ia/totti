/** Ritmo da voz do Totti: o padrão é o das réplicas curtas, que já soavam bem. */
export const VELOCIDADE_PADRAO = 1.1;
export const VELOCIDADE_MINIMA = 0.7;
export const VELOCIDADE_MAXIMA = 1.2;
/** Falas acima disso (apresentação, explicações) são sintetizadas mais calmas. */
export const CARACTERES_DE_FALA_LONGA = 200;
const VELOCIDADE_DE_FALA_LONGA = 1;

/** Apresentação e explicações longas mais calmas; réplicas curtas no ritmo atual. */
export function velocidadeDaFala(texto: string): number {
  return texto.trim().length > CARACTERES_DE_FALA_LONGA ? VELOCIDADE_DE_FALA_LONGA : VELOCIDADE_PADRAO;
}
