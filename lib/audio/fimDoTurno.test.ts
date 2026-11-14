import assert from "node:assert/strict";
import { it } from "node:test";
import { criarFimDoTurno, faixaDaEnergia, type FimDoTurno } from "./fimDoTurno";

const BLOCO_MS = 100;

// Alimenta `ms` de blocos de 100 ms com a mesma energia; devolve true se algum bloco fechou o turno.
function alimentar(d: FimDoTurno, energia: number, ms: number): boolean {
  return padrao(d, [energia], ms);
}

// Alimenta blocos de 100 ms repetindo a sequência de energias; devolve true se algum bloco fechou.
function padrao(d: FimDoTurno, sequencia: readonly number[], ms: number): boolean {
  let fechou = false;
  for (let t = 0, i = 0; t < ms; t += BLOCO_MS, i++) {
    if (d.medir(sequencia[i % sequencia.length], BLOCO_MS).fechou) fechou = true;
  }
  return fechou;
}

// Fala realista: 500 ms de voz alta com uma pausa de 100 ms entre sílabas/frases.
const FALA = [0.05, 0.05, 0.05, 0.05, 0.05, 0.002];
// Fala baixa realista: mesma pausa, mas a voz fica em 0,006.
const FALA_BAIXA = [0.006, 0.006, 0.006, 0.006, 0.006, 0.002];
const SILENCIO = 0.001;

it("sem voz alta nunca fecha, mesmo com 20 s de silêncio", () => {
  const d = criarFimDoTurno();
  assert.equal(alimentar(d, SILENCIO, 20000), false);
});

it("fala realista e depois silêncio: não fecha antes de 3,5 s e fecha ao completar 3,5 s", () => {
  const d = criarFimDoTurno();
  padrao(d, FALA, 3000);
  // A pausa final da fala já conta como silêncio; por isso são 3,4 s aqui (3,5 s desde o fim da voz).
  assert.equal(alimentar(d, SILENCIO, 3300), false);
  assert.equal(alimentar(d, SILENCIO, 100), true);
});

it("fala baixa realista em ambiente silencioso: não fecha aos 3,5 s e fecha aos 8 s", () => {
  const d = criarFimDoTurno();
  padrao(d, FALA, 1000);
  assert.equal(padrao(d, FALA_BAIXA, 3500), false);
  assert.equal(padrao(d, FALA_BAIXA, 4400), false);
  assert.equal(padrao(d, FALA_BAIXA, 100), true);
});

it("fala baixa sem marcarFala nunca fecha, mesmo com 10 s de silêncio depois", () => {
  const d = criarFimDoTurno();
  padrao(d, FALA_BAIXA, 1000);
  assert.equal(alimentar(d, SILENCIO, 10000), false);
});

it("fala baixa com marcarFala fecha aos 3,5 s de silêncio", () => {
  const d = criarFimDoTurno();
  padrao(d, FALA_BAIXA, 1000);
  d.marcarFala();
  assert.equal(alimentar(d, SILENCIO, 3400), false);
  assert.equal(alimentar(d, SILENCIO, 100), true);
});

it("trecho atrasado depois do fechamento recomeça a contagem: não fecha de novo antes de 3,5 s", () => {
  const d = criarFimDoTurno();
  padrao(d, FALA, 1000);
  assert.equal(alimentar(d, SILENCIO, 3500), true);
  // Trecho atrasado chega com o silêncio já em 3,5 s: a contagem vale a partir daqui.
  d.marcarFala();
  assert.equal(alimentar(d, SILENCIO, 3400), false);
  assert.equal(alimentar(d, SILENCIO, 100), true);
});

it("fala baixa com marcarFala fecha aos 8 s sem voz alta", () => {
  const d = criarFimDoTurno();
  padrao(d, FALA_BAIXA, 1000);
  d.marcarFala();
  assert.equal(padrao(d, FALA_BAIXA, 6900), false);
  assert.equal(padrao(d, FALA_BAIXA, 100), true);
});

it("fala realista contínua por 30 s nunca fecha", () => {
  const d = criarFimDoTurno();
  assert.equal(padrao(d, FALA, 30000), false);
});

it("voz alta no meio da fala baixa zera a contagem dos 8 s", () => {
  const d = criarFimDoTurno();
  padrao(d, FALA, 1000);
  assert.equal(padrao(d, FALA_BAIXA, 6000), false);
  assert.equal(padrao(d, FALA, 600), false);
  assert.equal(padrao(d, FALA_BAIXA, 7400), false);
  assert.equal(padrao(d, FALA_BAIXA, 600), true);
});

it("fecha uma única vez; nova voz alta rearma e pode fechar de novo", () => {
  const d = criarFimDoTurno();
  padrao(d, FALA, 1000);
  assert.equal(alimentar(d, SILENCIO, 3500), true);
  assert.equal(alimentar(d, SILENCIO, 5000), false);
  padrao(d, FALA, 1000);
  assert.equal(alimentar(d, SILENCIO, 3500), true);
});

it("ambiente barulhento: 10 s de ruído 0,015 dão piso entre 0,01 e 0,015 e o ruído conta como silêncio", () => {
  const d = criarFimDoTurno();
  alimentar(d, 0.015, 10000);
  assert.ok(d.piso() >= 0.01 && d.piso() <= 0.015, `piso ${d.piso()}`);
  assert.equal(faixaDaEnergia(0.015, d.piso()), "silencio");
});

it("ambiente barulhento: depois da fala no ruído, ruído 0,015 fecha por silêncio em 3,4 s a 4,0 s", () => {
  const d = criarFimDoTurno();
  alimentar(d, 0.015, 10000);
  // Numa sala com ruído constante, as pausas da fala ficam no nível do ruído (0,015), não abaixo dele.
  const falaNoRuido = [0.06, 0.06, 0.06, 0.06, 0.06, 0.015];
  padrao(d, falaNoRuido, 3000);
  let decorrido = 0;
  let fechou = false;
  while (!fechou && decorrido < 15000) {
    fechou = alimentar(d, 0.015, BLOCO_MS);
    decorrido += BLOCO_MS;
  }
  assert.ok(fechou, "o turno deveria fechar");
  assert.ok(decorrido >= 3400 && decorrido <= 4000, `fechou em ${decorrido} ms`);
});

it("faixaDaEnergia respeita os mínimos absolutos com piso 0", () => {
  assert.equal(faixaDaEnergia(0.003, 0), "silencio");
  assert.equal(faixaDaEnergia(0.006, 0), "baixa");
  assert.equal(faixaDaEnergia(0.01, 0), "alta");
});

it("reiniciar() exige nova voz alta antes de fechar", () => {
  const d = criarFimDoTurno();
  padrao(d, FALA, 1000);
  d.reiniciar();
  assert.equal(alimentar(d, SILENCIO, 10000), false);
  padrao(d, FALA, 1000);
  assert.equal(alimentar(d, SILENCIO, 3500), true);
});

it("bloco com duração zero ou energia não finita é ignorado", () => {
  const d = criarFimDoTurno();
  assert.deepEqual(d.medir(0.05, 0), { faixa: "silencio", fechou: false });
  assert.deepEqual(d.medir(Number.NaN, BLOCO_MS), { faixa: "silencio", fechou: false });
  assert.equal(alimentar(d, SILENCIO, 10000), false);
});
