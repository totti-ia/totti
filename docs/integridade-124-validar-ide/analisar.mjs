import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ler = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const manifesto = JSON.parse(ler('execucoes.json'));
assert.ok(manifesto.fim && manifesto.execucoes.every((e) => e.status !== 'executando'), 'Esperar o fim das execuções');
const fonte = ler('validar-conversa-ide.fonte.txt');
const nomes = [...fonte.slice(fonte.indexOf('const CASOS:')).matchAll(/nome: "([^"]+)"/g)].map((m) => m[1]);
assert.equal(nomes.length, 13);
const q = (v, p) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))];
const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let x = 1n;
  for (let i = 1; i <= k; i++) x = x * BigInt(n - k + i) / BigInt(i);
  return Number(x);
};
function fisher(b, nb, a, na) {
  const acertos = a + b, total = nb + na;
  let p = 0;
  for (let x = Math.max(0, nb - (total - acertos)); x <= b; x++) p += choose(acertos, x) * choose(total - acertos, nb - x) / choose(total, nb);
  return Math.min(1, p);
}
assert.ok(Math.abs(fisher(0, 2, 2, 2) - 1 / 6) < 1e-12);
assert.ok(Math.abs(fisher(1, 2, 1, 2) - 5 / 6) < 1e-12);
assert.ok(Math.abs(fisher(2, 2, 0, 2) - 1) < 1e-12);
function bootstrap(grupos) {
  let state = 20261121;
  const random = () => {
    let t = state += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const dif = { p50: [], p95: [] };
  for (let i = 0; i < 20000; i++) {
    const sorteados = grupos.map(() => grupos[Math.floor(random() * grupos.length)]);
    const a = sorteados.flatMap((g) => g.A), b = sorteados.flatMap((g) => g.B);
    dif.p50.push(q(b, .5) - q(a, .5));
    dif.p95.push(q(b, .95) - q(a, .95));
  }
  const a = grupos.flatMap((g) => g.A), b = grupos.flatMap((g) => g.B);
  return Object.fromEntries([['p50', .5], ['p95', .95]].map(([m, p]) => [m, {
    deltaBmenosA: q(b, p) - q(a, p), ic95: [q(dif[m], .025), q(dif[m], .975)],
  }]));
}
const execucoes = manifesto.execucoes.map((e) => {
  const stdout = ler(e.stdout), stderr = ler(e.stderr);
  const casos = stdout.split(/\r?\n/).filter((l) => l.startsWith('{"caso":')).map((l) => JSON.parse(l));
  const linhas = stderr.split(/\r?\n/).filter((l) => nomes.some((n) => l.startsWith(n + ': ')));
  let motivos = [];
  let completa = !e.interrupcao && !['limite_excedido', 'interrompida', 'interrupcao_do_ambiente'].includes(e.status)
    && casos.length === 13 && new Set(casos.map((c) => c.caso)).size === 13
    && nomes.every((n) => casos.some((c) => c.caso === n)) && casos.every((c) => Number.isFinite(c.ms) && c.ms >= 0);
  if (e.code === 0) completa &&= linhas.length === 0;
  else {
    completa &&= e.code === 1 && linhas.length === 1;
    if (linhas.length === 1) {
      motivos = linhas[0].split('; ');
      const contagem = stderr.match(/(?:^|\n)(\d+) !== 0(?:\r?\n|$)/);
      completa &&= !!contagem && Number(contagem[1]) === motivos.length && motivos.every((m) => nomes.some((n) => m.startsWith(n + ': ')));
    }
  }
  for (const c of casos) {
    c.motivos = motivos.filter((m) => m.startsWith(c.caso + ': '));
    c.ok = completa ? c.motivos.length === 0 : null;
  }
  const tempos = casos.map((c) => c.ms);
  const resumoOriginal = stdout.match(/p50 (\d+) ms, máx (\d+) ms/);
  if (completa) {
    assert.ok(resumoOriginal, `${e.id}: resumo original ausente`);
    assert.equal(q(tempos, .5), Number(resumoOriginal[1]));
    assert.equal(Math.max(...tempos), Number(resumoOriginal[2]));
  }
  return { ...e, completa, casos, motivos, acertos: completa ? casos.filter((c) => c.ok).length : null,
    p50: q(tempos, .5), p95: q(tempos, .95), maximo: Math.max(...tempos),
    filtroIndisponivel: (stderr.match(/\[spoilerFilter\] filtro de fala indisponível/g) ?? []).length,
    falhasLlmEntrevistador: (stderr.match(/\[interviewer\] falha no LLM:/g) ?? []).length,
  };
});
const completas = execucoes.length === 6 && execucoes.every((e) => e.completa);
const pares = [];
let agregado = null;
if (completas) {
  const comparar = (aa, bb) => {
    const casosA = aa.flatMap((r) => r.casos), casosB = bb.flatMap((r) => r.casos);
    const a = casosA.filter((c) => c.ok).length, b = casosB.filter((c) => c.ok).length;
    const grupos = nomes.map((nome) => ({ nome, A: aa.map((r) => r.casos.find((c) => c.caso === nome).ms), B: bb.map((r) => r.casos.find((c) => c.caso === nome).ms) }));
    return {
      A: { acertos: a, total: casosA.length, p50: q(casosA.map((c) => c.ms), .5), p95: q(casosA.map((c) => c.ms), .95) },
      B: { acertos: b, total: casosB.length, p50: q(casosB.map((c) => c.ms), .5), p95: q(casosB.map((c) => c.ms), .95) },
      fisherUnilateral: fisher(b, casosB.length, a, casosA.length), bootstrap: bootstrap(grupos), grupos,
    };
  };
  for (let rodada = 1; rodada <= 3; rodada++) pares.push({ rodada, uso: 'somente descritivo', ...comparar(execucoes.filter((e) => e.versao === 'A' && e.rodada === rodada), execucoes.filter((e) => e.versao === 'B' && e.rodada === rodada)) });
  agregado = comparar(execucoes.filter((e) => e.versao === 'A').sort((a, b) => a.rodada - b.rodada), execucoes.filter((e) => e.versao === 'B').sort((a, b) => a.rodada - b.rodada));
}
const pioras = agregado ? {
  acertos: agregado.fisherUnilateral < .05,
  p50: agregado.bootstrap.p50.ic95[0] > 0,
  p95: agregado.bootstrap.p95.ic95[0] > 0,
} : null;
const resultado = { protocolo: manifesto.protocolo, completas, execucoes, pares, agregado, pioras,
  bootstrap: { algoritmo: 'Mulberry32', seed: 20261121, repeticoes: 20000, reamostragem: '13 grupos de casos com reposição; A/B juntos; agregado preserva três rodadas de cada caso', ic: 'percentil 2,5–97,5; v[min(n−1,floor(n*p))]' },
  conclusao: !completas ? 'comparação incompleta; sem conclusão' : Object.values(pioras).some(Boolean) ? 'piora detectada pelo critério prévio' : 'sem piora detectada com este tamanho de amostra',
};
fs.writeFileSync(path.join(dir, 'resumo.json'), JSON.stringify(resultado, null, 2) + '\n');
console.log(JSON.stringify({ completas, execucoes: execucoes.map((e) => ({ id: e.id, acertos: e.acertos, p50: e.p50, p95: e.p95, filtroIndisponivel: e.filtroIndisponivel, motivos: e.motivos })), agregado: agregado && { A: agregado.A, B: agregado.B, fisherUnilateral: agregado.fisherUnilateral, bootstrap: agregado.bootstrap }, pares: pares.map(({ grupos, ...p }) => p), pioras, conclusao: resultado.conclusao }, null, 2));
