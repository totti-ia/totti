import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessaoAberta } from "./apoio";
import { salvarRevisao } from "../sessoes";
import { montarMensagens, aplicarPatch } from "../extrator";
import { reaplicarFixados } from "../fixados";
import { paraInterviewConfig } from "../rascunho";
import { buildInterviewerSystem } from "@/lib/agents/prompts/interviewer";
import { buildEvaluatorSystem } from "@/lib/agents/prompts/evaluator";
import { getProblem } from "@/problems";

describe("regra de IA escolhida no plano", () => {
  it("preserva edição manual concorrente, publica a regra e mantém os prompts iguais", () => {
    const sessao = sessaoAberta();
    const antes = sessao.rascunho;
    salvarRevisao(sessao, { ...antes, regraDeIa: "permitida" }, antes);
    assert.equal(sessao.rascunho.regraDeIa, "permitida");
    assert.ok(sessao.rascunho.fixados.includes("regraDeIa"));
    const depois = reaplicarFixados(sessao.rascunho, aplicarPatch(antes, { durationMin: 40 }));
    assert.equal(depois.regraDeIa, "permitida");
    assert.deepEqual(montarMensagens(sessao.rascunho, []), montarMensagens(antes, []));
    const publicado = paraInterviewConfig(sessao.rascunho);
    assert.ok(publicado.ok);
    assert.equal(publicado.config.regraDeIa, "permitida");
    const config = publicado.config;
    const semRegra = { ...config, regraDeIa: undefined };
    const problema = getProblem(config.problemId);
    assert.equal(buildInterviewerSystem(config, problema), buildInterviewerSystem(semRegra, problema));
    assert.equal(buildEvaluatorSystem(config, problema, []), buildEvaluatorSystem(semRegra, problema, []));
  });
});
