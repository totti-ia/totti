import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = 'C:/Users/Nicolas/PROJETOS/totti';
const impl = path.join(root, '.cate/worktrees/124-conversa');
const destino = path.join(impl, 'docs/integridade-124-e2e-2026-11-21');
fs.mkdirSync(destino, { recursive: true });
const [rotulo, versao, suite = 'tempo'] = process.argv.slice(2);
if (!rotulo || !['base', '124'].includes(versao)) throw new Error('Argumentos: rotulo base|124 [tempo|voz]');
const cwd = versao === 'base' ? path.join(root, '.cate/worktrees/124-e2e-base') : impl;
const pasta = path.join(destino, rotulo);
fs.mkdirSync(pasta); // Não sobrescrever uma tentativa.
const evidencia = path.join(root, '.cate/evidencias-124-e2e', rotulo);
const config = `e2e/playwright.${suite === 'voz' ? 'voz' : 'tempo-de-resposta'}.config.ts`;
const args = [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', config, '--output', evidencia, '--reporter=line,json'];
const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(pasta, 'playwright.json'), TEMPO_RESPOSTA_BASE: versao === 'base' ? '1' : '0' };
const git = (args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).stdout.trim();
const sha = (b) => createHash('sha256').update(b).digest('hex');
const fontes = ['e2e/voz.spec.ts', 'e2e/tempo-de-resposta.spec.ts', 'e2e/helpers/voz-falsa.ts', 'e2e/helpers/scribe-falso.ts', config];
const m = { rotulo, versao, suite, inicio: new Date().toISOString(), cwd, commit: git(['rev-parse', 'HEAD']), diff: git(['diff', '--stat']), config, evidencia,
  comando: ['node', '<clone>/node_modules/@playwright/test/cli.js', ...args.slice(1)],
  fontes: Object.fromEntries(fontes.filter((f) => fs.existsSync(path.join(cwd, f))).map((f) => [f, sha(fs.readFileSync(path.join(cwd, f)))])),
};
const salvar = () => fs.writeFileSync(path.join(pasta, 'execucao.json'), JSON.stringify(m, null, 2) + '\n');
salvar();
for (const f of fontes) if (fs.existsSync(path.join(cwd, f))) fs.copyFileSync(path.join(cwd, f), path.join(pasta, f.replaceAll('/', '_') + '.txt'));
const log = fs.createWriteStream(path.join(pasta, 'execucao.log'));
const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (b) => { log.write(b); process.stdout.write(b); });
child.stderr.on('data', (b) => { log.write(b); process.stderr.write(b); });
const fim = await new Promise((resolve) => { child.on('error', (e) => resolve({ erro: e.message })); child.on('close', (code, signal) => resolve({ code, signal })); });
await new Promise((resolve) => log.end(resolve));
Object.assign(m, fim, { fim: new Date().toISOString() });
if (fs.existsSync(path.join(pasta, 'playwright.json'))) {
  const report = JSON.parse(fs.readFileSync(path.join(pasta, 'playwright.json'), 'utf8'));
  m.stats = report.stats;
  let indice = 0;
  const visitar = (s) => {
    for (const spec of s.specs ?? []) for (const t of spec.tests ?? []) for (const [tentativa, r] of t.results.entries()) {
      for (const a of r.attachments ?? []) if ((a.body || (a.path && fs.existsSync(a.path))) && (a.name === 'posts-por-rota.json' || a.name === 'error-context')) {
        const nome = `${++indice}-${a.name === 'posts-por-rota.json' ? 'posts.json' : 'erro.md'}`;
        if (a.body) fs.writeFileSync(path.join(pasta, nome), Buffer.from(a.body, 'base64'));
        else fs.copyFileSync(a.path, path.join(pasta, nome));
        (m.anexos ??= []).push({ teste: spec.title, tentativa, status: r.status, arquivo: nome, original: a.path });
      }
    }
    for (const s2 of s.suites ?? []) visitar(s2);
  };
  for (const s of report.suites ?? []) visitar(s);
}
salvar();
console.log(`\nARQUIVOS: ${pasta}; saida=${m.code}`);
process.exitCode = m.code ?? 1;
