// A mesma leitura do turno nas duas salas (issue #95): a mesma fala do candidato, na mesma situação, com a mesma
// leitura do modelo, dá a mesma decisão no quadro (lib/agente/perguntar.ts) e no live coding
// (lib/agents/interviewer.ts): responde ou não, conclui ou não, encerra ou não. LLM falso nos dois lados.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { KIT_SYSTEM_DESIGN as kit } from "@/lib/agente/kits/system-design";
import { criarClienteFalso } from "@/lib/agente/llm/cliente";
import { perguntar } from "@/lib/agente/perguntar";
import { estadoInicial, type EstadoSessao } from "@/lib/agente/sessao/estado";
import { runInterviewerTurn } from "@/lib/agents/interviewer";
import { SISTEMA_DO_FILTRO } from "@/lib/agents/spoilerFilter";
import type { ChatMessage } from "@/lib/contracts";
import { getOrCreateSession } from "@/lib/session/store";
import { PEDIDOS_DE_REPETIR_A_PERGUNTA } from "../turno";

const AGORA = 1_800_000_000_000;
const PERGUNTA_DO_TOTTI = "Como os dois lados ficam sabendo que o dado mudou?";

/** O que o modelo leu, nos termos comuns; cada sala recebe isso no formato dela. */
type Lido = { fala?: string; quieto?: boolean; concluiu?: boolean; encerrar?: boolean; naoSabe?: boolean };
/** O que se compara entre as salas. */
type Decisao = { responde: boolean; conclui: boolean; encerra: boolean; texto: string };
type Momento = {
  /** O Totti acabou de fazer uma pergunta e esta fala responde a ela. Senão, é fala livre. */
  respondendo?: boolean;
  /** Há quantos segundos ele não mexe no material. */
  paradoHaS?: number;
};

// ---- quadro -----------------------------------------------------------------------------------------------------
let pedidosDoQuadro: string[] = [];

async function noQuadro(falaDoCandidato: string, leituras: Lido[], momento: Momento = {}): Promise<Decisao> {
  const estado: EstadoSessao = {
    ...estadoInicial(), fase: "APROFUNDAMENTO", faseIniciadaEm: AGORA - 5 * 60_000, iniciadaEm: AGORA - 8 * 60_000,
    conversa: [{ quem: "agente", texto: momento.respondendo ? PERGUNTA_DO_TOTTI : "São cem milhões de links por mês.", em: AGORA - 20_000 }],
  };
  const llm = criarClienteFalso(leituras.map((l) => ({
    responder: !l.quieto, texto: l.fala ?? "", requisito: null, concluiu: l.concluiu === true, encerrar: l.encerrar === true,
    desfecho: l.naoSabe ? "nao_sabe" : null,
  })));
  const r = await perguntar(
    { llm, kit, problema: kit.problemas[0], log: () => {}, versao: "v2" }, estado,
    { fase: "APROFUNDAMENTO", texto: falaDoCandidato, desenhoParadoHaS: momento.paradoHaS }, AGORA,
  );
  pedidosDoQuadro = llm.chamadas.map((c) => c.sistema.dinamico ?? "");
  return { responde: r.responder, conclui: r.concluiu, encerra: r.encerrar === true, texto: r.texto };
}

// ---- live coding ------------------------------------------------------------------------------------------------
const fetchOriginal = globalThis.fetch;
const chaves = { featherless: process.env.FEATHERLESS_API_KEY, openrouter: process.env.OPENROUTER_API_KEY };
let saidas: unknown[] = [];
let pedidosDoLiveCoding: string[] = [];

const completion = (conteudo: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(conteudo) }, finish_reason: "stop" }], usage: {} });

beforeEach(() => {
  saidas = [];
  pedidosDoLiveCoding = [];
  process.env.FEATHERLESS_API_KEY = "teste";
  delete process.env.OPENROUTER_API_KEY;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    if (corpo.messages[0]?.content.startsWith(SISTEMA_DO_FILTRO)) return completion({ reason: "ok", safe: true });
    pedidosDoLiveCoding.push(corpo.messages.map((m) => m.content).join("\n"));
    // Como o cliente falso do quadro: acabaram as respostas, repete a última.
    const saida = saidas.length > 1 ? saidas.shift() : saidas[0];
    if (saida === undefined) throw new Error("sem saída simulada");
    return completion(saida);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (chaves.featherless === undefined) delete process.env.FEATHERLESS_API_KEY;
  else process.env.FEATHERLESS_API_KEY = chaves.featherless;
  if (chaves.openrouter !== undefined) process.env.OPENROUTER_API_KEY = chaves.openrouter;
});

let n = 0;
async function noLiveCoding(falaDoCandidato: string, leituras: Lido[], momento: Momento = {}): Promise<Decisao> {
  const session = getOrCreateSession(`duas-salas-turno-${Date.now()}-${n++}`);
  // O relógio da sessão e a última vez que ele digitou: é daí que sai o "parado há".
  const agora = 10 * 60_000;
  session.clock = () => agora;
  session.codeHistory.push({ t: agora - (momento.paradoHaS ?? 0) * 1000, version: 1, language: "python", code: "def two_sum(nums, target):\n    for i in range(len(nums)):\n        pass\n" });
  saidas.push(...leituras.map((l) => ({
    respond: !l.quieto, concluded: l.concluiu === true, finish: l.encerrar === true, reply: l.fala ?? "", highlight: null, end: false, gaveHint: false,
    evidence: null, challenge: null, probeOutcome: l.naoSabe ? { criterionId: "abordagem", kind: "nao_conseguiu", note: "não soube" } : null,
  })));
  let blipId: string | undefined;
  const messages: ChatMessage[] = [];
  if (momento.respondendo) {
    blipId = "q-1";
    session.queue.push({ id: "q-1", question: PERGUNTA_DO_TOTTI, followUpTopic: "x", priority: 1, createdAt: 0, status: "asked", kind: "explicar" });
    session.blips.push({ id: "q-1", preview: "Tenho uma pergunta", priority: 1, createdAt: 0 });
    messages.push({ role: "agent", text: PERGUNTA_DO_TOTTI });
  }
  messages.push({ role: "candidate", text: falaDoCandidato });
  const r = await runInterviewerTurn(session, { blipId, messages });
  return { responde: r.reply.trim() !== "", conclui: r.concluded === true, encerra: r.despedida === true, texto: r.reply };
}

/** A mesma fala, a mesma situação e a mesma leitura do modelo nas duas salas. */
async function nasDuas(falaDoCandidato: string, leituras: Lido[], momento: Momento = {}): Promise<{ quadro: Decisao; codigo: Decisao }> {
  return { quadro: await noQuadro(falaDoCandidato, leituras, momento), codigo: await noLiveCoding(falaDoCandidato, leituras, momento) };
}
const decisao = (d: Decisao) => ({ responde: d.responde, conclui: d.conclui, encerra: d.encerra });

describe("tabela de casos: a mesma decisão nas duas salas", () => {
  const CASOS: { nome: string; fala: string; leituras: Lido[]; momento?: Momento; espera: Omit<Decisao, "texto">; esperaNoQuadro?: Omit<Decisao, "texto"> }[] = [
    { nome: "pergunta clara, e o modelo responde", fala: "posso assumir que sempre existe uma resposta?", leituras: [{ fala: "Pode, sempre existe uma." }], espera: { responde: true, conclui: false, encerra: false } },
    { nome: "\"o que tu acha\" sem \"?\", e o modelo fica quieto duas vezes", fala: "aí eu guardo o que já vi, o que tu acha", leituras: [{ quieto: true }], espera: { responde: true, conclui: false, encerra: false } },
    { nome: "\"o que tu acha\" sem \"?\", e o modelo responde na segunda", fala: "aí eu guardo o que já vi, o que tu acha", leituras: [{ quieto: true }, { fala: "Depende do que você quer mostrar. Pode seguir com essa ideia." }], espera: { responde: true, conclui: false, encerra: false } },
    { nome: "pensando em voz alta", fala: "então aqui eu percorro e pra cada um eu olho os outros", leituras: [{ quieto: true }], espera: { responde: false, conclui: false, encerra: false } },
    { nome: "pensando em voz alta com \"né\" no fim", fala: "aí eu ponho isso aqui na frente, né", leituras: [{ quieto: true }], espera: { responde: false, conclui: false, encerra: false } },
    { nome: "respondeu à pergunta do Totti", fala: "um avisa o outro por um evento", leituras: [{ fala: "Saquei. E se o evento se perder?" }], momento: { respondendo: true }, espera: { responde: true, conclui: false, encerra: false } },
    { nome: "respondeu, e o modelo só reagiu", fala: "um avisa o outro por um evento", leituras: [{ fala: "Tá." }], momento: { respondendo: true }, espera: { responde: true, conclui: false, encerra: false } },
    { nome: "não sabe responder à pergunta do Totti", fala: "não sei, nunca pensei nisso", leituras: [{ fala: "Tranquilo, deixa isso de lado. E como você testaria?", naoSabe: true }], momento: { respondendo: true }, espera: { responde: true, conclui: false, encerra: false } },
    { nome: "terminou, e o modelo marcou", fala: "pronto, terminei essa parte", leituras: [{ fala: "Certo.", concluiu: true }], momento: { paradoHaS: 10 }, espera: { responde: true, conclui: true, encerra: false } },
    // #130, item 9: no live coding, o "terminei" solto é o fim da entrevista: o fechamento abre com as perguntas finais
    // (nem conclusão de etapa, nem despedida direta). No quadro segue sendo conclusão.
    { nome: "terminou com as mãos paradas, e o modelo não marcou", fala: "Eu acho que é isso, terminei.", leituras: [{ quieto: true }], momento: { paradoHaS: 10 }, espera: { responde: true, conclui: false, encerra: false }, esperaNoQuadro: { responde: true, conclui: true, encerra: false } },
    { nome: "disse \"terminei\" de uma parte e segue mexendo", fala: "terminei essa parte, agora vou para a outra", leituras: [{ quieto: true }], momento: { paradoHaS: 0 }, espera: { responde: false, conclui: false, encerra: false } },
    // Decisão revisada (#129): no quadro, sem critérios no plano, o pedido vai à última palavra antes da despedida (e só
    // com urgência, direto). O live coding segue direto à despedida: a diferença é a da sala, não a da regra comum.
    { nome: "pediu para encerrar a entrevista", fala: "acho que é isso, pode encerrar a entrevista", leituras: [{ quieto: true, encerrar: true }], momento: { paradoHaS: 10 }, espera: { responde: true, conclui: false, encerra: true }, esperaNoQuadro: { responde: true, conclui: false, encerra: false } },
  ];

  for (const caso of CASOS) {
    it(caso.nome, async () => {
      const r = await nasDuas(caso.fala, caso.leituras, caso.momento);
      assert.deepEqual(decisao(r.quadro), caso.esperaNoQuadro ?? caso.espera, `quadro: ${JSON.stringify(r.quadro)}`);
      assert.deepEqual(decisao(r.codigo), caso.espera, `live coding: ${JSON.stringify(r.codigo)}`);
    });
  }
});

describe("o que cada regra comum faz com a fala, nas duas salas", () => {
  it("\"o que tu acha\" sem resposta: gera de novo avisando o modelo, uma vez", async () => {
    const r = await nasDuas("aí eu guardo o que já vi, o que tu acha", [{ quieto: true }, { fala: "Depende do que você quer mostrar. Pode seguir com essa ideia." }]);
    assert.equal(r.quadro.texto, "Depende do que você quer mostrar. Pode seguir com essa ideia.");
    assert.equal(r.codigo.texto, "Depende do que você quer mostrar. Pode seguir com essa ideia.");
    for (const pedidos of [pedidosDoQuadro, pedidosDoLiveCoding]) {
      assert.equal(pedidos.length, 2);
      assert.doesNotMatch(pedidos[0], /ele te fez uma pergunta e você não respondeu/);
      assert.match(pedidos[1], /ATENÇÃO: ele te fez uma pergunta e você não respondeu/);
    }
  });

  it("\"o que tu acha\" e o modelo quieto nas duas gerações: o Totti pede para repetir, em vez de ignorar", async () => {
    const r = await nasDuas("aí eu guardo o que já vi, o que tu acha", [{ quieto: true }]);
    assert.equal(r.quadro.texto, PEDIDOS_DE_REPETIR_A_PERGUNTA[0]);
    assert.equal(r.codigo.texto, PEDIDOS_DE_REPETIR_A_PERGUNTA[0]);
  });

  it("\"não sei\": a pergunta nova sai da fala nas duas", async () => {
    const r = await nasDuas("não sei, nunca pensei nisso", [{ fala: "Tranquilo, deixa isso de lado. E como você testaria?", naoSabe: true }], { respondendo: true });
    for (const d of [r.quadro, r.codigo]) {
      assert.doesNotMatch(d.texto, /\?/, d.texto);
      assert.match(d.texto, /^Tranquilo, deixa isso de lado\./, d.texto);
    }
  });

  it("só \"Tá.\" depois de uma resposta: entra o convite da sala", async () => {
    const r = await nasDuas("um avisa o outro por um evento", [{ fala: "Tá." }], { respondendo: true });
    assert.match(r.quadro.texto, /^Tá\. \S+/);
    assert.match(r.codigo.texto, /^Tá\. \S+/);
    assert.doesNotMatch(r.codigo.texto, /desenho/);
    assert.doesNotMatch(r.quadro.texto, /código/);
  });

  it("\"terminei\" sem fala do modelo: no quadro o Totti avisa que vai olhar; no live coding o fechamento começa", async () => {
    const r = await nasDuas("Eu acho que é isso, terminei.", [{ quieto: true }], { paradoHaS: 10 });
    assert.match(r.quadro.texto, /olhada no desenho|olho o que você fez/);
    // #130, item 9: o "terminei" solto encerra a entrevista no live coding, passando antes pelas perguntas finais.
    assert.match(r.codigo.texto, /antes de terminar.*\?$/);
  });
});
