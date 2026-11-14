// Entrevista completa por texto, ponta a ponta pelos HANDLERS (LLM falso, relógio controlado):
// criar -> fases -> analisar (grafo ruim) -> plin -> resposta -> reanálise forçada -> perguntar requisito
// -> encerrar -> finalizar -> scorecard. Mais: finalizar idempotente, visão segura do estado, gating de dev.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { criarRepositorioEmMemoria, type RepositorioSessoes } from "../../../lib/agente/armazenamento";
import { resolverAvaliacaoEstatica } from "../../../lib/agente/kits";
import { criarClienteFalso, type LlmCliente } from "../../../lib/agente/llm/cliente";
import { definirContextoParaTestes } from "../../../lib/agente/rotas/contexto";
import { limitadorCriacao } from "../../../lib/agente/rotas/handlers";
import { criarLlmFalsoDeterministico } from "../../../lib/agente/rotas/llm-falso";
import { GRAFO_BOM, GRAFO_RUIM } from "../../../lib/dev/entrevista-texto/exemplos";
import { diffGrafo } from "../../../lib/dev/entrevista-texto/diff";
import { POST as criar } from "../sessoes/route";
import { POST as analisarPost } from "../sessoes/[id]/analisar/route";
import { POST as perguntarPost } from "../sessoes/[id]/perguntar/route";
import { POST as eventosPost } from "../sessoes/[id]/eventos/route";
import { POST as finalizarPost } from "../sessoes/[id]/finalizar/route";
import { GET as scorecardGet } from "../sessoes/[id]/scorecard/route";
import { MAX_TOKENS_SCORECARD } from "@/lib/agente/scorecard";
import { GET as estadoGet } from "../dev/sessoes/[id]/estado/route";

const TEMAS = [
  "latência regional", "colisão de códigos", "expiração de links", "custo mensal", "observabilidade", "limite de taxa",
  "abuso por robôs", "migração de dados", "backup e restauração", "consistência eventual", "particionamento", "fila de cliques",
  "privacidade", "domínios personalizados", "picos virais", "falha de região", "versionamento da API", "cache frio",
];
const PERGUNTAS = TEMAS.map((t) => `Como o desenho trata ${t}?`);

/** O falso determinístico, mas com perguntas diferentes a cada dúvida (senão a guarda de pergunta repetida entra). */
function llmVariado(): LlmCliente {
  const base = criarLlmFalsoDeterministico();
  let n = 0;
  return {
    async completarJson(args) {
      const r = await base.completarJson(args);
      const d = r.dados as { status?: string; pergunta?: string | null };
      if (d && d.status === "duvida") return { ...r, dados: { ...d, pergunta: PERGUNTAS[n++ % PERGUNTAS.length] } as typeof r.dados };
      return r;
    },
  };
}

let repo: RepositorioSessoes;
let relogio = 1_800_000_000_000;
const env = process.env as Record<string, string | undefined>;
const salvo = { NODE_ENV: env.NODE_ENV, AGENTE_DEV: env.AGENTE_DEV, SEG: env.AVALIACOES_API_SECRET };

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, corpo: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x" + url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(corpo) });
const get = (url: string, headers: Record<string, string> = {}) => new Request("http://x" + url, { headers });

async function ler(r: Response) {
  return { status: r.status, corpo: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeEach(() => {
  repo = criarRepositorioEmMemoria();
  relogio = 1_800_000_000_000;
  limitadorCriacao.reiniciar();
  definirContextoParaTestes({ repositorio: repo, llm: criarLlmFalsoDeterministico(), agora: () => relogio, fake: true });
});
afterEach(() => {
  definirContextoParaTestes(null);
  for (const [k, v] of [["NODE_ENV", salvo.NODE_ENV], ["AGENTE_DEV", salvo.AGENTE_DEV], ["AVALIACOES_API_SECRET", salvo.SEG]] as const) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

async function novaSessao() {
  const r = await ler(await criar(post("/api/sessoes", { avaliacao_id: "demo", candidato_id: "cand-1" })));
  assert.equal(r.status, 200);
  return { id: r.corpo.sessao_id as string, resposta: r.corpo };
}

async function eventos(id: string, lista: { tipo: string; dados: unknown }[]) {
  relogio += 10;
  const base = relogio;
  const r = await eventosPost(
    post(`/api/sessoes/${id}/eventos`, { eventos: lista.map((e, i) => ({ horario: new Date(base + i).toISOString(), ...e })) }),
    params(id),
  );
  assert.equal(r.status, 200);
}

async function analisar(
  id: string,
  fase: string,
  grafo: string,
  mudancas: string,
  perguntas: number,
  paradoHaS?: number,
  falaExtra?: { quem: "candidato" | "agente"; texto: string } | { quem: "candidato" | "agente"; texto: string }[],
) {
  const r = await ler(
    await analisarPost(
      post(`/api/sessoes/${id}/analisar`, {
        sessao_id: id,
        fase,
        grafo,
        mudancas,
        conversa_recente: [{ quem: "agente", texto: "Projete um serviço." }, ...(falaExtra ? (Array.isArray(falaExtra) ? falaExtra : [falaExtra]) : [])],
        perguntas_feitas: perguntas,
        imagem_url: null,
        ...(paradoHaS !== undefined ? { parado_ha_s: paradoHaS } : {}),
      }),
      params(id),
    ),
  );
  assert.equal(r.status, 200);
  return r.corpo;
}

const estado = async (id: string) => (await ler(await estadoGet(get(`/api/dev/sessoes/${id}/estado`), params(id)))).corpo;

describe("pergunta nova logo depois de uma fala solta do agente", () => {
  it("a bola fica com o candidato até ele agir; depois ou num silêncio de verdade a pergunta sai", async () => {
    definirContextoParaTestes({ repositorio: repo, llm: llmVariado(), agora: () => relogio, fake: true });
    const { id } = await novaSessao();
    await eventos(id, [{ tipo: "fase", dados: { fase: "REQUISITOS" } }]);
    const p = await ler(await perguntarPost(post(`/api/sessoes/${id}/perguntar`, { sessao_id: id, fase: "REQUISITOS", texto: "Qual a escala de acessos?" }), params(id)));
    assert.equal(p.corpo.responder, true);

    const d1 = diffGrafo("COMPONENTES\nCONEXÕES", GRAFO_RUIM);
    await eventos(id, [{ tipo: "fase", dados: { fase: "ALTO_NIVEL" } }, { tipo: "desenho", dados: { grafo: GRAFO_RUIM, mudancas: d1.texto, ids: d1.ids } }]);
    // O agente acabou de responder e o candidato não fez nada depois (parado há 30 s, antes da resposta).
    const logo = await analisar(id, "ALTO_NIVEL", GRAFO_RUIM, d1.texto, 0, 30);
    assert.equal(logo.status, "ok", "com a bola no candidato a pergunta é rebaixada");
    assert.equal((await estado(id)).plinPendente, false);

    // A análise anterior estava bloqueada; quando o candidato para, a mesma assinatura precisa reanalisar.
    relogio += 3_000;
    const depois = await analisar(id, "ALTO_NIVEL", GRAFO_RUIM, d1.texto, 0, 1);
    assert.equal(depois.status, "duvida", "a pergunta bloqueada é recuperada quando o candidato para");
  });
});

describe("fala do agente gravada durante a análise", () => {
  it("o /analisar refiltra com o estado fresco: a pergunta não sai e o plin não fica pendente", async () => {
    // O LLM falso grava a fala do Totti (via /perguntar) enquanto a análise está em andamento.
    let sessao = "";
    let gravou = false;
    const base = llmVariado();
    const llm: LlmCliente = {
      async completarJson(args) {
        if (args.nomeSchema !== "abertura_entrevista" && sessao && !gravou) {
          gravou = true; // o /perguntar também chama o LLM: sem isso a chamada recursiva não termina
          relogio += 2_000;
          const p = await ler(await perguntarPost(post(`/api/sessoes/${sessao}/perguntar`, { sessao_id: sessao, fase: "ALTO_NIVEL", texto: "Qual a escala de acessos?" }), params(sessao)));
          assert.equal(p.corpo.responder, true);
          relogio += 1_000;
        }
        return base.completarJson(args);
      },
    };
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio, fake: true });
    const { id } = await novaSessao();
    await eventos(id, [{ tipo: "fase", dados: { fase: "REQUISITOS" } }]);
    const d1 = diffGrafo("COMPONENTES\nCONEXÕES", GRAFO_RUIM);
    await eventos(id, [{ tipo: "fase", dados: { fase: "ALTO_NIVEL" } }, { tipo: "desenho", dados: { grafo: GRAFO_RUIM, mudancas: d1.texto, ids: d1.ids } }]);
    sessao = id;
    const r = await analisar(id, "ALTO_NIVEL", GRAFO_RUIM, d1.texto, 0, 30);
    sessao = "";
    assert.equal(r.status, "ok", "a fala gravada no meio da análise segura a pergunta");
    assert.equal(r.pergunta, null);
    assert.equal((await estado(id)).plinPendente, false);
  });

  it("sem fala no meio da análise e com silêncio longo, a pergunta sai (sem regressão)", async () => {
    definirContextoParaTestes({ repositorio: repo, llm: llmVariado(), agora: () => relogio, fake: true });
    const { id } = await novaSessao();
    await eventos(id, [{ tipo: "fase", dados: { fase: "REQUISITOS" } }]);
    const d1 = diffGrafo("COMPONENTES\nCONEXÕES", GRAFO_RUIM);
    await eventos(id, [{ tipo: "fase", dados: { fase: "ALTO_NIVEL" } }, { tipo: "desenho", dados: { grafo: GRAFO_RUIM, mudancas: d1.texto, ids: d1.ids } }]);
    const r = await analisar(id, "ALTO_NIVEL", GRAFO_RUIM, d1.texto, 0, 30);
    assert.equal(r.status, "duvida");
    assert.equal((await estado(id)).plinPendente, true);
  });
});

describe("entrevista completa por texto (handlers + LLM falso)", () => {
  it("percorre todas as fases, respeita os limites do plin, não vaza segredos e gera o scorecard", async () => {
    definirContextoParaTestes({ repositorio: repo, llm: llmVariado(), agora: () => relogio, fake: true });
    const respostas: unknown[] = [];
    const { id, resposta } = await novaSessao();
    respostas.push(resposta);
    assert.deepEqual(Object.keys(resposta.problema).filter((k) => k !== "fala_do_desafio").sort(), ["enunciado", "titulo"]);

    // REQUISITOS: perguntar um requisito (a ficha responde, vira item no quadro).
    await eventos(id, [{ tipo: "fase", dados: { fase: "REQUISITOS" } }]);
    const p = await ler(await perguntarPost(post(`/api/sessoes/${id}/perguntar`, { sessao_id: id, fase: "REQUISITOS", texto: "Qual a escala de acessos?" }), params(id)));
    respostas.push(p.corpo);
    assert.equal(p.corpo.responder, true);
    assert.ok(p.corpo.requisito);

    // Primeiro desenho: sai de REQUISITOS. Em ALTO_NIVEL a dúvida vale (o modelo decide quando falar).
    const d1 = diffGrafo("COMPONENTES\nCONEXÕES", GRAFO_RUIM);
    await eventos(id, [{ tipo: "fase", dados: { fase: "ALTO_NIVEL" } }, { tipo: "desenho", dados: { grafo: GRAFO_RUIM, mudancas: d1.texto, ids: d1.ids } }]);
    // A análise vem depois do evento do desenho (o segundo do lote, 1 ms à frente): a observação dela é a que fica
    // (as repetições seguintes não entram de novo no livro) e precisa da âncora desse desenho.
    relogio += 10;
    const alto = await analisar(id, "ALTO_NIVEL", GRAFO_RUIM, d1.texto, 0);
    respostas.push(alto);
    assert.equal(alto.status, "duvida");
    assert.equal((await estado(id)).plinPendente, true);
    assert.ok((await estado(id)).observacoes >= 1, "observações são colhidas junto com o plin");

    // APROFUNDAMENTO: a dúvida aparece, pendente.
    await eventos(id, [{ tipo: "fase", dados: { fase: "APROFUNDAMENTO" } }]);
    const duvida = await analisar(id, "APROFUNDAMENTO", GRAFO_RUIM, "(sem mudanças)", 0, undefined,
      { quem: "candidato", texto: "Quero aprofundar a solução." });
    respostas.push(duvida);
    assert.equal(duvida.status, "duvida");
    assert.deepEqual(duvida.elementos, ["e1"]);
    assert.ok(duvida.nota.length <= 40);
    assert.equal((await estado(id)).plinPendente, true);

    // Cinco rodadas: clique, (análise durante a resposta é bloqueada), resposta, reanálise forçada.
    for (let n = 1; n <= 5; n++) {
      if (n > 1) {
        relogio += 4 * 60_000; // ritmo da política comum: ~1 pergunta a cada 3 min (intervalo e cota)
        const nova = await analisar(id, "APROFUNDAMENTO", GRAFO_RUIM, "(sem mudanças)", n - 1, undefined,
          Array.from({ length: n }, (_, i) => ({ quem: "candidato" as const, texto: `Quero aprofundar na rodada ${n}, fala ${i + 1}.` })));
        assert.equal(nova.status, "duvida", `rodada ${n}: plin liberado`);
      }
      await eventos(id, [{ tipo: "pergunta", dados: { pergunta: "x", elementos: ["e1"] } }]);
      assert.equal((await estado(id)).perguntaAtiva, true);
      const bloqueada = await analisar(id, "APROFUNDAMENTO", GRAFO_RUIM, "(sem mudanças)", n);
      assert.equal(bloqueada.status, "ok", "durante a resposta não há análise");
      await eventos(id, [
        { tipo: "fala", dados: { quem: "candidato", texto: `Resposta número ${n}: acho que um Postgres aguenta` } },
        { tipo: "resposta", dados: { texto: `Resposta número ${n}: acho que um Postgres aguenta` } },
      ]);
      const e = await estado(id);
      assert.equal(e.perguntasFeitas, n);
      assert.equal(e.perguntaAtiva, false);
      if (n < 5) {
        // Reanálise forçada logo após a resposta: o respiro da política comum segura o plin.
        const forcada = await analisar(id, "APROFUNDAMENTO", GRAFO_RUIM, "(o candidato terminou de responder)", n, undefined,
          { quem: "candidato", texto: `Resposta número ${n}: acho que um Postgres aguenta` });
        assert.equal(forcada.status, "ok");
        assert.equal(e.fase, "APROFUNDAMENTO");
      }
    }
    // Acabar perguntas não encerra o aprofundamento antes da hora: o quadro avança a fase pelo relógio.
    assert.equal((await estado(id)).fase, "APROFUNDAMENTO");
    await eventos(id, [{ tipo: "fase", dados: { fase: "FECHAMENTO" } }]);

    // FECHAMENTO: uma única pergunta final; depois, nenhuma.
    relogio += 61_000;
    const final = await analisar(id, "FECHAMENTO", GRAFO_BOM, d1.texto, 5);
    assert.equal(final.status, "duvida");
    await eventos(id, [{ tipo: "pergunta", dados: {} }]);
    await eventos(id, [{ tipo: "resposta", dados: { texto: "Fecho com cache e réplicas" } }]);
    relogio += 61_000;
    const depois = await analisar(id, "FECHAMENTO", GRAFO_RUIM, "(x)", 6);
    assert.equal(depois.status, "ok", "só uma pergunta no fechamento");
    assert.equal((await estado(id)).perguntasFeitas, 6, "5 no aprofundamento + 1 no fechamento");

    // Encerrar e finalizar.
    await eventos(id, [{ tipo: "fase", dados: { fase: "ENCERRADA" } }]);
    const fin = await ler(await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id)));
    assert.equal(fin.status, 200);
    const sc = fin.corpo;
    assert.equal(sc.origem, "fake");
    assert.equal(sc.candidato_id, "cand-1");
    assert.equal(sc.criterios.length, 6);
    for (const c of sc.criterios) {
      if (c.nota !== null) assert.ok(c.evidencias.length > 0, "toda nota tem prova");
    }
    const notas = sc.criterios.map((c: { nota: number | null }) => c.nota).filter((n: number | null) => n !== null) as number[];
    // Critério que o Totti não provocou fica sem nota (#131); sem nenhuma nota, a geral também é null.
    assert.equal(sc.nota_geral, notas.length ? Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10 : null);
    assert.equal((await estado(id)).scorecardGerado, true);
    assert.equal((await ler(await scorecardGet(get(`/api/sessoes/${id}/scorecard`), params(id)))).corpo.gerado_em, sc.gerado_em);

    // Segredos: nada da ficha, dos sinais, das armadilhas ou da rubrica nas respostas do candidato.
    const alvo = resolverAvaliacaoEstatica("demo")!;
    const publico = JSON.stringify([...respostas, await estado(id)]);
    const segredos = [
      ...alvo.problema.ficha.map((f) => f.resposta),
      ...alvo.problema.sinaisEsperados,
      ...alvo.problema.armadilhas,
      ...alvo.kit.criterios.map((c) => c.niveis[4]),
    ];
    for (const s of segredos) assert.ok(!publico.includes(s), `vazou: ${s.slice(0, 40)}`);
  });
});

describe("finalizar", () => {
  const rubrica = ["requisitos", "componentes_fluxo", "escalabilidade", "dados_consistencia", "tradeoffs", "comunicacao"];
  const saidaLlm = () => ({
    nota_geral: 9,
    recomendacao: "avancar",
    criterios: rubrica.map((c) => ({
      criterio: c,
      nota: 3,
      justificativa: "ok",
      evidencias: [{ tipo: "fala", horario: "2020-01-01T00:00:00.000Z", texto: "um Postgres aguenta tudo", elementos: [], imagem: null }],
    })),
    pontos_fortes: [],
    pontos_a_aprofundar: [],
    briefing_para_proxima_etapa: "b",
    resumo_da_solucao: "", resumo_da_entrevista: "",
  });

  it("é idempotente (inclusive em paralelo): uma única chamada ao modelo final, com as opções certas", async () => {
    const llm = criarClienteFalso([saidaLlm()]);
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio, fake: false });
    const { id } = await novaSessao();
    await eventos(id, [{ tipo: "fala", dados: { quem: "candidato", texto: "Eu acho que um Postgres aguenta tudo, sem cache" } }]);
    const [a, b] = await Promise.all([
      ler(await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id))),
      ler(await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id))),
    ]);
    const c = await ler(await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id)));
    assert.equal(a.status, 200);
    assert.deepEqual(a.corpo, b.corpo);
    assert.deepEqual(a.corpo, c.corpo);
    // A criação da sessão faz a chamada da abertura (apresentação e despedida); o scorecard é uma só.
    const finais = llm.chamadas.filter((x) => x.nomeSchema !== "abertura_entrevista");
    assert.equal(finais.length, 1);
    const ch = finais[0];
    assert.equal(ch.raciocinio, true);
    assert.equal(ch.maxTokens, MAX_TOKENS_SCORECARD);
    assert.equal(ch.timeoutMs, 280_000);
    assert.ok(ch.modelo);
    // guardas no caminho real: nota_geral recomputada e fala validada contra a conversa
    assert.equal(a.corpo.nota_geral, 3);
    assert.equal(a.corpo.origem, "llm");
    // requisitos/escalabilidade sem provocação do Totti ficam sem nota (#131): confere num critério com prova.
    const comProva = a.corpo.criterios.find((x: { evidencias: unknown[] }) => x.evidencias.length > 0);
    assert.ok(comProva, "algum critério mantém prova");
    assert.equal(comProva.evidencias[0].horario !== "2020-01-01T00:00:00.000Z", true);
    assert.ok(!JSON.stringify(ch.mensagens).includes("FICHA"), "mensagens do usuário não carregam a ficha");
  });

  it("sem chave e sem fake: erro amigável (503); falha do modelo retorna 202 e pode tentar de novo", async () => {
    definirContextoParaTestes({ repositorio: repo, llm: null, agora: () => relogio, fake: false });
    const { id } = await novaSessao();
    const sem = await ler(await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id)));
    assert.equal(sem.status, 503);
    assert.match(sem.corpo.erro, /OPENROUTER_API_KEY/);

    const llm = criarClienteFalso([new Error("boom"), saidaLlm()]);
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio, fake: false });
    const falha = await ler(await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id)));
    assert.equal(falha.status, 202);
    assert.deepEqual(falha.corpo, { gerando: true });
    const ok = await ler(await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id)));
    assert.equal(ok.status, 200);
  });

  it("tenta Featherless duas vezes e uma reserva; só um novo POST tenta a reserva novamente", async () => {
    const chamadas: string[] = [];
    const base = criarClienteFalso([new Error("indisponível"), new Error("indisponível"), new Error("indisponível"), saidaLlm()]);
    const llm: LlmCliente = { completarJson: async args => {
      chamadas.push(args.rota ?? "automatico");
      return base.completarJson(args);
    } };
    const { id } = await novaSessao();
    definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio, fake: false });
    assert.equal((await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id))).status, 202);
    assert.equal((await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id))).status, 202);
    assert.deepEqual(chamadas, ["primario", "primario"]);
    assert.equal((await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id))).status, 502);
    assert.deepEqual(chamadas, ["primario", "primario", "reserva"]);
    assert.equal((await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id))).status, 200);
    assert.deepEqual(chamadas, ["primario", "primario", "reserva", "reserva"]);
  });

  it("sessão inexistente: 404", async () => {
    assert.equal((await finalizarPost(post("/api/sessoes/nada/finalizar", {}), params("nada"))).status, 404);
  });

  it("timeout encerra a chamada, não salva relatório e permite nova tentativa", async () => {
    const anterior = process.env.AGENTE_TIMEOUT_SCORECARD_MS;
    process.env.AGENTE_TIMEOUT_SCORECARD_MS = "5";
    let sinal: AbortSignal | undefined;
    try {
      const { id } = await novaSessao();
      const llm: LlmCliente = { completarJson: args => {
        sinal = args.sinal;
        return new Promise((_, rejeitar) => args.sinal?.addEventListener("abort", () => rejeitar(new Error("abortou")), { once: true }));
      } };
      definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio, fake: false });
      const resposta = await ler(await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id)));
      assert.equal(resposta.status, 202);
      assert.equal(sinal?.aborted, true);
      assert.equal(await repo.obterScorecard(id), null);
      assert.equal((await repo.obter(id))?.estado.fase, "ENCERRADA");
      definirContextoParaTestes({ repositorio: repo, llm: criarClienteFalso([saidaLlm()]), agora: () => relogio, fake: false });
      assert.equal((await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id))).status, 200);
    } finally {
      if (anterior === undefined) delete process.env.AGENTE_TIMEOUT_SCORECARD_MS;
      else process.env.AGENTE_TIMEOUT_SCORECARD_MS = anterior;
    }
  });
});

describe("estado de dev e gating", () => {
  it("devolve só campos seguros (sem ficha, rubrica, conversa nem texto da dúvida)", async () => {
    const { id } = await novaSessao();
    const e = await estado(id);
    assert.deepEqual(
      Object.keys(e).sort(),
      ["analises", "criteriosSemEvidencia", "fase", "observacoes", "perguntaAtiva", "perguntaFinalFeita", "perguntasFeitas", "plin", "plinPendente", "scorecardGerado"],
    );
    assert.equal(e.fase, "APRESENTACAO");
    assert.equal(e.criteriosSemEvidencia.length, 6);
  });

  it("em produção, a visão de estado dá 404 (a menos de AGENTE_DEV=1)", async () => {
    const { id } = await novaSessao();
    env.NODE_ENV = "production";
    delete env.AGENTE_DEV;
    assert.equal((await estadoGet(get(`/api/dev/sessoes/${id}/estado`), params(id))).status, 404);
    env.AGENTE_DEV = "1";
    assert.equal((await estadoGet(get(`/api/dev/sessoes/${id}/estado`), params(id))).status, 200);
  });

  it("em produção, o scorecard só sai com x-api-key; finalizar não o devolve ao candidato", async () => {
    const { id } = await novaSessao();
    env.NODE_ENV = "production";
    delete env.AGENTE_DEV;
    env.AVALIACOES_API_SECRET = "segredo-de-teste";
    const fin = await ler(await finalizarPost(post(`/api/sessoes/${id}/finalizar`, {}), params(id)));
    assert.equal(fin.status, 200);
    assert.deepEqual(fin.corpo, { ok: true, gerado: true });
    assert.equal((await scorecardGet(get(`/api/sessoes/${id}/scorecard`), params(id))).status, 404);
    assert.equal((await scorecardGet(get(`/api/sessoes/${id}/scorecard`, { "x-api-key": "errada" }), params(id))).status, 404);
    const certo = await scorecardGet(get(`/api/sessoes/${id}/scorecard`, { "x-api-key": "segredo-de-teste" }), params(id));
    assert.equal(certo.status, 200);
  });
});
