// Acréscimo da #130 (itens 6 a 15) no live coding: a regra da bola, o pedido de tempo, o "terminei" solto como fim,
// o limiar do fechamento pela duração, o ritmo por conteúdo, a abertura sem molde, o trecho já explorado e a mudança
// no problema garantida. O provedor do LLM é simulado pelo fetch.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  empecilhoGarantido, esperaDoEmpecilho, GARANTIA_DO_EMPECILHO_A_PARTIR_DA_FRACAO, minimoRestanteDoEmpecilhoMs, mudancaPendente,
} from "../empecilho";
import { candidatasDoPedidoDeFim } from "../fechamento";
import { runInterviewerTurn } from "../interviewer";
import { buildInterviewerUser, linhaDoFechamentoNaIde, type InterviewerTurnInput } from "../prompts/interviewer";
import { assuntoJaExplorado, cortarAberturaDeMolde, trechosParaPrompt } from "../perguntaDaAnalise";
import { decideBlip, estadoDaBola, lastBlipDecision, motivoDoConteudo, tetoDaPerguntaNaIde } from "../policy";
import { SISTEMA_DO_FILTRO } from "../spoilerFilter";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import type { SessionEvent } from "@/lib/contracts";
import { RITMO_IDE } from "@/lib/interrupcao/politica";
import { appendEvent, getOrCreateSession } from "@/lib/session/store";
import type { QueuedQuestion, SessionState } from "@/lib/session/types";
import { iniciarFechamento, limiarDoFechamentoNaIde, TEMPO_PARA_FECHAR_MS } from "@/lib/totti/fechamento";
import { deSaidaDoLiveCoding } from "@/lib/totti/turno";

const fetchOriginal = globalThis.fetch;
const chaveOriginal = process.env.FEATHERLESS_API_KEY;
const openrouterOriginal = process.env.OPENROUTER_API_KEY;
let saidas: unknown[] = [];

function completion(conteudo: unknown) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(conteudo) }, finish_reason: "stop" }], usage: {} });
}

beforeEach(() => {
  saidas = [];
  process.env.FEATHERLESS_API_KEY = "teste";
  delete process.env.OPENROUTER_API_KEY;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    if (corpo.messages[0]?.content.startsWith(SISTEMA_DO_FILTRO)) return completion({ reason: "ok", safe: true });
    const saida = saidas.shift();
    if (saida === undefined) throw new Error("sem saída simulada");
    return completion(saida);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (chaveOriginal === undefined) delete process.env.FEATHERLESS_API_KEY;
  else process.env.FEATHERLESS_API_KEY = chaveOriginal;
  if (openrouterOriginal !== undefined) process.env.OPENROUTER_API_KEY = openrouterOriginal;
});

const base = { highlight: null, end: false, gaveHint: false, evidence: null, challenge: null, probeOutcome: null };
/** O mínimo para montar a mensagem do turno do entrevistador. */
const entradaMinima: InterviewerTurnInput = {
  mode: "candidate", fase: "implementando", elapsedLabel: "10:00", remainingLabel: "20:00", language: "python",
  numberedCode: "1 | pass", uncovered: [], previousConversations: "", messages: [{ role: "candidate", text: "não" }],
};
const CODIGO = "def two_sum(nums, target):\n    vistos = {}\n    for i, n in enumerate(nums):\n        falta = target - n\n        if falta in vistos:\n            return [vistos[falta], i]\n        vistos[n] = i\n";

function sessao(nome: string, durationMin = 30): { s: SessionState; relogio: { agora: number } } {
  const config = { ...DEFAULT_CONFIG, problemId: "two-sum", durationMin };
  const s = getOrCreateSession(`${nome}-${Date.now()}-${Math.random()}`, config);
  const relogio = { agora: 0 };
  s.clock = () => relogio.agora;
  appendEvent(s, { type: "session_started", sessionId: s.sessionId, t: 0, configId: config.id, problemId: config.problemId, language: "python" });
  return { s, relogio };
}

function evento(s: SessionState, e: Record<string, unknown>) {
  appendEvent(s, { sessionId: s.sessionId, ...e } as SessionEvent);
}

function escrever(s: SessionState, t: number, code = CODIGO) {
  evento(s, { type: "snapshot", t, code, version: (s.codeHistory.at(-1)?.version ?? 0) + 1, language: "python" });
}

function falaDoTotti(s: SessionState, t: number, text = "E por que guardar o índice?") {
  evento(s, { type: "speech", t, role: "agent", text });
}

function perguntaDaAnalise(s: SessionState, id: string, extra: Partial<QueuedQuestion> = {}): QueuedQuestion {
  const q: QueuedQuestion = { id, question: "Por que guardar o índice em vistos?", followUpTopic: "x", priority: 0.8, createdAt: 0, status: "queued", kind: "explicar", fase: "implementando", ...extra };
  s.queue.push(q);
  return q;
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Regra da bola
// ---------------------------------------------------------------------------------------------------------------

describe("regra da bola (item 6)", () => {
  test("depois de uma fala do Totti, a bola é dele; quebra o silêncio uma vez aos 60 s; depois espera ele agir", () => {
    const { s } = sessao("bola");
    escrever(s, 30_000);
    falaDoTotti(s, 100_000);
    assert.match(estadoDaBola(s, 120_000).espera ?? "", /a bola está com ele/);
    assert.equal(estadoDaBola(s, 161_000).quebraDeSilencio, true);
    s.silencioQuebradoEm = 161_000;
    falaDoTotti(s, 165_000, "Como está indo?");
    assert.match(estadoDaBola(s, 300_000).espera ?? "", /já foi quebrado/);
    // Ele digitou: a bola volta, e o período seguinte tem a sua quebra.
    escrever(s, 310_000, CODIGO + "    return []\n");
    assert.equal(estadoDaBola(s, 320_000).espera, undefined);
  });

  test("o pedido de tempo conta como fala do Totti, e a fala do próprio pedido não devolve a vez", () => {
    const { s } = sessao("bola-tempo");
    escrever(s, 30_000);
    s.pediuTempoEm = 90_000;
    // A fala "calma, tô pensando" chega à linha do tempo depois da resposta do servidor.
    evento(s, { type: "speech", t: 92_000, role: "candidate", text: "calma, deixa eu pensar um pouco" });
    assert.match(estadoDaBola(s, 110_000).espera ?? "", /a bola está com ele/);
    evento(s, { type: "speech", t: 130_000, role: "candidate", text: "acho que dá pra guardar o índice de cada número" });
    assert.equal(estadoDaBola(s, 131_000).espera, undefined);
  });

  test("a pergunta preparada espera a bola voltar", () => {
    const { s } = sessao("bola-blip");
    escrever(s, 30_000);
    perguntaDaAnalise(s, "q-1", { parteFechada: true, createdAt: 40_000 });
    falaDoTotti(s, 45_000, "Pode seguir.");
    assert.equal(decideBlip(s, 60_000).blip, undefined);
    assert.match(lastBlipDecision(s) ?? "", /a bola está com ele/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 7. "Calma, tô pensando"
// ---------------------------------------------------------------------------------------------------------------

describe("pedido de tempo (item 7)", () => {
  test("na primeira vez, uma reação curta sem pergunta; na segunda, calado; nada de sinal negativo", async () => {
    const { s, relogio } = sessao("pensando");
    escrever(s, 30_000);
    relogio.agora = 60_000;
    saidas.push({ ...base, respond: false, concluded: false, finish: false, pediuTempo: true, reply: "" });
    const r1 = await runInterviewerTurn(s, { messages: [{ role: "candidate", text: "calma, tô pensando" }] });
    assert.match(r1.reply, /^Claro/);
    assert.doesNotMatch(r1.reply, /\?/);
    assert.equal(r1.end, false);
    assert.equal(s.pediuTempoEm, 60_000);

    relogio.agora = 120_000;
    saidas.push({ ...base, respond: true, concluded: false, finish: false, pediuTempo: true, reply: "Tranquilo, pode pensar." });
    const r2 = await runInterviewerTurn(s, { messages: [{ role: "candidate", text: "peraí, deixa eu pensar" }] });
    assert.equal(r2.reply, "");
    assert.equal(r2.listening, true);
    assert.equal(s.pediuTempoEm, 120_000);
    assert.equal(s.evidence.length, 0);
  });

  test("a leitura comum trata como pensar alto", () => {
    const situacao = { sala: "codigo", falaDoCandidato: "calma, tô pensando", respondiaAoTotti: true } as Parameters<typeof deSaidaDoLiveCoding>[1];
    const l = deSaidaDoLiveCoding({ respond: false, reply: "", concluded: false, finish: false, pediuTempo: true }, situacao);
    assert.equal(l.intencao, "pensando_alto");
    const comPergunta = deSaidaDoLiveCoding({ respond: true, reply: "Pode.", finish: true, candidatoPerguntou: true }, situacao);
    assert.equal(comPergunta.candidatoPerguntou, true);
    assert.equal(comPergunta.encerrar, true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 8 e 9. Fim pedido pelo candidato
// ---------------------------------------------------------------------------------------------------------------

describe("fim pedido pelo candidato (itens 8 e 9)", () => {
  test("pediu para encerrar com uma pergunta junto: o Totti responde, pergunta se tem mais algo e não se despede", async () => {
    const { s, relogio } = sessao("fim-com-pergunta");
    escrever(s, 30_000);
    relogio.agora = 600_000;
    saidas.push({ ...base, respond: true, concluded: false, finish: true, candidatoPerguntou: true, reply: "Lista vazia devolve uma lista vazia." });
    const r = await runInterviewerTurn(s, { messages: [{ role: "candidate", text: "pode encerrar, mas e se a lista vier vazia" }] });
    assert.ok(s.fechamento, "o fechamento começou");
    assert.equal(r.despedida, undefined);
    assert.match(r.reply, /^Lista vazia devolve uma lista vazia\./);
    assert.match(r.reply, /\?$/);
  });

  test("na última palavra, o modelo sabe a etapa e o \"não\" que ele marca como fim despede (acréscimo do #135)", async () => {
    const { s, relogio } = sessao("ultima-palavra");
    escrever(s, 30_000);
    relogio.agora = 600_000;
    saidas.push({ ...base, respond: true, concluded: false, finish: true, candidatoPerguntou: true, reply: "Lista vazia devolve uma lista vazia." });
    const r1 = await runInterviewerTurn(s, { messages: [{ role: "candidate", text: "pode encerrar, mas e se a lista vier vazia" }] });
    assert.equal(s.fechamento?.etapa, "ultima_palavra");
    assert.match(buildInterviewerUser({ ...entradaMinima, fechamento: s.fechamento?.etapa }), /Fechamento da entrevista: .*finish = true/);
    saidas.push({ ...base, respond: false, concluded: false, finish: true, candidatoPerguntou: false, reply: "" });
    const r2 = await runInterviewerTurn(s, { messages: [{ role: "candidate", text: "pode encerrar, mas e se a lista vier vazia" }, { role: "agent", text: r1.reply }, { role: "candidate", text: "não" }] });
    assert.equal(r2.despedida, true);
  });

  test("a linha da etapa do fechamento só entra na última palavra e nas perguntas finais", () => {
    assert.equal(linhaDoFechamentoNaIde(undefined), "");
    assert.equal(linhaDoFechamentoNaIde("anuncio"), "");
    assert.match(linhaDoFechamentoNaIde("ultima_palavra"), /candidatoPerguntou = true/);
    assert.match(linhaDoFechamentoNaIde("perguntas_finais"), /sem pergunta nova/);
    assert.doesNotMatch(buildInterviewerUser(entradaMinima), /Fechamento da entrevista/);
  });

  test("as perguntas do pedido de fim são só a revisão da abordagem e os critérios que faltam", () => {
    const { s } = sessao("pedido-de-fim");
    escrever(s, 30_000);
    perguntaDaAnalise(s, "q-1", { status: "queued" });
    const origens = candidatasDoPedidoDeFim(s, 600_000).map((c) => c.origem);
    assert.ok(origens.length > 0);
    assert.ok(origens.every((o) => o === "revisao" || o === "criterio"), origens.join(","));
  });

  test("o fechamento começado pula a mudança pendente", () => {
    const { s } = sessao("fim-sem-mudanca");
    escrever(s, 30_000);
    assert.equal(mudancaPendente(s), true);
    s.fechamento = iniciarFechamento({ sala: "codigo", gatilho: "pediu_encerrar", perguntasNoPedidoDeFim: true });
    assert.match(esperaDoEmpecilho(s, 20 * 60_000) ?? "", /fechamento/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 10. Limiar do fechamento pela duração
// ---------------------------------------------------------------------------------------------------------------

test("limiar do fechamento por tempo: 15% da duração, com o mínimo de uma pergunta final e a despedida (item 10)", () => {
  assert.equal(limiarDoFechamentoNaIde(30 * 60_000), 270_000);
  assert.equal(limiarDoFechamentoNaIde(60 * 60_000), 540_000);
  assert.equal(limiarDoFechamentoNaIde(10 * 60_000), 105_000);
  assert.equal(limiarDoFechamentoNaIde(0), TEMPO_PARA_FECHAR_MS);
});

// ---------------------------------------------------------------------------------------------------------------
// 11. Ritmo por conteúdo
// ---------------------------------------------------------------------------------------------------------------

describe("ritmo por conteúdo (item 11)", () => {
  test("sem parte fechada, espera; com parte fechada, sai passado o piso; no teto, sai com código novo", () => {
    const { s } = sessao("conteudo");
    escrever(s, 30_000);
    evento(s, { type: "speech", t: 50_000, role: "candidate", text: "vou guardar cada número com o índice dele" });
    const solta = perguntaDaAnalise(s, "q-1");
    assert.match(motivoDoConteudo(s, solta, 60_000) ?? "", /nenhum trecho pronto/);
    const fechada = perguntaDaAnalise(s, "q-2", { parteFechada: true });
    assert.equal(motivoDoConteudo(s, fechada, 60_000), undefined, "primeira pergunta: sem piso");

    // Saiu uma pergunta da análise aos 60 s.
    s.blips.push({ id: "q-2", preview: "x", priority: 0.8, createdAt: 60_000 });
    fechada.status = "asked";
    const proxima = perguntaDaAnalise(s, "q-3", { parteFechada: true });
    escrever(s, 100_000, CODIGO + "    return []\n");
    evento(s, { type: "speech", t: 110_000, role: "candidate", text: "agora o retorno quando não acha nada" });
    assert.match(motivoDoConteudo(s, proxima, 120_000) ?? "", /piso entre perguntas/);
    assert.equal(motivoDoConteudo(s, proxima, 60_000 + RITMO_IDE.pisoEntrePerguntasMs), undefined);

    const semParte = perguntaDaAnalise(s, "q-4");
    assert.equal(tetoDaPerguntaNaIde(s, 200_000), false);
    assert.equal(tetoDaPerguntaNaIde(s, 60_000 + RITMO_IDE.tetoSemPerguntaMs), true);
    assert.equal(motivoDoConteudo(s, semParte, 60_000 + RITMO_IDE.tetoSemPerguntaMs), undefined);
  });

  test("momento-chave, conclusão recente e quebra de silêncio passam", () => {
    const { s } = sessao("conteudo-marcos");
    escrever(s, 30_000);
    evento(s, { type: "speech", t: 35_000, role: "candidate", text: "vou guardar cada número com o índice dele" });
    assert.equal(motivoDoConteudo(s, perguntaDaAnalise(s, "q-1", { keyMoment: "primeiro run verde" }), 40_000), undefined);
    const solta = perguntaDaAnalise(s, "q-2");
    s.ultimaConclusaoEm = 38_000;
    assert.equal(motivoDoConteudo(s, solta, 40_000), undefined);
    s.ultimaConclusaoEm = undefined;
    assert.equal(motivoDoConteudo(s, solta, 35_000 + RITMO_IDE.quebraDeSilencioMs), undefined);
  });

  test("abertura, retorno e mudança não passam pelo ritmo por conteúdo", () => {
    const { s } = sessao("conteudo-isentas");
    for (const extra of [{ kickoff: true }, { kind: "retorno" as const }, { kind: "empecilho" as const }]) {
      assert.equal(motivoDoConteudo(s, perguntaDaAnalise(s, `q-${s.queue.length + 1}`, extra), 10_000), undefined);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 13. Abertura sem molde e assunto repetido
// ---------------------------------------------------------------------------------------------------------------

describe("abertura sem molde e trecho já explorado (item 13)", () => {
  test("corta 'Vi que você…' e 'Para entender como você…' quando sobra uma pergunta", () => {
    assert.deepEqual(cortarAberturaDeMolde("Vi que você usou um dicionário. Por que guardar o índice?"), { texto: "Por que guardar o índice?", cortou: true });
    assert.deepEqual(cortarAberturaDeMolde("Notei que você mudou o loop, o que te levou a isso?"), { texto: "O que te levou a isso?", cortou: true });
    assert.deepEqual(cortarAberturaDeMolde("Para entender como você pensou, qual é a ideia do vistos?"), { texto: "Qual é a ideia do vistos?", cortou: true });
  });

  test("não corta quando o que sobra não é uma pergunta de verdade", () => {
    for (const p of ["Vi que você usou um dicionário. Me fala dele.", "Vi que você usou um dicionário?", "Por que guardar o índice?", "Vi que você parou. Tudo?"]) {
      assert.equal(cortarAberturaDeMolde(p).cortou, false, p);
    }
  });

  test("trecho perguntado duas vezes está explorado; o desafio é outro assunto", () => {
    const { s } = sessao("trecho");
    for (const id of ["q-1", "q-2"]) {
      perguntaDaAnalise(s, id, { status: "asked", highlight: { startLine: 3, endLine: 6 }, topicLabel: "o loop" });
      s.blips.push({ id, preview: "x", priority: 0.8, createdAt: 0 });
    }
    assert.equal(assuntoJaExplorado({ kind: "explicar", lines: { startLine: 4, endLine: 6 } }, s), true);
    assert.equal(assuntoJaExplorado({ kind: "desafio", lines: { startLine: 4, endLine: 6 } }, s), false);
    assert.equal(assuntoJaExplorado({ kind: "explicar", lines: { startLine: 7, endLine: 7 } }, s), false);
    assert.equal(assuntoJaExplorado({ kind: "explicar" }, s), false);
    assert.deepEqual(trechosParaPrompt(s), ["linhas 3–6 (o loop): 2 vezes"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 15. Mudança no problema garantida
// ---------------------------------------------------------------------------------------------------------------

describe("mudança no problema garantida (item 15)", () => {
  test("numa entrevista de 10 min ela ainda cabe, e a partir de 60% sai mesmo com o código mudando", () => {
    const { s } = sessao("empecilho-10", 10);
    const duracao = 10 * 60_000;
    assert.ok(minimoRestanteDoEmpecilhoMs(duracao) <= duracao * 0.3);
    escrever(s, 60_000);
    const t = duracao * GARANTIA_DO_EMPECILHO_A_PARTIR_DA_FRACAO;
    escrever(s, t - 1_000, CODIGO + "    return []\n");
    assert.equal(empecilhoGarantido(s, t), true);
    assert.equal(esperaDoEmpecilho(s, t), undefined);
  });

  test("o piso de 2 min depois da última pergunta vale até na garantia", () => {
    const { s } = sessao("empecilho-piso");
    escrever(s, 60_000);
    const t = 30 * 60_000 * GARANTIA_DO_EMPECILHO_A_PARTIR_DA_FRACAO;
    s.blips.push({ id: "q-1", preview: "x", priority: 0.8, createdAt: t - 60_000 });
    assert.match(esperaDoEmpecilho(s, t) ?? "", /piso/);
    assert.equal(esperaDoEmpecilho(s, t + 60_000), undefined);
  });

  test("'terminei essa parte' antes dos 60% também a libera", () => {
    const { s } = sessao("empecilho-conclusao");
    escrever(s, 60_000);
    const t = 8 * 60_000;
    assert.notEqual(esperaDoEmpecilho(s, t), undefined);
    s.ultimaConclusaoEm = t - 5_000;
    assert.equal(esperaDoEmpecilho(s, t), undefined);
  });
});
