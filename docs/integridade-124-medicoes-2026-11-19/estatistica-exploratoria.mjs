import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = 'C:/Users/Nicolas/PROJETOS/totti/.cate/worktrees/124-conversa/docs/integridade-124-medicoes-2026-11-19';
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let x = 1n;
  for (let i = 1; i <= k; i++) x = x * BigInt(n - k + i) / BigInt(i);
  return Number(x);
};
// Tabela [[acertos B, erros B], [acertos A, erros A]]; H1: taxa B < taxa A.
function fisherMenor(b, nb, a, na) {
  const totalAcertos = a + b, total = nb + na;
  const p = (x) => choose(totalAcertos, x) * choose(total - totalAcertos, nb - x) / choose(total, nb);
  let sum = 0;
  for (let x = Math.max(0, nb - (total - totalAcertos)); x <= b; x++) sum += p(x);
  return Math.min(1, sum);
}
assert.ok(Math.abs(fisherMenor(0, 2, 2, 2) - 1 / 6) < 1e-12);
assert.ok(Math.abs(fisherMenor(1, 2, 1, 2) - 5 / 6) < 1e-12);
assert.ok(Math.abs(fisherMenor(2, 2, 0, 2) - 1) < 1e-12);
const SEED = 20261119, REPETICOES = 20000;
let state = SEED;
const random = () => {
  let t = state += 0x6d2b79f5;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const q = (v, p) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))];
function bootstrap(a, b) {
  const differences = { p50: [], p95: [] };
  for (let i = 0; i < REPETICOES; i++) {
    const aa = a.map(() => a[Math.floor(random() * a.length)]).sort((x, y) => x - y);
    const bb = b.map(() => b[Math.floor(random() * b.length)]).sort((x, y) => x - y);
    for (const [name, p] of [['p50', .5], ['p95', .95]]) differences[name].push(bb[Math.min(bb.length - 1, Math.floor(p * bb.length))] - aa[Math.min(aa.length - 1, Math.floor(p * aa.length))]);
  }
  return Object.fromEntries([['p50', .5], ['p95', .95]].map(([name, p]) => [name, { deltaBmenosA: q(b, p) - q(a, p), ic95: [q(differences[name], .025), q(differences[name], .975)] }]));
}
const summary = JSON.parse(read('resumo.json'));
const r = (id) => summary.execucoes.find((e) => e.id === id);
const pairs = [['124-conversa-1-base', '124-conversa-2-pr'], ['124-conversa-4-base', '124-conversa-3-pr']];
const conversa = pairs.map(([a, b], i) => ({ rodada: i + 1, A: r(a).metricas, B: r(b).metricas, fisherUnilateral: fisherMenor(r(b).metricas.acertos, r(b).metricas.casos, r(a).metricas.acertos, r(a).metricas.casos), bootstrap: null, motivo: 'bench-conversa roda silencioso e só imprime agregados; os ms de cada caso não foram persistidos. Tempos do provedor não equivalem ao tempo total do caso.' }));
conversa.push({ rodada: 'agrupadas', A: { acertos: 20, casos: 28 }, B: { acertos: 18, casos: 28 }, fisherUnilateral: fisherMenor(18, 28, 20, 28) });
const vectors = {};
for (const e of summary.execucoes.filter((e) => e.instrumento === 'quadro')) {
  // O prompt de análise deste instrumento tem 6071 tokens em todas as chamadas registradas.
  // O logger de openaiCompat imprime o mesmo durationMs devolvido e usado pelo benchmark.
  const v = [...read(e.log).matchAll(/^\[featherless\] google\/gemma-4-26B-A4B-it (\d+)ms in=6071 out=\d+/gm)].map((m) => +m[1]);
  assert.equal(v.length, e.metricas.chamadas, `${e.id}: quantidade do vetor`);
  assert.equal(q(v, .5), e.metricas.p50, `${e.id}: p50`);
  assert.equal(q(v, .95), e.metricas.p95, `${e.id}: p95`);
  vectors[e.id] = v;
}
const quadro = [['124-quadro-1-base', '124-quadro-2-pr'], ['124-quadro-4-base', '124-quadro-3-pr']].map(([a, b], i) => {
  const [okA, nA] = r(a).metricas.aprovadas.split('/').map(Number), [okB, nB] = r(b).metricas.aprovadas.split('/').map(Number);
  return { rodada: i + 1, A: { acertos: okA, casos: nA, chamadasConcluidas: vectors[a].length }, B: { acertos: okB, casos: nB, chamadasConcluidas: vectors[b].length }, fisherUnilateral: fisherMenor(okB, nB, okA, nA), bootstrap: bootstrap(vectors[a], vectors[b]) };
});
quadro.push({ rodada: 'agrupadas', A: { acertos: 3, casos: 4 }, B: { acertos: 1, casos: 4 }, fisherUnilateral: fisherMenor(1, 4, 3, 4) });
const placarA = JSON.parse(read(r('124-placar-6-base-retomada').metricas.arquivo));
const placarB = JSON.parse(read(r('124-placar-5-pr-retomada').metricas.arquivo));
const times = (p, type) => [...(type === 'perguntar' ? p.casos.map((c) => c.ms) : []), ...p.conversas.flatMap((c) => c.turnos.filter((t) => t.fonte === type).map((t) => t.ms ?? 0))];
const result = {
  natureza: 'Análise exploratória pedida após as execuções; não altera critérios de aceitação.',
  fisher: { alternativa: 'H1: taxa de acerto da implementação B menor que a da base A', unilateral: true, ajusteMultiplo: false },
  bootstrap: { seed: SEED, repeticoes: REPETICOES, intervalo: 'percentil 2,5%–97,5%', delta: 'B menos A, em ms', reamostragem: 'independente por chamada, com reposição; exploratório, sem correção de dependência entre turnos ou multiplicidade' },
  conversa, quadro, vetoresQuadro: vectors,
  validarConversaIde: { executado: false, motivo: 'Não fazia parte do protocolo original; passou a ser pedido na revisão, que proíbe novas chamadas de LLM até análise.' },
  placarRetomada: { A: '124-placar-6-base-retomada', B: '124-placar-5-pr-retomada', fisherCasos: fisherMenor(15, 18, 15, 18), perguntar: bootstrap(times(placarA, 'perguntar'), times(placarB, 'perguntar')), analise: bootstrap(times(placarA, 'analise'), times(placarB, 'analise')) },
};
fs.writeFileSync(path.join(dir, 'estatistica-exploratoria.json'), JSON.stringify(result, null, 2) + '\n');
fs.copyFileSync(new URL(import.meta.url), path.join(dir, 'estatistica-exploratoria.mjs'));
console.log(JSON.stringify({ conversa: result.conversa, quadro: result.quadro, placar: result.placarRetomada }, null, 2));
