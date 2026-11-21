import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ler = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const r = ler('resumo.json'), m = ler('execucoes.json');
if (!m.fim) throw new Error('Medição ainda em andamento');
const n = (p) => p.toFixed(6);
const ic = (b) => `${b.deltaBmenosA} [${b.ic95.join(', ')}]`;
let md = `# Resultado — conversa da IDE, #124\n\n**${r.conclusao}.** ${r.completas ? 'As seis execuções previstas terminaram e contêm os 13 casos, sem substituição ou repetição.' : 'Há execução ausente ou incompleta; consultar o manifesto.'} Não é uma declaração de equivalência nem autorização de merge.\n\n`;
md += `Critério ajustado e commitado em [protocolo.md](protocolo.md), commit \`fe05360\`, **antes da primeira chamada**. Execuções de ${m.inicio} a ${m.fim}. A ordem foi A1–B1 / B2–A2 / A3–B3, um processo de cada vez. A = \`0f4efec\`, B = \`ff7558c\`, em worktrees destacados separados. O manifesto registra commit/tree, hashes dos scripts/dependências, Node/npm, parâmetros não secretos e hashes dos logs. Nenhum dev, e2e ou outro benchmark foi executado em paralelo por este executor.\n\n`;
md += '## Todas as execuções\n\n| Ordem / log combinado | Acertos | p50 (ms) | p95 (ms) | Máximo (ms) | Filtro indisponível | Falhas LLM entrevistador | Saída |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n';
for (const e of r.execucoes) md += `| [${e.id}](${e.combinado}) | ${e.acertos ?? 'incompleta'}/${e.casos.length} | ${e.p50} | ${e.p95} | ${e.maximo} | ${e.filtroIndisponivel} | ${e.falhasLlmEntrevistador} | ${e.code} |\n`;
md += '\n[Manifesto](execucoes.json) · [Vetores, motivos e estatísticas](resumo.json) · [Eventos de energia](eventos-de-energia.json) · [Hashes de todos os artefatos](sha256.json).\n\n';
if (r.agregado) {
  const a = r.agregado;
  md += `## Critério agregado, definido antes\n\nBase: **${a.A.acertos}/${a.A.total}**; #124: **${a.B.acertos}/${a.B.total}**. Fisher unilateral (H1: B < A): **p = ${n(a.fisherUnilateral)}**. Critério p < 0,05 ${r.pioras.acertos ? 'acionado' : 'não acionado'}.\n\n`;
  md += '| Latência agregada | Base (ms) | #124 (ms) | Delta B−A e IC 95% (ms) | IC inteiro acima de zero? |\n| --- | --- | --- | --- | --- |\n';
  for (const nome of ['p50', 'p95']) md += `| ${nome} | ${a.A[nome]} | ${a.B[nome]} | ${ic(a.bootstrap[nome])} | ${r.pioras[nome] ? 'sim' : 'não'} |\n`;
  md += '\nAs diferenças observadas são as da tabela; a conclusão usa somente os limiares do agregado. Ausência de detecção com esta amostra não demonstra equivalência ou ausência de efeito. Não reclassifica os quatro instrumentos anteriores sob o novo critério.\n\n';
  md += '## Pares, somente descrição\n\n| Par | Acertos A / B | Fisher unilateral | p50: delta e IC 95% (ms) | p95: delta e IC 95% (ms) |\n| --- | --- | --- | --- | --- |\n';
  for (const p of r.pares) md += `| ${p.rodada} | ${p.A.acertos}/${p.A.total} / ${p.B.acertos}/${p.B.total} | ${n(p.fisherUnilateral)} | ${ic(p.bootstrap.p50)} | ${ic(p.bootstrap.p95)} |\n`;
}
md += '\n## Falhas e alcance\n\n';
for (const e of r.execucoes) md += `- ${e.id}: ${e.motivos.join('; ') || (e.completa ? 'nenhuma falha de verificação' : 'incompleta; sem classificação de acertos')}.\n`;
md += '\nO código de saída 1 é a asserção final do validador, não uma execução interrompida: foram preservados os JSONs dos casos, resumo e todos os motivos. “Completa” significa que o processo produziu todos os casos e verificações; não significa que todas as chamadas de modelo funcionaram. Os avisos de filtro indisponível e falhas do entrevistador estão contados acima. Os logs do filtro registram chamadas abortadas/timeouts e passagem sem filtro, caminho de fallback existente nas duas versões. Essas falhas não foram apagadas nem convertidas em aprovação operacional dos componentes.\n\n';
md += 'Há uma falha comum na expectativa de silêncio para “pede para encerrar”: A1, A2, A3 e B1 devolvem uma despedida preenchida (`despedida: true`, `silent: false`), que o script conta como resposta indevida. Em B2, “lendo o enunciado” e “pede para encerrar” devolvem a resposta de contingência “Desculpa, me perdi aqui. Pode repetir?”; no encerramento, também falta `despedida`. B3 devolve essa contingência ao pedir encerramento. Os stderr de B2/B3 registram falhas de LLM por chamada abortada; não há atribuição a JSON inválido nem aos sensores da #124. Todos os motivos permanecem na contagem original: várias violações no mesmo caso contam como uma falha. Não foi corrigido teste ou fallback durante a medição.\n\n';
md += 'O monitor não encontrou lacunas de relógio acima de 30 s, e a consulta de eventos de suspensão/retomada no intervalo retornou zero registros. Não houve repetição ou exclusão de execução. Como cada execução tem 13 tempos, seu p95 coincide com o máximo pela definição prévia; no agregado são 39 tempos por versão.\n\n';
md += 'O [grafo estático](grafo.md) tem **79 módulos e somente `lib/contracts.ts` alterado pela #124**. Campos opcionais do contrato não são introduzidos nas falas simuladas. Os novos callbacks de voz/microfone, cálculo dos sinais e UI do relatório não entram no instrumento. O resultado observado não permite atribuir causalmente oscilações aos sensores do navegador.\n\n';
md += 'Fisher é unilateral; os ICs vêm de 20.000 reamostragens pareadas por nome de caso, Mulberry32 seed 20261121. No agregado, cada grupo leva as três rodadas de A/B. São somente 13 casos fixos repetidos: dependência entre casos/chamadas, pouca variação temporal e múltiplos desfechos limitam a inferência; não há controle global de erro de 5% nem teste de equivalência. O código da análise e os vetores estão publicados.\n\n';
md += '## Pendências\n\nO e2e novo de tempo de resposta **não foi executado**, por orientação da revisão: a suíte de voz na main para na abertura. Aguarda correção separada dos testes, integração e rebase antes de executar/comparar POSTs por rota. O [roteiro do e2e](e2e.md) permanece uma descrição do teste escrito, não resultado. A entrevista real com voz nas duas salas segue pendente por falta de crédito ElevenLabs. Esta medição não valida esses caminhos.\n\n';
md += 'Sem push, PR, tag ou nova chamada de avaliação além das seis execuções autorizadas. Os resultados e o commit são locais para revisão.\n';
fs.writeFileSync(path.join(dir, 'resultado.md'), md);
let indice = '# Índice das seis execuções\n\nTodos os logs, inclusive stderr e falhas, sem retentativa externa.\n\n| Execução | Combinado | Stdout original | Stderr original |\n| --- | --- | --- | --- |\n';
for (const e of r.execucoes) indice += `| ${e.id} | [log](${e.combinado}) | [stdout](${e.stdout}) | [stderr](${e.stderr}) |\n`;
indice += '\n[Resultado](resultado.md) · [Protocolo antes das chamadas](protocolo.md) · [Manifesto](execucoes.json) · [Dados e análise](resumo.json) · [Grafo](grafo.md) · [Energia](eventos-de-energia.json)\n\n[Executor](executar.mjs) · [Analisador](analisar.mjs) · [Publicação local](publicar.mjs) · [Hashes](sha256.json)\n';
fs.writeFileSync(path.join(dir, 'indice.md'), indice);
process.loadEnvFile('C:/Users/Nicolas/PROJETOS/totti/.env.local');
const segredos = Object.entries(process.env).filter(([k, v]) => /API_KEY|TOKEN|SECRET|PASSWORD|SERVICE_ROLE/.test(k) && v && v.length >= 12);
const arquivos = fs.readdirSync(dir).filter((f) => f !== 'sha256.json');
for (const f of arquivos) {
  const texto = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const [k, valor] of segredos) if (texto.includes(valor)) throw new Error(`Segredo ${k} encontrado em ${f}; não publicar`);
}
const hashes = Object.fromEntries(arquivos.map((f) => [f, createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]));
fs.writeFileSync(path.join(dir, 'sha256.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(`Relatório, índice e ${arquivos.length} hashes publicados localmente; auditoria não encontrou valores de segredos.`);
