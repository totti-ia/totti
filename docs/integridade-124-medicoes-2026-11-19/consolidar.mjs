import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = 'C:/Users/Nicolas/PROJETOS/totti';
const folder = path.join(root, '.cate/worktrees/124-conversa/docs/integridade-124-medicoes-2026-11-19');
const json = (file) => JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8').replace(/^\uFEFF/, ''));
const manifests = ['execucoes.json', 'retomada.json'].map(json);
if (manifests.some((m) => !m.fim || m.execucoes.some((e) => e.status === 'executando'))) throw new Error('Ainda há medições em execução');
const runs = manifests.flatMap((m, i) => m.execucoes.map((r) => ({ ...r, manifesto: i ? 'retomada.json' : 'execucoes.json' })));
const summaries = runs.map((r) => {
  const log = fs.readFileSync(path.join(folder, r.log), 'utf8');
  let metricas = null;
  if (r.instrumento === 'conversa') {
    const m = log.match(/^featherless:.*?p50\s+(\d+) ms\s+p95\s+(\d+) ms\s+acertos (\d+)\/(\d+)/m);
    if (m) metricas = { p50: +m[1], p95: +m[2], acertos: +m[3], casos: +m[4] };
  }
  if (r.instrumento === 'quadro') {
    const line = log.split(/\r?\n/).find((l) => l.startsWith('{"alvo"'));
    if (line) metricas = JSON.parse(line);
  }
  if (r.instrumento === 'rascunho') metricas = log.split(/\r?\n/).filter((l) => /^\| (Sala de system design|Live coding \(IDE\)) \|/.test(l)).map((l) => {
    const cols = l.split('|').map((c) => c.trim()).filter(Boolean);
    return { area: cols[0], pares: +cols[1], normal: cols[2], antecipado: cols[3], ganhoP50: cols[4], usoRascunho: cols[5], erros: +cols[6] };
  });
  if (r.instrumento === 'placar') {
    const artifact = r.artefatos.find((f) => f.endsWith('.json') && !f.includes('-incompleto'));
    if (artifact) {
      const p = json(artifact);
      metricas = { arquivo: artifact, resumo: p.resumo, casosSemNota: p.casos.filter((c) => !c.nota).length, conversasSemJuiz: p.conversas.filter((c) => !c.juiz).length };
    }
  }
  return { id: r.id, versao: r.versao, instrumento: r.instrumento, inicio: r.inicio, fim: r.fim, duracaoMs: r.duracaoMs, statusProcesso: r.status, codigo: r.code, manifesto: r.manifesto, log: r.log,
    ambienteInterrompido: ['124-placar-3-pr', '124-placar-4-base'].includes(r.id) || !!r.interrupcao,
    artefatos: r.artefatos, metricas };
});
fs.writeFileSync(path.join(folder, 'resumo.json'), JSON.stringify({ inicio: manifests[0].inicio, fim: manifests.at(-1).fim, quantidade: summaries.length, versoes: manifests[0].versoes, execucoes: summaries }, null, 2) + '\n');
let md = '# Índice de todas as execuções\n\nA = base `c91d3ce`; B = implementação `78b30d2`. Um processo de medição por vez. Falha e resultado incompleto não significam aprovação.\n\n';
md += '| # | Execução e log completo | Versão | Estado do processo | Tempo total (s) | Artefatos |\n| --- | --- | --- | --- | --- | --- |\n';
for (const [i, r] of summaries.entries()) md += `| ${i + 1} | [${r.id}](${r.log}) | ${r.versao} | ${r.statusProcesso}${r.ambienteInterrompido ? ' · ambiente interrompido' : ''} | ${(r.duracaoMs / 1000).toFixed(1)} | ${r.artefatos.map((f) => `[${f.endsWith('.md') ? 'Markdown' : f.includes('-incompleto') ? 'progresso' : 'JSON'}](${f})`).join(', ') || '—'} |\n`;
md += '\n[Manifesto original](execucoes.json) · [Manifesto da retomada](retomada.json) · [Resumo estruturado](resumo.json) · [Hashes do ambiente](ambiente.json) · [Eventos de espera moderna](interrupcoes-do-sistema.json)\n';
fs.writeFileSync(path.join(folder, 'indice.md'), md);
for (const [source, target] of [['medir-124.mjs', 'executor-original.mjs'], ['medir-124-retomada.mjs', 'executor-retomada.mjs'], ['comparar-124.mjs', 'comparar.mjs'], ['consolidar-124.mjs', 'consolidar.mjs']]) fs.copyFileSync(path.join(root, '.cate', source), path.join(folder, target));
const secrets = Object.entries(process.env).filter(([key, value]) => /API_KEY|TOKEN|SECRET|PASSWORD|SERVICE_ROLE/.test(key) && value && value.length >= 12);
const matches = [];
for (const file of fs.readdirSync(folder)) {
  const text = fs.readFileSync(path.join(folder, file), 'utf8');
  for (const [key, value] of secrets) if (text.includes(value)) matches.push({ file, variavel: key });
}
if (matches.length) { console.error(JSON.stringify(matches)); throw new Error('Conteúdo de credencial detectado: não versionar'); }
const hashes = fs.readdirSync(folder).filter((f) => f !== 'sha256.json').map((file) => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, file))).digest('hex') }));
fs.writeFileSync(path.join(folder, 'sha256.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(`${runs.length} execuções consolidadas; nenhuma credencial do ambiente encontrada nos artefatos.`);
