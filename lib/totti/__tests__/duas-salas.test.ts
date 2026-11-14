// O mesmo Totti nas duas salas (issue #94): a mesma fala do modelo, na mesma situação, passa pelas mesmas travas no
// quadro (lib/agente/perguntar.ts e analisar.ts) e no live coding (lib/agents/interviewer.ts). Os casos são os das
// entrevistas de teste de 2026-11-11. LLM falso nos dois lados.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { analisar } from "@/lib/agente/analisar";
import { KIT_SYSTEM_DESIGN as kit } from "@/lib/agente/kits/system-design";
import { criarClienteFalso } from "@/lib/agente/llm/cliente";
import { perguntar } from "@/lib/agente/perguntar";
import { estadoInicial, type EstadoSessao } from "@/lib/agente/sessao/estado";
import type { PedidoAnalise, RespostaAnalise } from "@/lib/agente/sessao/tipos";
import { runInterviewerTurn } from "@/lib/agents/interviewer";
import { SISTEMA_DO_FILTRO } from "@/lib/agents/spoilerFilter";
import type { ChatMessage } from "@/lib/contracts";
import { getOrCreateSession } from "@/lib/session/store";

const AGORA = 1_800_000_000_000;
const PERGUNTA_DO_TOTTI = "Como os dois lados ficam sabendo que o dado mudou?";

// ---- quadro: o modelo é o cliente falso do cérebro --------------------------------------------------------------
async function falaNoQuadro(falaDoModelo: string, falaDoCandidato: string, extra: Partial<EstadoSessao> = {}): Promise<string> {
  const estado: EstadoSessao = {
    ...estadoInicial(), fase: "APROFUNDAMENTO", faseIniciadaEm: AGORA - 5 * 60_000, iniciadaEm: AGORA - 8 * 60_000,
    conversa: [{ quem: "agente", texto: PERGUNTA_DO_TOTTI, em: AGORA - 20_000 }], ...extra,
  };
  const llm = criarClienteFalso([{ responder: true, texto: falaDoModelo, requisito: null, concluiu: false, desfecho: null }]);
  const r = await perguntar({ llm, kit, problema: kit.problemas[0], log: () => {}, versao: "v2" }, estado, { fase: "APROFUNDAMENTO", texto: falaDoCandidato }, AGORA);
  return r.responder ? r.texto : "";
}

// ---- live coding: o provedor é simulado pelo fetch ---------------------------------------------------------------
const fetchOriginal = globalThis.fetch;
const chaves = { featherless: process.env.FEATHERLESS_API_KEY, openrouter: process.env.OPENROUTER_API_KEY };
let saidas: unknown[] = [];

const completion = (conteudo: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(conteudo) }, finish_reason: "stop" }], usage: {} });

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
  if (chaves.featherless === undefined) delete process.env.FEATHERLESS_API_KEY;
  else process.env.FEATHERLESS_API_KEY = chaves.featherless;
  if (chaves.openrouter !== undefined) process.env.OPENROUTER_API_KEY = chaves.openrouter;
});

let n = 0;
/** Numa pergunta do Totti (balão): ele perguntou, o candidato respondeu, e o modelo devolve `falaDoModelo`. */
async function falaNoLiveCoding(falaDoModelo: string, falaDoCandidato: string): Promise<string> {
  const session = getOrCreateSession(`duas-salas-${Date.now()}-${n++}`);
  session.queue.push({ id: "q-1", question: PERGUNTA_DO_TOTTI, followUpTopic: "x", priority: 1, createdAt: 0, status: "asked", kind: "explicar" });
  session.blips.push({ id: "q-1", preview: "Tenho uma pergunta", priority: 1, createdAt: 0 });
  saidas.push({ respond: true, concluded: false, finish: false, reply: falaDoModelo, highlight: null, end: false, gaveHint: false, evidence: null, challenge: null, probeOutcome: null });
  const messages: ChatMessage[] = [{ role: "agent", text: PERGUNTA_DO_TOTTI }, { role: "candidate", text: falaDoCandidato }];
  const r = await runInterviewerTurn(session, { blipId: "q-1", messages });
  return r.reply;
}

describe("as mesmas travas nas duas salas (casos reais de 11/11)", () => {
  it("esclarecer uma resposta vaga preserva a pergunta nas duas salas", async () => {
    const esclarecimento = "Melhor em que sentido?";
    const vaga = "Acho que fica melhor assim.";
    assert.equal(await falaNoQuadro(esclarecimento, vaga), esclarecimento);
    assert.equal(await falaNoLiveCoding(esclarecimento, vaga), esclarecimento);
  });

  it("cumprimento no meio da entrevista: sai nas duas, e a pergunta fica", async () => {
    const doModelo = "Oi, tudo bem? E quando o serviço cai no meio, quem avisa o outro lado?";
    const esperado = "E quando o serviço cai no meio, quem avisa o outro lado?";
    assert.equal(await falaNoQuadro(doModelo, "um avisa o outro por um evento"), esperado);
    assert.equal(await falaNoLiveCoding(doModelo, "um avisa o outro por um evento"), esperado);
  });

  it("\"Faz sentido.\" antes do convite: a validação sai nas duas", async () => {
    const doModelo = "Faz sentido. Pode seguir de onde parou.";
    assert.equal(await falaNoQuadro(doModelo, "eu publico um evento e o outro lado consome"), "Pode seguir de onde parou.");
    assert.equal(await falaNoLiveCoding(doModelo, "eu publico um evento e o outro lado consome"), "Pode seguir de onde parou.");
  });

  it("\"Terminou.\" depois de \"terminei\": o eco não é falado em nenhuma das duas", async () => {
    const noQuadro = await falaNoQuadro("Terminou.", "Eu acho que é isso, terminei.");
    // No live coding o "terminei" solto já abre o fechamento antes do modelo (#130, item 9): aqui ele diz de quê.
    const noCodigo = await falaNoLiveCoding("Terminou.", "Eu acho que é isso, terminei a explicação.");
    for (const fala of [noQuadro, noCodigo]) assert.doesNotMatch(fala, /terminou/i, fala);
    // Ele respondia a uma pergunta do Totti: no lugar do eco entra a mesma reação neutra nas duas salas.
    assert.match(noQuadro, /^Certo\./);
    assert.match(noCodigo, /^Certo\./);
  });

  it("fala que era só validação vira a mesma reação neutra nas duas", async () => {
    assert.match(await falaNoQuadro("Perfeito!", "eu publico um evento e o outro lado consome"), /^Certo\./);
    assert.match(await falaNoLiveCoding("Perfeito!", "eu publico um evento e o outro lado consome"), /^Certo\./);
  });

  it("pergunta que ele já ouviu não sai de novo em nenhuma das duas", async () => {
    const doModelo = "Saquei. E como os dois lados ficam sabendo que o dado mudou?";
    const noQuadro = await falaNoQuadro(doModelo, "pode ser por evento");
    const noCodigo = await falaNoLiveCoding(doModelo, "pode ser por evento");
    for (const fala of [noQuadro, noCodigo]) {
      assert.doesNotMatch(fala, /\?/, fala);
      assert.match(fala, /^Saquei\./, fala);
    }
  });
});

describe("onde a pergunta de condução é a pergunta da vez", () => {
  const DE_CONDUCAO = "Quer acrescentar alguma coisa antes de a gente encerrar?";
  const saida = (reply: string) => ({ respond: true, concluded: false, finish: false, reply, highlight: null, end: false, gaveHint: false, evidence: null, challenge: null, probeOutcome: null });

  it("live coding: no meio da entrevista ela é barrada, no encerramento ela sai", async () => {
    const turno = async (kind: "explicar" | "encerramento") => {
      const session = getOrCreateSession(`duas-salas-conducao-${kind}-${Date.now()}`);
      session.queue.push({ id: "q-3", question: PERGUNTA_DO_TOTTI, followUpTopic: "x", priority: 1, createdAt: 0, status: "asked", kind, closingTopics: kind === "encerramento" ? ["um ponto", "outro ponto"] : undefined });
      session.blips.push({ id: "q-3", preview: "Tenho uma pergunta", priority: 1, createdAt: 0 });
      saidas.push(saida(`Certo. ${DE_CONDUCAO}`));
      const messages: ChatMessage[] = [{ role: "agent", text: PERGUNTA_DO_TOTTI }, { role: "candidate", text: "um avisa o outro por um evento" }];
      return (await runInterviewerTurn(session, { blipId: "q-3", messages })).reply;
    };
    assert.doesNotMatch(await turno("explicar"), /acrescentar/);
    assert.match(await turno("encerramento"), /Quer acrescentar alguma coisa antes de a gente encerrar\?$/);
  });

  it("quadro: fora das fases de desenho ela não é barrada", async () => {
    const estado: EstadoSessao = { ...estadoInicial(), fase: "REQUISITOS", faseIniciadaEm: AGORA - 60_000, iniciadaEm: AGORA - 90_000, conversa: [{ quem: "agente", texto: "São cem milhões de links por mês.", em: AGORA - 20_000 }] };
    const llm = criarClienteFalso([{ responder: true, texto: "Certo. Quer detalhar mais algum requisito?", requisito: null, concluiu: false, desfecho: null }]);
    const r = await perguntar({ llm, kit, problema: kit.problemas[0], log: () => {}, versao: "v2" }, estado, { fase: "REQUISITOS", texto: "beleza, anotei aqui o volume" }, AGORA);
    assert.match(r.responder ? r.texto : "", /Quer detalhar mais algum requisito\?$/);
  });
});

describe("a pergunta da análise também passa pelas travas", () => {
  const pedido: PedidoAnalise = { sessao_id: "s-1", fase: "APROFUNDAMENTO", grafo: "COMPONENTES\n- [r1] API (retângulo)", mudancas: "", conversa_recente: [], perguntas_feitas: 0, imagem_url: null, parado_ha_s: 30 };
  const estado: EstadoSessao = { ...estadoInicial(), fase: "APROFUNDAMENTO", faseIniciadaEm: AGORA - 5 * 60_000, iniciadaEm: AGORA - 8 * 60_000 };
  const resposta = (pergunta: string): RespostaAnalise => ({ status: "duvida", parteFechada: true, escopo: false, pergunta, nota: "abordagem", elementos: [], degrau: null, observacoes: [] });

  it("quadro: o caso real da #83 perde o cumprimento antes de virar pergunta", async () => {
    const llm = criarClienteFalso([resposta("Oi, tudo bem? Como você está pensando em abordar esse problema?")]);
    const r = await analisar({ llm, kit, problema: kit.problemas[0], log: () => {} }, estado, pedido, AGORA);
    assert.ok(r.diagnostico.ajustes.includes("trava_cumprimento"), JSON.stringify(r.diagnostico));
    assert.doesNotMatch(r.resposta.pergunta ?? "", /oi|tudo bem/i);
  });

  it("quadro: se só havia o cumprimento, não há pergunta a levantar", async () => {
    const llm = criarClienteFalso([resposta("Oi, tudo bem?")]);
    const r = await analisar({ llm, kit, problema: kit.problemas[0], log: () => {} }, estado, pedido, AGORA);
    assert.equal(r.resposta.status, "ok");
  });

  it("live coding: a pergunta preparada pela análise sai sem o cumprimento", async () => {
    const session = getOrCreateSession(`duas-salas-preparada-${Date.now()}`);
    session.queue.push({ id: "q-2", question: "Oi, tudo bem? Como você está pensando em abordar esse problema?", followUpTopic: "x", priority: 1, createdAt: 0, status: "blipped", kind: "explicar" });
    session.blips.push({ id: "q-2", preview: "Tenho uma pergunta", priority: 1, createdAt: 0 });
    const r = await runInterviewerTurn(session, { blipId: "q-2", messages: [] });
    assert.equal(r.reply, "Como você está pensando em abordar esse problema?");
  });
});
