import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ler = (arquivo) => JSON.parse(fs.readFileSync(path.join(dir, arquivo), 'utf8'));
function testes(relatorio) {
  const saida = [];
  function visitar(s) {
    for (const spec of s.specs ?? []) for (const t of spec.tests ?? []) {
      const r = t.results.at(-1);
      const a = r.attachments?.find((a) => a.name === 'posts-por-rota.json');
      const posts = a ? (a.body ? JSON.parse(Buffer.from(a.body, 'base64')) : JSON.parse(fs.readFileSync(a.path, 'utf8'))) : null;
      saida.push({ nome: spec.title, status: r.status, erros: r.errors?.map((e) => e.message) ?? [], posts });
    }
    for (const filho of s.suites ?? []) visitar(filho);
  }
  relatorio.suites.forEach(visitar);
  return saida;
}
const pr = testes(ler('02-tempo-124/playwright.json'));
const base = testes(ler('03-tempo-base/playwright.json'));
assert.equal(pr.length, 6); assert.equal(base.length, 6);
const comparacao = pr.map((p) => {
  const b = base.find((b) => b.nome === p.nome);
  assert.ok(b && b.posts && p.posts, p.nome + ': resultado/anexo ausente');
  const rotas = [...new Set([...Object.keys(p.posts.porRota), ...Object.keys(b.posts.porRota)])].sort();
  const contagem = rotas.map((rota) => ({ rota, base: b.posts.porRota[rota] ?? 0, pr: p.posts.porRota[rota] ?? 0 }));
  const resposta = (d) => d.eventosIde.find((e) => e.type === 'speech' && e.role === 'candidate' && e.text.startsWith('Eu separo'))
    ?? d.eventosQuadro.find((e) => e.tipo === 'fala' && e.dados.quem === 'candidato' && e.dados.texto.startsWith('Eu separo'))?.dados;
  const fala = resposta(p.posts), falaBase = resposta(b.posts);
  assert.ok(fala && falaBase, p.nome + ': fala medida ausente');
  const foraDoContexto = [p.posts, b.posts].every((d) => d.pedidos.filter((p) => p.rota === '/api/chat' || p.rota.endsWith('/perguntar')).every((p) => !JSON.stringify(p.corpo).includes('latenciaMs')));
  return { nome: p.nome, statusPr: p.status, statusBase: b.status, contagem, igual: contagem.every((c) => c.base === c.pr), latenciaMs: fala.latenciaMs ?? null,
    campoNa124: Object.hasOwn(fala, 'latenciaMs'), campoNaBase: Object.hasOwn(falaBase, 'latenciaMs'), latenciaForaDosPedidosDeConversa: foraDoContexto };
});
let voz = null;
if (fs.existsSync(path.join(dir, '04-voz-124/playwright.json'))) {
  const atuais = testes(ler('04-voz-124/playwright.json'));
  // Referência recebida do revisor e preservada em referencia-voz-5343db3.log.
  const esperadas = [
    ['IDE: conversa só por voz', 'toContain'],
    ['IDE: no meio do código', 'pediuLicenca'],
    ['IDE: Finalizar', 'Combinado, vamos encerrar por aqui'],
    ['quadro encaminha transcrição', 'Entrevista encerrada'],
    ['quadro pergunta na pausa', 'Quando terminar uma etapa'],
    ['mão compõe gestos', 'gestos'],
  ];
  const falhas = atuais.filter((t) => t.status === 'failed' || t.status === 'timedOut');
  voz = { passaram: atuais.filter((t) => t.status === 'passed').length, falharam: falhas.length,
    mesmasFalhas: falhas.length === 6 && esperadas.every(([prefixo, assercao]) => falhas.some((t) => t.nome.startsWith(prefixo) && t.erros.some((e) => e.includes(assercao)))),
    testes: atuais.map(({ posts, ...t }) => t) };
}
const totalBase = comparacao.flatMap((c) => c.contagem).reduce((n, r) => n + r.base, 0);
const totalPr = comparacao.flatMap((c) => c.contagem).reduce((n, r) => n + r.pr, 0);
const r = { comparacao, totalBase, totalPr, todosPassaram: [...pr, ...base].every((t) => t.status === 'passed'), contagensIguais: comparacao.every((c) => c.igual), voz };
fs.writeFileSync(path.join(dir, 'comparacao.json'), JSON.stringify(r, null, 2) + '\n');
console.log(JSON.stringify(r, null, 2));
