// Conversa natural na IDE: o entrevistador só ouve quem pensa em voz alta, avança quando a etapa termina
// e não repete as falas de reserva. O provedor do LLM é simulado pelo fetch.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { falaNaoRepetida, runInterviewerTurn } from "../interviewer";
import { buildInterviewerSystem, buildInterviewerUser } from "../prompts/interviewer";
import { SISTEMA_DO_FILTRO } from "../spoilerFilter";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import type { ChatMessage } from "@/lib/contracts";
import { appendEvent, getOrCreateSession } from "@/lib/session/store";
import { getProblem } from "@/problems";

const fetchOriginal = globalThis.fetch;
const chaveOriginal = process.env.FEATHERLESS_API_KEY;
const openrouterOriginal = process.env.OPENROUTER_API_KEY;
let saidas: unknown[] = [];
let chamadasAoEntrevistador = 0;

function completion(conteudo: unknown) {
  return Response.json({ choices: [{ message: { content: JSON.stringify(conteudo) }, finish_reason: "stop" }], usage: {} });
}

beforeEach(() => {
  saidas = [];
  chamadasAoEntrevistador = 0;
  process.env.FEATHERLESS_API_KEY = "teste";
  delete process.env.OPENROUTER_API_KEY;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    // O filtro de fala responde com {"reason", "safe"}: aqui, sempre seguro.
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
  if (openrouterOriginal !== undefined) process.env.OPENROUTER_API_KEY = openrouterOriginal;
});

const base = { highlight: null, end: false, gaveHint: false, evidence: null, challenge: null, probeOutcome: null };

test("pensando em voz alta: o entrevistador só ouve, sem fala e sem grifo", async () => {
  const session = getOrCreateSession(`ouvir-${Date.now()}`);
  saidas.push({ ...base, respond: false, concluded: false, reply: "" });
  const r = await runInterviewerTurn(session, { messages: [{ role: "candidate", text: "agora vou montar o loop de fora" }] });
  assert.deepEqual(r, { reply: "", commands: [], end: false, listening: true });
  assert.equal(chamadasAoEntrevistador, 1);
});

test("sem código do candidato, pergunta pelo plano sem inventar um trecho", async () => {
  const session = getOrCreateSession(`etapa-${Date.now()}`);
  saidas.push({ ...base, respond: true, concluded: true, end: true, reply: "Beleza, primeira versão de pé.", highlight: { startLine: 1, endLine: 1 } });
  const r = await runInterviewerTurn(session, { messages: [{ role: "candidate", text: "terminei a primeira versão" }] });
  assert.equal(r.reply, "Ainda não há trecho de código para comentar. Por onde você pensa em começar?");
  assert.equal(r.concluded, true);
  assert.equal(r.end, false);
  // Não há trecho do candidato para grifar.
  assert.equal(r.commands.some((c) => c.type === "highlight_range"), false);
  assert.notEqual(session.etapaConcluidaEm, undefined);
});

test("código inicial sem trecho do candidato não é comentado nem grifado", async () => {
  const session = getOrCreateSession(`starter-sem-trecho-${Date.now()}`);
  const problem = getProblem(session.config.problemId);
  const inicial = problem.public.starters[session.language] ?? "";
  appendEvent(session, { type: "session_started", sessionId: session.sessionId, t: 0, configId: session.config.id, problemId: session.config.problemId, language: session.language });
  appendEvent(session, { type: "snapshot", sessionId: session.sessionId, t: 0, code: inicial, version: 1, language: session.language });
  const r = await runInterviewerTurn(session, { messages: [{ role: "candidate", text: "Terminei, dá uma olhada." }] });
  assert.equal(r.reply, "Ainda não há trecho de código para comentar. Por onde você pensa em começar?");
  assert.equal(r.commands.some((c) => c.type === "highlight_range"), false);
});

test("pediu para olhar: comentário e pergunta saem juntos com o trecho grifado", async () => {
  const session = getOrCreateSession(`olhar-ide-${Date.now()}`);
  appendEvent(session, { type: "session_started", sessionId: session.sessionId, t: 0, configId: session.config.id, problemId: session.config.problemId, language: "python" });
  appendEvent(session, { type: "snapshot", sessionId: session.sessionId, t: 0, code: "def solve(nums):\n    return len(nums)", version: 1, language: "python" });
  saidas.push({ ...base, respond: true, concluded: true, end: false, reply: "A função solve recebe a lista toda. Como você decidiu percorrer os elementos dessa forma?", highlight: { startLine: 1, endLine: 1 } });
  const r = await runInterviewerTurn(session, { messages: [{ role: "candidate", text: "Terminei a primeira versão, olha aí." }] });
  assert.match(r.reply, /solve/);
  assert.ok(r.reply.trim().endsWith("?"), r.reply);
  assert.ok(r.commands.some((c) => c.type === "highlight_range"));
});

test("pergunta que só cita o identificador não passa como comentário do código", async () => {
  const session = getOrCreateSession(`comentario-vago-ide-${Date.now()}`);
  appendEvent(session, { type: "session_started", sessionId: session.sessionId, t: 0, configId: session.config.id, problemId: session.config.problemId, language: "python" });
  appendEvent(session, { type: "snapshot", sessionId: session.sessionId, t: 0, code: "def solve(nums):\n    return len(nums)", version: 1, language: "python" });
  saidas.push({ ...base, respond: true, concluded: true, end: false, reply: "Como você pensou na função solve?", highlight: { startLine: 1, endLine: 1 } });
  const r = await runInterviewerTurn(session, { messages: [{ role: "candidate", text: "Terminei a primeira versão, olha aí." }] });
  assert.match(r.reply, /^Olhei a linha 1: def solve\(nums\):\./);
  assert.equal((r.reply.match(/\?/g) ?? []).length, 1);
  assert.ok(r.commands.some((c) => c.type === "highlight_range"));
});

test("promessa vazia repetida na IDE cai na reserva com pergunta e grifo", async () => {
  const session = getOrCreateSession(`promessa-ide-${Date.now()}`);
  appendEvent(session, { type: "session_started", sessionId: session.sessionId, t: 0, configId: session.config.id, problemId: session.config.problemId, language: "python" });
  appendEvent(session, { type: "snapshot", sessionId: session.sessionId, t: 0, code: "def solve(nums):\n    return len(nums)", version: 1, language: "python" });
  saidas.push(
    { ...base, respond: true, concluded: true, end: true, reply: "Tá, vou olhar." },
    { ...base, respond: true, concluded: true, end: true, reply: "Certo, deixa eu analisar." },
  );
  const r = await runInterviewerTurn(session, { messages: [{ role: "candidate", text: "Terminei a primeira versão, olha aí." }] });
  assert.equal(chamadasAoEntrevistador, 2);
  assert.match(r.reply, /solve/);
  assert.ok(r.reply.trim().endsWith("?"), r.reply);
  assert.ok(r.commands.some((c) => c.type === "highlight_range"));
});

test("falha do modelo ao pedirem para olhar a IDE usa a reserva com grifo", async () => {
  const session = getOrCreateSession(`falha-olhar-ide-${Date.now()}`);
  appendEvent(session, { type: "session_started", sessionId: session.sessionId, t: 0, configId: session.config.id, problemId: session.config.problemId, language: "python" });
  appendEvent(session, { type: "snapshot", sessionId: session.sessionId, t: 0, code: "def solve(nums):\n    marker = len(nums)", version: 1, language: "python" });
  const r = await runInterviewerTurn(session, { messages: [{ role: "candidate", text: "Terminei a primeira versão, olha aí." }] });
  assert.match(r.reply, /solve/);
  assert.ok(r.reply.trim().endsWith("?"), r.reply);
  assert.ok(r.commands.some((c) => c.type === "highlight_range"));
});

test("resposta comum não marca etapa concluída", async () => {
  const session = getOrCreateSession(`comum-${Date.now()}`);
  saidas.push({ ...base, respond: true, concluded: false, reply: "Então você procura o complemento a cada passo." });
  const r = await runInterviewerTurn(session, { messages: [
    { role: "agent", text: "O que esse laço de fora faz?" },
    { role: "candidate", text: "eu procuro o complemento" },
  ] });
  assert.equal(r.concluded, undefined);
  assert.equal(r.listening, undefined);
  assert.equal(session.etapaConcluidaEm, undefined);
});

// Entrevista real de 2026-11-10 (sessão 972b2a10): o candidato resmungava sozinho e o Totti respondia "entendi".
test("fala solta sem pergunta: uma resposta que só reconhece não é falada, mas o que ele mostrou fica registrado", async () => {
  const session = getOrCreateSession(`resmungo-${Date.now()}`);
  saidas.push({ ...base, respond: true, concluded: false, end: true, reply: "Entendi, você está separando as contagens por passo.", evidence: { criterionId: "abordagem", note: "separa as contagens por passo" } });
  const r = await runInterviewerTurn(session, { messages: [{ role: "candidate", text: "em dois por dois dá sete, ok, acho que separo as contagens" }] });
  assert.deepEqual(r, { reply: "", commands: [], end: false, listening: true });
  assert.equal(session.evidence.at(-1)?.note, "separa as contagens por passo");
});

test("fala solta: ele perguntou, chamou o Totti, travou ou avisou que terminou → o Totti responde", async () => {
  const { reacaoDesnecessaria, respondendoAoTotti } = await import("../interviewer");
  const saida = { ...base, respond: true, concluded: false, finish: false, reply: "Pode usar, sim." };
  const fala = (text: string) => [{ role: "candidate" as const, text }];
  assert.equal(reacaoDesnecessaria(saida, fala("agora eu somo os dois de trás"), false), true);
  assert.equal(reacaoDesnecessaria(saida, fala("posso usar a biblioteca padrão"), true), false, "perguntou");
  assert.equal(reacaoDesnecessaria(saida, fala("totti eu vou começar pelo caso simples"), false), false, "chamou pelo nome");
  assert.equal(reacaoDesnecessaria(saida, fala("travei aqui nesse laço"), false), false, "travado");
  assert.equal(reacaoDesnecessaria({ ...saida, concluded: true }, fala("pronto terminei essa parte"), false), false, "etapa concluída");
  assert.equal(reacaoDesnecessaria({ ...saida, reply: "Saquei. Por que começar por aí?" }, fala("vou pelo mais direto"), false), false, "a fala pergunta algo");
  // Respondendo a uma pergunta que o Totti fez (o assunto fechou por silêncio e a resposta veio como fala livre).
  const respondendo = [{ role: "agent" as const, text: "Qual é a ideia aqui?" }, { role: "candidate" as const, text: "divido n por dois e arredondo" }];
  assert.equal(respondendoAoTotti(respondendo), true);
  assert.equal(reacaoDesnecessaria(saida, respondendo, false), false);
  assert.equal(respondendoAoTotti([{ role: "agent", text: "Pode seguir." }, { role: "candidate", text: "beleza vou seguir" }]), false);
});

test("falha do LLM: a fala de reserva não se repete na mesma sessão", async () => {
  const session = getOrCreateSession(`reserva-${Date.now()}`);
  const primeira = await runInterviewerTurn(session, { messages: [{ role: "candidate", text: "oi" }] });
  const segunda = await runInterviewerTurn(session, {
    messages: [{ role: "candidate", text: "oi" }, { role: "agent", text: primeira.reply }, { role: "candidate", text: "oi de novo" }],
  });
  assert.notEqual(primeira.reply, segunda.reply);
});

test("falaNaoRepetida escolhe a ainda não dita e, se todas foram, a menos recente", () => {
  assert.equal(falaNaoRepetida(["a", "b", "c"], ["a"]), "b");
  assert.equal(falaNaoRepetida(["a", "b"], ["b", "a"]), "b");
});

test("prompt da IDE traz intenção, feedback sem validar, recusa variada e grifo do trecho comentado", () => {
  const sistema = buildInterviewerSystem(DEFAULT_CONFIG, getProblem(DEFAULT_CONFIG.problemId));
  assert.match(sistema, /"respond": boolean, "concluded": boolean/);
  assert.match(sistema, /pela INTENÇÃO/);
  assert.match(sistema, /Pediu feedback/);
  assert.match(sistema, /VARIE a redação a cada recusa/);
  assert.match(sistema, /sem pedir licença/);
  assert.match(sistema, /Sempre que a fala comentar, parafrasear ou perguntar sobre um trecho do código/);
  assert.doesNotMatch(sistema, /Isso eu não posso te dar, a graça é ver como você pensa/);
});

test("prompt dinâmico da IDE lembra promessa pendente e freia depois de duas perguntas seguidas", () => {
  const baseInput = {
    mode: "candidate" as const, fase: "implementando" as const, elapsedLabel: "02:00", remainingLabel: "08:00", language: "python",
    numberedCode: "1 | def solve(): pass", uncovered: [], hintsPolicy: "livres" as const, messages: [] as ChatMessage[],
  };
  const pendente = buildInterviewerUser({ ...baseInput, previousConversations: "Você: Tá, vou olhar o código." });
  assert.match(pendente, /O que você disse que ia fazer e ainda não fez: "Tá, vou olhar o código\."/);
  const ritmo = buildInterviewerUser({
    ...baseInput, previousConversations: "", messages: [
      { role: "agent", text: "Por que escolheu esse loop?" }, { role: "candidate", text: "Para percorrer os valores." },
      { role: "agent", text: "O que pesou nessa decisão?" }, { role: "candidate", text: "O custo de memória." },
    ],
  });
  assert.match(ritmo, /as duas últimas falas terminaram em pergunta/);
});

// Entrevista real de 2026-11-09 (sessão 3ec438c1): depois da resposta ao último ponto do encerramento o Totti ficou
// ouvindo, e o candidato esperou ~30 s até perguntar "tem mais alguma pergunta?".
test("encerramento: respondeu o último ponto e o modelo ficou quieto → fecha agradecendo, sem 'pode finalizar'", async () => {
  const session = getOrCreateSession(`encerra-${Date.now()}`);
  session.queue.push({ id: "q-9", question: "Consegue me explicar esse bloco?", followUpTopic: "x", priority: 1, createdAt: 0, status: "asked", kind: "encerramento", closingTopics: ["ponto 1", "ponto 2"] });
  session.blips.push({ id: "q-9", preview: "Antes de encerrar, uns pontos rápidos", priority: 1, createdAt: 0 });
  saidas.push({ ...base, respond: false, concluded: false, reply: "" });
  const r = await runInterviewerTurn(session, { blipId: "q-9", messages: [
    { role: "agent", text: "Antes de você encerrar, queria fechar uns pontos rápidos. Consegue me explicar esse bloco?" },
    { role: "candidate", text: "ele vai cortando a lista ao meio" },
    { role: "agent", text: "E numa lista vazia, como esse código se comporta?" },
    { role: "candidate", text: "numa lista vazia ele já retornaria menos um porque nunca entra no while" },
  ] });
  assert.equal(r.end, true);
  assert.ok(r.reply.length > 0);
  assert.ok(!/finalizar|seguir|\?/i.test(r.reply), r.reply);
});

test("abertura: se o entrevistador já perguntou do plano numa fala livre, ela não sai de novo", async () => {
  const { enqueueKickoff, decideBlip, perdeuAVez } = await import("../policy");
  const { appendEvent } = await import("@/lib/session/store");
  const session = getOrCreateSession(`abertura-repetida-${Date.now()}`);
  let agora = 0;
  session.clock = () => agora;
  appendEvent(session, { type: "session_started", sessionId: session.sessionId, t: 0, configId: session.config.id, problemId: session.config.problemId, language: "python" });
  enqueueKickoff(session, 0);
  appendEvent(session, { type: "speech", sessionId: session.sessionId, t: 45_000, role: "candidate", text: "fecho obrigado" });
  appendEvent(session, { type: "speech", sessionId: session.sessionId, t: 49_000, role: "agent", text: "Me conta, como você pretende começar a resolver?" });
  agora = 50_000;
  assert.equal(decideBlip(session, agora).blip, undefined);
  assert.equal(session.queue.find((q) => q.kickoff)?.status, "stale");
  assert.match(perdeuAVez(session, session.queue.find((q) => q.kickoff)!, 0) ?? "", /já perguntou/);
});

// Sessão 972b2a10: ele colou da web uma solução diferente da que vinha escrevendo e o Totti não comentou.
test("colagem: a pergunta é escrita pelo modelo vendo o que havia antes; se o modelo falha, sai a de reserva com o grifo", async () => {
  const { enqueueCola, decideBlip } = await import("../policy");
  const { appendEvent } = await import("@/lib/session/store");
  const config = { ...DEFAULT_CONFIG, problemId: "climbing-stairs", durationMin: 15 };
  const session = getOrCreateSession(`cola-fala-${Date.now()}`, config);
  const id = session.sessionId;
  let agora = 0;
  session.clock = () => agora;
  appendEvent(session, { type: "session_started", sessionId: id, t: 0, configId: config.id, problemId: config.problemId, language: "python" });
  const antes = "def climb_stairs(n):\n    um_por_um = n/2\n    if um_por_um%10 != 0:\n        um_por_um = int(um_por_um) + 1\n    pass\n";
  const colado = "def climb_stairs(n):\n    if n <= 2:\n        return n\n    anterior, atual = 1, 2\n    for _ in range(3, n + 1):\n        anterior, atual = atual, anterior + atual\n    return atual\n";
  appendEvent(session, { type: "snapshot", sessionId: id, t: 199_000, code: antes, version: 1, language: "python" });
  appendEvent(session, { type: "snapshot", sessionId: id, t: 260_000, code: colado, version: 2, language: "python" });
  const colou = { type: "paste" as const, sessionId: id, t: 260_000, chars: 180, lines: 6, startLine: 2 };
  appendEvent(session, colou);
  assert.equal(enqueueCola(session, colou), true);
  agora = 263_000;
  const blip = decideBlip(session, agora).blip!;
  assert.equal(blip.passaNaFrente, true);

  saidas.push({ ...base, respond: true, concluded: false, reply: "Você vinha montando a conta com um_por_um e agora entrou esse laço com anterior e atual. De onde veio essa mudança, e como ela funciona?", highlight: { startLine: 4, endLine: 6 } });
  const r = await runInterviewerTurn(session, { blipId: blip.id, messages: [] });
  assert.equal(chamadasAoEntrevistador, 1, "a abertura da colagem passa pelo modelo");
  assert.match(r.reply, /um_por_um/);
  assert.equal(r.end, false);
  assert.deepEqual(r.commands, [{ type: "highlight_range", startLine: 4, endLine: 6 }]);

  // Modelo fora do ar: a pergunta de reserva, sobre a troca, com o grifo do trecho colado.
  const reserva = await runInterviewerTurn(session, { blipId: blip.id, messages: [] });
  assert.match(reserva.reply, /entrou de uma vez/);
  assert.match(reserva.reply, /diferente do que você vinha escrevendo/);
  assert.equal(reserva.end, false);
});

test("prompt: colagem vira conversa, encerramento não pergunta do plano do começo e fala que não é com ele fica sem resposta", () => {
  const sistema = buildInterviewerSystem(DEFAULT_CONFIG, getProblem(DEFAULT_CONFIG.problemId));
  assert.match(sistema, /## Tipo: cola/);
  assert.match(sistema, /de onde veio e se ele entende o que colou/);
  assert.match(sistema, /Nunca pergunte como ele planejou ou pensou "antes de começar"/);
  assert.match(sistema, /Fala que não é com você → respond = false/);
});
