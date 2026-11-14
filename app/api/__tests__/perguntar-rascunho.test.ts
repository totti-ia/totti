// Resposta antecipada do /perguntar: o rascunho (com `rascunho: true`) prepara a resposta sem gravar nada, e a fala
// normal que vem depois usa esse rascunho quando a entrada é a mesma. Sem rede: o LLM é falso.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { criarRepositorioEmMemoria, type RepositorioSessoes } from "@/lib/agente/armazenamento";
import { criarClienteFalso } from "@/lib/agente/llm/cliente";
import { definirContextoParaTestes } from "@/lib/agente/rotas/contexto";
import { estadoInicial } from "@/lib/agente/sessao/estado";
import { POST as perguntar } from "../sessoes/[id]/perguntar/route";

const AGORA = 1_800_000_000_000;
const GRAFO = "COMPONENTES\n- [r1] Cliente (retângulo)\n- [r2] API (retângulo)\n- [r3] Banco (retângulo)\nCONEXÕES\n- [s1] Cliente → API\n- [s2] API → Banco";
const FALA = "Eu uso um cache na frente do banco";
let repo: RepositorioSessoes;
let relogio = AGORA;

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (dados: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(dados) });
const resposta = (texto: string) => ({ responder: true, texto, requisito: null, desfecho: "respondeu" });
const corpo = (id: string, texto: string, extra: Record<string, unknown> = {}) => ({ sessao_id: id, fase: "ALTO_NIVEL", texto, grafo: GRAFO, ...extra });

async function sessao() {
  return repo.criar({ avaliacaoId: "demo", candidatoId: "teste", estado: {
    ...estadoInicial(), fase: "ALTO_NIVEL", faseIniciadaEm: AGORA - 60_000, iniciadaEm: AGORA - 10 * 60_000,
  } });
}

/** Repositório que anota as escritas: o rascunho não pode fazer nenhuma. */
function espiar(alvo: RepositorioSessoes, escritas: string[]): RepositorioSessoes {
  return new Proxy(alvo, {
    get(t, prop) {
      const v = Reflect.get(t, prop, t);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        if (prop === "salvarEstado" || prop === "anexarEventos") escritas.push(String(prop));
        return (v as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });
}

beforeEach(() => {
  repo = criarRepositorioEmMemoria();
  relogio = AGORA;
});
afterEach(() => definirContextoParaTestes(null));

test("rascunho não grava nada: sem salvarEstado nem anexarEventos, e o estado fica igual", async () => {
  const s = await sessao();
  const antes = JSON.stringify((await repo.obter(s.id))!.estado);
  const escritas: string[] = [];
  const llm = criarClienteFalso([resposta("Entendi.")]);
  definirContextoParaTestes({ repositorio: espiar(repo, escritas), llm, agora: () => relogio });

  const r = await perguntar(post({ ...corpo(s.id, FALA), rascunho: true }), params(s.id));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { rascunho: true, responder: true, texto: "Entendi." });
  assert.equal(llm.chamadas.length, 1);
  assert.deepEqual(escritas, []);
  assert.equal(JSON.stringify((await repo.obter(s.id))!.estado), antes);
});

test("rascunho e depois a fala normal com o mesmo corpo: o LLM roda só no rascunho e a fala sai uma vez só", async () => {
  const s = await sessao();
  const llm = criarClienteFalso([resposta("Primeira."), resposta("Segunda.")]);
  definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });

  await perguntar(post({ ...corpo(s.id, FALA), rascunho: true }), params(s.id));
  const normal = await perguntar(post(corpo(s.id, FALA)), params(s.id));
  assert.equal(normal.status, 200);
  assert.equal(normal.headers.get("x-totti-rascunho"), "usado");
  assert.equal((await normal.json()).texto, "Primeira.");
  assert.equal(llm.chamadas.length, 1);

  const estado = (await repo.obter(s.id))!.estado;
  assert.equal(estado.conversa.filter((f) => f.quem === "candidato" && f.texto === FALA).length, 1);
});

test("texto diferente na fala normal: a entrada é outra, então o LLM roda de novo", async () => {
  const s = await sessao();
  const llm = criarClienteFalso([resposta("Primeira."), resposta("Segunda.")]);
  definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });

  await perguntar(post({ ...corpo(s.id, FALA), rascunho: true }), params(s.id));
  const normal = await perguntar(post(corpo(s.id, FALA + " e uma fila na frente")), params(s.id));
  assert.equal(normal.headers.get("x-totti-rascunho"), "novo");
  assert.equal((await normal.json()).texto, "Segunda.");
  assert.equal(llm.chamadas.length, 2);
});

test("rascunho que falhou não bloqueia: a fala normal chama ao vivo e responde 200", async () => {
  const s = await sessao();
  let falhar = true;
  const llm = criarClienteFalso(() => {
    if (falhar) throw new Error("modelo fora do ar");
    return resposta("Ao vivo.");
  });
  definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });

  const rascunho = await (await perguntar(post({ ...corpo(s.id, FALA), rascunho: true }), params(s.id))).json();
  assert.equal(rascunho.rascunho, true);
  assert.equal(rascunho.texto, "");

  falhar = false;
  const normal = await perguntar(post(corpo(s.id, FALA)), params(s.id));
  assert.equal(normal.status, 200);
  assert.equal(normal.headers.get("x-totti-rascunho"), "novo");
  assert.equal((await normal.json()).texto, "Ao vivo.");
});

test("o mesmo rascunho não serve duas vezes: o segundo POST normal igual chama o LLM", async () => {
  const s = await sessao();
  const llm = criarClienteFalso([resposta("Primeira."), resposta("Segunda.")]);
  definirContextoParaTestes({ repositorio: repo, llm, agora: () => relogio });

  await perguntar(post({ ...corpo(s.id, FALA), rascunho: true }), params(s.id));
  const primeira = await perguntar(post(corpo(s.id, FALA)), params(s.id));
  assert.equal(primeira.headers.get("x-totti-rascunho"), "usado");
  const segunda = await perguntar(post(corpo(s.id, FALA)), params(s.id));
  assert.equal(segunda.headers.get("x-totti-rascunho"), "novo");
  assert.equal((await segunda.json()).texto, "Segunda.");
  assert.equal(llm.chamadas.length, 2);
});
