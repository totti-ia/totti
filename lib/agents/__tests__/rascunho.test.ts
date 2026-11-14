// Resposta antecipada: o rascunho roda o turno numa cópia da sessão e a confirmação usa o resultado quando a entrada e a
// sessão são as mesmas. Testa os helpers (lib/agents/rascunho.ts), não a rota: `after` do Next só existe dentro de uma
// requisição. O provedor do LLM é simulado pelo fetch, como em interviewer.test.ts.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { cacheDoRascunhoDoLiveCoding, prepararRascunho, turnoComRascunho, type PedidoDoTurno, type ResultadoDoRascunho } from "../rascunho";
import { SISTEMA_DO_FILTRO } from "../spoilerFilter";
import { criarCacheDeRascunho } from "@/lib/conversa/rascunho";
import { definirKvParaTestes, criarKvEmMemoria } from "@/lib/storage/kv";
import { guardarSessao } from "@/lib/session/persistencia";
import { appendEvent, getOrCreateSession } from "@/lib/session/store";
import type { SessionState } from "@/lib/session/types";

const fetchOriginal = globalThis.fetch;
const chaveOriginal = process.env.FEATHERLESS_API_KEY;
let saidas: unknown[] = [];
let chamadasAoEntrevistador = 0;

function completion(conteudo: unknown) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(conteudo) }, finish_reason: "stop" }], usage: {} });
}

const base = { highlight: null, end: true, gaveHint: false, evidence: null, challenge: null, probeOutcome: null };
const fala = (reply: string) => ({ ...base, respond: true, concluded: false, reply });

beforeEach(() => {
  saidas = [];
  chamadasAoEntrevistador = 0;
  process.env.FEATHERLESS_API_KEY = "teste";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    if (corpo.messages[0]?.content.startsWith(SISTEMA_DO_FILTRO)) return completion({ reason: "ok", safe: true });
    chamadasAoEntrevistador++;
    const saida = saidas.shift();
    if (saida === undefined) throw new Error("sem saída simulada");
    return completion(saida);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (chaveOriginal === undefined) delete process.env.FEATHERLESS_API_KEY;
  else process.env.FEATHERLESS_API_KEY = chaveOriginal;
});

let contador = 0;
/** Sessão nova com código inicial, uma por teste (o store é global). */
function sessaoNova(): SessionState {
  const id = `rascunho-${Date.now()}-${contador++}`;
  const s = getOrCreateSession(id);
  appendEvent(s, { type: "session_started", sessionId: id, t: 0, language: "python", problemId: s.config.problemId } as never);
  appendEvent(s, { type: "snapshot", sessionId: id, t: 0, version: 1, language: "python", code: "def f(s):\n    pass" } as never);
  return s;
}

function pedidoDe(s: SessionState, messages: PedidoDoTurno["messages"], liveCode?: string): PedidoDoTurno {
  return {
    sessionId: s.sessionId,
    messages,
    reconheceu: false,
    liveCode,
    liveLanguage: "python",
    turno: { messages, reconheceu: false },
  };
}

const CANDIDATO = [{ role: "candidate" as const, text: "vou começar pelo laço de fora e depois trato as bordas" }];
const CODIGO_NOVO = "def f(s):\n    for c in s:\n        pass";

test("rascunho não muda a sessão real nem grava nada no Supabase", async () => {
  const env = { url: process.env.SUPABASE_URL, chave: process.env.SUPABASE_SERVICE_ROLE_KEY, armazenamento: process.env.ARMAZENAMENTO };
  process.env.SUPABASE_URL = "http://falso.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  delete process.env.ARMAZENAMENTO;
  const kv = criarKvEmMemoria();
  definirKvParaTestes({ ...kv, nome: "supabase" } as never);
  try {
    const s = sessaoNova();
    const antes = structuredClone(s);
    saidas.push(fala("Por que você começou pelo laço de fora?"));
    const cache = criarCacheDeRascunho<ResultadoDoRascunho>();
    const r = await prepararRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
    assert.deepEqual(r, { rascunho: true, reply: "Por que você começou pelo laço de fora?" });
    assert.equal(chamadasAoEntrevistador, 1);
    assert.deepEqual(s, antes, "a sessão real não mudou");
    assert.ok(!(await kv.get("sessoes-live", s.sessionId)), "nada foi guardado");
    // Controle: guardarSessao de verdade grava (o teste acima não estaria provando nada sem isso).
    await guardarSessao(s);
    assert.ok(await kv.get("sessoes-live", s.sessionId));
  } finally {
    definirKvParaTestes(null);
    if (env.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = env.url;
    if (env.chave === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = env.chave;
    if (env.armazenamento !== undefined) process.env.ARMAZENAMENTO = env.armazenamento;
  }
});

test("rascunho e depois a confirmação: o modelo roda uma vez, a resposta é a mesma e o código entra uma vez", async () => {
  const cache = cacheDoRascunhoDoLiveCoding();
  // Controle: o mesmo turno ao vivo, em outra sessão idêntica.
  const controle = sessaoNova();
  saidas.push(fala("Por que você começou pelo laço de fora?"));
  const aoVivo = await turnoComRascunho(controle, pedidoDe(controle, CANDIDATO, CODIGO_NOVO), criarCacheDeRascunho<ResultadoDoRascunho>());
  assert.equal(aoVivo.doRascunho, false);
  const tiposAoVivo = controle.events.map((e) => e.type);

  const s = sessaoNova();
  saidas.push(fala("Por que você começou pelo laço de fora?"));
  const r = await prepararRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
  assert.equal(r.rascunho, true);
  assert.equal(chamadasAoEntrevistador, 2, "uma chamada do controle e uma do rascunho");

  const confirmada = await turnoComRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
  assert.equal(confirmada.doRascunho, true, "a confirmação usou o rascunho");
  assert.equal(chamadasAoEntrevistador, 2, "a confirmação não chamou o modelo");
  assert.equal(confirmada.resposta.reply, aoVivo.resposta.reply);
  if (r.rascunho) assert.equal(confirmada.resposta.reply, r.reply);
  assert.equal(s.events.filter((e) => e.type === "snapshot").length, 2, "o snapshot inicial e o código novo, uma vez cada");
  assert.equal(s.codeHistory.at(-1)?.code, CODIGO_NOVO);
  assert.equal(s.codeHistory.filter((c) => c.code === CODIGO_NOVO).length, 1);
  assert.deepEqual(s.events.map((e) => e.type), tiposAoVivo, "a linha do tempo é a mesma do turno ao vivo");
  assert.equal(s.events.filter((e) => e.type === "llm_uso").length, controle.events.filter((e) => e.type === "llm_uso").length);
});

test("mensagem diferente: não usa o rascunho e chama o modelo de novo", async () => {
  const cache = cacheDoRascunhoDoLiveCoding();
  const s = sessaoNova();
  saidas.push(fala("Por que você começou pelo laço de fora?"));
  await prepararRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
  saidas.push(fala("E o caso de lista vazia?"));
  const outra = [{ role: "candidate" as const, text: "na verdade vou começar pela lista vazia" }];
  const r = await turnoComRascunho(s, pedidoDe(s, outra, CODIGO_NOVO), cache);
  assert.equal(r.doRascunho, false);
  assert.equal(chamadasAoEntrevistador, 2);
  assert.equal(r.resposta.reply, "E o caso de lista vazia?");
});

test("a sessão mudou entre o rascunho e a confirmação: turno ao vivo", async () => {
  const cache = cacheDoRascunhoDoLiveCoding();
  const s = sessaoNova();
  saidas.push(fala("Por que você começou pelo laço de fora?"));
  await prepararRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
  appendEvent(s, { type: "speech", sessionId: s.sessionId, t: 5_000, role: "candidate", text: "outra coisa" } as never);
  saidas.push(fala("Certo, e a complexidade?"));
  const r = await turnoComRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
  assert.equal(r.doRascunho, false);
  assert.equal(chamadasAoEntrevistador, 2);
});

test("o mesmo rascunho não serve duas vezes", async () => {
  const cache = cacheDoRascunhoDoLiveCoding();
  const s = sessaoNova();
  const antes = structuredClone(s);
  saidas.push(fala("Por que você começou pelo laço de fora?"));
  await prepararRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
  const primeira = await turnoComRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
  assert.equal(primeira.doRascunho, true);
  // Mesma sessão de antes do rascunho (mesma chave): o rascunho já foi tomado, então sai ao vivo.
  const repetida = copiaComMesmoEstado(antes, s.sessionId);
  saidas.push(fala("De novo, por que o laço de fora?"));
  const segunda = await turnoComRascunho(repetida, pedidoDe(repetida, CANDIDATO, CODIGO_NOVO), cache);
  assert.equal(segunda.doRascunho, false);
  assert.equal(chamadasAoEntrevistador, 2, "uma do rascunho e uma ao vivo: a repetida não usou o rascunho já tomado");
});

test("evento de uso gravado na sessão real durante o rascunho não se perde na troca", async () => {
  const cache = cacheDoRascunhoDoLiveCoding();
  const s = sessaoNova();
  saidas.push(fala("Por que você começou pelo laço de fora?"));
  await prepararRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
  // A transcrição manda o uso durante a fala: fica fora da chave, então o rascunho continua valendo.
  appendEvent(s, { type: "transcricao_uso", sessionId: s.sessionId, t: 4_000, contexto: "coding", escuta_id: "e1", audioEnviadoS: 3, sessaoS: 4, conexoes: 1, reconexoes: 0, final: false } as never);
  const r = await turnoComRascunho(s, pedidoDe(s, CANDIDATO, CODIGO_NOVO), cache);
  assert.equal(r.doRascunho, true);
  assert.equal(s.events.filter((e) => e.type === "transcricao_uso").length, 1);
});

/** Uma sessão com o mesmo estado de `antes` (o que o rascunho viu), no mesmo id, para repetir a chave. */
function copiaComMesmoEstado(antes: SessionState, sessionId: string): SessionState {
  const copia = structuredClone(antes);
  copia.sessionId = sessionId;
  return copia;
}
