// Issue #131 (frente B): travas objetivas do avaliador do live coding. Sem LLM: só funções puras.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  afirmaOQueOsFatosDesmentem,
  comCorretude,
  descartarAfirmacoesSemFato,
  limparTextosDoRelatorio,
  recomendacaoDe,
  type FatosDaSessao,
} from "../evaluator";
import { buildEvaluatorSystem } from "../prompts/evaluator";
import { getProblem } from "@/problems";
import { DEFAULT_CONFIG } from "../../config/default";

const rodou: FatosDaSessao = { rodou: true, primeiraFalaDoEntrevistador: 60_000 };
const naoRodou: FatosDaSessao = { rodou: false, primeiraFalaDoEntrevistador: 60_000 };
const semPergunta: FatosDaSessao = { rodou: true, primeiraFalaDoEntrevistador: null };

describe("recomendação com trava objetiva", () => {
  it("0 testes aprovados é nao_avancar, mesmo com média 3,3", () => {
    assert.equal(recomendacaoDe(3.3, { passed: 0, total: 5 }), "nao_avancar");
  });
  it("abaixo de 50% limita a talvez", () => {
    assert.equal(recomendacaoDe(3.8, { passed: 2, total: 5 }), "talvez");
  });
  it("50% ou mais não limita", () => {
    assert.equal(recomendacaoDe(3.2, { passed: 3, total: 6 }), "avancar");
  });
  it("a trava não melhora a nota: média baixa continua nao_avancar", () => {
    assert.equal(recomendacaoDe(1.5, { passed: 2, total: 5 }), "nao_avancar");
    assert.equal(recomendacaoDe(2.4, { passed: 2, total: 5 }), "talvez");
  });
  it("sem testes (total 0) vale só a média", () => {
    assert.equal(recomendacaoDe(3.5, { passed: 0, total: 0 }), "avancar");
    assert.equal(recomendacaoDe(2.5, { passed: 0, total: 0 }), "talvez");
  });
});

describe("corretude sempre entra", () => {
  it("acrescenta corretude quando a config não tem", () => {
    const sem = DEFAULT_CONFIG.criteria.filter((c) => c.id !== "corretude");
    const r = comCorretude(sem);
    assert.equal(r.length, sem.length + 1);
    assert.equal(r.at(-1)?.id, "corretude");
  });
  it("não duplica quando já existe", () => {
    assert.equal(comCorretude(DEFAULT_CONFIG.criteria).length, DEFAULT_CONFIG.criteria.length);
  });
});

describe("guarda: 'não rodou' com execução", () => {
  it("detecta as variações", () => {
    for (const t of ["Não rodou o código.", "Nunca rodou os testes", "Ficou sem rodar nada", "não executou a solução", "Nao rodou"]) {
      assert.equal(afirmaOQueOsFatosDesmentem(t, rodou), true, t);
    }
  });
  it("sem execução, o texto vale", () => {
    assert.equal(afirmaOQueOsFatosDesmentem("Nunca rodou o código.", naoRodou), false);
  });
  it("evidência 'não rodou' é descartada e a nota vira nula se era a única", () => {
    const r = descartarAfirmacoesSemFato(
      { score: 1, evidence: [{ at: "05:00", text: "Não rodou o código antes de entregar." }] },
      rodou,
      new Map([["05:00", 300_000]]),
    );
    assert.equal(r.score, null);
    assert.equal(r.semProva, true);
  });
  it("com outra evidência válida, a nota fica", () => {
    const r = descartarAfirmacoesSemFato(
      { score: 2, evidence: [{ at: "05:00", text: "Nunca rodou." }, { at: "06:00", text: "Explicou o loop." }] },
      rodou,
      new Map([["05:00", 300_000], ["06:00", 360_000]]),
    );
    assert.equal(r.score, 2);
    assert.deepEqual(r.evidence.map((e) => e.at), ["06:00"]);
  });
  it("justificativas (resumo, pontos fortes, preocupações) também perdem a afirmação falsa", () => {
    const r = limparTextosDoRelatorio(
      {
        summary: "Resolveu o problema. Não rodou o código. Explicou bem o custo.",
        strengths: ["Código limpo."],
        concerns: ["Nunca rodou os testes.", "Colou código grande."],
        nextSteps: [],
      },
      null,
      rodou,
    );
    assert.equal(r.summary, "Resolveu o problema. Explicou bem o custo.");
    assert.deepEqual(r.concerns, ["Colou código grande."]);
  });
});

describe("guarda: 'quando perguntado' precisa de pergunta antes", () => {
  it("sem nenhuma fala do entrevistador, a evidência cai", () => {
    const r = descartarAfirmacoesSemFato(
      { score: 4, evidence: [{ at: "02:00", text: "Explicou a string vazia quando perguntado." }] },
      semPergunta,
      new Map([["02:00", 120_000]]),
    );
    assert.equal(r.score, null);
    assert.deepEqual(r.evidence, []);
  });
  it("pergunta só depois da evidência também não vale", () => {
    assert.equal(afirmaOQueOsFatosDesmentem("Respondeu ao ser perguntado.", rodou, 30_000), true);
  });
  it("pergunta antes da evidência vale", () => {
    assert.equal(afirmaOQueOsFatosDesmentem("Respondeu quando perguntado sobre memória.", rodou, 120_000), false);
  });
});

describe("prompt do avaliador", () => {
  it("manda tratar os sinais como fato e exige pergunta antes de 'quando perguntado'", () => {
    const system = buildEvaluatorSystem(DEFAULT_CONFIG, getProblem(DEFAULT_CONFIG.problemId), ["complexidade"]);
    assert.match(system, /FATOS medidos pelo sistema/);
    assert.match(system, /Nunca os contradiga/);
    assert.match(system, /só valem se o entrevistador fez a pergunta ANTES/);
  });
});
