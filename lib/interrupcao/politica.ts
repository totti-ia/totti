/**
 * Política comum de interrupção dos dois agentes (quadro e live coding): QUANDO o agente pode tomar a vez sem ser
 * chamado. O QUE perguntar é do LLM; aqui só regras determinísticas, as mesmas constantes nos dois, escaladas pela
 * duração da entrevista. Medido com scripts/linha-do-tempo-quadro.ts e scripts/simulate.ts --linha-do-tempo.
 *
 * Dois portões:
 * - ritmo (`motivoDoRitmo`): orçamento da entrevista, cota proporcional ao tempo e intervalo entre interrupções.
 *   Abertura, encerramento e a mudança no problema ficam fora (`extra`).
 * - momento (`motivoDoMomento`): só numa pausa real (mãos paradas e uma brecha na fala), nunca no meio de uma
 *   fala, digitação ou desenho.
 * Um marco (run verde, voltou a falhar, colagem, retorno de desafio, etapa concluída, começo do aprofundamento)
 * encurta o intervalo e a pausa: é a hora natural de falar.
 */

export const RITMO = {
  /**
   * Em média, uma interrupção a cada tantos minutos de entrevista. Com 3, numa entrevista real de quadro o candidato
   * desenhou 7 minutos e ouviu uma pergunta só: a entrevista é a conversa sobre o que ele está fazendo.
   */
  minutosPorInterrupcao: 2,
  orcamentoMinimo: 4,
  orcamentoMaximo: 20,
  /** Intervalo mínimo entre duas interrupções comuns, como fração do ritmo médio (~1 min). */
  fracaoDoRitmoEntreInterrupcoes: 0.5,
  /**
   * Respiro mínimo desde o começo e o fim da última conversa (a última fala de qualquer um dos dois). Com 45 s, numa
   * entrevista de 15 min a primeira pergunta sobre o código saía aos 3:40.
   */
  respiroMs: 30_000,
  /** Depois de um marco (primeiro run verde, colagem, começo de fase), a hora passa rápido: respiro curto. */
  respiroDeMarcoMs: 15_000,
  /** A cota pode estar adiantada em até tantas interrupções em relação ao tempo decorrido. */
  folgaDaCota: 1,
  /**
   * Pausa real: tanto tempo sem digitar nem desenhar (mãos paradas)... Com 8 s o agente só falava com o candidato
   * parado de vez: quem programa ou desenha direto, com pausas de 3 a 5 s, quase não era perguntado.
   */
  pausaRealMs: 4_000,
  /** ...e essa brecha na fala. Silêncio total longo é raro numa conversa por voz: quem fala muito nunca teria vez. */
  brechaNaFalaMs: 1_500,
  /** Depois de um marco (ou quando a pergunta já esperou demais), basta não estar no meio de uma ação. */
  pausaCurtaMs: 1_500,
  /**
   * Paciência: a pergunta que já espera há tanto tempo (ou a interrupção atrasada) se contenta com a pausa curta.
   * Sem isso, quem digita ou desenha sem parar nunca recebia pergunta.
   */
  pacienciaMs: 12_000,
  /**
   * Mesmo sem nenhuma pausa, a análise roda pelo menos uma vez nesse tempo de trabalho contínuo: a pergunta precisa
   * estar pronta quando a pausa curta chegar.
   */
  analiseMaximaSemPausaMs: 30_000,
  /** Mexendo numa melhoria que ele mesmo começou: só uma pausa longa. */
  pausaFocadoMs: 30_000,
  /** Uma dúvida pendente mais velha que isso cai quando o candidato volta a falar (ficou para trás). */
  pendenteValidaMs: 45_000,
  /** Sem interrupção há tantos ritmos (e com cota livre): a interrupção está atrasada. */
  atrasoEmRitmos: 1,
  /**
   * Pausa das mãos (digitar, desenhar) que a tela exige antes de o agente falar a pergunta que já tem pronta:
   * a de sempre; a de um ponto natural (acabou uma linha, soltou uma peça) ou de uma pergunta que já espera; e a de
   * uma pergunta que esperou demais (qualquer respiro entre duas teclas).
   */
  pausaDasMaosMs: 2_500,
  pausaDasMaosNoPontoNaturalMs: 1_200,
  pausaDasMaosNoLimiteMs: 600,
  /** A pergunta pronta espera isso para valer a pausa curta, e isso para valer qualquer respiro. */
  esperaParaPausaCurtaMs: 12_000,
  esperaParaQualquerRespiroMs: 30_000,
  /** Um marco de fase (começo do aprofundamento, do fechamento) vale por esse tempo. */
  marcoDeFaseMs: 20_000,
  /** O candidato disse que terminou: a pergunta seguinte é esperada, e o marco vale por esse tempo. */
  marcoDeConclusaoMs: 45_000,
} as const;

/**
 * Ritmo por conteúdo do quadro (#129, bloco B). Só o quadro usa: a análise do desenho só vira pergunta quando o
 * candidato fechou uma parte (ou no teto). O live coding não lê estes valores.
 */
export const RITMO_QUADRO = {
  /** Nunca duas perguntas da análise em menos de tanto tempo. A quebra de silêncio não respeita este piso. */
  pisoEntrePerguntasMs: 120_000,
  /**
   * Passado tanto tempo sem pergunta e havendo desenho novo, a pergunta é obrigatória mesmo sem parte fechada: o "ok"
   * não vale nessa análise (ver `perguntaObrigatoria`, lib/agente/sessao/politica.ts). Era 5 min; a linha do tempo com
   * o modelo real mostrou uma lacuna de 13 min sem pergunta, e o dono baixou o teto para 3 min.
   */
  tetoSemPerguntaMs: 180_000,
} as const;

/**
 * Ritmo por conteúdo do live coding (#130, item 11), o equivalente do `RITMO_QUADRO`: a pergunta da análise só vira
 * balão quando um trecho coerente ficou pronto (função terminada, primeira versão completa), e não a cada pausa de 8 s.
 * Só a IDE usa (lib/agents/policy.ts, `motivoDoConteudo`); o quadro não lê estes valores.
 */
export const RITMO_IDE = {
  /** Nunca duas perguntas da análise em menos de tanto tempo. Marco (run verde, colagem) e quebra de silêncio não respeitam. */
  pisoEntrePerguntasMs: 120_000,
  /** Passado tanto tempo sem pergunta e com código novo, a pergunta sai mesmo sem parte fechada. */
  tetoSemPerguntaMs: 180_000,
  /** Mãos paradas e calado há tanto tempo: a pergunta é a quebra de silêncio, sem esperar parte fechada nem piso. */
  quebraDeSilencioMs: 60_000,
} as const;

/** Interrupções que a entrevista comporta (fora abertura, encerramento e mudança no problema). */
export function orcamentoDeInterrupcoes(duracaoMin: number): number {
  const n = Math.round(Math.max(0, duracaoMin) / RITMO.minutosPorInterrupcao);
  return Math.min(RITMO.orcamentoMaximo, Math.max(RITMO.orcamentoMinimo, n));
}

/** Tempo médio entre interrupções (ms). */
export function ritmoMs(duracaoMin: number): number {
  return (duracaoMin * 60_000) / orcamentoDeInterrupcoes(duracaoMin);
}

export function intervaloMinimoMs(duracaoMin: number): number {
  return Math.round(ritmoMs(duracaoMin) * RITMO.fracaoDoRitmoEntreInterrupcoes);
}

/** Quantas interrupções já podem ter acontecido nesta fração (0..1) da entrevista. */
export function cotaAte(fracao: number, orcamento: number): number {
  const f = Math.min(1, Math.max(0, fracao));
  return Math.min(orcamento, Math.floor(orcamento * f) + RITMO.folgaDaCota);
}

export type Ritmo = {
  agora: number;
  /** Quando a entrevista começou. */
  inicioEm: number;
  duracaoMin: number;
  /** Interrupções que contam no orçamento (sem abertura, encerramento e mudança no problema). */
  feitas: number;
  /** Começo da última interrupção (de qualquer tipo), se houve. */
  ultimaEm: number | null;
  /** Fim da última conversa que o agente puxou, se houve. */
  ultimaConversaFimEm?: number | null;
  marco?: boolean;
};

export type MotivoRitmo = { codigo: "orcamento" | "cota" | "respiro" | "intervalo"; texto: string };

/** Por que o ritmo ainda não deixa interromper (null = deixa). */
export function motivoDoRitmo(r: Ritmo): MotivoRitmo | null {
  const orcamento = orcamentoDeInterrupcoes(r.duracaoMin);
  if (r.feitas >= orcamento) return { codigo: "orcamento", texto: `orçamento de ${orcamento} interrupções usado` };
  const fracao = (r.agora - r.inicioEm) / (r.duracaoMin * 60_000);
  const cota = cotaAte(fracao, orcamento);
  if (r.feitas >= cota) return { codigo: "cota", texto: `cota do tempo: ${r.feitas} de ${cota} até aqui` };
  const desdeConversa = r.ultimaConversaFimEm == null ? Infinity : r.agora - r.ultimaConversaFimEm;
  const desdeUltima = r.ultimaEm === null ? Infinity : r.agora - r.ultimaEm;
  const respiro = Math.min(desdeConversa, desdeUltima);
  const respiroMinimo = r.marco ? RITMO.respiroDeMarcoMs : RITMO.respiroMs;
  if (respiro < respiroMinimo) {
    return { codigo: "respiro", texto: `respiro: ${Math.floor(respiro / 1000)} s desde a última conversa (mín. ${respiroMinimo / 1000} s)` };
  }
  const intervalo = intervaloMinimoMs(r.duracaoMin);
  if (!r.marco && desdeUltima < intervalo) {
    return { codigo: "intervalo", texto: `intervalo: ${Math.floor(desdeUltima / 1000)} s desde a última interrupção (mín. ${Math.round(intervalo / 1000)} s)` };
  }
  return null;
}

export type Momento = {
  /** Tempo sem digitar nem desenhar. */
  maosParadasHaMs: number;
  /** Tempo desde a última fala do candidato (Infinity se ele não falou). */
  falaHaMs: number;
  marco?: boolean;
  /** Mexendo numa melhoria que ele mesmo começou (live coding: otimizando). */
  focado?: boolean;
  /** Há quanto tempo a pergunta espera a vez. */
  esperandoHaMs?: number;
  /** A interrupção está atrasada (ver `interrupcaoAtrasada`). */
  atrasada?: boolean;
};

/** Pausa necessária para tomar a vez agora. */
export function pausaNecessariaMs(m: Pick<Momento, "marco" | "focado" | "esperandoHaMs" | "atrasada">): number {
  if (m.marco || m.atrasada || (m.esperandoHaMs ?? 0) >= RITMO.pacienciaMs) return RITMO.pausaCurtaMs;
  return m.focado ? RITMO.pausaFocadoMs : RITMO.pausaRealMs;
}

/** Por que agora não é um bom momento para tomar a vez (null = é). */
export function motivoDoMomento(m: Momento): string | null {
  if (m.falaHaMs < RITMO.brechaNaFalaMs) return "candidato falando";
  const pausa = pausaNecessariaMs(m);
  if (m.maosParadasHaMs < pausa) {
    return `${pausa === RITMO.pausaFocadoMs ? "mexendo numa melhoria" : "candidato ativo"} (${Math.floor(m.maosParadasHaMs / 1000)} s sem mexer, mín. ${pausa / 1000} s)`;
  }
  return null;
}

/**
 * A interrupção está atrasada: faz `atrasoEmRitmos` ritmos sem nenhuma e o ritmo deixaria. Os agentes usam isso
 * para não ficar calados demais (o live coding baixa o limiar da pergunta; o quadro avisa o modelo no prompt).
 */
export function interrupcaoAtrasada(r: Ritmo): boolean {
  if (motivoDoRitmo({ ...r, marco: true }) !== null) return false;
  const desde = r.agora - (r.ultimaEm ?? r.inicioEm);
  return desde >= RITMO.atrasoEmRitmos * ritmoMs(r.duracaoMin);
}

/**
 * Quanto tempo as mãos precisam estar paradas para o agente falar a pergunta que já está pronta (na tela, depois de
 * o ritmo e o momento já terem deixado). Não é só "quando ele parar": um ponto natural do trabalho (terminou uma
 * linha, soltou uma peça no quadro) já serve, e a exigência cai conforme a pergunta espera, para quem trabalha sem
 * parar também ser perguntado.
 */
export function pausaDasMaosParaFalarMs(o: { esperandoHaMs: number; pontoNatural?: boolean }): number {
  if (o.esperandoHaMs >= RITMO.esperaParaQualquerRespiroMs) return RITMO.pausaDasMaosNoLimiteMs;
  if (o.pontoNatural || o.esperandoHaMs >= RITMO.esperaParaPausaCurtaMs) return RITMO.pausaDasMaosNoPontoNaturalMs;
  return RITMO.pausaDasMaosMs;
}
