// Revisão da #123: os falsos positivos que pesariam contra o candidato honesto.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionEvent, type SessionEvent as Evento } from "@/lib/contracts";
import { enqueueCola } from "@/lib/agents/policy";
import { disparaAnalise } from "@/lib/agents/gatilhos";
import { appendEvent, getOrCreateSession } from "@/lib/session/store";
import { canarioApareceu, fraseDoCanario, nomeDoCanario, trechoDaFrase } from "../canario";
import { duracao, integridadeDaIde, integridadeDoQuadro } from "../montar";

const sessionId = "integridade-correcoes";
const foto = (t: number, code: string): Extract<Evento, { type: "snapshot" }> => ({ type: "snapshot", sessionId, t, code, version: t, language: "python" });
const cola = (origem: "editor" | "fora" | "enunciado", lines: number, t = 180_000): Extract<Evento, { type: "paste" }> => ({ type: "paste", sessionId, t, chars: lines * 30, lines, startLine: 1, origem });
const CODIGO = Array.from({ length: 12 }, (_, i) => `    valor_${i} = numeros[${i}] + 42`).join("\n");

describe("enunciado colado no editor", () => {
  const nome = nomeDoCanario(sessionId);
  const enunciado = "Dada uma lista de números e um alvo, devolva os índices dos dois números que somam o alvo.";
  const copiado = `${enunciado}\n\n${fraseDoCanario(nome)}`;

  it("a frase do canário é achada com as linhas em branco antes, para o editor tirar", () => {
    const trecho = trechoDaFrase(copiado, nome)!;
    assert.equal(copiado.slice(0, trecho.inicio), enunciado);
    assert.equal(copiado.slice(trecho.fim), "");
    assert.equal(trechoDaFrase(enunciado, nome), null);
  });

  it("a frase colada (se sobrar no código) não conta como canário; o nome usado numa variável conta", () => {
    assert.equal(canarioApareceu(nome, `# ${copiado.replace(/\n/g, "\n# ")}\ndef dois(n, alvo):\n    pass`), false);
    assert.equal(canarioApareceu(nome, `# ${enunciado}\ndef dois(n, alvo):\n    ${nome} = {}`), true);
  });

  it("origem enunciado não vira sinal, pergunta nem análise", () => {
    const evento = cola("enunciado", 6);
    assert.equal(SessionEvent.safeParse(evento).success, true);
    const s = getOrCreateSession("integridade-cola-enunciado");
    appendEvent(s, foto(0, "pass"));
    appendEvent(s, foto(180_000, CODIGO));
    assert.equal(enqueueCola(s, evento), false);
    assert.equal(disparaAnalise(evento, s), false);
    assert.deepEqual(integridadeDaIde(sessionId, [foto(0, "pass"), foto(180_000, CODIGO), evento]), { sinais: [], destaques: [] });
  });
});

describe("colagem pequena de fora", () => {
  it("uma ou duas linhas (sintaxe da documentação) não viram sinal; três viram", () => {
    for (const [linhas, vira] of [[1, false], [2, false], [3, true]] as const) {
      const bloco = integridadeDaIde(sessionId, [foto(0, "pass"), foto(180_000, CODIGO), cola("fora", linhas)])!;
      assert.equal(bloco.sinais.some((s) => s.tipo === "colagem_de_fora"), vira, `${linhas} linhas`);
    }
  });
});

describe("textos de evidência", () => {
  it("duração legível, sem minuto no texto (a tela mostra o momento ao lado)", () => {
    assert.equal(duracao(400), "1 s");
    assert.equal(duracao(40_000), "40 s");
    assert.equal(duracao(65_000), "1 min 5 s");
    assert.equal(duracao(180_000), "3 min");
  });

  it("o destaque diz quanto tempo depois de voltar a atividade veio, sem palavra de veredito", () => {
    const bloco = integridadeDaIde(sessionId, [
      foto(0, "pass"),
      { type: "foco", sessionId, t: 200_000, saidas: [{ t: 120_000, duracaoMs: 40_000, motivo: "janela" }] },
      foto(165_000, CODIGO),
      cola("fora", 12, 165_000),
    ])!;
    assert.equal(bloco.destaques.length, 1);
    assert.equal(bloco.destaques[0].texto, "Saiu da janela da entrevista por 40 s e, 5 s depois de voltar, colou 12 linhas que não vieram do próprio editor");
    for (const s of [...bloco.sinais.map((x) => x.texto), ...bloco.destaques.map((x) => x.texto)]) {
      assert.doesNotMatch(s, /provavelmente|suspeit|trapaç|fraude|%|usou IA/i, s);
    }
  });
});

describe("colagem de peças no quadro", () => {
  const inicio = Date.parse("2026-11-14T12:00:00Z");
  const em = (ms: number) => new Date(inicio + ms).toISOString();
  it("sozinha fica recolhida; logo depois de uma saída de foco vira destaque", () => {
    const fase = { horario: em(0), tipo: "fase", dados: { fase: "APRESENTACAO" } };
    const colagem = { horario: em(130_000), tipo: "colagem", dados: { pecas: 8 } };
    const sozinha = integridadeDoQuadro(sessionId, [fase, colagem], inicio)!;
    assert.equal(sozinha.sinais[0].texto, "Entraram 8 peças no quadro de uma só vez");
    assert.deepEqual(sozinha.destaques, []);
    const saida = { horario: em(140_000), tipo: "foco", dados: { saidas: [{ inicio: em(60_000), duracaoMs: 65_000, motivo: "aba" }] } };
    const junta = integridadeDoQuadro(sessionId, [fase, saida, colagem], inicio)!;
    assert.equal(junta.destaques.length, 1);
    assert.equal(junta.destaques[0].texto, "Saiu da aba da entrevista por 1 min 5 s e, 5 s depois de voltar, entraram 8 peças no quadro de uma só vez");
  });
});

it("duas saídas antes da mesma colagem viram um destaque só", () => {
  const eventos = [
    { type: "session_started", t: 0, sessionId: "s", configId: "c", problemId: "p", language: "python" },
    { type: "foco", t: 200_000, sessionId: "s", saidas: [{ t: 130_000, duracaoMs: 19_000, motivo: "janela" }, { t: 150_000, duracaoMs: 3_000, motivo: "janela" }] },
    { type: "paste", t: 154_000, sessionId: "s", chars: 60, lines: 3, startLine: 1, origem: "fora" },
  ] as unknown as Evento[];
  const bloco = integridadeDaIde("s", eventos)!;
  assert.equal(bloco.destaques.length, 1);
  assert.match(bloco.destaques[0].texto, /^Saiu da entrevista 2 vezes \(22 s no total\) e, logo ao voltar, colou 3 linhas/);
  assert.equal(bloco.destaques[0].sinais.length, 3);
});

it("colagem pequena só vira sinal logo depois de sair da janela", () => {
  const base = [
    { type: "session_started", t: 0, sessionId: "s", configId: "c", problemId: "p", language: "python" },
    { type: "foco", t: 200_000, sessionId: "s", saidas: [{ t: 44_000, duracaoMs: 45_000, motivo: "janela" }] },
  ];
  const colar = (t: number) => ({ type: "paste", t, sessionId: "s", chars: 33, lines: 2, startLine: 4, origem: "fora" });
  const logo = integridadeDaIde("s", [...base, colar(92_000)] as unknown as Evento[])!;
  assert.equal(logo.destaques.length, 1);
  assert.match(logo.destaques[0].texto, /colou 2 linhas que não vieram do próprio editor/);
  const longe = integridadeDaIde("s", [...base, colar(180_000)] as unknown as Evento[])!;
  assert.equal(longe.sinais.filter((s) => s.tipo === "colagem_de_fora").length, 0);
});
