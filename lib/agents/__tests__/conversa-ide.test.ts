import assert from "node:assert/strict";
import { test } from "node:test";
import { liberouAPergunta } from "@/lib/conversa/licenca";
import { grifoComProposito } from "@/lib/agents/interviewer";

test("pedido de licença: 'pode' abre a pergunta; 'espera' e 'agora não' deixam para depois", () => {
  for (const sim of ["pode", "pode falar", "sim, manda", "claro", "fala aí", "beleza, pode perguntar depois desse if"]) {
    assert.equal(liberouAPergunta(sim), true, sim);
  }
  for (const nao of ["espera um pouquinho", "agora não", "pera aí", "só um minuto", "não, deixa eu terminar", "daqui a pouco"]) {
    assert.equal(liberouAPergunta(nao), false, nao);
  }
});

const codigo = [
  "def is_valid(s):",
  "    pilha = []",
  "    pares = {')': '(', ']': '['}",
  "    for char in s:",
  "        if char in '([':",
  "            pilha.append(char)",
].join("\n");
const inicio = "def is_valid(s):\n    # escreva sua solução aqui\n    pass\n";

test("grifo com propósito: a fala cita algo das linhas grifadas", () => {
  assert.equal(grifoComProposito("Por que o dicionário pares mapeia o fechamento para a abertura?", codigo, { startLine: 3, endLine: 3 }, inicio), true);
  assert.equal(grifoComProposito("E essa linha, o que ela garante?", codigo, { startLine: 6, endLine: 6 }, inicio), true);
});

test("grifo sem propósito sai: fala que não fala das linhas, ou linhas só do código inicial", () => {
  assert.equal(grifoComProposito("Como você costuma dividir o tempo da entrevista?", codigo, { startLine: 1, endLine: 3 }, inicio), false);
  assert.equal(grifoComProposito("Como você pensa em resolver?", inicio, { startLine: 1, endLine: 3 }, inicio), false);
});

test("pergunta de foco só no momento dela: pressão com falhas seguidas, escala e IA com a solução funcionando", async () => {
  const { focoPendente } = await import("@/lib/agents/focoQuota");
  const { getOrCreateSession, appendEvent } = await import("@/lib/session/store");
  const { DEFAULT_CONFIG } = await import("@/lib/config/default");
  const config = { ...DEFAULT_CONFIG, focus: [{ area: "pressao" as const, weight: 0.5 }, { area: "escala_produto" as const, weight: 0.3 }, { area: "uso_ia" as const, weight: 0.2 }] };
  const s = getOrCreateSession(`foco-${Date.now()}`, config);
  const id = s.sessionId;
  appendEvent(s, { type: "session_started", sessionId: id, t: 0, configId: config.id, problemId: config.problemId, language: "python" });
  appendEvent(s, { type: "snapshot", sessionId: id, t: 30_000, code: "def f(s):\n    return s", version: 1, language: "python" });
  // Logo depois de começar a codar: nenhum foco (era aqui que saía o "como você divide o seu tempo?").
  assert.equal(focoPendente(s, 40_000), undefined);
  const falhou = { passed: 0, total: 5, cases: [], stdout: "", stderr: "erro", durationMs: 1 };
  appendEvent(s, { type: "run", sessionId: id, t: 50_000, result: falhou });
  assert.equal(focoPendente(s, 51_000), undefined, "um erro só: ele ainda está olhando");
  appendEvent(s, { type: "run", sessionId: id, t: 60_000, result: falhou });
  assert.equal(focoPendente(s, 61_000), "pressao", "duas falhas seguidas");
  appendEvent(s, { type: "run", sessionId: id, t: 90_000, result: { ...falhou, passed: 5, stderr: "" } });
  assert.equal(focoPendente(s, 91_000), "escala_produto", "funcionou: pressão sai, entra o próximo foco do momento");
});

test("perguntas seguidas: um aprofundamento por resposta e, fora de uma pergunta do Totti, nenhum encadeamento", async () => {
  const { limitarPerguntas, perguntasSeguidas } = await import("@/lib/agents/interviewer");
  const saida = (reply: string) => ({ respond: true, concluded: false, finish: false, reply, highlight: { startLine: 2, endLine: 2 }, end: false, gaveHint: false, evidence: null, challenge: null, probeOutcome: null });
  const conversa = [
    { role: "agent" as const, text: "Por que uma pilha?" },
    { role: "candidate" as const, text: "porque o último aberto é o primeiro a fechar" },
  ];
  assert.equal(perguntasSeguidas(conversa), 1);
  // Na pergunta da análise: cabe um aprofundamento.
  assert.equal(limitarPerguntas(saida("Saquei. E a memória, como fica?"), { kind: "explicar" }, conversa, false).end, false);
  // Já aprofundou uma vez: reconhece e devolve a vez para o código, sem grifo.
  const depois = [...conversa, { role: "agent" as const, text: "E a memória, como fica?" }, { role: "candidate" as const, text: "no pior caso guarda tudo" }];
  const fechou = limitarPerguntas(saida("Certo. E por que não usar um contador?"), { kind: "explicar" }, depois, false);
  assert.equal(fechou.end, true);
  assert.equal(fechou.highlight, null);
  assert.ok(!fechou.reply.includes("?"), fechou.reply);
  assert.ok(fechou.reply.startsWith("Certo."), fechou.reply);
  // Fala livre respondendo uma pergunta que o Totti fez: não puxa outra.
  assert.equal(limitarPerguntas(saida("Hum, tá. E o custo de tempo?"), undefined, conversa, false).end, true);
  // A abertura nunca aprofunda.
  assert.equal(limitarPerguntas(saida("Beleza. E por que pilha?"), { kickoff: true }, conversa, false).end, true);
  // Pedido de licença não conta como pergunta.
  assert.equal(perguntasSeguidas([{ role: "agent", text: "Ei, posso te perguntar uma coisa sobre o seu código?" }]), 0);
});

test("ritmo das perguntas: escreveu uma linha e falou há pouco, a próxima espera; pergunta que ele já respondeu falando sai", async () => {
  const { decideBlip, lastBlipDecision } = await import("@/lib/agents/policy");
  const { getOrCreateSession, appendEvent } = await import("@/lib/session/store");
  const { DEFAULT_CONFIG } = await import("@/lib/config/default");
  const s = getOrCreateSession(`ritmo-${Date.now()}`, DEFAULT_CONFIG);
  const id = s.sessionId;
  let agora = 0;
  s.clock = () => agora;
  const pergunta = (n: number, question: string, createdAt: number) =>
    s.queue.push({ id: `q-${n}`, question, followUpTopic: "x", priority: 0.8, createdAt, status: "queued", kind: "explicar", fase: "implementando", parteFechada: true } as never);
  appendEvent(s, { type: "session_started", sessionId: id, t: 0, configId: DEFAULT_CONFIG.id, problemId: DEFAULT_CONFIG.problemId, language: "python" });
  appendEvent(s, { type: "snapshot", sessionId: id, t: 30_000, code: "def f(nums, target):\n    vistos = {}\n    pass\n", version: 1, language: "python" });
  appendEvent(s, { type: "pause", sessionId: id, t: 40_000, idleMs: 10_000 });
  pergunta(1, "O que você vai guardar no dicionário vistos?", 40_000);
  agora = 60_000;
  assert.equal(decideBlip(s, agora).blip?.id, "q-1");
  appendEvent(s, { type: "blip_opened", sessionId: id, t: agora, blipId: "q-1" });
  appendEvent(s, { type: "speech", sessionId: id, t: 62_000, role: "agent", text: "O que você vai guardar no dicionário vistos?", blipId: "q-1" });
  appendEvent(s, { type: "speech", sessionId: id, t: 75_000, role: "candidate", text: "vou guardar cada número com o índice dele para achar o complemento depois", blipId: "q-1" });
  appendEvent(s, { type: "blip_closed", sessionId: id, t: 80_000, blipId: "q-1", reason: "agent" });
  // Pergunta nova da análise, mas ele não escreveu nada desde a última e acabaram de conversar.
  pergunta(2, "Como você vai percorrer a lista nums?", 81_000);
  agora = 100_000;
  assert.equal(decideBlip(s, agora).blip, undefined);
  assert.match(lastBlipDecision(s) ?? "", /desde a última conversa|cota do tempo/);
  // A cota do tempo (política comum) só libera a segunda pergunta depois dos 3 min de 30; a q-2 envelheceu
  // e a análise seguinte traz outra. Ainda sem linha nova: espera ele avançar no código.
  pergunta(3, "Como você vai percorrer a lista nums?", 170_000);
  agora = 185_000;
  assert.equal(decideBlip(s, agora).blip, undefined);
  assert.match(lastBlipDecision(s) ?? "", /linha\(s\) nova\(s\)/);
  appendEvent(s, { type: "snapshot", sessionId: id, t: 186_000, code: "def f(nums, target):\n    vistos = {}\n    for i, n in enumerate(nums):\n        falta = target - n\n        if falta in vistos:\n            return [vistos[falta], i]\n", version: 2, language: "python" });
  appendEvent(s, { type: "pause", sessionId: id, t: 195_000, idleMs: 9_000 });
  agora = 196_000;
  assert.equal(decideBlip(s, agora).blip?.id, "q-3");

  // Uma pergunta nascida antes de ele explicar falando sai: a análise seguinte decide de novo.
  const s2 = getOrCreateSession(`ritmo2-${Date.now()}`, DEFAULT_CONFIG);
  s2.clock = () => agora;
  appendEvent(s2, { type: "session_started", sessionId: s2.sessionId, t: 0, configId: DEFAULT_CONFIG.id, problemId: DEFAULT_CONFIG.problemId, language: "python" });
  appendEvent(s2, { type: "snapshot", sessionId: s2.sessionId, t: 30_000, code: "def f(nums, target):\n    vistos = {}\n    pass\n", version: 1, language: "python" });
  s2.queue.push({ id: "q-1", question: "O que você vai guardar em vistos?", followUpTopic: "x", priority: 0.8, createdAt: 35_000, status: "queued", kind: "explicar", fase: "implementando" } as never);
  appendEvent(s2, { type: "speech", sessionId: s2.sessionId, t: 40_000, role: "candidate", text: "então a ideia é guardar em vistos cada número que eu já passei junto com o índice" });
  appendEvent(s2, { type: "pause", sessionId: s2.sessionId, t: 90_000, idleMs: 10_000 });
  agora = 91_000;
  assert.equal(decideBlip(s2, agora).blip, undefined);
  assert.equal(s2.queue[0].status, "stale");
});

test("pergunta do candidato sem '?': o Totti responde antes de perguntar", async () => {
  const { candidatoPerguntou } = await import("@/lib/agents/prompts/interviewer");
  const c = (text: string) => [{ role: "candidate" as const, text }];
  for (const sim of ["criar uma pilha e conferir o topo o que que tu achou", "tá certo assim", "eu não vou ser penalizado né", "quanto tempo falta", "posso usar um dicionário"]) {
    assert.equal(candidatoPerguntou(c(sim)), true, sim);
  }
  for (const nao of ["agora vou montar o loop", "porque a pilha é last in first out", "deixa eu ver esse índice"]) {
    assert.equal(candidatoPerguntou(c(nao)), false, nao);
  }
});

test("sem 'entendi, entendi': a resposta não abre com outro reconhecimento depois do 'uhum' nem repete o da fala anterior", async () => {
  // A trava agora é a comum às duas salas (lib/totti/guardas.ts, com os casos em lib/totti/__tests__).
  const { semReacaoRepetida } = await import("@/lib/totti/guardas");
  assert.equal(semReacaoRepetida("Saquei. E o custo de memória?", [], true), "E o custo de memória?");
  assert.equal(semReacaoRepetida("Entendi, fica mais direto. Qual o custo?", [], true), "Fica mais direto. Qual o custo?");
  assert.equal(semReacaoRepetida("Saquei. E o custo?", [], false), "Saquei. E o custo?");
  assert.equal(semReacaoRepetida("Saquei, e a pilha vazia?", ["Saquei. Pode seguir."], false), "E a pilha vazia?");
  assert.equal(semReacaoRepetida("Saquei.", [], true), "Saquei.");
});

test("fim da entrevista: 'já terminei' encerra; travado ou perguntando, a pergunta do Totti não é cortada", async () => {
  const { querEncerrar, travado, limitarPerguntas } = await import("@/lib/agents/interviewer");
  const c = (text: string) => ({ role: "candidate" as const, text });
  assert.equal(querEncerrar([c("pronto terminei")]), false, "o primeiro 'terminei' é etapa concluída");
  assert.equal(querEncerrar([c("pronto terminei"), { role: "agent", text: "E a memória?" }, c("conseguiu? eu já terminei")]), true);
  assert.equal(querEncerrar([c("terminei"), { role: "agent", text: "Por quê?" }, c("terminei pô")]), true);
  assert.equal(travado([c("mas eu não sei como seguir, não sei porque tá quebrando")]), true);
  const saida = { respond: true, concluded: false, finish: false, reply: "Quando você roda, o que aparece?", highlight: null, end: false, gaveHint: false, evidence: null, challenge: null, probeOutcome: null };
  const conversa = [{ role: "agent" as const, text: "O que acontece aqui?" }, c("eu não sei o que fazer, não entendi porque tá quebrando")];
  assert.equal(limitarPerguntas(saida, undefined, conversa, false).end, false);
});

test("abertura: espera a leitura e não sai se ele já contou o plano enquanto ela esperava a pausa", async () => {
  const { decideBlip, perdeuAVez, enqueueKickoff, lastBlipDecision } = await import("@/lib/agents/policy");
  const { getOrCreateSession, appendEvent } = await import("@/lib/session/store");
  const { DEFAULT_CONFIG } = await import("@/lib/config/default");
  const s = getOrCreateSession(`abertura-${Date.now()}`, DEFAULT_CONFIG);
  let agora = 0;
  s.clock = () => agora;
  appendEvent(s, { type: "session_started", sessionId: s.sessionId, t: 0, configId: DEFAULT_CONFIG.id, problemId: DEFAULT_CONFIG.problemId, language: "python" });
  enqueueKickoff(s, 0);
  // Ainda na apresentação (~30 s): nada de pergunta.
  agora = 20_000;
  assert.equal(decideBlip(s, agora).blip, undefined);
  // Passou da leitura, mas ele ainda não escreveu nada: a abertura espera ele começar.
  agora = 46_000;
  assert.equal(decideBlip(s, agora).blip, undefined);
  assert.match(lastBlipDecision(s) ?? "", /começar a escrever/);
  // Escreveu umas linhas e parou: agora sim.
  appendEvent(s, { type: "snapshot", sessionId: s.sessionId, t: 50_000, code: "def f(nums, target):\n    vistos = {}\n    for i, n in enumerate(nums):\n        falta = target - n\n", version: 1, language: "python" });
  appendEvent(s, { type: "pause", sessionId: s.sessionId, t: 58_000, idleMs: 8_000 });
  agora = 58_500;
  const blip = decideBlip(s, agora).blip;
  assert.ok(blip?.id);
  const q = s.queue.find((x) => x.id === blip.id)!;
  assert.equal(perdeuAVez(s, q, blip.createdAt), undefined);
  // Enquanto a IDE esperava a pausa, ele contou o plano sozinho: a abertura perdeu a vez.
  appendEvent(s, { type: "speech", sessionId: s.sessionId, t: 60_000, role: "candidate", text: "então eu vou percorrer a lista guardando o menor preço até agora e calculando o lucro de vender em cada dia" });
  assert.match(perdeuAVez(s, q, blip.createdAt) ?? "", /contou o plano/);
});

test("a abertura que perdeu a vez não é falada: a conversa fecha sem fala", async () => {
  const { runInterviewerTurn } = await import("@/lib/agents/interviewer");
  const { decideBlip, enqueueKickoff } = await import("@/lib/agents/policy");
  const { getOrCreateSession, appendEvent } = await import("@/lib/session/store");
  const { DEFAULT_CONFIG } = await import("@/lib/config/default");
  const s = getOrCreateSession(`abertura-chat-${Date.now()}`, DEFAULT_CONFIG);
  let agora = 0;
  s.clock = () => agora;
  appendEvent(s, { type: "session_started", sessionId: s.sessionId, t: 0, configId: DEFAULT_CONFIG.id, problemId: DEFAULT_CONFIG.problemId, language: "python" });
  enqueueKickoff(s, 0);
  // Sem código nenhum até a reserva (2,5 min): a abertura sai mesmo assim.
  agora = 151_000;
  const blip = decideBlip(s, agora).blip!;
  appendEvent(s, { type: "speech", sessionId: s.sessionId, t: 155_000, role: "candidate", text: "minha ideia é usar um dicionário para guardar o que eu já vi e achar o complemento numa passada só" });
  agora = 170_000;
  const res = await runInterviewerTurn(s, { blipId: blip.id, messages: [] });
  assert.equal(res.reply, "");
  assert.equal(res.end, true);
  assert.equal(s.queue.find((x) => x.id === blip.id)?.status, "stale");
});

test("encerramento: uma pergunta por ponto pendente e, depois do último, fecha despedindo (sem 'pode seguir')", async () => {
  const { limitarPerguntas } = await import("@/lib/agents/interviewer");
  const saida = (reply: string) => ({ respond: true, concluded: false, finish: false, reply, highlight: { startLine: 2, endLine: 2 }, end: false, gaveHint: false, evidence: null, challenge: null, probeOutcome: null });
  const encerramento = { kind: "encerramento", closingTopics: ["ponto 1", "ponto 2"] };
  const conversa = [
    { role: "agent" as const, text: "Antes de você encerrar, queria fechar uns pontos rápidos. Qual o custo de tempo?" },
    { role: "candidate" as const, text: "é linear, passo uma vez só" },
  ];
  // Segundo ponto: ainda cabe.
  assert.equal(limitarPerguntas(saida("Saquei. E se a lista vier vazia?"), encerramento, conversa, false).end, false);
  const depois = [...conversa, { role: "agent" as const, text: "E se a lista vier vazia?" }, { role: "candidate" as const, text: "devolve zero" }];
  const fechou = limitarPerguntas(saida("Entendi. E a memória, como fica?"), encerramento, depois, false);
  assert.equal(fechou.end, true);
  assert.ok(!fechou.reply.includes("?"), fechou.reply);
  assert.ok(!/seguir|continuar|código/i.test(fechou.reply), fechou.reply);
  // Mesmo perguntando algo, depois do último ponto o encerramento fecha.
  const perguntou = [...depois.slice(0, -1), { role: "candidate" as const, text: "devolve zero, isso conta como caso de borda?" }];
  assert.equal(limitarPerguntas(saida("Conta sim. E a memória?"), encerramento, perguntou, false).end, true);
});

test("licença: 'pode encerrar' não libera a pergunta (é pedido para fechar a entrevista)", async () => {
  const { pedeParaEncerrar } = await import("@/lib/conversa/licenca");
  for (const fala of ["pode encerrar", "não, pode encerrar a entrevista", "vamos finalizar", "tenho que sair"]) {
    assert.equal(liberouAPergunta(fala), false, fala);
    assert.equal(pedeParaEncerrar(fala), true, fala);
  }
  assert.equal(liberouAPergunta("pode falar"), true);
  assert.equal(pedeParaEncerrar("pode falar"), false);
});

test("filtro de fala: só roda quando a fala pode entregar algo (código, número, técnica, erro)", async () => {
  const { podeEntregarAlgo } = await import("@/lib/agents/interviewer");
  const code = "def busca(nums, alvo):\n    esquerda = 0\n    direita = len(nums) - 1\n";
  for (const fala of ["Por que começar por aí?", "Me fala mais do que você pensou.", "Beleza, e qual o próximo passo?"]) {
    assert.equal(podeEntregarAlgo(fala, code), false, fala);
  }
  for (const fala of ["E esse esquerda aqui, quando muda?", "Você notou algo estranho?", "Testa com [1, 2].", "Dá pra usar um dicionário?", "Isso está certo."]) {
    assert.equal(podeEntregarAlgo(fala, code), true, fala);
  }
});

test("abertura: quem digita sem parar 8 s recebe a pergunta numa pausa curta, e ela não some com o código crescendo", async () => {
  const { decideBlip, enqueueKickoff } = await import("@/lib/agents/policy");
  const { getOrCreateSession, appendEvent } = await import("@/lib/session/store");
  const { DEFAULT_CONFIG } = await import("@/lib/config/default");
  const s = getOrCreateSession(`abertura-rapido-${Date.now()}`, DEFAULT_CONFIG);
  let agora = 0;
  s.clock = () => agora;
  appendEvent(s, { type: "session_started", sessionId: s.sessionId, t: 0, configId: DEFAULT_CONFIG.id, problemId: DEFAULT_CONFIG.problemId, language: "python" });
  enqueueKickoff(s, 0);
  // Digita direto: um snapshot a cada 2 s, sem nenhum evento de pausa, até umas 25 linhas.
  let codigo = "def f(nums, target):\n";
  for (let i = 0; i < 25; i++) {
    codigo += `    linha_${i} = ${i}\n`;
    appendEvent(s, { type: "snapshot", sessionId: s.sessionId, t: 40_000 + i * 2_000, code: codigo, version: i + 1, language: "python" });
    agora = 40_000 + i * 2_000 + 500;
    assert.equal(decideBlip(s, agora).blip, undefined);
  }
  // Para 3 s: a abertura sai, mesmo com 25 linhas.
  agora = 40_000 + 24 * 2_000 + 3_100;
  assert.equal(decideBlip(s, agora).blip?.id, s.queue.find((q) => q.kickoff)?.id);
});

test("pedido de explicação fechado com ponto vira pergunta: o assunto não fecha antes de ele responder", async () => {
  const { pedidoViraPergunta } = await import("@/lib/agents/interviewer");
  assert.equal(pedidoViraPergunta("Entendi. E me conta com as suas palavras o que esse laço faz passo a passo."), "Entendi. E me conta com as suas palavras o que esse laço faz passo a passo?");
  assert.equal(pedidoViraPergunta("Me explica essa linha."), "Me explica essa linha?");
  // Fala que não pede nada, pergunta já com "?" e frase em aberto ficam como estão.
  assert.equal(pedidoViraPergunta("Beleza, pode seguir."), "Beleza, pode seguir.");
  assert.equal(pedidoViraPergunta("Me conta: por que esse caminho?"), "Me conta: por que esse caminho?");
  assert.equal(pedidoViraPergunta("Você me conta depois. Pode seguir."), "Você me conta depois. Pode seguir.");
});
