import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cotaAte,
  interrupcaoAtrasada,
  intervaloMinimoMs,
  motivoDoMomento,
  motivoDoRitmo,
  orcamentoDeInterrupcoes,
  pausaDasMaosParaFalarMs,
  RITMO,
} from "../politica";

const MIN = 60_000;

test("orçamento escala com a duração, entre o mínimo e o máximo", () => {
  assert.equal(orcamentoDeInterrupcoes(15), 10);
  assert.equal(orcamentoDeInterrupcoes(30), 20);
  assert.equal(orcamentoDeInterrupcoes(35), 20);
  assert.equal(orcamentoDeInterrupcoes(5), RITMO.orcamentoMinimo);
  assert.equal(orcamentoDeInterrupcoes(90), RITMO.orcamentoMaximo);
  // #140: 1,5 min de ritmo médio e metade disso como intervalo mínimo.
  assert.equal(intervaloMinimoMs(30), 45_000);
});

test("cota proporcional: não gasta o orçamento no começo", () => {
  assert.equal(cotaAte(0, 8), 2);
  assert.equal(cotaAte(0.25, 8), 4);
  assert.equal(cotaAte(1, 8), 8);
  const base = { agora: 5 * MIN, inicioEm: 0, duracaoMin: 30, ultimaEm: 1 * MIN };
  // Aos 5 de 30 min (cota 5), a sexta espera, mesmo depois de um marco.
  assert.match(motivoDoRitmo({ ...base, feitas: 5, marco: true })?.codigo ?? "", /cota/);
  assert.equal(motivoDoRitmo({ ...base, feitas: 1, ultimaEm: 2 * MIN }), null);
});

test("intervalo entre interrupções; o marco reduz ao respiro", () => {
  const base = { inicioEm: 0, duracaoMin: 30, feitas: 2, ultimaEm: 10 * MIN, ultimaConversaFimEm: 10 * MIN + 10_000 };
  assert.match(motivoDoRitmo({ ...base, agora: 10 * MIN + 40_000 })?.codigo ?? "", /intervalo/);
  assert.equal(motivoDoRitmo({ ...base, agora: 10 * MIN + 40_000, marco: true }), null);
  assert.equal(motivoDoRitmo({ ...base, agora: 11 * MIN + 5_000 }), null);
  // Marco logo depois de uma conversa ainda respeita o respiro curto.
  assert.match(motivoDoRitmo({ ...base, agora: 10 * MIN + 20_000, marco: true })?.codigo ?? "", /respiro/);
  assert.equal(motivoDoRitmo({ ...base, agora: 10 * MIN + 30_000, marco: true }), null);
  assert.match(motivoDoRitmo({ ...base, feitas: 20, agora: 29 * MIN, marco: true })?.codigo ?? "", /orcamento/);
});

test("momento: nunca no meio da fala; mãos paradas, curta depois de marco, longa focado", () => {
  assert.match(motivoDoMomento({ maosParadasHaMs: 60_000, falaHaMs: 300 }) ?? "", /falando/);
  assert.match(motivoDoMomento({ maosParadasHaMs: 3_000, falaHaMs: Infinity }) ?? "", /ativo/);
  assert.equal(motivoDoMomento({ maosParadasHaMs: 3_000, falaHaMs: Infinity, marco: true }), null);
  assert.equal(motivoDoMomento({ maosParadasHaMs: 9_000, falaHaMs: 2_000 }), null);
  // Brecha curta na fala basta, desde que as mãos estejam paradas.
  assert.match(motivoDoMomento({ maosParadasHaMs: 9_000, falaHaMs: 1_000 }) ?? "", /falando/);
  assert.match(motivoDoMomento({ maosParadasHaMs: 9_000, falaHaMs: Infinity, focado: true }) ?? "", /melhoria/);
});

test("atraso: muito tempo sem interromper com cota livre", () => {
  const base = { inicioEm: 0, duracaoMin: 30, feitas: 2, ultimaEm: 5 * MIN };
  // Um ritmo (1,5 min numa entrevista de 30) sem interromper já é atraso.
  assert.equal(interrupcaoAtrasada({ ...base, agora: 6 * MIN + 29_000 }), false);
  assert.equal(interrupcaoAtrasada({ ...base, agora: 6 * MIN + 30_000 }), true);
  // Sem cota livre não é atraso.
  assert.equal(interrupcaoAtrasada({ ...base, feitas: 20, agora: 25 * MIN }), false);
});

test("paciência: quem não para de digitar ou desenhar também recebe pergunta numa pausa curta", () => {
  const ocupado = { maosParadasHaMs: 2_500, falaHaMs: Infinity };
  assert.match(motivoDoMomento(ocupado) ?? "", /ativo/);
  assert.equal(motivoDoMomento({ ...ocupado, esperandoHaMs: RITMO.pacienciaMs }), null);
  assert.equal(motivoDoMomento({ ...ocupado, atrasada: true }), null);
  // Mesmo com paciência, nunca no meio da fala.
  assert.match(motivoDoMomento({ ...ocupado, falaHaMs: 500, esperandoHaMs: 60_000 }) ?? "", /falando/);
});

test("pausa das mãos para falar: ponto natural e espera encurtam, para quem trabalha sem parar também ser perguntado", () => {
  assert.equal(pausaDasMaosParaFalarMs({ esperandoHaMs: 0 }), RITMO.pausaDasMaosMs);
  // Acabou uma linha (ou soltou uma peça no quadro): uma pausa curta já serve.
  assert.equal(pausaDasMaosParaFalarMs({ esperandoHaMs: 0, pontoNatural: true }), RITMO.pausaDasMaosNoPontoNaturalMs);
  // A pergunta já espera: a mesma pausa curta, em qualquer ponto.
  assert.equal(pausaDasMaosParaFalarMs({ esperandoHaMs: RITMO.esperaParaPausaCurtaMs }), RITMO.pausaDasMaosNoPontoNaturalMs);
  // Esperou demais: qualquer respiro entre duas teclas.
  assert.equal(pausaDasMaosParaFalarMs({ esperandoHaMs: RITMO.esperaParaQualquerRespiroMs }), RITMO.pausaDasMaosNoLimiteMs);
  assert.ok(RITMO.pausaDasMaosNoLimiteMs < RITMO.pausaDasMaosNoPontoNaturalMs && RITMO.pausaDasMaosNoPontoNaturalMs < RITMO.pausaDasMaosMs);
});
