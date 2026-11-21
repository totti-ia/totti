import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = 'C:/Users/Nicolas/PROJETOS/totti';
const cwd = path.join(root, '.cate/worktrees/124-conversa');
const folder = path.join(cwd, 'docs/integridade-124-medicoes-2026-11-19');
const graph = path.join(root, '.cate/medicoes-123/ferramentas/grafo.mjs');
const entries = ['scripts/bench-conversa.ts', 'scripts/bench-quadro.ts', 'scripts/placar-quadro/index.ts', 'scripts/medir-rascunho.ts'];
const r = spawnSync(process.execPath, [graph, 'c91d3ce', '78b30d2', ...entries], { cwd, encoding: 'utf8', windowsHide: true });
if (r.status !== 0) throw new Error(r.stderr);
fs.writeFileSync(path.join(folder, 'grafo-imports.log'), r.stdout + r.stderr);
fs.copyFileSync(graph, path.join(folder, 'grafo-imports.mjs'));
const p = JSON.parse(fs.readFileSync(path.join(folder, '2026-11-20-00-49-124-placar-5-pr-retomada.json'), 'utf8'));
const failures = p.conversas.flatMap((c) => c.turnos.filter((t) => t.falhou).map((t) => ({
  persona: c.persona, turno: t.n, fase: t.fase, fonte: t.fonte, ms: t.ms,
  candidatoAnterior: c.turnos.filter((x) => x.fonte === 'candidato' && x.n < t.n).at(-1)?.texto,
  registro: 'falhou=true; código tipado do ErroLlm não persistido pelo simulador',
  inferencia: `Duração compatível com teto de ${t.fonte === 'analise' ? 15000 : 8000} ms; não prova do código de erro.`,
})));
fs.writeFileSync(path.join(folder, 'cinco-falhas.json'), JSON.stringify({ origem: '2026-11-20-00-49-124-placar-5-pr-retomada.json', falhasEmCasosFixos: p.casos.filter((c) => c.falhas.includes('falha do provedor')).length, falhas: failures, limitacao: 'simulacao.ts define log: () => {} e só serializa falhou; não se pode recuperar ErroLlm.codigo das medições existentes.' }, null, 2) + '\n');
const git = (...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
fs.writeFileSync(path.join(folder, 'rebase-e-validacao.json'), JSON.stringify({
  main: git('rev-parse', 'main'),
  baseMedida: 'c91d3ce65c802dfd40f342c88f456a118d4f8f40',
  arvoreBase: git('rev-parse', 'c91d3ce^{tree}'), arvoreMain: git('rev-parse', 'main^{tree}'),
  codigoAntes: '78b30d28407e3cd2f08b74b51c45e174808bfcc8', codigoDepois: git('rev-parse', 'ff7558c'),
  arvoreCodigoAntes: git('rev-parse', '78b30d2^{tree}'), arvoreCodigoDepois: git('rev-parse', 'ff7558c^{tree}'),
  documentacaoAntes: 'e5a0bc2', documentacaoDepois: 'aa60087',
  arvoreDocumentacaoAntes: git('rev-parse', 'e5a0bc2^{tree}'), arvoreDocumentacaoDepois: git('rev-parse', 'aa60087^{tree}'),
  validacaoDepoisDoRebase: { testIntegridade: { comando: 'npm run test:integridade', codigo: 0, testes: 72, falhas: 0, redeSimulada: true }, typescript: { comando: 'node node_modules/typescript/bin/tsc --noEmit --incremental false', codigo: 0 } },
}, null, 2) + '\n');
fs.copyFileSync(path.join(root, '.cate/briefings/124-revisao.md'), path.join(folder, 'solicitacao-revisao.md'));
fs.copyFileSync(new URL(import.meta.url), path.join(folder, 'auditar.mjs'));
console.log(r.stdout);
console.log(`${failures.length} falhas localizadas; metadados do rebase registrados.`);
