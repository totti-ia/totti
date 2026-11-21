import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const root = 'C:/Users/Nicolas/PROJETOS/totti';
const impl = path.join(root, '.cate/worktrees/124-conversa');
const base = path.join(root, '.cate/worktrees/124-base-medicao');
const output = path.join(impl, 'docs/integridade-124-medicoes-2026-11-19');
mkdirSync(output, { recursive: true });
const manifestPath = path.join(output, 'retomada.json');
if (readdirSync(output).includes('retomada.json')) throw new Error('Já existe manifesto: não sobrescrever medições');
const definitions = [
  { id: 'conversa', script: 'scripts/bench-conversa.ts', args: ['featherless:google/gemma-4-26B-A4B-it'], rounds: '1', minutes: 10 },
  { id: 'quadro', script: 'scripts/bench-quadro.ts', args: ['featherless:google/gemma-4-26B-A4B-it'], rounds: '2', minutes: 15 },
  { id: 'transcricao', script: 'scripts/medir-transcricao.ts', args: ['--pago'], rounds: '1', minutes: 2, order: ['B', 'A'] },
  { id: 'rascunho', script: 'scripts/medir-rascunho.ts', args: ['sala', 'ide'], rounds: '1', minutes: 20 },
  { id: 'placar', script: 'scripts/placar-quadro/index.ts', args: [], rounds: '1', minutes: 45 },
];
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).stdout.trim();
const manifest = {
  protocolo: 'retomada.md', inicio: new Date().toISOString(),
  versoes: { A: { cwd: base, commit: git(base, ['rev-parse', 'HEAD']) }, B: { cwd: impl, commit: git(impl, ['rev-parse', 'HEAD']) } },
  ambiente: { arquivo: '.env.local do clone principal (conteúdo privado)', ARMAZENAMENTO: 'memoria' },
  execucoes: [],
};
const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
let child;
let stopped = false;
const kill = () => { if (child && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; kill(); });
save();
for (const definition of definitions.filter((item) => item.id === 'placar')) {
  const order = ['B', 'A'];
  for (let i = 0; i < order.length && !stopped; i++) {
    const version = order[i];
    const label = `124-placar-${i + 5}-${version === 'A' ? 'base' : 'pr'}-retomada`;
    const cwd = manifest.versoes[version].cwd;
    const args = [`--env-file=${path.join(root, '.env.local')}`, path.join(root, 'node_modules/tsx/dist/cli.mjs'), definition.script, ...definition.args];
    if (definition.id === 'placar') args.push('--rotulo', label);
    const run = { ordem: manifest.execucoes.length + 1, id: label, instrumento: definition.id, versao: version, inicio: new Date().toISOString(), comando: ['node', '--env-file=<clone>/.env.local', '<clone>/node_modules/tsx/dist/cli.mjs', definition.script, ...args.slice(3)], ambiente: { ARMAZENAMENTO: 'memoria', RODADAS: definition.rounds }, limiteMs: definition.minutes * 60_000, log: `${label}.log`, status: 'executando' };
    manifest.execucoes.push(run); save();
    console.log(`INICIO ${run.ordem}: ${label}`);
    const log = createWriteStream(path.join(output, run.log));
    const start = Date.now();
    child = spawn(process.execPath, args, { cwd, env: { ...process.env, ARMAZENAMENTO: 'memoria', RODADAS: definition.rounds }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    let timedOut = false; let interrupcao = null; let ultimoTique = Date.now(); const monitor = setInterval(() => { const agora = Date.now(); const intervalo = agora - ultimoTique; ultimoTique = agora; if (intervalo > 30000) { interrupcao = { intervaloMs: intervalo, em: new Date().toISOString() }; stopped = true; kill(); } }, 1000);
    const timeout = setTimeout(() => { timedOut = true; kill(); }, run.limiteMs);
    const result = await new Promise((resolve) => { child.on('error', (error) => resolve({ erro: error.message })); child.on('close', (code, signal) => resolve({ code, signal })); });
    clearTimeout(timeout); clearInterval(monitor);
    await new Promise((resolve) => log.end(resolve));
    Object.assign(run, { fim: new Date().toISOString(), duracaoMs: Date.now() - start, ...result, interrupcao, status: interrupcao ? 'interrupcao_do_ambiente' : stopped ? 'interrompida' : timedOut ? 'limite_excedido' : result.code === 0 ? 'terminou' : 'erro', artefatos: [] });
    if (definition.id === 'placar') {
      const artifacts = path.join(cwd, 'test-results/placar-quadro');
      try { for (const file of readdirSync(artifacts).filter((name) => name.includes(label))) { copyFileSync(path.join(artifacts, file), path.join(output, file)); run.artefatos.push(file); } } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    save();
    console.log(`FIM ${label}: ${run.status}, ${run.code ?? '-'}, ${Math.round(run.duracaoMs / 1000)} s`);
    child = undefined;
  }
}
manifest.fim = new Date().toISOString(); manifest.interrompido = stopped; save();
console.log(`MEDICOES ENCERRADAS: ${manifest.execucoes.length} execuções`);

