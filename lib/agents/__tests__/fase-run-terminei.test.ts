// Entrevista de live coding de 12/11 (#130): a fase ficou em "Entendimento", o run com falha passou em silêncio, o
// "terminei" depois da complexidade virou "Continua daí.", a abordagem errada não voltou no fechamento e o relatório
// disse "não rodou" com dois runs feitos.
import assert from "node:assert/strict";
import { test } from "node:test";
import { disseQueTerminou } from "../conclusao";
import { faseDaEntrevista } from "../fase";
import { candidatasDoFechamento } from "../fechamento";
import { limitarPerguntas, querEncerrar, runInterviewerTurn } from "../interviewer";
import { disseSoQueTerminou } from "../conclusao";
import {
  abordagemParaRever, decideBlip, enqueueKickoff, enqueueRunFalhou, FALAS_DO_RUN_FALHOU, lastBlipDecision, ordemDaComplexidade,
  PERGUNTA_DE_REVISAO, perdeuAVez, startClosing,
} from "../policy";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import type { RunResult, SessionEvent } from "@/lib/contracts";
import { appendEvent, eventoRepetido, getOrCreateSession } from "@/lib/session/store";
import type { SessionState } from "@/lib/session/types";

const config = { ...DEFAULT_CONFIG, problemId: "two-sum", durationMin: 30 };
const FORCA_BRUTA = [
  "def two_sum(nums, target):",
  "    for i in range(len(nums)):",
  "        for j in range(i + 1, len(nums)):",
  "            if nums[i] + nums[j] == target:",
  "                return [i, j]",
  "    return []",
].join("\n");

function sessao(nome: string): { s: SessionState; relogio: { agora: number } } {
  const s = getOrCreateSession(`${nome}-${Date.now()}-${Math.random()}`, config);
  const relogio = { agora: 0 };
  s.clock = () => relogio.agora;
  appendEvent(s, { type: "session_started", sessionId: s.sessionId, t: 0, configId: config.id, problemId: config.problemId, language: "python" });
  return { s, relogio };
}

function resultado(passed: number, total = 5): RunResult {
  return { passed, total, cases: [], stdout: "", stderr: "", durationMs: 10 };
}

function escrever(s: SessionState, t: number, code = FORCA_BRUTA) {
  appendEvent(s, { type: "snapshot", sessionId: s.sessionId, t, code, version: (s.codeHistory.at(-1)?.version ?? 0) + 1, language: "python" });
}

function comAnalise(s: SessionState, timeComplexity: string) {
  s.analyst.insights = { approach: "dois loops", timeComplexity, spaceComplexity: "O(1)", progress: "funcional", suspiciousLines: [], evidence: [] };
}

function rodar(s: SessionState, t: number, passed: number) {
  const evento = { type: "run" as const, sessionId: s.sessionId, t, result: resultado(passed) };
  appendEvent(s, evento);
  return enqueueRunFalhou(s, evento);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Fase de verdade
// ---------------------------------------------------------------------------------------------------------------

test("fase: vem dos eventos, não do relógio (escreveu, rodou e falhou, passou)", () => {
  const { s } = sessao("fase");
  assert.equal(faseDaEntrevista(s), "entendendo");
  escrever(s, 60_000);
  assert.equal(faseDaEntrevista(s), "implementando");
  rodar(s, 90_000, 3);
  assert.equal(faseDaEntrevista(s), "depurando");
  rodar(s, 120_000, 5);
  assert.equal(faseDaEntrevista(s), "funcionando");
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Run com falha nunca passa em silêncio
// ---------------------------------------------------------------------------------------------------------------

test("run com falha: a fala curta entra na fila e sai na pausa seguinte, fora do orçamento", () => {
  const { s } = sessao("run-falhou");
  escrever(s, 200_000);
  assert.equal(rodar(s, 240_000, 3), true);
  const q = s.queue.find((x) => x.kind === "run_falhou")!;
  assert.equal(q.question, FALAS_DO_RUN_FALHOU[0]);
  assert.equal(q.status, "queued");

  // Logo depois do run ele ainda está com a mão no teclado (o snapshot do run saiu agora).
  escrever(s, 240_000, `${FORCA_BRUTA}\n`);
  assert.equal(decideBlip(s, 240_500).blip, undefined);
  assert.match(lastBlipDecision(s) ?? "", /run com falha/);
  const blip = decideBlip(s, 243_000).blip;
  assert.equal(blip?.id, q.id);
  assert.equal(blip?.perdeAVez, undefined, "a IDE não descarta esta fala por ele ter falado");
  assert.equal(blip?.preview, "Quero entender o resultado do teste");
});

test("run com falha: run verde depois tira a fala da fila; run que passa não enfileira nada", () => {
  const { s } = sessao("run-verde");
  escrever(s, 200_000);
  rodar(s, 240_000, 2);
  assert.equal(rodar(s, 241_000, 5), false);
  const q = s.queue.find((x) => x.kind === "run_falhou")!;
  assert.equal(decideBlip(s, 250_000).blip, undefined);
  assert.equal(q.status, "stale");
  assert.equal(perdeuAVez(s, q, 240_000), "fala do run com falha descartada: rodou de novo depois");
});

test("run com falha: um run novo troca a fala anterior que ainda não saiu (uma por run)", () => {
  const { s } = sessao("run-dois");
  escrever(s, 200_000);
  rodar(s, 240_000, 2);
  rodar(s, 245_000, 4);
  const doRun = s.queue.filter((x) => x.kind === "run_falhou");
  assert.deepEqual(doRun.map((x) => x.status), ["stale", "queued"]);
});

test("run com falha: um balão ainda não falado cede o lugar (sai da tela) e volta para a fila", () => {
  const { s } = sessao("run-cede");
  enqueueKickoff(s, 0);
  escrever(s, 200_000);
  // A abertura está na tela, esperando a pausa para ser dita.
  const abertura = decideBlip(s, 210_000).blip;
  assert.ok(abertura);
  rodar(s, 240_000, 1);
  const r = decideBlip(s, 245_000);
  assert.equal(r.blip?.id, s.queue.find((x) => x.kind === "run_falhou")?.id);
  assert.equal(r.dismissBlipId, abertura.id);
  assert.equal(s.queue.find((x) => x.id === abertura.id)?.status, "queued");
});

test("run com falha: com uma conversa aberta ela espera, e o Totti falando depois do run a cancela", () => {
  const { s } = sessao("run-conversa");
  enqueueKickoff(s, 0);
  escrever(s, 200_000);
  const abertura = decideBlip(s, 210_000).blip!;
  appendEvent(s, { type: "blip_opened", sessionId: s.sessionId, t: 212_000, blipId: abertura.id });
  rodar(s, 240_000, 1);
  assert.equal(decideBlip(s, 245_000).blip, undefined);
  assert.match(lastBlipDecision(s) ?? "", /conversa aberta/);
  appendEvent(s, { type: "speech", sessionId: s.sessionId, t: 246_000, role: "agent", text: "E o que aparece quando roda?", blipId: abertura.id });
  appendEvent(s, { type: "blip_closed", sessionId: s.sessionId, t: 250_000, blipId: abertura.id, reason: "agent" });
  assert.equal(decideBlip(s, 255_000).blip, undefined);
  assert.equal(s.queue.find((x) => x.kind === "run_falhou")?.status, "stale");
});

test("balão que expira sem ser dito não some da tela: só sai quando outro toma o lugar", () => {
  const { s } = sessao("expira");
  enqueueKickoff(s, 0);
  escrever(s, 200_000);
  // Sem a abertura: um balão comum do Analyst, que expira em 80 s.
  s.queue.find((q) => q.kickoff)!.status = "stale";
  s.queue.push({ id: "q-9", question: "O que esse loop interno faz?", followUpTopic: "o loop", topicLabel: "o loop interno", priority: 0.9, createdAt: 300_000, status: "queued" });
  const balao = decideBlip(s, 310_000).blip;
  assert.equal(balao?.id, "q-9");
  const depois = decideBlip(s, 395_000);
  assert.equal(depois.dismissBlipId, undefined, "expirou, mas a IDE continua com ele até dizer ou trocar");
  assert.equal(s.queue.find((q) => q.id === "q-9")?.status, "ignored");
  assert.equal(s.pendingBlipId, undefined, "a vez fica livre para outro balão");
});

// ---------------------------------------------------------------------------------------------------------------
// 3. "terminei" fecha
// ---------------------------------------------------------------------------------------------------------------

test("'terminei': é o fim, não 'acabei de mudar' nem 'terminei essa parte'", () => {
  for (const f of ["terminei", "pronto, terminei", "acho que acabei", "finalizei aqui", "já concluí"]) assert.equal(disseQueTerminou(f), true, f);
  for (const f of ["acabei de mudar o loop", "terminei essa parte", "terminei a primeira parte", "terminando aqui", "ainda não terminei"]) {
    assert.equal(disseQueTerminou(f), false, f);
  }
});

test("querEncerrar conta o 'terminei' de outra conversa da sessão", () => {
  const c = (text: string) => ({ role: "candidate" as const, text });
  assert.equal(querEncerrar([c("terminei")]), false);
  assert.equal(querEncerrar([c("terminei")], ["pronto, terminei", "é O(n²)"]), true);
});

test("'terminei' com o último run verde: o fechamento começa na hora, mesmo dentro da conversa da complexidade", async () => {
  const { s, relogio } = sessao("terminei");
  escrever(s, 200_000);
  rodar(s, 400_000, 5);
  comAnalise(s, "O(n²)");
  // A pergunta da complexidade, aberta e respondida.
  s.queue.push({ id: "q-5", question: "Qual o custo de tempo dessa solução?", followUpTopic: "complexidade", topicLabel: "o custo", priority: 0.9, createdAt: 410_000, status: "asked", criterionId: "complexidade" });
  s.blips.push({ id: "q-5", preview: "Quero entender o custo", priority: 0.9, createdAt: 410_000 });
  appendEvent(s, { type: "speech", sessionId: s.sessionId, t: 420_000, role: "candidate", text: "pronto, terminei", blipId: undefined });
  relogio.agora = 460_000;
  const messages = [
    { role: "agent" as const, text: "Qual o custo de tempo dessa solução?" },
    { role: "candidate" as const, text: "É quadrático, dois loops." },
    { role: "agent" as const, text: "E a memória?" },
    { role: "candidate" as const, text: "Constante. Terminei." },
  ];
  assert.equal(disseSoQueTerminou("Constante. Terminei."), true);
  const r = await runInterviewerTurn(s, { blipId: "q-5", messages });
  assert.ok(s.fechamento, "o fechamento começou");
  assert.doesNotMatch(r.reply, /continua daí|pode seguir|pode continuar/i);
  assert.equal(r.end, false);
  assert.ok(r.fechamento);
  // Força bruta num problema com solução O(n): a revisão da abordagem é a primeira pergunta do fechamento.
  assert.match(r.reply, /mudaria alguma coisa na abordagem/);
});

test("'terminei' solto é o fim da entrevista; dizendo de quê, é uma etapa (#130, item 9)", () => {
  for (const fim of ["terminei", "Terminei.", "pronto, terminei", "acabei aqui", "Constante. Terminei.", "acho que é isso, acabei, né"]) {
    assert.equal(disseSoQueTerminou(fim), true, fim);
  }
  for (const etapa of ["terminei essa parte", "terminei a primeira versão", "terminei o loop, agora vou testar", "ainda não terminei", "quando eu terminar eu aviso"]) {
    assert.equal(disseSoQueTerminou(etapa), false, etapa);
  }
});

test("'terminei' solto sem run verde também abre o fechamento, com as perguntas finais antes da despedida", async () => {
  const { s, relogio } = sessao("terminei-vermelho");
  escrever(s, 200_000);
  rodar(s, 400_000, 3);
  relogio.agora = 420_000;
  const r = await runInterviewerTurn(s, { messages: [{ role: "candidate", text: "terminei" }] });
  assert.ok(s.fechamento, "o fechamento começou");
  assert.equal(r.despedida, undefined);
  assert.match(r.reply, /\?$/);
});

test("limitarPerguntas: 'terminei' nunca vira 'Continua daí.'", () => {
  const saida = { respond: true, concluded: false, finish: false, reply: "Beleza. E a memória, como fica?", highlight: null, end: false, gaveHint: false, evidence: null, challenge: null, probeOutcome: null };
  const conversa = [
    { role: "agent" as const, text: "Qual o custo de tempo?" },
    { role: "candidate" as const, text: "Quadrático." },
    { role: "agent" as const, text: "E por quê?" },
    { role: "candidate" as const, text: "terminei" },
  ];
  const r = limitarPerguntas(saida, { kind: "explicar" }, conversa, false);
  assert.equal(r.reply, saida.reply);
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Revisão da abordagem no fechamento
// ---------------------------------------------------------------------------------------------------------------

test("ordem das complexidades", () => {
  assert.ok(ordemDaComplexidade("O(n²)")! > ordemDaComplexidade("O(n)")!);
  assert.ok(ordemDaComplexidade("O(n^2)")! > ordemDaComplexidade("O(n log n)")!);
  assert.ok(ordemDaComplexidade("O(n log(n))")! > ordemDaComplexidade("O(log n)")!);
  assert.equal(ordemDaComplexidade("quadrático"), undefined);
});

test("abordagem pior que a melhor conhecida: a revisão é o primeiro ponto do fechamento (nos dois caminhos)", () => {
  const { s } = sessao("revisao");
  escrever(s, 200_000);
  rodar(s, 400_000, 5);
  comAnalise(s, "O(n²)");
  assert.equal(abordagemParaRever(s), true);
  const candidatas = candidatasDoFechamento(s, 500_000);
  assert.equal(candidatas[0]?.pergunta, PERGUNTA_DE_REVISAO);
  const blip = startClosing(s, 500_000);
  const fechamento = s.queue.find((q) => q.id === blip?.id);
  assert.match(fechamento?.closingTopics?.[0] ?? "", /revisão da abordagem/);
});

test("abordagem ótima e justificativa boa: sem revisão; justificativa fraca: com revisão", () => {
  const { s } = sessao("sem-revisao");
  comAnalise(s, "O(n)");
  assert.equal(abordagemParaRever(s), false);
  s.coverage.abordagem.outcomes.push({ t: 1, criterionId: "abordagem", kind: "parcial", note: "justificou mal", source: "interviewer" });
  assert.equal(abordagemParaRever(s), true);
  appendEvent(s, { type: "speech", sessionId: s.sessionId, t: 2, role: "agent", text: PERGUNTA_DE_REVISAO });
  assert.equal(abordagemParaRever(s), false, "já perguntada");
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Run sempre chega (o servidor aceita o reenvio sem duplicar e na ordem)
// ---------------------------------------------------------------------------------------------------------------

test("reenvio: o mesmo run não entra duas vezes e o que chega atrasado entra na ordem do t", () => {
  const { s } = sessao("reenvio");
  escrever(s, 100_000);
  const run: SessionEvent = { type: "run", sessionId: s.sessionId, t: 150_000, result: resultado(2) };
  escrever(s, 160_000, `${FORCA_BRUTA}\n# mexi`);
  assert.equal(eventoRepetido(s, run), false);
  appendEvent(s, run);
  assert.equal(eventoRepetido(s, run), true);
  const tipos = s.events.map((e) => `${e.type}@${e.t}`);
  assert.deepEqual(tipos.slice(-3), ["snapshot@100000", "run@150000", "snapshot@160000"]);
  // Um snapshot reenviado atrasado também entra no lugar certo do histórico do código.
  escrever(s, 120_000, FORCA_BRUTA.replace("[]", "None"));
  assert.deepEqual(s.codeHistory.map((v) => v.t), [100_000, 120_000, 160_000]);
});
