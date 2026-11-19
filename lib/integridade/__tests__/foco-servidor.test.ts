import assert from "node:assert/strict";
import { it } from "node:test";
import { POST } from "@/app/api/events/route";
import { disparaAnalise } from "@/lib/agents/gatilhos";
import { enqueueKickoff } from "@/lib/agents/policy";
import { getOrCreateSession, appendEvent } from "@/lib/session/store";
import { criarRepositorioEmMemoria } from "@/lib/agente/armazenamento";
import { criarClienteFalso } from "@/lib/agente/llm/cliente";
import { definirContextoParaTestes } from "@/lib/agente/rotas/contexto";
import { eventosDaMaquina, eventosHandler } from "@/lib/agente/rotas/handlers";
import { estadoInicial } from "@/lib/agente/sessao/estado";

it("POST foco na IDE só grava: não analisa nem consulta a fila que já tem pergunta", async () => {
  const sessionId = "integridade-foco-rota";
  const s = getOrCreateSession(sessionId);
  appendEvent(s, { type: "snapshot", sessionId, t: 0, code: "def two_sum(nums, target):\n    return [0, 1]", language: "python", version: 1 });
  enqueueKickoff(s, 0);
  const antes = structuredClone({ queue: s.queue, analyst: s.analyst, blips: s.blips, coverage: s.coverage });
  const evento = { sessionId, t: 120_000, type: "foco" as const, saidas: [{ t: 90_000, duracaoMs: 30_000, motivo: "janela" as const }] };
  assert.equal(disparaAnalise(evento, s), false);
  const enviar = () => POST(new Request("http://local/api/events", { method: "POST", body: JSON.stringify(evento) }));
  assert.deepEqual(await (await enviar()).json(), {});
  assert.deepEqual({ queue: s.queue, analyst: s.analyst, blips: s.blips, coverage: s.coverage }, antes);
  assert.equal(s.events.filter((e) => e.type === "foco").length, 1);
  await enviar();
  assert.equal(s.events.filter((e) => e.type === "foco").length, 1, "reenvio não duplica a evidência");
});

it("POST foco no quadro só grava: máquina, efeitos, análises e LLM ficam intactos", async () => {
  const repo = criarRepositorioEmMemoria();
  const llm = criarClienteFalso([]);
  definirContextoParaTestes({ repositorio: repo, llm, agora: () => 120_000 });
  try {
    const sessao = await repo.criar({ avaliacaoId: "demo", candidatoId: "c", estado: estadoInicial() });
    const antes = structuredClone(sessao.estado);
    const dados = { saidas: [{ inicio: "2026-11-14T12:00:00Z", duracaoMs: 30_000, motivo: "aba" }] };
    assert.deepEqual(eventosDaMaquina("foco", dados), []);
    const r = await eventosHandler(new Request("http://local/api/sessoes/id/eventos", {
      method: "POST", body: JSON.stringify({ eventos: [{ horario: "2026-11-14T12:00:30Z", tipo: "foco", dados }] }),
    }), { params: Promise.resolve({ id: sessao.id }) });
    assert.equal(r.status, 200);
    assert.equal((await repo.listarEventos(sessao.id)).length, 1);
    assert.deepEqual((await repo.obter(sessao.id))!.estado, antes);
    assert.equal((await repo.obter(sessao.id))!.analises, 0);
    assert.equal(llm.chamadas.length, 0);
  } finally { definirContextoParaTestes(null); }
});
