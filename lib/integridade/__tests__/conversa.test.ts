import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blocoSemFala, ecoDaPergunta, sinaisDaConversa, type FalaDaConversa } from "../conversa";
import { integridadeDaIde, integridadeDoQuadro } from "../montar";
import { Gravacao, SessionEvent } from "../../contracts";
import { gravacaoDoQuadro } from "../../relatorio/gravacao-do-quadro";
import { getOrCreateSession, appendEvent } from "../../session/store";
import { gravacaoDaSessao } from "../../session/gravacao";

const perguntas = ["Tudo bem, podemos seguir com a entrevista?", "Como você escalaria o banco de dados?", "Você está pronto para começar a entrevista?", "Por que você escolheu essa estrutura de dados?", "Você tem alguma dúvida antes de começar?", "Como funciona a busca nesse algoritmo?"];
function conversa(tempos = [5000, 5100, 4900, 5000, 5000, 5100], eco = false): FalaDaConversa[] {
  return perguntas.flatMap((text, i) => [{ t: i * 30_000, role: "agent" as const, text }, { t: i * 30_000 + 10_000, role: "candidate" as const, text: eco ? `Então você quer saber ${text} Vou explicar minha ideia.` : "Vou explicar minha ideia com um exemplo.", latenciaMs: tempos[i] }]);
}
const codigo = Array.from({ length: 10 }, (_, i) => `const resultado_${i} = buscarValor(${i});`).join("\n");
const falas = [1000, 10_000, 400_000].map((t) => ({ t, role: "candidate" as const, text: "Vou explicar a ideia." }));

describe("sinais determinísticos da conversa", () => {
  it("normaliza eco e exige repetição em várias respostas", () => {
    assert.equal(ecoDaPergunta("Como você escalaria o banco de dados?", "Então você quer saber como eu escalaria o banco de dados. Usaria réplicas."), true);
    assert.equal(ecoDaPergunta("Tudo bem?", "Tudo bem."), false);
    assert.equal(ecoDaPergunta("Como você escalaria o banco de dados?", "Usaria réplicas com cache. Voltando à pergunta: como você escalaria o banco de dados?"), false);
    assert.equal(sinaisDaConversa(conversa().slice(0, 2)).sinais.length, 0);
    assert.equal(sinaisDaConversa(conversa(undefined, true).slice(0, 4)).sinais.length, 0);
    assert.equal(sinaisDaConversa(conversa(undefined, true)).sinais.filter((s) => s.tipo === "eco_da_pergunta").length, 6);
  });
  it("registra tempo plano de 5 s com amostras das duas categorias", () => {
    const r = sinaisDaConversa(conversa());
    assert.equal(r.sinais[0].tipo, "tempo_plano");
    assert.deepEqual(r.temposDeResposta.map((d) => d.quantidade), [3, 3]);
    assert.equal(sinaisDaConversa(conversa().slice(0, 10)).sinais.length, 0);
  });
  it("caso honesto varia entre confirmação e pergunta técnica, sem sinal", () => {
    assert.deepEqual(sinaisDaConversa(conversa([300, 8000, 500, 5000, 800, 10_000])).sinais, []);
    assert.deepEqual(sinaisDaConversa(conversa([200, 250, 300, 200, 300, 250])).sinais, []);
  });
  it("não usa pedido de tempo, latência ausente ou inválida, nem continuação", () => {
    for (const latenciaMs of [undefined, -1, NaN, Infinity]) assert.deepEqual(sinaisDaConversa(conversa().map((f) => f.role === "candidate" ? { ...f, latenciaMs } : f)).sinais, []);
    const lista = conversa();
    lista[1].text = "Calma, tô pensando";
    lista.splice(2, 0, { ...lista[1], t: 20_000, text: "Minha solução é uma fila", latenciaMs: 5000 });
    assert.equal(sinaisDaConversa(lista).sinais.length, 0);
  });
  it("bloco grande exige fala no restante e silêncio comprovado em toda a janela", () => {
    const fotos = [{ t: 180_000, code: "" }, { t: 190_000, code: codigo }];
    assert.equal(blocoSemFala(fotos, falas).length, 1);
    assert.equal(blocoSemFala(fotos, []).length, 0);
    assert.equal(blocoSemFala(fotos, [...falas, { ...falas[0], t: 100_000 }]).length, 0);
    assert.equal(blocoSemFala([{ t: 190_000, code: codigo }], falas).length, 0);
    assert.equal(blocoSemFala([{ t: 180_000, code: codigo }, { t: 190_000, code: `\n${codigo}` }], falas).length, 0);
    assert.equal(blocoSemFala(fotos, falas, "", [185_000]).length, 0, "colagem do próprio editor não é código de fora");
    assert.equal(blocoSemFala([{ ...fotos[0], language: "python" }, { ...fotos[1], language: "javascript" }], falas).length, 0, "troca de linguagem não é entrada de bloco");
  });
  it("liga à IDE e ao quadro, com destaque só por convergência e contrato persistível", () => {
    const eventos = conversa(undefined, true).map((f) => ({ ...f, type: "speech" as const, sessionId: "teste" }));
    eventos.forEach((e) => assert.equal(SessionEvent.safeParse(e).success, true));
    const ide = integridadeDaIde("teste", eventos)!;
    assert.equal(ide.destaques.length, 1);
    assert.equal(integridadeDaIde("teste", conversa().map((f) => ({ ...f, type: "speech" as const, sessionId: "teste" })))!.destaques.length, 0);
    const inicio = Date.parse("2026-11-19T12:00:00Z");
    const quadro = integridadeDoQuadro("teste", eventos.map((e) => ({ tipo: "fala", horario: new Date(inicio + e.t).toISOString(), dados: { quem: e.role === "agent" ? "agente" : "candidato", texto: e.text, latenciaMs: e.latenciaMs } })), inicio)!;
    assert.deepEqual(quadro, ide);
    assert.equal(Gravacao.safeParse({ sessionId: "teste", durationMs: 200_000, codigo: [], falas: [], execucoes: [], marcos: [], integridade: ide }).success, true);
  });
  it("preserva latência nas duas gravações e rejeita valores inválidos no contrato", () => {
    const s = getOrCreateSession("gravacao-latencia-124");
    const evento = { type: "speech" as const, sessionId: s.sessionId, t: 8000, role: "candidate" as const, text: "Sim, pode seguir", latenciaMs: 5000 };
    appendEvent(s, evento);
    assert.equal(Gravacao.parse(gravacaoDaSessao(s)).falas[0].latenciaMs, 5000);
    for (const latenciaMs of [-1, NaN, Infinity]) assert.equal(SessionEvent.safeParse({ ...evento, latenciaMs }).success, false);
    const gravada = gravacaoDoQuadro([
      { recebidoEm: 8000, tipo: "resposta", horario: new Date(8000).toISOString(), dados: { texto: evento.text } },
      { recebidoEm: 9000, tipo: "fala", horario: new Date(9000).toISOString(), dados: { quem: "candidato", texto: evento.text, latenciaMs: 5000 } },
    ], [], 0);
    assert.equal(gravada.falas.length, 1);
    assert.equal(gravada.falas[0].latenciaMs, 5000);
  });
  it("consolida fala e resposta duplicadas do quadro sem duplicar amostras", () => {
    const inicio = Date.parse("2026-11-19T12:00:00Z");
    const eventos = conversa().flatMap((f) => {
      const fala = { tipo: "fala", horario: new Date(inicio + f.t).toISOString(), dados: { quem: f.role === "agent" ? "agente" : "candidato", texto: f.text, latenciaMs: f.latenciaMs } };
      return f.role === "agent" ? [fala] : [{ ...fala, tipo: "resposta", dados: { ...fala.dados, latenciaMs: undefined } }, fala];
    });
    const bloco = integridadeDoQuadro("teste", eventos, inicio)!;
    assert.deepEqual(bloco.temposDeResposta?.map((d) => d.quantidade), [3, 3]);
    assert.equal(bloco.sinais[0].tipo, "tempo_plano");
  });
});
