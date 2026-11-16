// Testes das rotas do cérebro: chamam os handlers exportados com Request de verdade, sem rede e sem LLM real.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { criarRepositorioEmMemoria, type RepositorioSessoes } from "../../../lib/agente/armazenamento";
import { criarRepositorioKv } from "../../../lib/agente/armazenamento/kv";
import { criarArquivosEmMemoria } from "../../../lib/storage/arquivos";
import { criarKvEmMemoria } from "../../../lib/storage/kv";
import { resolverAvaliacao } from "../../../lib/agente/kits";
import { criarClienteFalso, type LlmCliente } from "../../../lib/agente/llm/cliente";
import { definirContextoParaTestes } from "../../../lib/agente/rotas/contexto";
import { eventosDaMaquina, limitadorCriacao } from "../../../lib/agente/rotas/handlers";
import { criarLlmFalsoDeterministico } from "../../../lib/agente/rotas/llm-falso";
import { POST as criar } from "../sessoes/route";
import { POST as analisarPost } from "../sessoes/[id]/analisar/route";
import { POST as perguntarPost } from "../sessoes/[id]/perguntar/route";
import { POST as eventosPost } from "../sessoes/[id]/eventos/route";
import { POST as imagemPost } from "../sessoes/[id]/imagens/route";
import { GET as imagemGet } from "../sessoes/[id]/imagens/[n]/route";
import { POST as falarPost } from "../falar/route";
import { GET as sttGet } from "../stt-token/route";

const GRAFO = "COMPONENTES\n- [r1] Cliente (retângulo)\n- [r2] API (retângulo)\n- [e1] Postgres (elipse)\nCONEXÕES\n- [s1] Cliente → API\n- [s2] API → Postgres";

let repo: RepositorioSessoes;
let relogio = 1_000_000;

function post(url: string, corpo: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://x" + url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function novaSessao(): Promise<{ sessao_id: string; corpo: Record<string, unknown> }> {
  const r = await criar(post("/api/sessoes", { avaliacao_id: "demo", candidato_id: "c1" }));
  assert.equal(r.status, 200);
  const corpo = await r.json();
  return { sessao_id: corpo.sessao_id, corpo };
}

function pedido(id: string, extra: Record<string, unknown> = {}) {
  return {
    sessao_id: id,
    fase: "APROFUNDAMENTO",
    grafo: GRAFO,
    mudancas: "+ adicionou [e1] Postgres",
    conversa_recente: [{ quem: "agente", texto: "Projete um serviço." }],
    perguntas_feitas: 0,
    imagem_url: null,
    ...extra,
  };
}

function llmComGanchoDeDecisao(): LlmCliente {
  const base = criarLlmFalsoDeterministico();
  return {
    async completarJson(args) {
      const r = await base.completarJson(args);
      const dados = r.dados as { status?: string };
      if (args.nomeSchema === "analise_quadro" && dados.status === "duvida") {
        // #140: o fake emite o novo gancho e uma marca visual para cobrir o contrato público completo.
        return { ...r, dados: { ...dados, gancho: "decisao", parteFechada: false, visual: [{ tipo: "marcar", alvo: "e1" }] } as typeof r.dados };
      }
      return r;
    },
  };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
function formImagem(bytes: Uint8Array, horario = "2026-11-07T15:00:00.000Z", campo = "imagem"): Request {
  const f = new FormData();
  f.append(campo, new Blob([bytes as BlobPart], { type: "image/png" }), "quadro.png");
  f.append("horario", horario);
  return new Request("http://x/api/sessoes/i/imagens", { method: "POST", body: f });
}

beforeEach(() => {
  repo = criarRepositorioEmMemoria();
  relogio = 1_000_000;
  limitadorCriacao.reiniciar();
  definirContextoParaTestes({ repositorio: repo, llm: criarLlmFalsoDeterministico(), agora: () => relogio });
});
afterEach(() => definirContextoParaTestes(null));

describe("POST /api/sessoes", () => {
  it("cria a sessão com o formato do contrato e só dados públicos do problema", async () => {
    const { corpo, sessao_id } = await novaSessao();
    assert.deepEqual(Object.keys(corpo).sort(), ["apresentacao", "area", "despedida", "problema", "sessao_id", "tempos"]);
    assert.deepEqual(Object.keys(corpo.problema as object).filter((k) => k !== "fala_do_desafio").sort(), ["enunciado", "titulo"]);
    assert.match(sessao_id, /^[0-9a-f-]{36}$/);
    assert.equal(corpo.area, "system design");
    assert.ok((corpo.tempos as Record<string, number>).REQUISITOS > 0);
    assert.equal((await repo.obter(sessao_id))?.estado.fase, "APRESENTACAO");
  });
  it("a abertura (apresentação e despedida) vem do modelo; sem LLM vem null; com erro vem a de reserva", async () => {
    const { corpo } = await novaSessao();
    assert.equal(typeof corpo.apresentacao, "string");
    assert.equal(typeof corpo.despedida, "string");
    assert.ok((corpo.apresentacao as string).length > 0);

    definirContextoParaTestes({ repositorio: repo, llm: null, agora: () => relogio });
    const semLlm = (await novaSessao()).corpo;
    assert.equal(semLlm.apresentacao, null);
    assert.equal(semLlm.despedida, null);

    const quebrado = criarClienteFalso([new Error("fora do ar")]);
    definirContextoParaTestes({ repositorio: repo, llm: quebrado, agora: () => relogio });
    const comErro = (await novaSessao()).corpo;
    // O Totti não pode ir direto ao desafio sem se apresentar: com o modelo fora do ar, vale a fala de reserva.
    assert.match(String(comErro.apresentacao), /Totti/);
    assert.equal(typeof comErro.despedida, "string");
    assert.ok(comErro.sessao_id, "a sessão é criada mesmo sem a abertura do modelo");
  });
  it("a abertura é guardada por kit+problema: a 2ª sessão não chama o modelo de novo", async () => {
    const llm = criarClienteFalso([{ apresentacao: "Olá, tudo bem? Vamos começar.", despedida: "Obrigado. Daremos retorno." }]);
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });
    const a = (await novaSessao()).corpo;
    const b = (await novaSessao()).corpo;
    assert.equal(a.apresentacao, "Olá, tudo bem? Vamos começar.");
    assert.equal(b.apresentacao, a.apresentacao);
    assert.equal(llm.chamadas.filter((c) => c.nomeSchema === "abertura_entrevista").length, 1);
  });
  it("com config_id: o plano escolhe o kit, escala os tempos e vai para o estado; config desconhecida cai no padrão", async () => {
    const globais = globalThis as typeof globalThis & { __convergeConfigs?: Map<string, unknown> };
    const mapa = (globais.__convergeConfigs ??= new Map());
    mapa.set("cfg-teste-sd", {
      id: "cfg-teste-sd", mode: "system_design", roleTitle: "Staff Engineer", seniority: "senior",
      focus: [{ area: "escala_produto", weight: 1 }], recruiterNotes: "autonomia", hints: "nenhuma", tone: "desafiador",
      criteria: [{ id: "c1", name: "Escala", description: "d", weight: 1, focus: "escala_produto" }],
      problemId: "chatbot-atendimento-ia", languages: ["python"], durationMin: 70,
    });
    try {
      const r = await criar(post("/api/sessoes", { avaliacao_id: "demo", candidato_id: "c1", config_id: "cfg-teste-sd" }));
      assert.equal(r.status, 200);
      const corpo = await r.json();
      assert.equal((corpo.problema as { titulo: string }).titulo, "Chatbot de atendimento com IA", "o plano trocou o kit pelo do problema");
      const estado = (await repo.obter(corpo.sessao_id))?.estado;
      assert.equal(estado?.plano?.cargo, "Staff Engineer");
      assert.equal(estado?.plano?.dicas, "nenhuma");
      assert.equal(estado?.tempos.ALTO_NIVEL, 1200, "70 min é o dobro de 35: 600 s viram 1200");
      assert.equal(JSON.stringify(corpo).includes("autonomia"), false, "as notas da recrutadora não vão ao navegador");

      const padrao = await (await criar(post("/api/sessoes", { avaliacao_id: "demo", candidato_id: "c1", config_id: "nao-existe" }))).json();
      assert.equal((padrao.problema as { titulo: string }).titulo, "Encurtador de URL");
      assert.equal((await repo.obter(padrao.sessao_id))?.estado.plano ?? null, null);
    } finally {
      mapa.delete("cfg-teste-sd");
    }
  });
  it("avaliação desconhecida: 404 {erro}", async () => {
    const r = await criar(post("/api/sessoes", { avaliacao_id: "nao-existe", candidato_id: "c" }));
    assert.equal(r.status, 404);
    assert.deepEqual(Object.keys(await r.json()), ["erro"]);
  });
  it("corpo inválido: 400 com detalhes; JSON quebrado: 400", async () => {
    const r = await criar(post("/api/sessoes", { avaliacao_id: 1 }));
    assert.equal(r.status, 400);
    const c = await r.json();
    assert.ok(c.erro && Array.isArray(c.detalhes));
    assert.equal((await criar(post("/api/sessoes", "{quebrado"))).status, 400);
  });
  it("corpo grande demais: 413", async () => {
    const r = await criar(post("/api/sessoes", { avaliacao_id: "demo", candidato_id: "x".repeat(100_000) }));
    assert.equal(r.status, 413);
  });
  it("limita a 10 criações por minuto por IP", async () => {
    const h = { "x-real-ip": "1.2.3.4" };
    for (let i = 0; i < 10; i++) {
      assert.equal((await criar(post("/api/sessoes", { avaliacao_id: "demo", candidato_id: "c" }, h))).status, 200);
    }
    assert.equal((await criar(post("/api/sessoes", { avaliacao_id: "demo", candidato_id: "c" }, h))).status, 429);
    assert.equal(
      (await criar(post("/api/sessoes", { avaliacao_id: "demo", candidato_id: "c" }, { "x-real-ip": "9.9.9.9" }))).status,
      200,
    );
  });
});

describe("POST /api/sessoes/[id]/analisar", () => {
  it("pula assinatura igual já analisada sem bloqueio", async () => {
    const { sessao_id } = await novaSessao();
    const falso = criarClienteFalso(Array.from({ length: 2 }, () => ({ status: "ok" as const, pergunta: null, nota: null, elementos: [], degrau: null, observacoes: [] })));
    definirContextoParaTestes({ repositorio: repo, llm: falso, agora: () => relogio });
    await analisarPost(post(`/api/sessoes/${sessao_id}/analisar`, pedido(sessao_id)), params(sessao_id));
    await analisarPost(post(`/api/sessoes/${sessao_id}/analisar`, pedido(sessao_id)), params(sessao_id));
    assert.equal(falso.chamadas.length, 1);
  });

  it("reanalisa assinatura igual quando o bloqueio anterior foi liberado", async () => {
    const { sessao_id } = await novaSessao();
    const sessao = (await repo.obter(sessao_id))!;
    await repo.salvarEstado(sessao_id, { ...sessao.estado, fase: "APROFUNDAMENTO", perguntasFeitas: 5 });
    const falso = criarClienteFalso(Array.from({ length: 2 }, () => ({ status: "ok" as const, pergunta: null, nota: null, elementos: [], degrau: null, observacoes: [] })));
    definirContextoParaTestes({ repositorio: repo, llm: falso, agora: () => relogio });
    await analisarPost(post(`/api/sessoes/${sessao_id}/analisar`, pedido(sessao_id)), params(sessao_id));
    const atual = (await repo.obter(sessao_id))!;
    await repo.salvarEstado(sessao_id, { ...atual.estado, perguntasFeitas: 0 });
    await analisarPost(post(`/api/sessoes/${sessao_id}/analisar`, pedido(sessao_id)), params(sessao_id));
    assert.equal(falso.chamadas.length, 2);
  });

  it("pula assinatura igual quando segue bloqueada", async () => {
    const { sessao_id } = await novaSessao();
    const sessao = (await repo.obter(sessao_id))!;
    await repo.salvarEstado(sessao_id, { ...sessao.estado, fase: "APROFUNDAMENTO", perguntasFeitas: 5 });
    const falso = criarClienteFalso(Array.from({ length: 2 }, () => ({ status: "ok" as const, pergunta: null, nota: null, elementos: [], degrau: null, observacoes: [] })));
    definirContextoParaTestes({ repositorio: repo, llm: falso, agora: () => relogio });
    await analisarPost(post(`/api/sessoes/${sessao_id}/analisar`, pedido(sessao_id)), params(sessao_id));
    await analisarPost(post(`/api/sessoes/${sessao_id}/analisar`, pedido(sessao_id)), params(sessao_id));
    assert.equal(falso.chamadas.length, 1);
  });

  it("handler marca semReserva quando a cota de perguntas está bloqueada", async () => {
    const { sessao_id } = await novaSessao();
    const sessao = (await repo.obter(sessao_id))!;
    await repo.salvarEstado(sessao_id, { ...sessao.estado, fase: "APROFUNDAMENTO", perguntasFeitas: 5 });
    const falso = criarClienteFalso([{ status: "ok", pergunta: null, nota: null, elementos: [], degrau: null, observacoes: [] }]);
    let semReserva: boolean | undefined;
    const llm = { ...falso, async completarJson<T>(args: Parameters<typeof falso.completarJson<T>>[0]) {
      semReserva = args.semReserva;
      return falso.completarJson(args);
    } };
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });
    const r = await analisarPost(post(`/api/sessoes/${sessao_id}/analisar`, pedido(sessao_id)), params(sessao_id));
    assert.equal(r.status, 200);
    assert.equal(semReserva, true);
  });

  it("sincroniza a fase do quadro e devolve EXATAMENTE os campos de RespostaAnalise", async () => {
    const { sessao_id } = await novaSessao();
    // #140: o fixture tem gancho e pausa real; `gancho` permanece interno e fora do JSON do quadro.
    definirContextoParaTestes({ repositorio: repo, llm: llmComGanchoDeDecisao(), agora: () => relogio });
    const r = await analisarPost(post(`/api/sessoes/${sessao_id}/analisar`, pedido(sessao_id, { parado_ha_s: 4 })), params(sessao_id));
    assert.equal(r.status, 200);
    const c = await r.json();
    assert.deepEqual(Object.keys(c).sort(), ["degrau", "elementos", "escopo", "nota", "observacoes", "parteFechada", "pergunta", "status", "visual"]);
    assert.deepEqual(c.visual, [{ tipo: "marcar", alvo: "e1" }]);
    assert.equal(c.status, "duvida");
    assert.deepEqual(c.elementos, ["e1"]);
    assert.ok(c.pergunta && c.nota.length <= 40);
    const estado = (await repo.obter(sessao_id))!.estado;
    assert.equal(estado.fase, "APROFUNDAMENTO");
    assert.equal(estado.plin, "PLIN_PENDENTE");
    assert.equal(estado.observacoes.length, 1);
  });
  it("sem Postgres no grafo devolve ok", async () => {
    const { sessao_id } = await novaSessao();
    const r = await analisarPost(
      post(`/api/sessoes/${sessao_id}/analisar`, pedido(sessao_id, { grafo: "COMPONENTES\n- [r1] Cliente (retângulo)" })),
      params(sessao_id),
    );
    const c = await r.json();
    assert.equal(c.status, "ok");
    assert.equal(c.pergunta, null);
  });
  it("grava analise_uso com provedor, reserva e tokens", async () => {
    const { sessao_id } = await novaSessao();
    const falso = criarClienteFalso([{ status: "duvida", pergunta: "Por que cache?", nota: "latência", elementos: ["e1"], degrau: 1, observacoes: [] }]);
    const llm = { ...falso, async completarJson<T>(args: Parameters<typeof falso.completarJson<T>>[0]) {
      return { ...(await falso.completarJson(args)), modelo: "modelo-teste", provedor: "openrouter", reservaDisparada: true,
        ms: 12, uso: { entrada: 90, saida: 20, cache: 30, custo: .001 } };
    } };
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });
    await analisarPost(post("/x", pedido(sessao_id)), params(sessao_id));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const eventos = await repo.listarEventos(sessao_id);
    const uso = eventos.find((e) => e.tipo === "analise_uso");
    assert.ok(uso);
    assert.deepEqual(uso.dados, { modelo: "modelo-teste", provedor: "openrouter", reserva_disparada: true, ms: 12,
      tokens_entrada: 90, tokens_saida: 20, tokens_cache: 30, custo_usd: .001 });
  });
  it("a fase só avança: o quadro atrasado não faz o servidor voltar", async () => {
    const { sessao_id } = await novaSessao();
    await analisarPost(post("/x", pedido(sessao_id, { fase: "ALTO_NIVEL" })), params(sessao_id));
    assert.equal((await repo.obter(sessao_id))!.estado.fase, "ALTO_NIVEL");
    await analisarPost(post("/x", pedido(sessao_id, { fase: "REQUISITOS" })), params(sessao_id));
    assert.equal((await repo.obter(sessao_id))!.estado.fase, "ALTO_NIVEL");
  });
  it("404 para sessão desconhecida; 400 para pedido inválido, sessao_id divergente e grafo enorme", async () => {
    const { sessao_id } = await novaSessao();
    assert.equal((await analisarPost(post("/x", pedido("fantasma")), params("fantasma"))).status, 404);
    assert.equal((await analisarPost(post("/x", { sessao_id }), params(sessao_id))).status, 400);
    assert.equal((await analisarPost(post("/x", pedido("outra")), params(sessao_id))).status, 400);
    const grande = await analisarPost(post("/x", pedido(sessao_id, { grafo: "a".repeat(60_001) })), params(sessao_id));
    assert.equal(grande.status, 400);
    const conversa = Array.from({ length: 41 }, () => ({ quem: "candidato", texto: "oi" }));
    assert.equal(
      (await analisarPost(post("/x", pedido(sessao_id, { conversa_recente: conversa })), params(sessao_id))).status,
      400,
    );
  });
  it("sem LLM (sem chave): responde ok, nunca 500", async () => {
    definirContextoParaTestes({ repositorio: repo, llm: null, agora: () => relogio });
    const { sessao_id } = await novaSessao();
    const r = await analisarPost(post("/x", pedido(sessao_id)), params(sessao_id));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, "ok");
  });
  it("LLM que estoura erro: ok", async () => {
    definirContextoParaTestes({
      repositorio: repo,
      llm: criarClienteFalso([new Error("falhou")]),
      agora: () => relogio,
    });
    const { sessao_id } = await novaSessao();
    const r = await analisarPost(post("/x", pedido(sessao_id)), params(sessao_id));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, "ok");
  });
  it("limita o número de análises por sessão", async () => {
    const { sessao_id } = await novaSessao();
    for (let i = 0; i < 200; i++) await repo.contarAnalise(sessao_id);
    const r = await analisarPost(post("/x", pedido(sessao_id)), params(sessao_id));
    assert.equal(r.status, 429);
  });
});

describe("POST /api/sessoes/[id]/perguntar", () => {
  it("entrega o plano visual junto da fala e remove alvos que não existem", async () => {
    const { sessao_id } = await novaSessao();
    const llm = criarClienteFalso([{ responder: true, texto: "Como funciona este fluxo?", requisito: null,
      visual: [{ tipo: "colchetes", alvo: "e1" }, { tipo: "sublinhar", alvo: "inventado" }],
    }]);
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });
    const r = await perguntarPost(post("/x", { sessao_id, fase: "ALTO_NIVEL", texto: "Pode destacar?", grafo: GRAFO, gestos_recentes: ["circular"] }), params(sessao_id));
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).visual, [{ tipo: "colchetes", alvo: "e1" }]);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /circular/);
  });
  it("grava o uso de cada turno (tokens, custo e blocos do prompt) na linha do tempo da sessão", async () => {
    const { sessao_id } = await novaSessao();
    const falso = criarClienteFalso([{ responder: true, texto: "Certo.", requisito: null }]);
    const llm = { ...falso, async completarJson<T>(args: Parameters<typeof falso.completarJson<T>>[0]) {
      return { ...(await falso.completarJson(args)), modelo: "google/gemini-3.5-flash-lite", provedor: "openrouter", uso: { entrada: 4000, saida: 60, custo: 0.0009 } };
    } };
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });
    const r = await perguntarPost(post("/x", { sessao_id, fase: "ALTO_NIVEL", texto: "Vou pôr um cache.", grafo: GRAFO }), params(sessao_id));
    assert.equal(r.status, 200);
    assert.equal(JSON.stringify(await r.json()).includes("tokens_entrada"), false, "o uso não vai para o quadro");
    const usos = (await repo.listarEventos(sessao_id)).filter((e) => e.tipo === "perguntar_uso");
    assert.equal(usos.length, 1);
    const dados = usos[0].dados as { tokens_entrada: number; custo_usd: number; blocos: { grafo: number } };
    assert.equal(dados.tokens_entrada, 4000);
    assert.equal(dados.custo_usd, 0.0009);
    assert.ok(dados.blocos.grafo > 0);
  });
  it("pergunta cortada pelo candidato (#97): a fala seguinte não conta como resposta a ela", async () => {
    const { sessao_id } = await novaSessao();
    const sessao = (await repo.obter(sessao_id))!;
    const pergunta = { numero: 1, status: "duvida" as const, pergunta: "Como esse banco aguenta o pico de acessos?", nota: null,
      elementos: [], degrau: null, fase: "APROFUNDAMENTO" as const, feitaEm: relogio };
    await repo.salvarEstado(sessao_id, { ...sessao.estado, fase: "APROFUNDAMENTO", perguntaAtiva: pergunta, perguntas: [pergunta] });
    const respondeu = () => criarClienteFalso([{ responder: true, texto: "O pico é de manhã cedo.", requisito: null, desfecho: "respondeu" }]);
    definirContextoParaTestes({ repositorio: repo, llm: respondeu(), agora: () => relogio });
    const cortada = await perguntarPost(post("/x", { sessao_id, fase: "APROFUNDAMENTO", texto: "Pera, qual pico?", pergunta_cortada: true }), params(sessao_id));
    assert.equal(cortada.status, 200);
    assert.equal((await repo.obter(sessao_id))!.estado.perguntas[0].desfecho, undefined, "a pergunta segue sem resposta");
    definirContextoParaTestes({ repositorio: repo, llm: respondeu(), agora: () => relogio });
    await perguntarPost(post("/x", { sessao_id, fase: "APROFUNDAMENTO", texto: "Com réplicas de leitura." }), params(sessao_id));
    assert.equal((await repo.obter(sessao_id))!.estado.perguntas[0].desfecho, "respondeu");
  });
  it("repassa o contexto do quadro para a devolutiva rápida", async () => {
    const { sessao_id } = await novaSessao();
    const llm = criarClienteFalso([{ responder: true, texto: "Você ligou a API ao banco.", requisito: null }]);
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });
    const r = await perguntarPost(post("/x", { sessao_id, fase: "ALTO_NIVEL", texto: "Pode comentar?", grafo: GRAFO, pergunta_ativa: "Como funciona a leitura?", requisitos: ["100 leituras/s"] }), params(sessao_id));
    assert.equal(r.status, 200);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /Postgres/);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /Como funciona a leitura/);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /100 leituras/);
  });
  it("aceita o que o cliente do quadro envia: foto, mudanças e conversa do quadro chegam ao modelo", async () => {
    const { sessao_id } = await novaSessao();
    const llm = criarClienteFalso([{ responder: true, texto: "Saquei.", requisito: null }]);
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });
    const foto = "data:image/jpeg;base64," + "A".repeat(200_000);
    const conversa = Array.from({ length: 20 }, (_, i) => ({ quem: i % 2 ? "agente" : "candidato", texto: `fala ${i}` }));
    const r = await perguntarPost(post("/x", {
      sessao_id, fase: "ALTO_NIVEL", texto: "Olha isso", grafo: GRAFO,
      imagem_base64: foto, mudancas: "+ adicionou [r9] Fila " + "x".repeat(9000), conversa_do_quadro: conversa,
    }), params(sessao_id));
    assert.equal(r.status, 200);
    assert.equal(llm.chamadas[0].imagem, foto);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /adicionou \[r9\] Fila/);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /fala 19/);
  });
  it("foto grande demais é descartada, não derruba a fala nem a análise", async () => {
    const { sessao_id } = await novaSessao();
    const llm = criarClienteFalso([{ responder: true, texto: "Saquei.", requisito: null }]);
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });
    const enorme = "data:image/jpeg;base64," + "A".repeat(600_000);
    const r = await perguntarPost(post("/x", { sessao_id, fase: "ALTO_NIVEL", texto: "Olha isso", imagem_base64: enorme }), params(sessao_id));
    assert.equal(r.status, 200);
    assert.equal(llm.chamadas[0].imagem ?? null, null);
    const a = await analisarPost(post("/x", pedido(sessao_id, { imagem_base64: enorme })), params(sessao_id));
    assert.equal(a.status, 200);
  });
  it("falha do modelo devolve erro recuperável em vez de silêncio deliberado", async () => {
    const { sessao_id } = await novaSessao();
    definirContextoParaTestes({ repositorio: repo, llm: criarClienteFalso([new Error("indisponível")]), agora: () => relogio });
    const r = await perguntarPost(post("/x", { sessao_id, fase: "REQUISITOS", texto: "Qual a escala?" }), params(sessao_id));
    assert.equal(r.status, 503);
    assert.equal((await repo.obter(sessao_id))!.estado.conversa.length, 0);
  });
  it("responde no formato do contrato e guarda a conversa", async () => {
    const { sessao_id } = await novaSessao();
    const r = await perguntarPost(
      post("/x", { sessao_id, fase: "REQUISITOS", texto: "Quantos acessos por segundo?" }),
      params(sessao_id),
    );
    assert.equal(r.status, 200);
    const c = await r.json();
    assert.deepEqual(Object.keys(c).sort(), ["concluiu", "requisito", "responder", "texto"]);
    assert.equal(c.responder, true);
    const e = (await repo.obter(sessao_id))!.estado;
    assert.equal(e.fase, "REQUISITOS");
    assert.deepEqual(e.conversa.map((f) => f.quem), ["candidato", "agente"]);
  });
  it("fala que não pede resposta: responder false", async () => {
    const { sessao_id } = await novaSessao();
    const c = await (
      await perguntarPost(post("/x", { sessao_id, fase: "REQUISITOS", texto: "hmm deixa eu ver" }), params(sessao_id))
    ).json();
    assert.deepEqual(c, { responder: false, texto: "", requisito: null, concluiu: false });
  });
  it("404 e 400", async () => {
    const { sessao_id } = await novaSessao();
    assert.equal((await perguntarPost(post("/x", { sessao_id: "z", fase: "REQUISITOS", texto: "a?" }), params("z"))).status, 404);
    assert.equal((await perguntarPost(post("/x", { sessao_id, fase: "NADA", texto: "a?" }), params(sessao_id))).status, 400);
    assert.equal((await perguntarPost(post("/x", { sessao_id, fase: "REQUISITOS", texto: "" }), params(sessao_id))).status, 400);
  });
});

describe("POST /api/sessoes/[id]/eventos", () => {
  const ev = (tipo: string, dados: unknown, horario = "2026-11-07T15:00:00.000Z") => ({ horario, tipo, dados });

  it("guarda a linha do tempo e é idempotente no reenvio", async () => {
    const { sessao_id } = await novaSessao();
    const lote = { eventos: [ev("fala", { quem: "agente", texto: "oi" }), ev("analise", { status: "ok" })] };
    const r1 = await eventosPost(post("/x", lote), params(sessao_id));
    assert.equal(r1.status, 200);
    assert.equal((await r1.json()).novos, 2);
    const r2 = await eventosPost(post("/x", lote), params(sessao_id));
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).novos, 0);
    assert.equal((await repo.listarEventos(sessao_id)).length, 2);
  });
  it("mesmo horário e tipo com dados diferentes não são duplicata", async () => {
    const { sessao_id } = await novaSessao();
    await eventosPost(post("/x", { eventos: [ev("fala", { texto: "a" }), ev("fala", { texto: "b" })] }), params(sessao_id));
    assert.equal((await repo.listarEventos(sessao_id)).length, 2);
  });
  it("segue o cliente: fase, pergunta (plin), resposta e desenho", async () => {
    const { sessao_id } = await novaSessao();
    // #140: o fake emite um gancho em pausa real para o plin continuar cobrindo o ciclo do quadro.
    definirContextoParaTestes({ repositorio: repo, llm: llmComGanchoDeDecisao(), agora: () => relogio });
    await eventosPost(post("/x", { eventos: [ev("fase", { fase: "APROFUNDAMENTO" })] }), params(sessao_id));
    assert.equal((await repo.obter(sessao_id))!.estado.fase, "APROFUNDAMENTO");

    await analisarPost(post("/x", pedido(sessao_id, { parado_ha_s: 4 })), params(sessao_id));
    assert.equal((await repo.obter(sessao_id))!.estado.plin, "PLIN_PENDENTE");

    await eventosPost(post("/x", { eventos: [ev("pergunta", { numero: 1 }, "2026-11-07T15:00:01.000Z")] }), params(sessao_id));
    let e = (await repo.obter(sessao_id))!.estado;
    assert.equal(e.plin, "PERGUNTA_ATIVA");
    assert.equal(e.perguntasFeitas, 1);

    await eventosPost(post("/x", { eventos: [ev("resposta", { numero: 1 }, "2026-11-07T15:00:02.000Z")] }), params(sessao_id));
    e = (await repo.obter(sessao_id))!.estado;
    assert.equal(e.plin, "LIVRE");
    assert.equal(e.perguntaAtiva, null);
  });
  it("desenho que mexe no elemento citado expira o plin pendente", async () => {
    const { sessao_id } = await novaSessao();
    await analisarPost(post("/x", pedido(sessao_id)), params(sessao_id));
    await eventosPost(
      post("/x", { eventos: [ev("desenho", { grafo: GRAFO, mudancas: "~ moveu [e1] Postgres" })] }),
      params(sessao_id),
    );
    assert.equal((await repo.obter(sessao_id))!.estado.plin, "LIVRE");
  });
  it("tipo desconhecido só é guardado", async () => {
    assert.deepEqual(eventosDaMaquina("coisa-nova", {}), []);
    const { sessao_id } = await novaSessao();
    const antes = (await repo.obter(sessao_id))!.estado;
    const r = await eventosPost(post("/x", { eventos: [ev("coisa-nova", { x: 1 })] }), params(sessao_id));
    assert.equal(r.status, 200);
    assert.deepEqual((await repo.obter(sessao_id))!.estado, antes);
    assert.equal((await repo.listarEventos(sessao_id)).length, 1);
  });
  it("400 para entrada inválida, 404 para sessão desconhecida", async () => {
    const { sessao_id } = await novaSessao();
    assert.equal((await eventosPost(post("/x", { eventos: [{ tipo: "x" }] }), params(sessao_id))).status, 400);
    assert.equal((await eventosPost(post("/x", { eventos: [ev("x", {}, "ontem")] }), params(sessao_id))).status, 400);
    assert.equal((await eventosPost(post("/x", "nao-json"), params(sessao_id))).status, 400);
    assert.equal((await eventosPost(post("/x", { eventos: [] }), params("fantasma"))).status, 404);
  });
});

describe("imagens", () => {
  it("guarda o PNG, devolve a url e serve de volta com image/png", async () => {
    const { sessao_id } = await novaSessao();
    const r = await imagemPost(formImagem(PNG), params(sessao_id));
    assert.equal(r.status, 200);
    const c = await r.json();
    assert.deepEqual(Object.keys(c), ["url"]);
    assert.equal(c.url, `/api/sessoes/${sessao_id}/imagens/1`);
    const g = await imagemGet(new Request("http://x" + c.url), { params: Promise.resolve({ id: sessao_id, n: "1" }) });
    assert.equal(g.status, 200);
    assert.equal(g.headers.get("content-type"), "image/png");
    assert.deepEqual(new Uint8Array(await g.arrayBuffer()), PNG);
    const r2 = await imagemPost(formImagem(PNG), params(sessao_id));
    assert.equal((await r2.json()).url, `/api/sessoes/${sessao_id}/imagens/2`);
  });
  it("a url da foto final (repositório de produção) serve a imagem", async () => {
    definirContextoParaTestes({ repositorio: criarRepositorioKv(criarKvEmMemoria(), criarArquivosEmMemoria()), llm: criarLlmFalsoDeterministico(), agora: () => relogio });
    const { sessao_id } = await novaSessao();
    const f = new FormData();
    f.append("imagem", new Blob([PNG as BlobPart], { type: "image/png" }), "quadro.png");
    f.append("horario", "2026-11-07T15:00:00.000Z");
    f.append("final", "1");
    const r = await imagemPost(new Request("http://x/api/sessoes/i/imagens", { method: "POST", body: f }), params(sessao_id));
    assert.equal(r.status, 200);
    const n = (await r.json()).url.split("/").at(-1);
    const g = await imagemGet(new Request("http://x"), { params: Promise.resolve({ id: sessao_id, n }) });
    assert.equal(g.status, 200);
    assert.deepEqual(new Uint8Array(await g.arrayBuffer()), PNG);
  });
  it("rejeita o que não é PNG, grande demais, sem campo, sessão ou imagem inexistentes", async () => {
    const { sessao_id } = await novaSessao();
    assert.equal((await imagemPost(formImagem(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), params(sessao_id))).status, 400);
    const grande = new Uint8Array(4 * 1024 * 1024 + 1);
    grande.set(PNG);
    assert.equal((await imagemPost(formImagem(grande), params(sessao_id))).status, 413);
    assert.equal((await imagemPost(formImagem(PNG, "2026-11-07T15:00:00Z", "outro"), params(sessao_id))).status, 400);
    assert.equal((await imagemPost(formImagem(PNG), params("fantasma"))).status, 404);
    const g = await imagemGet(new Request("http://x"), { params: Promise.resolve({ id: sessao_id, n: "7" }) });
    assert.equal(g.status, 404);
    const g2 = await imagemGet(new Request("http://x"), { params: Promise.resolve({ id: sessao_id, n: "abc" }) });
    assert.equal(g2.status, 404);
    const g3 = await imagemGet(new Request("http://x"), { params: Promise.resolve({ id: sessao_id, n: "99999999999999999" }) });
    assert.equal(g3.status, 404);
  });
});

describe("voz", () => {
  it("sem chave a síntese indica fallback e o token exige sessão", async () => {
    const chave = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      const a = await falarPost(post("/api/falar", { texto: "Olá" }));
      const b = await sttGet(new NextRequest("http://localhost/api/stt-token"));
      assert.equal(a.status, 501);
      assert.equal(b.status, 400);
      assert.equal(typeof (await a.json()).erro, "string");
      assert.equal(typeof (await b.json()).erro, "string");
    } finally {
      if (chave !== undefined) process.env.ELEVENLABS_API_KEY = chave;
    }
  });
});

describe("segredos", () => {
  it("nenhuma resposta de um fluxo completo contém ficha, sinais, armadilhas ou rubrica", async () => {
    const alvo = (await resolverAvaliacao("demo"))!;
    const segredos = [
      ...alvo.problema.ficha.flatMap((f) => [f.resposta]),
      ...alvo.problema.sinaisEsperados,
      ...alvo.problema.armadilhas,
      ...alvo.kit.criterios.flatMap((c) => Object.values(c.niveis)),
    ].filter((s) => s.length > 15);
    assert.ok(segredos.length > 5);

    const corpos: string[] = [];
    const guardar = async (r: Response) => {
      corpos.push(await r.clone().text());
      return r;
    };
    const cria = await guardar(await criar(post("/api/sessoes", { avaliacao_id: "demo", candidato_id: "c" })));
    const { sessao_id } = await cria.json();
    await guardar(await analisarPost(post("/x", pedido(sessao_id)), params(sessao_id)));
    await guardar(
      await eventosPost(post("/x", { eventos: [{ horario: "2026-11-07T15:00:00Z", tipo: "pergunta", dados: { numero: 1 } }] }), params(sessao_id)),
    );
    await guardar(await perguntarPost(post("/x", { sessao_id, fase: "APROFUNDAMENTO", texto: "Quantos acessos?" }), params(sessao_id)));
    await guardar(await analisarPost(post("/x", pedido(sessao_id)), params(sessao_id)));
    await guardar(await analisarPost(post("/x", pedido("fantasma")), params("fantasma")));

    const tudo = corpos.join("\n").toLowerCase();
    for (const s of segredos) assert.ok(!tudo.includes(s.toLowerCase()), `vazou: ${s}`);
    for (const proibido of ["diagnostico", "rubrica", "ficha", "armadilhas", "sinaisesperados"]) {
      assert.ok(!tudo.includes(proibido), `campo proibido: ${proibido}`);
    }
  });
});
