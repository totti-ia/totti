import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SILENCIO_INICIAL_S, SILENCIO_REQUISITOS_S, SILENCIO_SEM_ACAO_S } from "../../../contracts";
import { intervaloMinimoMs, orcamentoDeInterrupcoes, RITMO, RITMO_QUADRO } from "../../../interrupcao/politica";
import type { PlanoDaSessao } from "../../plano";
import { estadoInicial, transicionar, type EstadoSessao } from "../estado";
import {
  perguntaObrigatoria,
  tetoDaPergunta,
  precisaAbrirBrechaDaMudanca,
  conclusaoBarradaRecente,
  desenhoNovoDesdePergunta,
  extrairIdsDoGrafo,
  filtrarResposta,
  motivoBloqueio,
  motivoDoConteudo,
  falaQueContaParaABola,
  motivoBloqueioPlin,
  parametrosDoFechamentoNoQuadro,
  pedidoDeTempoPendente,
  podeAnalisar,
  podeLevantarPlin,
  podeOferecerEncerrar,
  REGRAS_PADRAO,
  aplicarRegraDoEscopo,
  ESPERA_SEGUNDO_LEMBRETE_ESCOPO_MS,
  motivoRedirecionamentoDeEscopo,
  statusPermitido,
} from "../politica";
import { FASES, STATUS_ANALISE, type Fase, type RespostaAnalise } from "../tipos";

const AGORA = 10_000_000;
const MIN = 60_000;
/** Orçamento e intervalo da política comum para a entrevista padrão (35 min): os mesmos no quadro e no live coding. */
const LIMITE = orcamentoDeInterrupcoes(35);
const INTERVALO = intervaloMinimoMs(35);

function estadoEm(fase: Fase, extra: Partial<EstadoSessao> = {}): EstadoSessao {
  return { ...estadoInicial(), fase, faseIniciadaEm: 0, ...extra };
}

function resposta(extra: Partial<RespostaAnalise> = {}): RespostaAnalise {
  return {
    status: "duvida", parteFechada: true, escopo: false,
    pergunta: "Onde fica o gargalo?",
    nota: "Gargalo?",
    elementos: ["e1"],
    degrau: null,
    observacoes: [],
    ...extra,
  };
}

const GRAFO = "COMPONENTES\n- [r1] Cliente (retângulo)\n- [e1] Postgres (elipse)\nCONEXÕES\n- [s1] Cliente → Postgres";
const IDS = extrairIdsDoGrafo(GRAFO);

describe("REQUISITOS: silêncio inicial decidido no servidor (#83)", () => {
  const inicio = AGORA - SILENCIO_INICIAL_S * 1000;
  const e = () => estadoEm("REQUISITOS", { faseIniciadaEm: inicio });

  it("espera 120 segundos desde a fase, inclusive sem telemetria do navegador", () => {
    assert.equal(motivoBloqueioPlin(e(), AGORA - 1), "SILENCIO_INICIAL_INSUFICIENTE");
    assert.equal(motivoBloqueioPlin(e(), AGORA), null);
    assert.equal(motivoBloqueioPlin({ ...e(), faseIniciadaEm: null }, AGORA), "SILENCIO_INICIAL_INSUFICIENTE");
  });

  it("fala ou texto durante a fase bloqueia mesmo após longo silêncio e em estado antigo", () => {
    for (const em of [inicio, inicio + 1, AGORA - 1]) {
      const estado = { ...e(), conversa: [{ quem: "candidato" as const, texto: "Tá bom", em }] };
      assert.equal(motivoBloqueioPlin(estado, AGORA), "CANDIDATO_JA_FALOU");
      assert.equal(motivoBloqueioPlin(estado, AGORA + 600_000), "CANDIDATO_JA_FALOU");
      assert.equal(podeAnalisar(estado), true, "observações continuam sendo colhidas");
      assert.equal(estado.conviteFeito, false, "a política é pura");
    }
  });

  it("fala anterior à fase, fala do agente e marcador vazio não impedem o convite", () => {
    const estado = { ...e(), conversa: [
      { quem: "candidato" as const, texto: "Oi", em: inicio - 1 },
      { quem: "agente" as const, texto: "Este é o desafio", em: inicio },
      { quem: "candidato" as const, texto: "  ", em: inicio + 1 },
    ] };
    assert.equal(motivoBloqueioPlin(estado, AGORA), null);
  });

  it("atividade recente informada pelo quadro segura o convite antes de a fala ser persistida", () => {
    assert.equal(motivoBloqueioPlin(e(), AGORA, undefined, { paradoHaS: SILENCIO_REQUISITOS_S - 0.001 }), "CANDIDATO_EM_ATIVIDADE");
    assert.equal(motivoBloqueioPlin(e(), AGORA, undefined, { paradoHaS: SILENCIO_REQUISITOS_S }), null);
  });

  it("qualquer elemento no grafo impede o convite, preservando observações", () => {
    const observacoes = [{ criterio: "requisitos", sinal: "neutro" as const, espontaneo: true, evidencia: "Começou pelo desenho" }];
    for (const grafo of [GRAFO, 'ANOTAÇÕES SOLTAS\n- [t1] escala', 'DESENHOS SEM TEXTO\n- [f1] traço livre']) {
      assert.equal(motivoBloqueioPlin(e(), AGORA, undefined, { temDesenho: true }), "CANDIDATO_JA_DESENHOU");
      const r = filtrarResposta(e(), resposta({ observacoes }), extrairIdsDoGrafo(grafo), AGORA);
      assert.equal(r.status, "ok");
      assert.equal(r.pergunta, null);
      assert.deepEqual(r.observacoes, observacoes);
    }
  });
});

describe("gestos da análise", () => {
  it("preserva gestos válidos e retira uma comparação com alvo inexistente", () => {
    const r = filtrarResposta(estadoEm("APROFUNDAMENTO"), resposta({ visual: [
      { tipo: "percorrer", alvos: ["r1", "s1", "e1"] }, { tipo: "comparar", alvos: ["r1", "inventado"] },
    ] }), IDS, AGORA);
    assert.deepEqual(r.visual, [{ tipo: "percorrer", alvos: ["r1", "s1", "e1"] }]);
  });
  it("política que adia a intervenção também silencia seus desenhos", () => {
    const r = filtrarResposta(estadoEm("APROFUNDAMENTO", { perguntasFeitas: LIMITE }), resposta({ visual: [{ tipo: "circular", alvo: "e1" }] }), IDS, AGORA);
    assert.equal(r.status, "ok");
    assert.deepEqual(r.visual, []);
  });
});

describe("statusPermitido: matriz fase x status", () => {
  const esperado: Record<Fase, Record<string, boolean>> = {
    AGUARDANDO: { ok: true, duvida: false, redirecionar: false, dica: false },
    APRESENTACAO: { ok: true, duvida: false, redirecionar: false, dica: false },
    REQUISITOS: { ok: true, duvida: true, redirecionar: false, dica: false },
    ALTO_NIVEL: { ok: true, duvida: true, redirecionar: true, dica: true },
    APROFUNDAMENTO: { ok: true, duvida: true, redirecionar: true, dica: true },
    FECHAMENTO: { ok: true, duvida: true, redirecionar: false, dica: false },
    ENCERRADA: { ok: true, duvida: false, redirecionar: false, dica: false },
  };
  for (const fase of FASES) {
    for (const status of STATUS_ANALISE) {
      it(`${fase} / ${status} = ${esperado[fase][status]}`, () => {
        assert.equal(statusPermitido(fase, status), esperado[fase][status]);
      });
    }
  }
});

describe("podeAnalisar (portão de entrada)", () => {
  it("só nas fases que analisam", () => {
    const analisam: Fase[] = ["REQUISITOS", "ALTO_NIVEL", "APROFUNDAMENTO", "FECHAMENTO"];
    for (const fase of FASES) {
      assert.equal(podeAnalisar(estadoEm(fase), AGORA), analisam.includes(fase), fase);
    }
    assert.equal(motivoBloqueio(estadoEm("APRESENTACAO")), "FASE_NAO_ANALISA");
    assert.equal(motivoBloqueio(estadoEm("REQUISITOS")), null);
  });

  it("não roda com o candidato no meio da resposta", () => {
    const e = estadoEm("APROFUNDAMENTO", { plin: "PERGUNTA_ATIVA" });
    assert.equal(motivoBloqueio(e), "CANDIDATO_RESPONDENDO");
  });

  it("uma dúvida pendente não bloqueia (a análise pode substituí-la ou cancelá-la)", () => {
    const e = estadoEm("APROFUNDAMENTO", { plin: "PLIN_PENDENTE" });
    assert.equal(podeAnalisar(e, AGORA), true);
  });

  it("intervalo e limite NÃO bloqueiam a análise (só o plin)", () => {
    assert.equal(podeAnalisar(estadoEm("APROFUNDAMENTO", { perguntasFeitas: 1, ultimaPerguntaEm: AGORA - 1000 }), AGORA), true);
    assert.equal(podeAnalisar(estadoEm("APROFUNDAMENTO", { perguntasFeitas: LIMITE }), AGORA), true);
    assert.equal(podeAnalisar(estadoEm("FECHAMENTO", { perguntasFeitas: 6, perguntaFinalFeita: true }), AGORA), true);
  });
});

describe("motivoBloqueioPlin (política comum: orçamento, cota e intervalo)", () => {
  it("intervalo desde a última pergunta", () => {
    const base = { perguntasFeitas: 1 };
    assert.equal(motivoBloqueioPlin(estadoEm("APROFUNDAMENTO", { ...base, ultimaPerguntaEm: AGORA - INTERVALO + 1 }), AGORA), "INTERVALO_ENTRE_PERGUNTAS");
    assert.equal(motivoBloqueioPlin(estadoEm("APROFUNDAMENTO", { ...base, ultimaPerguntaEm: AGORA - INTERVALO }), AGORA), null);
  });

  it("orçamento escalado pela duração (35 min no padrão)", () => {
    assert.equal(motivoBloqueioPlin(estadoEm("APROFUNDAMENTO", { perguntasFeitas: LIMITE - 1 }), AGORA), null);
    assert.equal(motivoBloqueioPlin(estadoEm("APROFUNDAMENTO", { perguntasFeitas: LIMITE }), AGORA), "LIMITE_DE_PERGUNTAS");
  });

  it("cota proporcional ao tempo: não gasta o orçamento no começo", () => {
    // Aos 4 de 35 min, a cota é 4 com a folga #140.
    assert.equal(motivoBloqueioPlin(estadoEm("ALTO_NIVEL", { iniciadaEm: AGORA - 4 * MIN, perguntasFeitas: 4 }), AGORA), "COTA_DO_TEMPO");
  });

  it("começo do aprofundamento é marco: basta o respiro curto", () => {
    const base = { perguntasFeitas: 2, ultimaPerguntaEm: AGORA - 60_000, ultimaRespostaEm: AGORA - 20_000 };
    assert.equal(motivoBloqueioPlin(estadoEm("APROFUNDAMENTO", base), AGORA), "INTERVALO_ENTRE_PERGUNTAS");
    assert.equal(motivoBloqueioPlin(estadoEm("APROFUNDAMENTO", { ...base, faseIniciadaEm: AGORA - 5_000 }), AGORA), null);
  });

  it("FECHAMENTO: uma pergunta final, mesmo depois do orçamento", () => {
    assert.equal(motivoBloqueioPlin(estadoEm("FECHAMENTO", { perguntasFeitas: LIMITE }), AGORA), null);
    assert.equal(motivoBloqueioPlin(estadoEm("FECHAMENTO", { perguntasFeitas: LIMITE + 1, perguntaFinalFeita: true }), AGORA), "LIMITE_DE_PERGUNTAS");
  });
});

describe("podeLevantarPlin", () => {
  it("combina status da fase com o portão", () => {
    assert.equal(podeLevantarPlin(estadoEm("APROFUNDAMENTO"), "dica", AGORA), true);
    assert.equal(podeLevantarPlin(estadoEm("ALTO_NIVEL"), "dica", AGORA), true);
    assert.equal(podeLevantarPlin(estadoEm("REQUISITOS"), "dica", AGORA), false);
    assert.equal(podeLevantarPlin(estadoEm("APROFUNDAMENTO"), "ok", AGORA), false);
    assert.equal(podeLevantarPlin(estadoEm("APROFUNDAMENTO", { perguntasFeitas: LIMITE }), "duvida", AGORA), false);
  });
});

describe("filtrarResposta", () => {
  const e = estadoEm("APROFUNDAMENTO");

  it("deixa passar uma resposta válida", () => {
    const r = filtrarResposta(e, resposta(), IDS, AGORA);
    // A pergunta cita uma peça e o modelo não pediu gesto: a peça é marcada mesmo assim.
    assert.deepEqual(r, { ...resposta(), visual: [{ tipo: "marcar", alvo: "e1" }], avancar_fase: false });
  });

  it("avancar_fase só vale em ALTO_NIVEL, mesmo quando o plin é rebaixado", () => {
    const pronto = resposta({ status: "ok", pergunta: null, nota: null, elementos: [], avancar_fase: true });
    assert.equal(filtrarResposta(estadoEm("ALTO_NIVEL"), pronto, IDS, AGORA).avancar_fase, true);
    for (const fase of ["REQUISITOS", "APROFUNDAMENTO", "FECHAMENTO"] as const) {
      assert.equal(filtrarResposta(estadoEm(fase), pronto, IDS, AGORA).avancar_fase, false);
    }
    // Pergunta que a política barra (aqui, limite de perguntas) vira ok, mas o sinal de prontidão continua.
    const comDuvida = resposta({ status: "duvida", avancar_fase: true });
    const r = filtrarResposta(estadoEm("ALTO_NIVEL", { perguntasFeitas: LIMITE }), comDuvida, IDS, AGORA);
    assert.equal(r.status, "ok");
    assert.equal(r.avancar_fase, true);
  });

  it("rebaixa para ok o status que a fase não permite, mantendo observações", () => {
    const obs = [{ criterio: "dados", sinal: "negativo" as const, espontaneo: false, evidencia: "x" }];
    const r = filtrarResposta(estadoEm("REQUISITOS"), resposta({ status: "dica", observacoes: obs }), IDS, AGORA);
    assert.equal(r.status, "ok");
    assert.equal(r.pergunta, null);
    assert.equal(r.nota, null);
    assert.deepEqual(r.elementos, []);
    assert.deepEqual(r.observacoes, obs);
  });

  it("REQUISITOS: analisa; só `duvida` (convite) vira plin; outros status e observações ficam como ok", () => {
    const obs = [{ criterio: "requisitos", sinal: "positivo" as const, espontaneo: true, evidencia: "perguntou a escala" }];
    assert.equal(podeAnalisar(estadoEm("REQUISITOS"), AGORA), true);
    assert.equal(podeLevantarPlin(estadoEm("REQUISITOS"), "duvida", AGORA), true);
    assert.equal(podeLevantarPlin(estadoEm("REQUISITOS"), "redirecionar", AGORA), false);
    const r = filtrarResposta(estadoEm("REQUISITOS"), resposta({ status: "redirecionar", observacoes: obs }), IDS, AGORA);
    assert.equal(r.status, "ok");
    assert.deepEqual(r.observacoes, obs);
  });

  it("rebaixa por limite e por intervalo", () => {
    assert.equal(filtrarResposta(estadoEm("APROFUNDAMENTO", { perguntasFeitas: LIMITE }), resposta(), IDS, AGORA).status, "ok");
    assert.equal(filtrarResposta(estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AGORA - 10_000 }), resposta(), IDS, AGORA).status, "ok");
  });

  it("rebaixa quando há plin mas não há pergunta", () => {
    assert.equal(filtrarResposta(e, resposta({ pergunta: null }), IDS, AGORA).status, "ok");
    assert.equal(filtrarResposta(e, resposta({ pergunta: "   " }), IDS, AGORA).status, "ok");
  });

  it("ok limpa qualquer lixo de pergunta/elementos", () => {
    const r = filtrarResposta(e, resposta({ status: "ok", pergunta: "sobra", elementos: ["e1"] }), IDS, AGORA);
    assert.equal(r.pergunta, null);
    assert.deepEqual(r.elementos, []);
  });

  it("descarta ids que não existem no grafo (e repetidos)", () => {
    const r = filtrarResposta(e, resposta({ elementos: ["e1", "zzz", "s1", "e1"] }), IDS, AGORA);
    assert.deepEqual(r.elementos, ["e1", "s1"]);
  });

  it("sem nenhum id válido, devolve lista vazia (nota ao lado do desenho)", () => {
    assert.deepEqual(filtrarResposta(e, resposta({ elementos: ["x9"] }), IDS, AGORA).elementos, []);
  });

  it("corta a nota em ~40 caracteres", () => {
    const longa = "Essa nota é muito maior do que o cursor consegue escrever no quadro";
    const r = filtrarResposta(e, resposta({ nota: longa }), IDS, AGORA);
    assert.ok(r.nota!.length <= 40);
    assert.ok(longa.startsWith(r.nota!));
  });

  it("sem nota, usa a pergunta cortada", () => {
    const r = filtrarResposta(e, resposta({ nota: null, pergunta: "Com leitura cem vezes maior que escrita, onde fica o gargalo?" }), IDS, AGORA);
    assert.equal(r.nota, "Com leitura cem vezes maior que escrita,");
  });

  it("não modifica o objeto original", () => {
    const original = resposta({ elementos: ["e1", "zzz"] });
    filtrarResposta(e, original, IDS, AGORA);
    assert.deepEqual(original.elementos, ["e1", "zzz"]);
  });
});

describe("extrairIdsDoGrafo", () => {
  it("pega os ids de todas as seções", () => {
    const grafo = `${GRAFO}\nANOTAÇÕES SOLTAS\n- [t1] "algo"\nORDEM NA TELA (esquerda → direita)\n- Cliente, Postgres`;
    assert.deepEqual([...extrairIdsDoGrafo(grafo)].sort(), ["e1", "r1", "s1", "t1"]);
  });
});

describe("a bola está com o candidato depois de uma fala solta do agente", () => {
  const base = { plin: "LIVRE" as const };
  const falou = () => transicionar(estadoEm("APROFUNDAMENTO", base), { tipo: "AGENTE_FALOU", texto: "São 20 mil por dia. Pode seguir com o desenho." }, AGORA).estado;
  const regras = REGRAS_PADRAO;

  it("a fala do agente registra a hora", () => {
    assert.equal(falou().ultimaFalaDoAgenteEm, AGORA);
  });

  it("sem o candidato agir depois da fala, a pergunta nova espera", () => {
    // Ele não faz nada há 30 s (a última ação é anterior à fala) e o agente falou há 3 s.
    assert.equal(motivoBloqueioPlin(falou(), AGORA + 3_000, regras, { paradoHaS: 30 }), "BOLA_COM_O_CANDIDATO");
    assert.equal(podeLevantarPlin(falou(), "duvida", AGORA + 3_000, regras, { paradoHaS: 30 }), false);
  });

  it("se o candidato agiu depois da fala, a pergunta pode sair na hora", () => {
    // Agente falou em AGORA; ele mexeu no desenho 1 s depois (parado há 2 s quando se pergunta em AGORA + 3 s).
    assert.equal(motivoBloqueioPlin(falou(), AGORA + 3_000, regras, { paradoHaS: 2 }), null);
  });

  it("sem ação dele, só um silêncio total de SILENCIO_SEM_ACAO_S (60 s) libera a pergunta", () => {
    assert.equal(motivoBloqueioPlin(falou(), AGORA + SILENCIO_SEM_ACAO_S * 1000 - 1, regras, { paradoHaS: 120 }), "BOLA_COM_O_CANDIDATO");
    assert.equal(motivoBloqueioPlin(falou(), AGORA + SILENCIO_SEM_ACAO_S * 1000, regras, { paradoHaS: 120 }), null);
  });

  it("o mesmo limite de 60 s vale em REQUISITOS (antes era 15 s)", () => {
    const req = transicionar(estadoEm("REQUISITOS", base), { tipo: "AGENTE_FALOU", texto: "Uns 4 mil por segundo." }, AGORA).estado;
    assert.equal(motivoBloqueioPlin(req, AGORA + 15_000, regras, { paradoHaS: 60 }), "BOLA_COM_O_CANDIDATO");
    assert.equal(motivoBloqueioPlin(req, AGORA + 60_000, regras, { paradoHaS: 120 }), null);
  });

  it("o pedido de tempo conta como fala do Totti: sem ação dele, a bola segura 60 s depois do pedido e libera", () => {
    const pediu = transicionar(falou(), { tipo: "CANDIDATO_PEDIU_TEMPO", reagiu: false }, AGORA + 1_000).estado;
    assert.equal(motivoBloqueioPlin(pediu, AGORA + 60_999, regras, { paradoHaS: 60 }), "BOLA_COM_O_CANDIDATO");
    assert.equal(motivoBloqueioPlin(pediu, AGORA + 61_000, regras, { paradoHaS: 61 }), null);
    assert.equal(pedidoDeTempoPendente(pediu, AGORA + 61_000, 61), true);
  });

  it("o pedido só conta como fala se for a última coisa do agente (a fala mais recente vale)", () => {
    const pediu = transicionar(falou(), { tipo: "CANDIDATO_PEDIU_TEMPO", reagiu: false }, AGORA + 1_000).estado;
    assert.equal(falaQueContaParaABola(pediu), AGORA + 1_000);
    assert.equal(falaQueContaParaABola(estadoEm("APROFUNDAMENTO", base)), null);
  });

  it("depois do pedido, ele agir (desenhar ou falar) libera a regra: o pedido deixa de estar pendente", () => {
    const pediu = transicionar(falou(), { tipo: "CANDIDATO_PEDIU_TEMPO", reagiu: false }, AGORA + 1_000).estado;
    // Última ação há 2 s, depois do pedido: ele voltou a agir.
    assert.equal(pedidoDeTempoPendente(pediu, AGORA + 10_000, 2), false);
    assert.equal(motivoBloqueioPlin(pediu, AGORA + 10_000, regras, { paradoHaS: 2 }), null);
  });

  it("sem saber se ele agiu desde o pedido, a espera vale", () => {
    const pediu = transicionar(falou(), { tipo: "CANDIDATO_PEDIU_TEMPO", reagiu: true }, AGORA).estado;
    assert.equal(pedidoDeTempoPendente(pediu, AGORA + 10_000), true);
    assert.equal(pedidoDeTempoPendente(estadoEm("APROFUNDAMENTO", base), AGORA + 10_000), false);
  });

  it("sem saber há quanto tempo ele está parado, a regra não se aplica", () => {
    assert.equal(motivoBloqueioPlin(falou(), AGORA + 1_000), null);
  });

  it("estado guardado antes do campo não bloqueia nada", () => {
    assert.equal(estadoEm("APROFUNDAMENTO", base).ultimaFalaDoAgenteEm, undefined);
    assert.equal(motivoBloqueioPlin(estadoEm("APROFUNDAMENTO", base), AGORA, regras, { paradoHaS: 60 }), null);
  });

  it("filtrarResposta rebaixa a pergunta enquanto a bola está com ele", () => {
    const ids = new Set(["e1"]);
    const r = resposta({ elementos: ["e1"] });
    assert.equal(filtrarResposta(falou(), r, ids, AGORA + 3_000, regras, { paradoHaS: 30 }).status, "ok");
    assert.equal(filtrarResposta(falou(), r, ids, AGORA + 3_000, regras, { paradoHaS: 2 }).status, "duvida");
  });

  it("o intervalo entre perguntas continua valendo por conta própria", () => {
    assert.equal(
      motivoBloqueioPlin(estadoEm("APROFUNDAMENTO", { ...base, ultimaPerguntaEm: AGORA - 10_000 }), AGORA),
      "INTERVALO_ENTRE_PERGUNTAS",
    );
  });
});

describe("intervalo entre perguntas: referência de tempo", () => {
  const base = { perguntasFeitas: 1 };
  const motivo = (extra: Partial<EstadoSessao>, agora: number) =>
    motivoBloqueioPlin(estadoEm("APROFUNDAMENTO", { ...base, ...extra }), agora);

  it("o respiro conta do fim da resposta quando ele é mais recente que o início da pergunta", () => {
    const e = { ultimaPerguntaEm: AGORA - 5 * MIN, ultimaRespostaEm: AGORA - 10_000 };
    assert.equal(motivo(e, AGORA), "INTERVALO_ENTRE_PERGUNTAS");
    assert.equal(motivo(e, AGORA - 10_000 + RITMO.respiroMs), null);
  });

  it("o intervalo conta do início da pergunta", () => {
    const e = { ultimaPerguntaEm: AGORA - 10_000, ultimaRespostaEm: AGORA - 5 * MIN };
    assert.equal(motivo(e, AGORA), "INTERVALO_ENTRE_PERGUNTAS");
    assert.equal(motivo(e, AGORA - 10_000 + INTERVALO), null);
  });

  it("estado antigo sem ultimaRespostaEm continua funcionando", () => {
    const antigo = estadoEm("APROFUNDAMENTO", { ...base, ultimaPerguntaEm: AGORA - 10_000 });
    delete (antigo as { ultimaRespostaEm?: number | null }).ultimaRespostaEm;
    assert.equal(motivoBloqueioPlin(antigo, AGORA), "INTERVALO_ENTRE_PERGUNTAS");
    assert.equal(motivoBloqueioPlin(antigo, AGORA - 10_000 + INTERVALO), null);
  });
});

describe("ritmo por conteúdo do quadro (#129, bloco B)", () => {
  const PISO = RITMO_QUADRO.pisoEntrePerguntasMs;
  const TETO = RITMO_QUADRO.tetoSemPerguntaMs;
  const fechada = { status: "duvida" as const, parteFechada: true };
  const aberta = { status: "duvida" as const, parteFechada: false };
  const alto = (extra: Partial<EstadoSessao> = {}) => estadoEm("ALTO_NIVEL", extra);

  it("#140: decisão sai depois do piso e numa pausa real", () => {
    const e = alto({ ultimaPerguntaEm: AGORA });
    const decisao = { status: "duvida" as const, gancho: "decisao" as const, parteFechada: false };
    assert.equal(motivoDoConteudo(e, decisao, AGORA + PISO - 1, { paradoHaS: 5 }), "PISO_ENTRE_PERGUNTAS");
    assert.equal(motivoDoConteudo(e, decisao, AGORA + PISO, { paradoHaS: 5 }), null);
    assert.equal(motivoDoConteudo(e, decisao, AGORA + PISO, { paradoHaS: 3 }), "PAUSA_REAL");
  });

  it("sem pergunta anterior, a parte fechada sai sem esperar o piso", () => {
    assert.equal(motivoDoConteudo(alto(), { ...fechada, gancho: "parte_fechada" }, AGORA, { paradoHaS: 5 }), null);
  });

  it("#140: sem gancho, aguarda até o teto de 90 s", () => {
    const e = alto({ ultimaPerguntaEm: AGORA - MIN });
    assert.equal(motivoDoConteudo(e, aberta, AGORA, { pecas: ["r1", "e1"] }), "SEM_GANCHO");
  });

  it("#140: não repete o gancho da pergunta anterior", () => {
    const e = alto({ ultimaPerguntaEm: AGORA - PISO, perguntas: [{
      numero: 1, status: "duvida", gancho: "decisao", pergunta: "Por que escolheu Postgres?", nota: null,
      elementos: ["e1"], degrau: null, fase: "ALTO_NIVEL", feitaEm: AGORA - PISO,
    }] });
    assert.equal(motivoDoConteudo(e, { status: "duvida", gancho: "decisao", parteFechada: false }, AGORA, { paradoHaS: 5 }), "GANCHO_REPETIDO");
    assert.equal(motivoDoConteudo(e, { status: "duvida", gancho: "raciocinio", parteFechada: false }, AGORA, { paradoHaS: 3 }), "PAUSA_REAL");
  });

  it("teto: 90 s sem pergunta e com desenho novo sai mesmo sem parte fechada", () => {
    const e = alto({ ultimaPerguntaEm: AGORA, desenhoNaUltimaPergunta: ["r1"] });
    assert.equal(motivoDoConteudo(e, aberta, AGORA + TETO, { pecas: ["r1", "e1"] }), null);
    assert.equal(motivoDoConteudo(e, aberta, AGORA + TETO - 1, { pecas: ["r1", "e1"] }), "SEM_GANCHO");
  });

  it("teto sem desenho novo não libera: o mesmo desenho não gera pergunta sem parte fechada", () => {
    const e = alto({ ultimaPerguntaEm: AGORA, desenhoNaUltimaPergunta: ["r1", "e1"] });
    assert.equal(motivoDoConteudo(e, aberta, AGORA + TETO, { pecas: ["r1", "e1"] }), "SEM_GANCHO");
  });

  it("sem pergunta anterior, o teto conta desde o começo da fase", () => {
    const e = alto({ faseIniciadaEm: AGORA, ultimaPerguntaEm: null });
    assert.equal(motivoDoConteudo(e, aberta, AGORA + TETO - 1, { pecas: ["r1"] }), "SEM_GANCHO");
    assert.equal(motivoDoConteudo(e, aberta, AGORA + TETO, { pecas: ["r1"] }), null);
  });

  it("grafo cortado (peças desconhecidas) não conta como desenho novo", () => {
    const e = alto({ ultimaPerguntaEm: AGORA, desenhoNaUltimaPergunta: ["r1"] });
    assert.equal(motivoDoConteudo(e, aberta, AGORA + TETO, { pecas: null }), "SEM_GANCHO");
  });

  it("quebra de silêncio fura o piso, com ou sem parte fechada", () => {
    const e = alto({ ultimaPerguntaEm: AGORA - 30_000 });
    assert.equal(motivoDoConteudo(e, fechada, AGORA, { paradoHaS: SILENCIO_SEM_ACAO_S }), null);
    assert.equal(motivoDoConteudo(e, aberta, AGORA, { paradoHaS: SILENCIO_SEM_ACAO_S }), null);
    assert.equal(motivoDoConteudo(e, fechada, AGORA, { paradoHaS: SILENCIO_SEM_ACAO_S - 1 }), "PISO_ENTRE_PERGUNTAS");
  });

  it("marco de conclusão ('terminei') fura o piso", () => {
    const e = alto({ ultimaPerguntaEm: AGORA - 30_000, ultimaConclusaoEm: AGORA - 10_000 });
    assert.equal(motivoDoConteudo(e, fechada, AGORA), null);
  });

  it("gancho repetido continua barrado na quebra de silêncio e na conclusão recente", () => {
    const e = alto({
      ultimaPerguntaEm: AGORA - 1_000,
      ultimaConclusaoEm: AGORA - 1_000,
      perguntas: [{ numero: 1, status: "duvida", gancho: "decisao", pergunta: "Por quê?", nota: null, elementos: [], degrau: null, fase: "ALTO_NIVEL", feitaEm: AGORA - 2_000 }],
    });
    const repetida = { status: "duvida" as const, gancho: "decisao" as const, parteFechada: false };
    assert.equal(motivoDoConteudo(e, repetida, AGORA, { paradoHaS: SILENCIO_SEM_ACAO_S }), "GANCHO_REPETIDO");
    assert.equal(motivoDoConteudo(e, repetida, AGORA), "GANCHO_REPETIDO");
  });

  it("só se aplica a duvida e dica em ALTO_NIVEL e APROFUNDAMENTO", () => {
    const e = alto({ ultimaPerguntaEm: AGORA - 1000 });
    assert.equal(motivoDoConteudo(estadoEm("REQUISITOS", { ultimaPerguntaEm: AGORA - 1000 }), aberta, AGORA), null);
    assert.equal(motivoDoConteudo(e, { status: "redirecionar", parteFechada: false }, AGORA), null);
    assert.equal(motivoDoConteudo(e, { status: "ok", parteFechada: false }, AGORA), null);
    assert.equal(
      motivoDoConteudo(estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AGORA - 1000 }), { status: "dica", parteFechada: false }, AGORA),
      "SEM_GANCHO",
    );
  });

  it("desenhoNovoDesdePergunta: só peça que não estava no grafo da última pergunta", () => {
    const e = alto({ desenhoNaUltimaPergunta: ["r1", "e1"] });
    assert.equal(desenhoNovoDesdePergunta(e, ["r1", "e1"]), false);
    assert.equal(desenhoNovoDesdePergunta(e, ["r1", "e1", "s2"]), true);
    assert.equal(desenhoNovoDesdePergunta(alto(), ["r1"]), true, "sem pergunta anterior, qualquer peça conta");
    assert.equal(desenhoNovoDesdePergunta(alto(), []), false);
    assert.equal(desenhoNovoDesdePergunta(e, null), false);
  });

  it("PLIN_CLICADO grava as peças da análise que fez a pergunta (base do teto)", () => {
    const pendente = transicionar(alto(), { tipo: "ANALISE_RECEBIDA", resposta: resposta(), pecas: ["r1", "e1"] }, AGORA).estado;
    assert.equal(pendente.plin, "PLIN_PENDENTE");
    const feita = transicionar(pendente, { tipo: "PLIN_CLICADO" }, AGORA + 1000).estado;
    assert.deepEqual(feita.desenhoNaUltimaPergunta, ["r1", "e1"]);
    const semPecas = transicionar(transicionar(alto(), { tipo: "ANALISE_RECEBIDA", resposta: resposta() }, AGORA).estado, { tipo: "PLIN_CLICADO" }, AGORA + 1000).estado;
    assert.equal(semPecas.desenhoNaUltimaPergunta, undefined, "sem peças na análise, o campo fica ausente");
  });
});


describe("quando o quadro pode oferecer o encerramento (#129, decisão F)", () => {
  const PLANO: PlanoDaSessao = {
    cargo: "Engenheiro de pagamentos", senioridade: "pleno", tom: "amigavel", dicas: "livres", foco: [], notas: "", duracaoMin: 30,
    criterios: [
      { nome: "Idempotência", descricao: "não cobra duas vezes", peso: 2 },
      { nome: "Falha no gateway", descricao: "o que acontece se o gateway cair", peso: 1 },
    ],
  };
  /** Vaga de 30 min, começada 9 min atrás: faltam 21 min, longe do limiar de 15%. */
  const quadroEm = (extra: Partial<EstadoSessao> = {}): EstadoSessao => ({
    ...estadoInicial({ plano: PLANO }), fase: "ALTO_NIVEL", faseIniciadaEm: AGORA - 5 * MIN, iniciadaEm: AGORA - 9 * MIN, ...extra,
  });
  const comCriteriosCobertos = (e: EstadoSessao): EstadoSessao => ({
    ...e,
    cobertura: { ...e.cobertura, Idempotência: { positivo: 1, negativo: 0, neutro: 0 }, "Falha no gateway": { positivo: 1, negativo: 0, neutro: 0 } },
  });
  const anunciada: EstadoSessao["empecilho"] = { id: "x", fala: "Mudou.", requisito: "Mudança", exige: "Rever.", anunciadoEm: AGORA - MIN, fase: "ALTO_NIVEL", forcado: false };
  const COM_MUDANCA = { kit: { id: "system_design" }, problema: {} };
  const SEM_MUDANCA = { kit: { id: "design_produto" }, problema: {} };

  it("com critério do plano sem evidência, barra (faltam_criterios), mesmo com a mudança anunciada", () => {
    assert.equal(podeOferecerEncerrar(quadroEm(), AGORA, COM_MUDANCA), "faltam_criterios");
    assert.equal(podeOferecerEncerrar(quadroEm({ empecilho: anunciada }), AGORA, COM_MUDANCA), "faltam_criterios");
  });

  it("critérios cobertos mas a mudança ainda não saiu: barra (falta_mudanca)", () => {
    assert.equal(podeOferecerEncerrar(comCriteriosCobertos(quadroEm()), AGORA, COM_MUDANCA), "falta_mudanca");
  });

  it("critérios cobertos e mudança anunciada: pode", () => {
    assert.equal(podeOferecerEncerrar(comCriteriosCobertos(quadroEm({ empecilho: anunciada })), AGORA, COM_MUDANCA), null);
  });

  it("sem mudança prevista no problema, critérios cobertos bastam", () => {
    assert.equal(podeOferecerEncerrar(comCriteriosCobertos(quadroEm()), AGORA, SEM_MUDANCA), null);
  });

  it("faltando 15% da duração ou menos, pode, mesmo com critério e mudança pendentes (4,5 min numa vaga de 30)", () => {
    assert.equal(podeOferecerEncerrar(quadroEm({ iniciadaEm: AGORA - 25.5 * MIN }), AGORA, COM_MUDANCA), null, "faltam 4,5 min");
    assert.equal(podeOferecerEncerrar(quadroEm({ iniciadaEm: AGORA - 25.4 * MIN }), AGORA, COM_MUDANCA), "faltam_criterios", "faltam 4,6 min");
  });

  it("sem duração conhecida, não barra (o comportamento de antes)", () => {
    assert.equal(podeOferecerEncerrar(estadoInicial({ tempos: {}, plano: null }), AGORA, COM_MUDANCA), null);
  });

  it("parametrosDoFechamentoNoQuadro: limiar da vaga e a barra da conclusão", () => {
    assert.deepEqual(parametrosDoFechamentoNoQuadro(quadroEm(), AGORA, COM_MUDANCA), { limiarTempoMs: 4.5 * MIN, podeFecharPorConclusao: false });
    const pode = comCriteriosCobertos(quadroEm({ empecilho: anunciada }));
    assert.deepEqual(parametrosDoFechamentoNoQuadro(pode, AGORA, COM_MUDANCA), { limiarTempoMs: 4.5 * MIN, podeFecharPorConclusao: true });
  });

  it("conclusaoBarradaRecente: só com conclusão recente, no desenho, sem fechamento, e barrada", () => {
    const concluiu = (ha: number, fase: EstadoSessao["fase"] = "ALTO_NIVEL") => quadroEm({ fase, ultimaConclusaoEm: AGORA - ha, conclusoes: 1 });
    assert.equal(conclusaoBarradaRecente(concluiu(10_000), AGORA, COM_MUDANCA), "faltam_criterios");
    assert.equal(conclusaoBarradaRecente(concluiu(60_000), AGORA, COM_MUDANCA), null, "conclusão antiga não conta");
    assert.equal(conclusaoBarradaRecente(concluiu(10_000, "REQUISITOS"), AGORA, COM_MUDANCA), null, "fora do desenho não conta");
    assert.equal(conclusaoBarradaRecente(quadroEm(), AGORA, COM_MUDANCA), null, "sem conclusão, não há o que puxar");
    assert.equal(conclusaoBarradaRecente(comCriteriosCobertos(concluiu(10_000)), AGORA, COM_MUDANCA), "falta_mudanca");
  });
});

describe("redirecionamento de escopo (#129, decisão I)", () => {
  const PECAS = ["r1", "e1", "s1"];
  const ESPERA = ESPERA_SEGUNDO_LEMBRETE_ESCOPO_MS;
  const alto = (extra: Partial<EstadoSessao> = {}) => estadoEm("ALTO_NIVEL", extra);
  const redireciona = (extra: Partial<RespostaAnalise> = {}) => resposta({ status: "redirecionar", escopo: true, parteFechada: false, ...extra });

  it("só em ALTO_NIVEL e APROFUNDAMENTO", () => {
    assert.equal(motivoRedirecionamentoDeEscopo(alto(), AGORA, PECAS), null);
    assert.equal(motivoRedirecionamentoDeEscopo(estadoEm("APROFUNDAMENTO"), AGORA, PECAS), null);
    assert.equal(motivoRedirecionamentoDeEscopo(estadoEm("REQUISITOS"), AGORA, PECAS), "escopo_fora_da_fase");
    assert.equal(motivoRedirecionamentoDeEscopo(estadoEm("FECHAMENTO"), AGORA, PECAS), "escopo_fora_da_fase");
  });

  it("sem peça desenhada não julga o escopo; grafo grande demais para comparar conta como desenho", () => {
    assert.equal(motivoRedirecionamentoDeEscopo(alto(), AGORA, []), "escopo_sem_desenho");
    assert.equal(motivoRedirecionamentoDeEscopo(alto(), AGORA, null), null);
  });

  it("o primeiro sai; o segundo só depois de 5 min do primeiro; o terceiro nunca", () => {
    assert.equal(motivoRedirecionamentoDeEscopo(alto({ escopoRedirecionamentos: 1, escopoProvocadoEm: AGORA - ESPERA + 1 }), AGORA, PECAS), "escopo_espera_lembrete");
    assert.equal(motivoRedirecionamentoDeEscopo(alto({ escopoRedirecionamentos: 1, escopoProvocadoEm: AGORA - ESPERA }), AGORA, PECAS), null);
    assert.equal(motivoRedirecionamentoDeEscopo(alto({ escopoRedirecionamentos: 2, escopoProvocadoEm: AGORA - 10 * ESPERA }), AGORA, PECAS), "escopo_ja_redirecionado");
  });

  it("aplicarRegraDoEscopo: fora da regra vira ok com o motivo; dentro passa; sem escopo, escopo cai fora de redirecionar", () => {
    const barrada = aplicarRegraDoEscopo(estadoEm("REQUISITOS"), redireciona(), AGORA, PECAS);
    assert.equal(barrada.motivo, "escopo_fora_da_fase");
    assert.equal(barrada.resposta.status, "ok");
    assert.equal(barrada.resposta.escopo, false);
    const passa = aplicarRegraDoEscopo(alto(), redireciona(), AGORA, PECAS);
    assert.equal(passa.motivo, null);
    assert.equal(passa.resposta.status, "redirecionar");
    assert.equal(passa.resposta.escopo, true);
    const duvidaComEscopo = aplicarRegraDoEscopo(alto(), resposta({ status: "duvida", escopo: true }), AGORA, PECAS);
    assert.equal(duvidaComEscopo.resposta.escopo, false);
    assert.equal(duvidaComEscopo.motivo, null);
  });

  it("fura o intervalo e o respiro entre perguntas, mas só com escopo", () => {
    const recente = alto({ ultimaPerguntaEm: AGORA - 10_000, ultimaRespostaEm: AGORA - 5_000 });
    assert.equal(filtrarResposta(recente, redireciona({ escopo: false }), IDS, AGORA).status, "ok", "sem escopo, o ritmo comum barra");
    const comEscopo = filtrarResposta(recente, redireciona(), IDS, AGORA);
    assert.equal(comEscopo.status, "redirecionar");
    assert.equal(comEscopo.pergunta, "Onde fica o gargalo?");
  });

  it("a cota de perguntas não barra o escopo (revisado, decisão I)", () => {
    const cedo = alto({ iniciadaEm: AGORA, perguntasFeitas: 1 });
    assert.equal(filtrarResposta(cedo, redireciona(), IDS, AGORA).status, "redirecionar");
  });

  it("o orçamento de perguntas continua valendo para o escopo", () => {
    const sem = alto({ perguntasFeitas: LIMITE, ultimaPerguntaEm: AGORA - 10_000 });
    assert.equal(filtrarResposta(sem, redireciona(), IDS, AGORA).status, "ok");
    assert.equal(motivoBloqueioPlin(sem, AGORA, REGRAS_PADRAO, { escopo: true }), "LIMITE_DE_PERGUNTAS");
  });

  it("a regra da bola continua valendo: fala do Totti sem ação do candidato segura o escopo", () => {
    const bola = alto({ ultimaFalaDoAgenteEm: AGORA - 10_000 });
    assert.equal(filtrarResposta(bola, redireciona(), IDS, AGORA, REGRAS_PADRAO, { paradoHaS: 60 }).status, "ok");
  });
});

describe("cota e escopo (#129, decisão I, revisado)", () => {
  it("a cota não barra o redirecionamento de escopo; o orçamento total continua barrando", () => {
    // Início da entrevista (fração 0): a cota é 2 com a folga #140.
    const cedo = estadoEm("ALTO_NIVEL", { iniciadaEm: AGORA, perguntasFeitas: 2 });
    assert.equal(motivoBloqueioPlin(cedo, AGORA), "COTA_DO_TEMPO");
    assert.equal(motivoBloqueioPlin(cedo, AGORA, REGRAS_PADRAO, { escopo: true }), null);
    const cheio = estadoEm("ALTO_NIVEL", { iniciadaEm: AGORA, perguntasFeitas: LIMITE });
    assert.equal(motivoBloqueioPlin(cheio, AGORA, REGRAS_PADRAO, { escopo: true }), "LIMITE_DE_PERGUNTAS");
  });
});

describe("pergunta obrigatória do teto (#129, bloco B)", () => {
  const TETO = RITMO_QUADRO.tetoSemPerguntaMs;
  const AGORA_OB = 10_000_000;
  const PECAS = ["r1", "e1"];
  const ctx = { mudancaPrevista: false };
  // Teto vencido: a última pergunta foi há mais que o teto, com a peça e1 nova desde então.
  const vencida = (extra: Partial<EstadoSessao> = {}) => estadoEm("APROFUNDAMENTO", {
    iniciadaEm: AGORA_OB - 10 * 60_000, faseIniciadaEm: AGORA_OB - 60_000,
    ultimaPerguntaEm: AGORA_OB - TETO - 1, desenhoNaUltimaPergunta: ["r1"], ...extra,
  });

  it("o teto de RITMO_QUADRO é de 90 s", () => {
    // #140: teto de 90 s.
    assert.equal(TETO, 90_000);
  });

  it("com o teto vencido, em fase de conteúdo e sem bloqueio, a pergunta é obrigatória", () => {
    assert.equal(perguntaObrigatoria(vencida(), AGORA_OB, PECAS, ctx), true);
  });

  it("antes do teto, não é obrigatória", () => {
    assert.equal(perguntaObrigatoria(vencida({ ultimaPerguntaEm: AGORA_OB - TETO + 1 }), AGORA_OB, PECAS, ctx), false);
  });

  it("no ALTO_NIVEL, sem desenho novo, não é obrigatória", () => {
    assert.equal(perguntaObrigatoria(vencida({ fase: "ALTO_NIVEL", desenhoNaUltimaPergunta: ["r1", "e1"] }), AGORA_OB, PECAS, ctx), false);
  });

  it("no APROFUNDAMENTO, sem desenho novo, o teto vence pelo tempo (decisão do dono)", () => {
    assert.equal(perguntaObrigatoria(vencida({ desenhoNaUltimaPergunta: ["r1", "e1"] }), AGORA_OB, PECAS, ctx), true);
    assert.equal(perguntaObrigatoria(vencida({ desenhoNaUltimaPergunta: ["r1", "e1"], ultimaPerguntaEm: AGORA_OB - TETO + 1 }), AGORA_OB, PECAS, ctx), false);
  });

  it("fora das fases de conteúdo (REQUISITOS), não é obrigatória", () => {
    assert.equal(perguntaObrigatoria(vencida({ fase: "REQUISITOS" }), AGORA_OB, PECAS, ctx), false);
  });

  it("uma pergunta pendente é outro portão: não é obrigatória", () => {
    const pendente = { status: "duvida" as const, pergunta: "x?", nota: null, elementos: [], degrau: null, observacoes: [], parteFechada: true, escopo: false, visual: [], criadoEm: AGORA_OB - 1 };
    assert.equal(perguntaObrigatoria(vencida({ perguntaPendente: pendente }), AGORA_OB, PECAS, ctx), false);
  });

  it("orçamento de perguntas esgotado é outro portão: não é obrigatória", () => {
    assert.equal(perguntaObrigatoria(vencida({ perguntasFeitas: 50 }), AGORA_OB, PECAS, ctx), false);
  });

  it("a brecha da mudança (decisão G) é um \"ok\" de propósito: não é obrigatória", () => {
    // Garantia dos 60% já passou (23 min de 35), a mudança prevista ainda não entrou e a brecha está aberta.
    const comBrecha = vencida({ iniciadaEm: AGORA_OB - 23 * 60_000 });
    assert.equal(perguntaObrigatoria(comBrecha, AGORA_OB, PECAS, { mudancaPrevista: true }), false);
    assert.equal(precisaAbrirBrechaDaMudanca(comBrecha, AGORA_OB, true), true);
    assert.equal(perguntaObrigatoria(comBrecha, AGORA_OB, PECAS, { mudancaPrevista: false }), true);
  });

  it("a brecha de INTERVALO_BRECHA_EMPECILHO_MS: ciclo recente, sem brecha; depois, de novo", () => {
    const recente = vencida({ iniciadaEm: AGORA_OB - 23 * 60_000, brechaEmpecilhoEm: AGORA_OB - 1000 });
    assert.equal(precisaAbrirBrechaDaMudanca(recente, AGORA_OB, true), false);
    assert.equal(perguntaObrigatoria(recente, AGORA_OB, PECAS, { mudancaPrevista: true }), true);
  });
});

describe("teto por fase (decisão do dono): APROFUNDAMENTO vence só pelo tempo; ALTO_NIVEL exige desenho novo", () => {
  const TETO_MS = RITMO_QUADRO.tetoSemPerguntaMs;
  const AG = 10_000_000;
  const pecas = ["r1", "e1"];

  it("APROFUNDAMENTO com 90 s sem pergunta e sem desenho novo: o teto vence", () => {
    const e = estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AG - TETO_MS, desenhoNaUltimaPergunta: ["r1", "e1"] });
    assert.equal(tetoDaPergunta(e, AG, pecas), true);
  });

  it("ALTO_NIVEL com 90 s sem pergunta e sem desenho novo: o teto não vence", () => {
    const e = estadoEm("ALTO_NIVEL", { ultimaPerguntaEm: AG - TETO_MS, desenhoNaUltimaPergunta: ["r1", "e1"] });
    assert.equal(tetoDaPergunta(e, AG, pecas), false);
  });

  it("antes dos 90 s, nem o APROFUNDAMENTO vence", () => {
    const e = estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AG - TETO_MS + 1, desenhoNaUltimaPergunta: ["r1", "e1"] });
    assert.equal(tetoDaPergunta(e, AG, pecas), false);
  });

  it("no APROFUNDAMENTO sem desenho novo, motivoDoConteudo deixa a pergunta sair (sem parte fechada)", () => {
    const e = estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AG - TETO_MS, desenhoNaUltimaPergunta: ["r1", "e1"] });
    assert.equal(motivoDoConteudo(e, { status: "duvida", parteFechada: false }, AG, { pecas }), null);
  });
});
