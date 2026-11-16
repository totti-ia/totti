import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { criarClienteFalso, criarClienteOpenRouter, ErroLlm } from "../cliente";
import { paraJsonSchema } from "../jsonschema";
import { EsquemaRespostaAnalise } from "../../sessao/tipos";

const CHAVE = "sk-or-SEGREDO-123";
const Saida = z.object({ ok: z.boolean(), n: z.number().int().nullable() });

type Chamada = { url: string; init: RequestInit };

function openaiOk(conteudo: unknown, usage?: object): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo) } }], usage }),
    { status: 200 },
  );
}

function montar(respostas: (Response | Error | ((init: RequestInit) => Promise<Response>))[], extra = {}) {
  const chamadas: Chamada[] = [];
  const logs: unknown[][] = [];
  let i = 0;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const r = respostas[Math.min(i++, respostas.length - 1)];
    if (r instanceof Error) throw r;
    if (typeof r === "function") return r(init);
    return r.clone();
  }) as unknown as typeof fetch;
  const cliente = criarClienteOpenRouter({
    apiKey: CHAVE,
    fetch: fakeFetch,
    esperar: async () => {},
    log: (...a) => logs.push(a),
    ...extra,
  });
  return { cliente, chamadas, logs };
}

const ARGS = {
  sistema: { estatico: "ESTATICO", dinamico: "DINAMICO" },
  mensagens: [{ role: "user" as const, content: "oi" }],
  schema: Saida,
  nomeSchema: "saida_teste",
};

describe("criarClienteOpenRouter: formato da requisição", () => {
  it("monta URL, headers, cache_control e response_format estrito", async () => {
    const { cliente, chamadas } = montar([openaiOk({ ok: true, n: 3 }, { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80 } })]);
    const r = await cliente.completarJson({ ...ARGS, modelo: "anthropic/teste", maxTokens: 321 });
    assert.deepEqual(r.dados, { ok: true, n: 3 });
    assert.deepEqual(r.uso, { entrada: 100, saida: 20, cache: 80 });

    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, "https://openrouter.ai/api/v1/chat/completions");
    const h = chamadas[0].init.headers as Record<string, string>;
    assert.equal(h["Content-Type"], "application/json; charset=utf-8");
    assert.equal(h.Authorization, `Bearer ${CHAVE}`);

    const corpo = JSON.parse(chamadas[0].init.body as string);
    assert.equal(corpo.model, "anthropic/teste");
    assert.equal(corpo.max_tokens, 321);
    assert.deepEqual(corpo.reasoning, { enabled: false });
    assert.equal("temperature" in corpo, false);
    assert.deepEqual(corpo.messages[0].content[0], { type: "text", text: "ESTATICO", cache_control: { type: "ephemeral" } });
    assert.deepEqual(corpo.messages[0].content[1], { type: "text", text: "DINAMICO" });
    assert.equal(corpo.messages[0].role, "system");
    assert.deepEqual(corpo.messages[1], { role: "user", content: "oi" });
    assert.equal(corpo.response_format.type, "json_schema");
    assert.equal(corpo.response_format.json_schema.name, "saida_teste");
    assert.equal(corpo.response_format.json_schema.strict, true);
    assert.deepEqual(corpo.response_format.json_schema.schema, {
      type: "object",
      properties: { ok: { type: "boolean" }, n: { anyOf: [{ type: "integer" }, { type: "null" }] } },
      required: ["ok", "n"],
      additionalProperties: false,
    });
  });

  it("modelo vem de AGENTE_MODELO_AO_VIVO ou do padrão", async () => {
    const antes = process.env.AGENTE_MODELO_AO_VIVO;
    try {
      delete process.env.AGENTE_MODELO_AO_VIVO;
      const a = montar([openaiOk({ ok: true, n: null })]);
      await a.cliente.completarJson(ARGS);
      assert.equal(JSON.parse(a.chamadas[0].init.body as string).model, "anthropic/claude-haiku-5.5");
      process.env.AGENTE_MODELO_AO_VIVO = "x/y";
      const b = montar([openaiOk({ ok: true, n: null })]);
      await b.cliente.completarJson(ARGS);
      assert.equal(JSON.parse(b.chamadas[0].init.body as string).model, "x/y");
    } finally {
      if (antes === undefined) delete process.env.AGENTE_MODELO_AO_VIVO;
      else process.env.AGENTE_MODELO_AO_VIVO = antes;
    }
  });

  it("aceita JSON dentro de cerca de código", async () => {
    const { cliente } = montar([openaiOk('```json\n{"ok":true,"n":1}\n```')]);
    assert.deepEqual((await cliente.completarJson(ARGS)).dados, { ok: true, n: 1 });
  });

  it("sem chave: erro tipado, sem chamar a rede", async () => {
    const antes = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const chamadas: Chamada[] = [];
      const c = criarClienteOpenRouter({ fetch: (async (u: string, i: RequestInit) => (chamadas.push({ url: u, init: i }), openaiOk({}))) as unknown as typeof fetch });
      await assert.rejects(c.completarJson(ARGS), (e: ErroLlm) => e.codigo === "sem_chave");
      assert.equal(chamadas.length, 0);
    } finally {
      if (antes !== undefined) process.env.OPENROUTER_API_KEY = antes;
    }
  });
});

describe("criarClienteOpenRouter: validação, retry e timeout", () => {
  it("saída fora do schema vira ErroLlm 'invalido'", async () => {
    const { cliente } = montar([openaiOk({ ok: "sim" })]);
    await assert.rejects(cliente.completarJson(ARGS), (e: ErroLlm) => e.name === "ErroLlm" && e.codigo === "invalido");
  });

  it("conteúdo que não é JSON vira 'invalido'", async () => {
    const { cliente } = montar([openaiOk("desculpe, não posso")]);
    await assert.rejects(cliente.completarJson(ARGS), (e: ErroLlm) => e.codigo === "invalido");
  });

  it("tenta de novo uma vez em 5xx e consegue", async () => {
    const { cliente, chamadas } = montar([new Response("erro", { status: 503 }), openaiOk({ ok: true, n: null })]);
    const r = await cliente.completarJson(ARGS);
    assert.equal(r.dados.ok, true);
    assert.equal(chamadas.length, 2);
  });

  it("429 também tenta de novo, mas só uma vez", async () => {
    const { cliente, chamadas } = montar([new Response("x", { status: 429 })]);
    await assert.rejects(cliente.completarJson(ARGS), (e: ErroLlm) => e.codigo === "http" && e.status === 429);
    assert.equal(chamadas.length, 2);
  });

  it("4xx (exceto 429) não tenta de novo", async () => {
    const { cliente, chamadas } = montar([new Response("x", { status: 400 })]);
    await assert.rejects(cliente.completarJson(ARGS), (e: ErroLlm) => e.codigo === "http" && e.status === 400);
    assert.equal(chamadas.length, 1);
  });

  it("não tenta de novo se o orçamento de tempo é curto", async () => {
    const { cliente, chamadas } = montar([new Response("x", { status: 500 })], { timeoutMs: 1000 });
    await assert.rejects(cliente.completarJson(ARGS), (e: ErroLlm) => e.codigo === "http");
    assert.equal(chamadas.length, 1);
  });

  it("estoura o timeout: ErroLlm 'timeout'", async () => {
    const pendura = (init: RequestInit) =>
      new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new Error("abortou"))));
    const { cliente } = montar([pendura], { timeoutMs: 30 });
    await assert.rejects(cliente.completarJson(ARGS), (e: ErroLlm) => e.codigo === "timeout");
  });

  it("sinal do chamador aborta: 'abortado'", async () => {
    const pendura = (init: RequestInit) =>
      new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new Error("abortou"))));
    const { cliente } = montar([pendura]);
    const ctl = new AbortController();
    const p = cliente.completarJson({ ...ARGS, sinal: ctl.signal });
    ctl.abort();
    await assert.rejects(p, (e: ErroLlm) => e.codigo === "abortado");
  });
});

describe("criarClienteOpenRouter: a chave nunca aparece em log nem em erro", () => {
  it("em falha HTTP, rede, timeout e schema inválido", async () => {
    const saidas: string[] = [];
    const originais = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (...a: unknown[]) => void saidas.push(JSON.stringify(a));
    try {
      const cenarios = [
        montar([new Response(`eco: Bearer ${CHAVE}`, { status: 500 })]),
        montar([new Error(`falha com ${CHAVE}`)]),
        montar([openaiOk({ ok: 1 })]),
      ];
      for (const c of cenarios) {
        try {
          await c.cliente.completarJson(ARGS);
        } catch (e) {
          saidas.push(String((e as Error).message), String((e as Error).stack ?? "").split("\n")[0]);
        }
        saidas.push(JSON.stringify(c.logs));
      }
    } finally {
      Object.assign(console, originais);
    }
    assert.ok(saidas.length > 0);
    assert.ok(saidas.every((s) => !s.includes(CHAVE)), "a chave vazou");
  });
});

describe("criarClienteFalso", () => {
  it("consome a fila, repete a última, valida pelo schema e guarda as chamadas", async () => {
    const f = criarClienteFalso([{ ok: true, n: 1 }, { ok: false, n: null }]);
    assert.equal((await f.completarJson(ARGS)).dados.n, 1);
    assert.equal((await f.completarJson(ARGS)).dados.ok, false);
    assert.equal((await f.completarJson(ARGS)).dados.ok, false);
    assert.equal(f.chamadas.length, 3);
  });
  it("Error na fila faz a chamada falhar; saída inválida também", async () => {
    const f = criarClienteFalso([new ErroLlm("timeout", "x"), { ok: 1 }]);
    await assert.rejects(f.completarJson(ARGS), (e: ErroLlm) => e.codigo === "timeout");
    await assert.rejects(f.completarJson(ARGS), (e: ErroLlm) => e.codigo === "invalido");
  });
});

describe("paraJsonSchema", () => {
  it("converte o schema da análise (defaults viram obrigatórios, nullable vira anyOf)", () => {
    const s = paraJsonSchema(EsquemaRespostaAnalise) as { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
    assert.deepEqual(s.required, ["gancho", "status", "pergunta", "nota", "elementos", "visual", "degrau", "observacoes", "avancar_fase", "parteFechada", "escopo"]);
    assert.equal(s.additionalProperties, false);
    assert.deepEqual(s.properties.status, { type: "string", enum: ["ok", "duvida", "redirecionar", "dica"] });
    assert.deepEqual(s.properties.pergunta, { anyOf: [{ type: "string" }, { type: "null" }] });
    assert.deepEqual(s.properties.elementos, { type: "array", items: { type: "string" } });
  });
});

describe("criarClienteOpenRouter: modelo que exige raciocínio", () => {
  const recusa = () =>
    new Response(JSON.stringify({ error: { message: "Reasoning is mandatory for this endpoint and cannot be disabled." } }), { status: 400 });

  it("refaz o pedido com raciocínio em esforço baixo e mais tokens, e lembra do modelo", async () => {
    const { cliente, chamadas } = montar([recusa(), openaiOk({ ok: true, n: 1 }), openaiOk({ ok: true, n: 2 })]);
    const r1 = await cliente.completarJson({ ...ARGS, modelo: "anthropic/exige-raciocinio", maxTokens: 800 });
    assert.deepEqual(r1.dados, { ok: true, n: 1 });
    assert.equal(chamadas.length, 2);
    const c1 = JSON.parse(String(chamadas[0].init.body));
    const c2 = JSON.parse(String(chamadas[1].init.body));
    assert.deepEqual(c1.reasoning, { enabled: false });
    assert.deepEqual(c2.reasoning, { effort: "low" });
    assert.ok(c2.max_tokens >= 4000);

    // Segunda chamada ao mesmo modelo já vai direto com raciocínio (sem a tentativa que falha).
    await cliente.completarJson({ ...ARGS, modelo: "anthropic/exige-raciocinio", maxTokens: 800 });
    assert.equal(chamadas.length, 3);
    assert.deepEqual(JSON.parse(String(chamadas[2].init.body)).reasoning, { effort: "low" });
  });

  it("outros 400 continuam falhando, com a mensagem do provedor no erro", async () => {
    const { cliente, chamadas } = montar([new Response(JSON.stringify({ error: { message: "Invalid schema: foo" } }), { status: 400 })]);
    await assert.rejects(
      cliente.completarJson({ ...ARGS, modelo: "anthropic/outro" }),
      (e: unknown) => e instanceof ErroLlm && e.status === 400 && /Invalid schema: foo/.test(e.message) && !e.message.includes(CHAVE),
    );
    assert.equal(chamadas.length, 1);
  });
});
