import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  analisar, criarSessao, enviarEventos, enviarImagem, finalizar, perguntar, sintetizarFala, tokenTranscricao,
  type Alinhamento, type FalaRecente, type PedidoAnalise, type Sessao,
} from "../servidor";

type Chamada = { rota: string; opcoes: RequestInit };

function substituirFetch(t: TestContext, responder: (chamada: Chamada) => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  t.mock.method(globalThis, "fetch", async (entrada: string | URL | Request, opcoes: RequestInit = {}) => {
    assert.equal(typeof entrada, "string");
    const rota = String(entrada);
    assert.ok(rota.startsWith("/api/"));
    assert.equal(new Headers(opcoes.headers).get("authorization"), null);
    const chamada = { rota, opcoes };
    chamadas.push(chamada);
    return responder(chamada);
  });
  return chamadas;
}

function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), { status, headers: { "Content-Type": "application/json" } });
}

function corpo(chamada: Chamada): unknown {
  assert.equal(new Headers(chamada.opcoes.headers).get("content-type"), "application/json");
  assert.equal(typeof chamada.opcoes.body, "string");
  return JSON.parse(String(chamada.opcoes.body)) as unknown;
}

function pedido(sessaoId = "sessao-1"): PedidoAnalise {
  const conversa: FalaRecente[] = [{ quem: "candidato", texto: "O cache armazena as leituras." }];
  return {
    sessao_id: sessaoId,
    fase: "APROFUNDAMENTO",
    grafo: "COMPONENTES\n- [r1] API (retângulo)\nCONEXÕES",
    mudancas: "+ adicionou [r1] API",
    conversa_recente: conversa,
    perguntas_feitas: 1,
    imagem_url: "/imagens/quadro.png",
  };
}

const sessao: Sessao = {
  sessao_id: "sessao-1", area: "system design", problema: { titulo: "Links", enunciado: "Projete um encurtador." },
  tempos: { REQUISITOS: 60, ALTO_NIVEL: 120, APROFUNDAMENTO: 300 },
};
const alinhamento: Alinhamento = { characters: ["O", "i"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] };

test("finalizar mantém o pedido vivo se a página fechar durante a despedida", async (t) => {
  const chamadas = substituirFetch(t, () => json({ ok: true }));
  await finalizar("sessao-1");
  assert.equal(chamadas[0].opcoes.keepalive, true);
  assert.equal(chamadas[0].rota, "/api/sessoes/sessao-1/finalizar");
});

test("criarSessao envia identificadores no contrato e valida a sessão recebida", async (t) => {
  const chamadas = substituirFetch(t, () => json(sessao, 201));
  assert.deepEqual(await criarSessao({ avaliacaoId: "avaliacao-1", candidatoId: "candidato-1" }), sessao);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].rota, "/api/sessoes");
  assert.equal(chamadas[0].opcoes.method, "POST");
  assert.deepEqual(corpo(chamadas[0]), { avaliacao_id: "avaliacao-1", candidato_id: "candidato-1" });
});

test("analisar envia o pedido completo, codifica o ID, repassa o sinal e usa validarResposta", async (t) => {
  const controlador = new AbortController();
  const p = pedido("sessão/1?x=2");
  const chamadas = substituirFetch(t, () => json({ status: "duvida", pergunta: "Onde fica o gargalo?", nota: " ", elementos: ["r1"] }));
  const resultado = await analisar(p, controlador.signal);
  assert.equal(chamadas[0].rota, `/api/sessoes/${encodeURIComponent(p.sessao_id)}/analisar`);
  assert.equal(chamadas[0].opcoes.method, "POST");
  assert.equal(chamadas[0].opcoes.signal, controlador.signal);
  assert.deepEqual(corpo(chamadas[0]), p);
  assert.deepEqual(resultado, { status: "duvida", pergunta: "Onde fica o gargalo?", nota: "Onde fica o gargalo?", elementos: ["r1"], degrau: null, observacoes: [], avancar_fase: false, parteFechada: false, escopo: false });
});

test("analisar preserva a normalização de resposta sem pergunta", async (t) => {
  substituirFetch(t, () => json({ status: "duvida", pergunta: " " }));
  assert.equal((await analisar(pedido(), new AbortController().signal)).status, "ok");
});

test("perguntar envia sessão, fase e texto e aceita requisito nulo", async (t) => {
  const resposta = { responder: true, texto: "Considere cem mil requisições por segundo.", requisito: null };
  const chamadas = substituirFetch(t, () => json(resposta));
  assert.deepEqual(await perguntar("sessao-1", "REQUISITOS", "Qual a escala?"), { ...resposta, concluiu: false, seguimento: false, encerrar: false, pediuTempo: false });
  assert.equal(chamadas[0].rota, "/api/sessoes/sessao-1/perguntar");
  assert.equal(chamadas[0].opcoes.method, "POST");
  assert.deepEqual(corpo(chamadas[0]), { sessao_id: "sessao-1", fase: "REQUISITOS", texto: "Qual a escala?" });
});

test("perguntar envia o desenho e a pergunta ativa no mesmo pedido", async (t) => {
  const chamadas = substituirFetch(t, () => json({ responder: true, texto: "Você separou as leituras.", requisito: null }));
  const contexto = { grafo: "- [e1] API", pergunta_ativa: "Como funciona a leitura?", requisitos: ["100 leituras/s"] };
  await perguntar("sessao-1", "ALTO_NIVEL", "A API consulta o banco.", contexto);
  assert.deepEqual(corpo(chamadas[0]), { sessao_id: "sessao-1", fase: "ALTO_NIVEL", texto: "A API consulta o banco.", ...contexto });
});

test("sintetizarFala converte base64 em bytes MP3 sem alterar os bytes nem o alinhamento", async (t) => {
  const bytes = [0xff, 0xfb, 0x90, 0, 0x49, 0x44, 0x33];
  const controlador = new AbortController();
  const chamadas = substituirFetch(t, () => json({ audio_base64: btoa(String.fromCharCode(...bytes)), alinhamento }));
  const resultado = await sintetizarFala("Oi", controlador.signal);
  assert.equal(chamadas[0].rota, "/api/falar");
  assert.equal(chamadas[0].opcoes.method, "POST");
  assert.equal(chamadas[0].opcoes.signal, controlador.signal);
  assert.deepEqual(corpo(chamadas[0]), { texto: "Oi" });
  assert.deepEqual([...resultado.bytes], bytes);
  assert.deepEqual(resultado.alinhamento, alinhamento);
});

test("enviarEventos aceita 204 vazio sem tentar ler JSON", async (t) => {
  const chamadas = substituirFetch(t, () => new Response(null, { status: 204 }));
  const lote = [{ horario: "2026-11-07T15:00:00.000Z", tipo: "desenho", dados: { texto: "API" } }];
  assert.equal(await enviarEventos("sessao/1", lote), undefined);
  assert.equal(chamadas[0].rota, "/api/sessoes/sessao%2F1/eventos");
  assert.equal(chamadas[0].opcoes.method, "POST");
  assert.deepEqual(corpo(chamadas[0]), { eventos: lote });
});

test("enviarImagem envia PNG e horário em FormData sem fixar Content-Type", async (t) => {
  const chamadas = substituirFetch(t, () => json({ url: "/imagens/prova.png" }));
  const imagem = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const horario = "2026-11-07T15:00:00.000Z";
  assert.equal(await enviarImagem("sessao/1", imagem, horario), "/imagens/prova.png");
  assert.equal(chamadas[0].rota, "/api/sessoes/sessao%2F1/imagens");
  assert.equal(chamadas[0].opcoes.method, "POST");
  assert.equal(new Headers(chamadas[0].opcoes.headers).get("content-type"), null);
  const formulario = chamadas[0].opcoes.body;
  assert.ok(formulario instanceof FormData);
  assert.deepEqual([...formulario.keys()], ["imagem", "horario"]);
  assert.equal(formulario.get("horario"), horario);
  const arquivo = formulario.get("imagem");
  assert.ok(arquivo instanceof Blob);
  assert.equal(arquivo.type, "image/png");
  assert.equal(arquivo.name, "quadro.png");
  assert.deepEqual([...new Uint8Array(await arquivo.arrayBuffer())], [137, 80, 78, 71]);
});

test("tokenTranscricao usa GET e codifica a sessão na query", async (t) => {
  const chamadas = substituirFetch(t, () => json({ token: "temporario" }));
  const id = "sessão/1?x=2 &mais";
  assert.equal(await tokenTranscricao(id), "temporario");
  const url = new URL(chamadas[0].rota, "http://localhost");
  assert.equal(url.pathname, "/api/stt-token");
  assert.equal(url.searchParams.get("sessao_id"), id);
  assert.equal(chamadas[0].opcoes.method, "GET");
  assert.equal(chamadas[0].opcoes.body, undefined);
});

function rotas() {
  return [
    { nome: "/api/sessoes", chamar: () => criarSessao({ avaliacaoId: "a", candidatoId: "c" }) },
    { nome: "/api/sessoes/sessao-1/analisar", chamar: () => analisar(pedido(), new AbortController().signal) },
    { nome: "/api/sessoes/sessao-1/perguntar", chamar: () => perguntar("sessao-1", "REQUISITOS", "escala?") },
    { nome: "/api/falar", chamar: () => sintetizarFala("Oi") },
    { nome: "/api/sessoes/sessao-1/eventos", chamar: () => enviarEventos("sessao-1", []) },
    { nome: "/api/sessoes/sessao-1/imagens", chamar: () => enviarImagem("sessao-1", new Blob([], { type: "image/png" }), "2026-11-07T15:00:00Z") },
    { nome: "/api/stt-token", chamar: () => tokenTranscricao("sessao-1") },
  ];
}

test("todas as rotas rejeitam erro HTTP com status, rota e corpo resumido", async (t) => {
  substituirFetch(t, () => new Response("  ocupado\n" + "x".repeat(1000), { status: 503 }));
  for (const rota of rotas()) {
    await assert.rejects(rota.chamar, (erro) => {
      assert.ok(erro instanceof Error);
      assert.match(erro.message, /HTTP 503/);
      assert.ok(erro.message.includes(rota.nome));
      assert.match(erro.message, /ocupado x+…$/u);
      assert.ok(erro.message.length < 400);
      return true;
    });
  }
});

test("JSON inválido recebe mensagem clara em todas as rotas com resposta JSON", async (t) => {
  substituirFetch(t, () => new Response("não é JSON", { status: 200 }));
  for (const rota of rotas().filter((r) => !r.nome.endsWith("/eventos"))) {
    await assert.rejects(rota.chamar, (erro) => erro instanceof Error && erro.message.includes("JSON inválido") && erro.message.includes(rota.nome));
  }
});

test("formatos inesperados recebem erro claro em todas as respostas validadas", async (t) => {
  substituirFetch(t, () => json({}));
  for (const rota of rotas().filter((r) => !r.nome.endsWith("/eventos"))) {
    await assert.rejects(rota.chamar, (erro) => erro instanceof Error && erro.message.includes("Resposta inesperada") && erro.message.includes(rota.nome));
  }
});

test("analisar respeita cancelamento em andamento sem converter AbortError em outro erro", async (t) => {
  const controlador = new AbortController();
  const chamadas = substituirFetch(t, ({ opcoes }) => new Promise<Response>((_, rejeitar) => {
    const sinal = opcoes.signal;
    assert.ok(sinal);
    sinal.addEventListener("abort", () => rejeitar(sinal.reason), { once: true });
  }));
  const resultado = analisar(pedido(), controlador.signal);
  const erro = new DOMException("cancelada", "AbortError");
  controlador.abort(erro);
  await assert.rejects(resultado, (e) => e === erro);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].opcoes.signal, controlador.signal);
});

test("analisar com sinal já abortado não inicia fetch", async (t) => {
  const chamadas = substituirFetch(t, () => json({ status: "ok" }));
  const controlador = new AbortController();
  const erro = new Error("cancelada antes de iniciar");
  controlador.abort(erro);
  await assert.rejects(analisar(pedido(), controlador.signal), (e) => e === erro);
  assert.equal(chamadas.length, 0);
});

test("cancelamento durante leitura do JSON mantém o motivo original", async (t) => {
  const controlador = new AbortController();
  const erro = new DOMException("cancelada", "AbortError");
  substituirFetch(t, () => {
    const resposta = json({ status: "ok" });
    t.mock.method(resposta, "json", async () => {
      controlador.abort(erro);
      throw erro;
    });
    return resposta;
  });
  await assert.rejects(analisar(pedido(), controlador.signal), (e) => e === erro);
});

test("falha de rede é preservada sem virar erro de JSON", async (t) => {
  const erro = new TypeError("rede indisponível");
  substituirFetch(t, async () => { throw erro; });
  await assert.rejects(criarSessao({ avaliacaoId: "a", candidatoId: "c" }), (e) => e === erro);
});

test("base64 inválido e alinhamentos inconsistentes são rejeitados", async (t) => {
  let resposta: unknown = { audio_base64: "%%%", alinhamento };
  substituirFetch(t, () => json(resposta));
  await assert.rejects(sintetizarFala("Oi"), /audio_base64 inválido/);
  resposta = { audio_base64: "T2k=", alinhamento: { ...alinhamento, character_end_times_seconds: [0.1] } };
  await assert.rejects(sintetizarFala("Oi"), /Resposta inesperada.*horários/u);
  resposta = { audio_base64: "T2k=", alinhamento: { ...alinhamento, character_end_times_seconds: [0.1, 0] } };
  await assert.rejects(sintetizarFala("Oi"), /Resposta inesperada.*fim/u);
});

test("resposta HTTP sem corpo ainda informa o status", async (t) => {
  substituirFetch(t, () => new Response(null, { status: 500 }));
  await assert.rejects(enviarEventos("sessao-1", []), /HTTP 500.*sem corpo/);
});
