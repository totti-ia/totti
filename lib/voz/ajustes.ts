import { VELOCIDADE_PADRAO } from "@/lib/voz/velocidade";

// A voz do Totti é uma só, em todo o site (quadro, live coding, pré-entrevista): Fernando - Casual (pt-BR), no
// eleven_flash_v2_5, com os ajustes abaixo. Escolhida ouvindo amostras em 2026-11-09. Fixa de propósito, sem variável
// de ambiente: com os ajustes do painel (estilo 0,15, velocidade 1) o tom mudava de uma fala para outra e soava lenta.
export const VOZ = "jyRzzBWbHll8EUfOjmhe";
// ~0,4 s numa fala curta (o turbo_v2_5 dá o mesmo tempo; o multilingual_v2, 0,65-0,8 s).
export const MODELO = "eleven_flash_v2_5";
/** Estabilidade alta e estilo 0: a voz soa igual em toda fala. Velocidade 1,1 tira a lentidão. */
export const AJUSTES_DA_VOZ = { stability: 0.75, similarity_boost: 0.85, style: 0, use_speaker_boost: true, speed: VELOCIDADE_PADRAO } as const;
