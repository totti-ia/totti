import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = 'C:/Users/Nicolas/PROJETOS/totti';
const cwd = path.join(root, '.cate/worktrees/124-conversa');
const folder = path.join(cwd, 'docs/integridade-124-medicoes-2026-11-19');
const summary = JSON.parse(fs.readFileSync(path.join(folder, 'resumo.json'), 'utf8'));
const artifact = (id) => path.join(folder, summary.execucoes.find((r) => r.id === id).metricas.arquivo);
const pairs = [
  { id: 'comparacao-inicial', a: '124-placar-1-base', b: '124-placar-2-pr' },
  { id: 'comparacao-retomada', a: '124-placar-6-base-retomada', b: '124-placar-5-pr-retomada' },
];
for (const p of pairs) {
  const r = spawnSync(process.execPath, [`--env-file=${path.join(root, '.env.local')}`, path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'scripts/placar-quadro/index.ts', '--comparar', artifact(p.a), artifact(p.b)], { cwd, encoding: 'utf8', windowsHide: true });
  p.codigo = r.status; p.log = `${p.id}.log`;
  fs.writeFileSync(path.join(folder, p.log), r.stdout + r.stderr);
  console.log(`${p.id}: código ${r.status}\n${r.stdout}${r.stderr}`);
}
fs.writeFileSync(path.join(folder, 'comparacoes.json'), JSON.stringify({ chamadasDeLlm: 0, pares: pairs }, null, 2) + '\n');
