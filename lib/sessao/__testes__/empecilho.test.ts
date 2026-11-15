import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concluiuHaPouco, contarComponentes, emGarantiaDoEmpecilho, esperaDoEmpecilho, esperaDoEmpecilhoForcado, relaxaPreChecagens, REGRAS_EMPECILHO, type SituacaoEmpecilho } from "../empecilho";

const base: SituacaoEmpecilho = {
  agora: 1_000_000,
  fase: "ALTO_NIVEL",
  faseIniciadaEm: 1_000_000 - 300_000,
  duracaoDaFaseS: 600,
  jaAnunciado: false,
  respondendoPergunta: false,
  componentes: 4,
  ultimaFalaDoAgenteEm: null,
};

describe("hora do empecilho no quadro", () => {
  it("meio da visão geral, com desenho e em silêncio: pode", () => {
    assert.equal(esperaDoEmpecilho(base), null);
  });

  it("espera o começo da fase, o desenho, o respiro e a resposta do candidato", () => {
    assert.equal(esperaDoEmpecilho({ ...base, faseIniciadaEm: base.agora - 60_000 }), "cedo");
    assert.equal(esperaDoEmpecilho({ ...base, componentes: 2 }), "pouco desenho para adaptar");
    assert.equal(esperaDoEmpecilho({ ...base, ultimaFalaDoAgenteEm: base.agora - 5_000 }), "respiro depois da última fala");
    assert.equal(esperaDoEmpecilho({ ...base, respondendoPergunta: true }), "candidato respondendo uma pergunta");
    assert.equal(esperaDoEmpecilho({ ...base, jaAnunciado: true }), "já anunciado");
  });

  it("nem no começo nem no fim da entrevista", () => {
    for (const fase of ["APRESENTACAO", "REQUISITOS", "FECHAMENTO", "ENCERRADA"]) {
      assert.equal(esperaDoEmpecilho({ ...base, fase }), "fora do meio da entrevista");
    }
  });

  it("no aprofundamento, só com tempo para adaptar", () => {
    const aprof = { ...base, fase: "APROFUNDAMENTO", duracaoDaFaseS: 900 };
    assert.equal(esperaDoEmpecilho({ ...aprof, faseIniciadaEm: base.agora - 200_000 }), null);
    assert.equal(esperaDoEmpecilho({ ...aprof, faseIniciadaEm: base.agora - 700_000 }), "pouco tempo para adaptar");
  });

  it("forçado ignora a hora, mas não repete nem sai fora da entrevista", () => {
    assert.equal(esperaDoEmpecilhoForcado({ fase: "REQUISITOS", jaAnunciado: false }), null);
    assert.equal(esperaDoEmpecilhoForcado({ fase: "ALTO_NIVEL", jaAnunciado: true }), "já anunciado");
    assert.equal(esperaDoEmpecilhoForcado({ fase: "APRESENTACAO", jaAnunciado: false }), "entrevista fora de andamento");
  });

  it("conta as peças do desenho, sem setas nem molduras", () => {
    assert.equal(contarComponentes("COMPONENTES\n- [r1] A (retângulo)\n- [e1] B (elipse)\n- [t1] nota\nCONEXÕES\n- [s1] A → B\nSEÇÕES\n- [m1] Grupo"), 3);
    assert.equal(contarComponentes(""), 0);
  });
});

describe("piso entre perguntas do quadro (#129, decisão G)", () => {
  it("#140: o piso de 45 s entre perguntas continua valendo", () => {
    assert.equal(esperaDoEmpecilho({ ...base, ultimaPerguntaEm: base.agora - 30_000 }), "piso entre perguntas");
    assert.equal(esperaDoEmpecilho({ ...base, ultimaPerguntaEm: base.agora - 46_000 }), null);
  });

  it("sem pergunta registrada (ou campo ausente), o piso não se aplica", () => {
    assert.equal(esperaDoEmpecilho({ ...base, ultimaPerguntaEm: null }), null);
    assert.equal(esperaDoEmpecilho(base), null);
  });

  it("vale também na garantia dos 60%", () => {
    const na_garantia = { ...base, ...emEntrevistaAos(0.7), ultimaPerguntaEm: base.agora - 30_000 };
    assert.equal(esperaDoEmpecilho(na_garantia), "piso entre perguntas");
  });
});

/** A entrevista de 2200 s (o total do kit sem plano) começada `fracao` do tempo atrás. */
const TOTAL_S = 2200;
const emEntrevistaAos = (fracao: number) => ({ iniciadaEm: base.agora - fracao * TOTAL_S * 1000, duracaoTotalS: TOTAL_S });

describe("garantia dos 60% do tempo total (#129, decisão G)", () => {
  it("a garantia começa na fração da entrevista, não antes", () => {
    assert.equal(emGarantiaDoEmpecilho({ agora: base.agora, ...emEntrevistaAos(0.59) }), false);
    assert.equal(emGarantiaDoEmpecilho({ agora: base.agora, ...emEntrevistaAos(0.6) }), true);
    assert.equal(REGRAS_EMPECILHO.GARANTIA_A_PARTIR_DA_FRACAO, 0.6);
    assert.equal(emGarantiaDoEmpecilho({ agora: base.agora, iniciadaEm: null, duracaoTotalS: TOTAL_S }), false, "sem início não há garantia");
  });

  it("passada a garantia, relaxa a fração da fase e o mínimo de peças (mantém pelo menos uma)", () => {
    const cedo = { ...base, faseIniciadaEm: base.agora - 10_000 };
    assert.equal(esperaDoEmpecilho(cedo), "cedo", "sem garantia, ainda é cedo");
    assert.equal(esperaDoEmpecilho({ ...cedo, ...emEntrevistaAos(0.6) }), null, "com garantia, sai");
    assert.equal(esperaDoEmpecilho({ ...base, ...emEntrevistaAos(0.6), componentes: 1 }), null);
    assert.equal(esperaDoEmpecilho({ ...base, ...emEntrevistaAos(0.6), componentes: 0 }), "sem desenho para adaptar");
  });

  it("passada a garantia, o aprofundamento não espera o tempo para adaptar", () => {
    const aprof = { ...base, fase: "APROFUNDAMENTO", duracaoDaFaseS: 900, faseIniciadaEm: base.agora - 800_000 };
    assert.equal(esperaDoEmpecilho(aprof), "pouco tempo para adaptar");
    assert.equal(esperaDoEmpecilho({ ...aprof, ...emEntrevistaAos(0.7) }), null);
  });

  it("não relaxa o respiro, a pergunta ativa, a fase nem o já anunciado", () => {
    const g = emEntrevistaAos(0.7);
    assert.equal(esperaDoEmpecilho({ ...base, ...g, ultimaFalaDoAgenteEm: base.agora - 5_000 }), "respiro depois da última fala");
    assert.equal(esperaDoEmpecilho({ ...base, ...g, respondendoPergunta: true }), "candidato respondendo uma pergunta");
    assert.equal(esperaDoEmpecilho({ ...base, ...g, fase: "FECHAMENTO" }), "fora do meio da entrevista");
    assert.equal(esperaDoEmpecilho({ ...base, ...g, jaAnunciado: true }), "já anunciado");
  });

  it("sem os campos novos, as regras de antes valem como estavam", () => {
    assert.equal(esperaDoEmpecilho({ ...base, faseIniciadaEm: base.agora - 10_000 }), "cedo");
    assert.equal(esperaDoEmpecilho({ ...base, componentes: 2 }), "pouco desenho para adaptar");
  });
});

describe("conclusão recente como brecha para a mudança (#129, decisão F)", () => {
  it("'terminei' há pouco relaxa como a garantia: sai sem a fração da fase nem o mínimo de peças", () => {
    assert.equal(esperaDoEmpecilho({ ...base, faseIniciadaEm: base.agora - 10_000 }), "cedo");
    assert.equal(esperaDoEmpecilho({ ...base, faseIniciadaEm: base.agora - 10_000, conclusaoRecente: true }), null);
    assert.equal(esperaDoEmpecilho({ ...base, componentes: 1, conclusaoRecente: true }), null);
    assert.equal(esperaDoEmpecilho({ ...base, componentes: 0, conclusaoRecente: true }), "sem desenho para adaptar");
  });

  it("o piso entre perguntas continua valendo, e o respiro e a pergunta ativa também", () => {
    const c = { ...base, conclusaoRecente: true };
    assert.equal(esperaDoEmpecilho({ ...c, ultimaPerguntaEm: base.agora - 30_000 }), "piso entre perguntas");
    assert.equal(esperaDoEmpecilho({ ...c, ultimaFalaDoAgenteEm: base.agora - 5_000 }), "respiro depois da última fala");
    assert.equal(esperaDoEmpecilho({ ...c, respondendoPergunta: true }), "candidato respondendo uma pergunta");
  });

  it("relaxaPreChecagens: garantia ou conclusão recente relaxam; nenhuma das duas é a regra de antes", () => {
    assert.equal(relaxaPreChecagens({ garantia: true, ultimaConclusaoEm: null, agora: base.agora }), true, "garantia");
    assert.equal(relaxaPreChecagens({ garantia: false, ultimaConclusaoEm: base.agora - 10_000, agora: base.agora }), true, "conclusão recente");
    assert.equal(relaxaPreChecagens({ garantia: false, ultimaConclusaoEm: base.agora - 120_000, agora: base.agora }), false, "conclusão antiga");
    assert.equal(relaxaPreChecagens({ garantia: false, agora: base.agora }), false, "sem conclusão");
  });

  it("concluiuHaPouco: dentro do marco de conclusão, e nunca sem conclusão", () => {
    assert.equal(concluiuHaPouco(base.agora - 10_000, base.agora), true);
    assert.equal(concluiuHaPouco(base.agora - 120_000, base.agora), false);
    assert.equal(concluiuHaPouco(null, base.agora), false);
    assert.equal(concluiuHaPouco(undefined, base.agora), false);
  });
});
