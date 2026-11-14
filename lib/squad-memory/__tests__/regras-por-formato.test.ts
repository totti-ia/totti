// Issue #131, item 4: regra de OUTRA vaga só entra se for do mesmo formato e de um critério da rubrica da vaga.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import { comRegrasDaSquad, regrasParaOsCriterios } from "../config";
import { regraAfeta } from "../criterios";
import { blocoDasRegras } from "../prompt";
import { adicionarRegra, limparMemoria } from "../store";
import type { NovaRegra } from "../tipos";

const EMPRESA = "empresa-formato";
beforeEach(() => limparMemoria());

const regra = (texto: string, criterio: string, vagaId: string): NovaRegra => ({
  empresaId: EMPRESA, texto, efeito: "valoriza", criterio, origem: { tipo: "ajuste_plano", vagaId },
});

test("regra aprendida num live coding não pesa num system design, mesmo com critério parecido", () => {
  adicionarRegra(regra("Valoriza quem pergunta sobre observabilidade antes de codar", "abordagem", "vaga-lc"));
  adicionarRegra(regra("Penaliza Kafka para volume baixo", "tradeoffs", "vaga-sd-antiga"));
  const regras = regrasParaOsCriterios("vaga-sd", ["requisitos", "tradeoffs", "abordagem", "escalabilidade"], EMPRESA, { modo: "system_design" });
  assert.deepEqual(regras.map((r) => r.text), ["Penaliza Kafka para volume baixo"]);
});

test("o formato da vaga de origem, quando se sabe, vale mais que o critério", () => {
  adicionarRegra(regra("Valoriza quem comunica o plano", "comunicacao", "vaga-lc"));
  adicionarRegra(regra("Valoriza quem comunica o desenho", "comunicacao", "vaga-sd-antiga"));
  const modoDaVaga = (id: string) => (id === "vaga-lc" ? "live_coding" as const : "system_design" as const);
  const sd = regrasParaOsCriterios("vaga-sd", ["comunicacao"], EMPRESA, { modo: "system_design", modoDaVaga });
  assert.deepEqual(sd.map((r) => r.text), ["Valoriza quem comunica o desenho"]);
  // Sem saber o formato da origem e com critério que existe nos dois formatos: fica de fora.
  const semResolver = regrasParaOsCriterios("vaga-sd", ["comunicacao"], EMPRESA, { modo: "system_design" });
  assert.equal(semResolver.length, 0);
});

test("a regra da própria vaga entra sempre e vem marcada; as da empresa também, com a origem 'empresa'", () => {
  adicionarRegra(regra("Penaliza cache sem invalidação", "estimativa", "vaga-sd"));
  adicionarRegra(regra("Valoriza trade-offs explícitos", "tradeoffs", "vaga-sd-antiga"));
  const regras = regrasParaOsCriterios("vaga-sd", ["escalabilidade", "tradeoffs"], EMPRESA, { modo: "system_design" });
  const porTexto = Object.fromEntries(regras.map((r) => [r.text, r.origin]));
  assert.equal(porTexto["Penaliza cache sem invalidação"], "vaga");
  assert.equal(porTexto["Valoriza trade-offs explícitos"], "empresa");
  assert.ok(blocoDasRegras(regras, "observar").includes("de outra vaga da empresa"));
});

test("comRegrasDaSquad usa o formato da config e o nome do critério da vaga", () => {
  adicionarRegra(regra("Valoriza código com testes", "corretude", "vaga-lc"));
  adicionarRegra(regra("Valoriza quem estima a escala", "estimativa", "vaga-sd-antiga"));
  const sd = comRegrasDaSquad({ ...DEFAULT_CONFIG, id: "vaga-sd", mode: "system_design",
    criteria: [{ id: "estimativa", name: "Estimativa de escala", description: "x", weight: 1, focus: DEFAULT_CONFIG.criteria[0].focus }] }, EMPRESA);
  assert.deepEqual(sd.squadRules?.map((r) => r.text), ["Valoriza quem estima a escala"]);
  assert.equal((sd.squadRules?.[0] as { origin?: string }).origin, "empresa");
});

test("a regra também casa com a rubrica da vaga pelo NOME do critério do plano", () => {
  assert.ok(regraAfeta({ criterio: "tradeoffs" }, "Trade-offs"));
  assert.ok(regraAfeta({ criterio: "requisitos" }, "requisitos e escopo"));
  assert.ok(!regraAfeta({ criterio: "tradeoffs" }, "Comunicação"));
});
