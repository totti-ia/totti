import assert from "node:assert/strict";
import test from "node:test";
import { atualizadaEmDe, compararVagas, type VagaEmpresa } from "@/lib/vagas/workspace";

const DIA = 86_400_000;
const agora = Date.UTC(2026, 10, 14);
const vaga = (cargo: string, extra: Partial<VagaEmpresa>) =>
  ({ cargo, abertaHaDias: 0, funil: { inscritos: 0, convidados: 0, emAndamento: 0, concluiram: 0, novos: 0 }, ...extra }) as VagaEmpresa;

test("sem atualizadaEm, vale agora menos os dias de aberta", () => {
  assert.equal(atualizadaEmDe({ abertaHaDias: 3 }, agora), agora - 3 * DIA);
  assert.equal(atualizadaEmDe({ abertaHaDias: 3, atualizadaEm: 5 }, agora), 5);
});

test("mais recentes: quem mexeu por último vem primeiro", () => {
  const a = vaga("A", { atualizadaEm: agora - 5 * DIA });
  const b = vaga("B", { atualizadaEm: agora - 1000 });
  const c = vaga("C", { atualizadaEm: agora - 2 * DIA });
  assert.deepEqual([a, b, c].sort(compararVagas("recentes", agora)).map((v) => v.cargo), ["B", "C", "A"]);
});

test("mais recentes: vagas reais antes das de exemplo, mesmo que a de exemplo seja mais nova", () => {
  const real = vaga("Real", { atualizadaEm: agora - 30 * DIA });
  const exemplo = vaga("Exemplo", { mockada: true, abertaHaDias: 0 });
  assert.deepEqual([exemplo, real].sort(compararVagas("recentes", agora)).map((v) => v.cargo), ["Real", "Exemplo"]);
});

test("vaga de exemplo sem registro usa os dias de aberta", () => {
  const velha = vaga("Velha", { mockada: true, abertaHaDias: 40 });
  const nova = vaga("Nova", { mockada: true, abertaHaDias: 2 });
  assert.deepEqual([velha, nova].sort(compararVagas("recentes", agora)).map((v) => v.cargo), ["Nova", "Velha"]);
});
