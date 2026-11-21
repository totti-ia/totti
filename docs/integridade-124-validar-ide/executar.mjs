// Executar somente após liberação da máquina/conta. Um processo por vez; não sobrescreve dados.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = 'C:/Users/Nicolas/PROJETOS/totti';
const output = path.dirname(fileURLToPath(import.meta.url));
const manifesto = path.join(output, 'execucoes.json');
assert.ok(!existsSync(manifesto), 'Manifesto existente: não substituir execuções');
const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const versoes = {
  A: { cwd: path.join(root, '.cate/worktrees/124-ide-base-medicao'), commit: '0f4efec3d6546569f8e68942fd72052b64271bc5' },
  B: { cwd: path.join(root, '.cate/worktrees/124-ide-pr-medicao'), commit: 'ff7558c865a35f646c80b089d6ff2e448438e342' },
};
const arquivos = ['scripts/validar-conversa-ide.ts', 'scripts/validar-conversa.ts', 'scripts/_gasto.ts', 'package-lock.json', 'package.json', 'tsconfig.json', 'lib/llm/index.ts', 'lib/agents/interviewer.ts'];
for (const v of Object.values(versoes)) {
  assert.equal(git(v.cwd, ['rev-parse', 'HEAD']), v.commit);
  assert.equal(git(v.cwd, ['status', '--porcelain', '--untracked-files=no']), '');
  v.tree = git(v.cwd, ['rev-parse', 'HEAD^{tree}']);
  v.sha256 = Object.fromEntries(arquivos.map((f) => [f, sha(path.join(v.cwd, f))]));
}
assert.deepEqual(versoes.A.sha256, versoes.B.sha256, 'Scripts/config/dependências devem coincidir');
assert.equal(git(output, ['log', '-1', '--format=%h', '--', 'protocolo.md']), 'fe05360', 'Critério deve estar commitado antes da medição');
process.loadEnvFile(path.join(root, '.env.local'));
const env = { ...process.env, ARMAZENAMENTO: 'memoria', CONVERSA_FEATHERLESS_MODEL: 'google/gemma-4-26B-A4B-it', FEATHERLESS_CONCURRENCY: '2', PAGO: '0', AGENTE_FAKE: '0' };
delete env.SO_CASOS;
delete env.DEBUG_FILA;
delete env.OPENROUTER_API_KEY;
assert.ok(env.FEATHERLESS_API_KEY, 'Featherless sem chave; não iniciar');
const dados = {
  protocolo: { commit: git(output, ['rev-parse', 'HEAD']), sha256: sha(path.join(output, 'protocolo.md')), criterioAntesDaPrimeiraExecucao: true },
  inicio: new Date().toISOString(), node: process.version,
  npm: spawnSync('cmd.exe', ['/d', '/c', 'npm --version'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim(),
  ambiente: Object.fromEntries(Object.entries(env).filter(([k]) => /_MODEL$|_CONCURRENCY$|^ARMAZENAMENTO$|^PAGO$|^AGENTE_FAKE$|^TOTTI_QUADRO$/.test(k))),
  openrouterDesligada: true, versoes, execucoes: [],
};
const save = () => writeFileSync(manifesto, JSON.stringify(dados, null, 2) + '\n');
save();
let child;
let parar = false;
const kill = () => {
  if (child && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
};
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => { parar = true; kill(); });
const ordem = [['A', 1], ['B', 1], ['B', 2], ['A', 2], ['A', 3], ['B', 3]];
for (const [versao, rodada] of ordem) {
  if (parar) break;
  const id = `${dados.execucoes.length + 1}-${versao}${rodada}`;
  const r = {
    id, versao, rodada, inicio: new Date().toISOString(), limiteMs: 600000, status: 'executando',
    stdout: `${id}.stdout.log`, stderr: `${id}.stderr.log`, combinado: `${id}.log`,
    comando: ['node', '--import', 'tsx', '--env-file-if-exists=<clone>/.env.local', 'scripts/validar-conversa-ide.ts'],
  };
  dados.execucoes.push(r); save();
  console.log(`INICIO ${id}`);
  const stdout = createWriteStream(path.join(output, r.stdout), { flags: 'wx' });
  const stderr = createWriteStream(path.join(output, r.stderr), { flags: 'wx' });
  const combinado = createWriteStream(path.join(output, r.combinado), { flags: 'wx' });
  const inicio = Date.now();
  child = spawn(process.execPath, ['--import', 'tsx', `--env-file-if-exists=${path.join(root, '.env.local')}`, 'scripts/validar-conversa-ide.ts'], {
    cwd: versoes[versao].cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  r.pid = child.pid; save();
  child.stdout.pipe(stdout); child.stderr.pipe(stderr);
  child.stdout.on('data', (b) => combinado.write(b));
  child.stderr.on('data', (b) => combinado.write(b));
  let linhas = '';
  child.stdout.on('data', (b) => {
    linhas += b.toString();
    const partes = linhas.split(/\r?\n/); linhas = partes.pop();
    for (const linha of partes) {
      if (linha.startsWith('{"caso":')) {
        const item = JSON.parse(linha);
        console.log(`${id}: ${item.caso} (${item.ms} ms)`);
      }
    }
  });
  let limite = false;
  let interrupcao = null;
  let ultimo = Date.now();
  const monitor = setInterval(() => {
    const agora = Date.now();
    if (agora - ultimo > 30000) { interrupcao = { em: new Date().toISOString(), intervaloMs: agora - ultimo }; parar = true; kill(); }
    ultimo = agora;
  }, 1000);
  const teto = setTimeout(() => { limite = true; kill(); }, r.limiteMs);
  const fim = await new Promise((resolve) => {
    child.on('error', (e) => resolve({ erro: e.message }));
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(teto); clearInterval(monitor);
  await Promise.all([stdout, stderr].map((stream) => stream.closed ? Promise.resolve() : new Promise((resolve) => stream.on('close', resolve))));
  await new Promise((resolve) => combinado.end(resolve));
  Object.assign(r, fim, {
    fim: new Date().toISOString(), duracaoMs: Date.now() - inicio, interrupcao,
    status: interrupcao ? 'interrupcao_do_ambiente' : limite ? 'limite_excedido' : parar ? 'interrompida' : fim.code === 0 ? 'terminou' : 'erro_ou_assercao',
    sha256: Object.fromEntries([r.stdout, r.stderr, r.combinado].map((f) => [f, sha(path.join(output, f))])),
  });
  save();
  console.log(`FIM ${id}: ${r.status}; code=${r.code}; ${Math.round(r.duracaoMs / 1000)} s`);
  child = undefined;
}
dados.fim = new Date().toISOString(); dados.interrompido = parar; save();
console.log(`MEDICOES ENCERRADAS: ${dados.execucoes.length} execuções`);
