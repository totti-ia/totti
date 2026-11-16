// Teste de POST /imagens isolado para permitir execução independente das demais rotas.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { criarRepositorioEmMemoria, type RepositorioSessoes } from "../../../lib/agente/armazenamento";
import { definirContextoParaTestes } from "../../../lib/agente/rotas/contexto";
import { criarLlmFalsoDeterministico } from "../../../lib/agente/rotas/llm-falso";
import { POST as criarSessao } from "../sessoes/route";
import { POST as imagemPost } from "../sessoes/[id]/imagens/route";

let repo: RepositorioSessoes;

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function novaSessao(): Promise<string> {
  const resposta = await criarSessao(new Request("http://x/api/sessoes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ avaliacao_id: "demo", candidato_id: "c1" }),
  }));
  assert.equal(resposta.status, 200);
  return (await resposta.json()).sessao_id as string;
}

function formImagem(final = false, horario = "2026-11-07T15:00:00.000Z"): Request {
  const formulario = new FormData();
  formulario.append("imagem", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], { type: "image/png" }), "quadro.png");
  formulario.append("horario", horario);
  if (final) formulario.append("final", "1");
  return new Request("http://x/api/sessoes/i/imagens", { method: "POST", body: formulario });
}

beforeEach(() => {
  repo = criarRepositorioEmMemoria();
  definirContextoParaTestes({ repositorio: repo, llm: criarLlmFalsoDeterministico(), agora: () => 1_000_000 });
});
afterEach(() => definirContextoParaTestes(null));

describe("POST /api/sessoes/:id/imagens final", () => {
  it("aceita a foto final acima do teto e substitui finais anteriores", async () => {
    const id = await novaSessao();
    for (let i = 0; i < 60; i++) assert.equal((await imagemPost(formImagem(), params(id))).status, 200);
    assert.equal((await imagemPost(formImagem(), params(id))).status, 429);
    assert.equal((await imagemPost(formImagem(true), params(id))).status, 200);
    assert.equal((await imagemPost(formImagem(true, "2026-11-07T15:01:00.000Z"), params(id))).status, 200);

    const imagens = await repo.listarImagens(id);
    assert.equal(imagens.length, 61);
    assert.equal(imagens.at(-1)?.horario, "2026-11-07T15:01:00.000Z");
  });
});
