import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analisar,
  assinaturaDaAnalise,
  assuntoJaExplorado,
  CONVITES_SILENCIO_INICIAL,
  cortarAberturaDeMolde,
  INTERVALO_BRECHA_EMPECILHO_MS,
  precisaAbrirBrechaDaMudanca,
  refiltrarComEstadoAtual,
  respostaSilencio,
  type DepsAnalisar,
} from "../analisar";
import { eQuaseDuplicada, limitarFrases } from "../guardas";
import type { PlanoDaSessao } from "../plano";
import { KIT_SYSTEM_DESIGN as kitDemo } from "../kits/system-design";
import { criarClienteFalso, ErroLlm } from "../llm/cliente";
import { motivoBloqueioPlin } from "../sessao/politica";
import { duracaoTotalS, estadoInicial, transicionar, type EstadoSessao, type PerguntaFeita } from "../sessao/estado";
import type { Fase, PedidoAnalise, RespostaAnalise } from "../sessao/tipos";

const AGORA = 10_000_000;
const problema = kitDemo.problemas[0];
const criterios = kitDemo.criterios.map((c) => c.id);

const logs: [string, Record<string, unknown>][] = [];
const log = (e: string, m: Record<string, unknown>) => void logs.push([e, m]);

function deps(llm: DepsAnalisar["llm"]): DepsAnalisar {
  return { llm, kit: kitDemo, problema, log };
}

function estadoEm(fase: Fase, extra: Partial<EstadoSessao> = {}): EstadoSessao {
  return { ...estadoInicial({ criterios }), fase, faseIniciadaEm: AGORA - 1000, ...extra };
}

function pedido(fase: Fase = "APROFUNDAMENTO"): PedidoAnalise {
  return {
    sessao_id: "s1",
    fase,
    grafo: "COMPONENTES\n- [r1] Cliente (retângulo)\n- [e1] Postgres (elipse)\nCONEXÕES\n- [s1] Cliente → Postgres",
    mudancas: "+ adicionou [e1] Postgres",
    conversa_recente: [],
    perguntas_feitas: 0,
    imagem_url: null,
    // #140: as perguntas de conteúdo só saem numa pausa real.
    parado_ha_s: 5,
  };
}

function duvida(extra: Partial<RespostaAnalise> = {}): RespostaAnalise {
  return {
    status: "duvida",
    pergunta: "Com leitura cem vezes maior, o que protege esse banco?",
    nota: "Leitura 100x: gargalo?",
    elementos: ["e1"],
    degrau: null,
    observacoes: [{ criterio: "escalabilidade", sinal: "negativo", espontaneo: false, evidencia: "banco único" }],
    // A pergunta fala do banco, uma parte fechada do desenho (ritmo por conteúdo, #129 bloco B).
    parteFechada: true,
    escopo: false,
    ...extra,
  };
}

describe("analisar", () => {
  it("assinatura muda com o grafo ou com uma fala nova", () => {
    const p = pedido();
    const assinatura = assinaturaDaAnalise(p, 2);
    assert.equal(assinaturaDaAnalise(p, 2), assinatura);
    assert.notEqual(assinaturaDaAnalise({ ...p, grafo: `${p.grafo}\n- [e2] Cache` }, 2), assinatura);
    assert.notEqual(assinaturaDaAnalise(p, 3), assinatura);
  });

  it("usa semReserva quando a política bloqueia pergunta", async () => {
    const llm = criarClienteFalso([duvida()]);
    const estado = estadoEm("APROFUNDAMENTO", { perguntasFeitas: 5, ultimaPerguntaEm: AGORA - 1000 });
    await analisar(deps(llm), estado, pedido(), AGORA);
    assert.equal(llm.chamadas[0].semReserva, true);
  });

  it("dúvida válida vira PLIN_PENDENTE e registra observações", async () => {
    const r = await analisar(deps(criarClienteFalso([duvida()])), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.deepEqual(r.resposta.elementos, ["e1"]);
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
    assert.equal(r.efeitos[0].tipo, "PLIN_PENDENTE");
    assert.equal(r.estado.cobertura.escalabilidade.negativo, 1);
    assert.equal(r.diagnostico.origem, "llm");
  });

  it("o prompt enviado ao LLM leva o grafo no bloco dinâmico, não no estático", async () => {
    const llm = criarClienteFalso([duvida()]);
    await analisar(deps(llm), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    const a = llm.chamadas[0];
    assert.ok(a.sistema.dinamico!.includes("[e1] Postgres"));
    assert.ok(!a.sistema.estatico.includes("[e1] Postgres"));
    assert.equal(a.nomeSchema, "analise_quadro");
  });

  it("nada da ficha/rubrica aparece na resposta ao quadro", async () => {
    const r = await analisar(deps(criarClienteFalso([duvida()])), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    const json = JSON.stringify(r.resposta);
    for (const f of problema.ficha) assert.ok(!json.includes(f.resposta));
    for (const c of kitDemo.criterios) for (const n of [1, 2, 3, 4] as const) assert.ok(!json.includes(c.niveis[n]));
    // #140: gancho é usado pelo estado, mas não atravessa a serialização até o quadro.
    assert.deepEqual(Object.keys(JSON.parse(json)).sort(), ["avancar_fase", "degrau", "elementos", "escopo", "nota", "observacoes", "parteFechada", "pergunta", "status", "visual"]);
  });

  it("ok cancela a dúvida pendente", async () => {
    const pend = transicionar(estadoEm("APROFUNDAMENTO"), { tipo: "ANALISE_RECEBIDA", resposta: duvida() }, AGORA).estado;
    assert.equal(pend.plin, "PLIN_PENDENTE");
    const ok: RespostaAnalise = { status: "ok", pergunta: null, nota: null, elementos: [], degrau: null, observacoes: [], parteFechada: false, escopo: false };
    const r = await analisar(deps(criarClienteFalso([ok])), pend, pedido(), AGORA + 1000);
    assert.equal(r.estado.plin, "LIVRE");
    assert.deepEqual(r.efeitos, [{ tipo: "PLIN_CANCELADO", motivo: "ok" }]);
  });

  it("status não permitido na fase é rebaixado para ok, mantendo observações", async () => {
    // Em REQUISITOS só `duvida` vale (convite do silêncio inicial); `dica` é barrada.
    const r = await analisar(deps(criarClienteFalso([duvida({ status: "dica" })])), estadoEm("REQUISITOS"), pedido("REQUISITOS"), AGORA);
    assert.equal(r.resposta.status, "ok");
    assert.equal(r.resposta.pergunta, null);
    assert.equal(r.resposta.observacoes.length, 1);
    assert.equal(r.estado.plin, "LIVRE");
    assert.equal(r.estado.cobertura.escalabilidade.negativo, 1);
    assert.ok(r.diagnostico.ajustes.includes("rebaixada_pela_politica"));
  });

  it("REQUISITOS: o convite (duvida) vira plin e não gasta a cota de perguntas", async () => {
    const r = await analisar(deps(criarClienteFalso([duvida({ elementos: [] })])),
      estadoEm("REQUISITOS", { faseIniciadaEm: AGORA - 120_000 }), { ...pedido("REQUISITOS"), parado_ha_s: 120, grafo: "" }, AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
    const clicado = transicionar(r.estado, { tipo: "PLIN_CLICADO" }, AGORA + 1).estado;
    assert.equal(clicado.plin, "PERGUNTA_ATIVA");
    assert.equal(clicado.perguntasFeitas, 0);
  });

  it("REQUISITOS: a análise roda e colhe observações; só `duvida` (convite) vira plin", async () => {
    const obs: RespostaAnalise = duvida({ status: "redirecionar", observacoes: [{ criterio: "requisitos", sinal: "positivo", espontaneo: true, evidencia: "perguntou a escala" }] });
    const r = await analisar(deps(criarClienteFalso([obs])), estadoEm("REQUISITOS"), pedido("REQUISITOS"), AGORA);
    assert.equal(r.diagnostico.origem, "llm");
    assert.equal(r.resposta.status, "ok");
    assert.equal(r.estado.cobertura.requisitos.positivo, 1);
  });

  it("intervalo/limite não bloqueiam a análise: observações entram, plin não", async () => {
    const e = estadoEm("APROFUNDAMENTO", { perguntasFeitas: 5, ultimaPerguntaEm: AGORA - 1000 });
    const r = await analisar(deps(criarClienteFalso([duvida()])), e, pedido(), AGORA);
    assert.equal(r.diagnostico.origem, "llm");
    assert.equal(r.resposta.status, "ok");
    assert.equal(r.estado.cobertura.escalabilidade.negativo, 1);
  });

  it("fase que não analisa ou candidato respondendo: não chama o LLM", async () => {
    for (const e of [estadoEm("APRESENTACAO"), estadoEm("APROFUNDAMENTO", { plin: "PERGUNTA_ATIVA" })]) {
      const llm = criarClienteFalso([duvida()]);
      const r = await analisar(deps(llm), e, pedido(), AGORA);
      assert.equal(llm.chamadas.length, 0);
      assert.equal(r.resposta.status, "ok");
      assert.equal(r.diagnostico.origem, "bloqueado");
    }
  });

  it("descarta ids de elementos que não existem no grafo", async () => {
    const r = await analisar(deps(criarClienteFalso([duvida({ elementos: ["e1", "zz9", "r1"] })])), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    assert.deepEqual(r.resposta.elementos, ["e1", "r1"]);
  });

  it("pergunta quase igual a uma já feita é descartada (vira ok)", async () => {
    const feita = { numero: 1, status: "duvida" as const, pergunta: "Com leitura cem vezes maior, o que protege o banco?", nota: null, elementos: ["e1"], degrau: null, fase: "APROFUNDAMENTO" as const, feitaEm: AGORA - 120_000 };
    const e = estadoEm("APROFUNDAMENTO", { perguntas: [feita], perguntasFeitas: 1, ultimaPerguntaEm: AGORA - 120_000 });
    const r = await analisar(deps(criarClienteFalso([duvida()])), e, pedido(), AGORA);
    assert.equal(r.resposta.status, "ok");
    assert.ok(r.diagnostico.ajustes.includes("pergunta_repetida"));
    assert.equal(r.estado.plin, "LIVRE");
  });

  it("repetir a dúvida pendente mantém a pendente (não cancela)", async () => {
    const pend = transicionar(estadoEm("APROFUNDAMENTO"), { tipo: "ANALISE_RECEBIDA", resposta: duvida() }, AGORA).estado;
    const r = await analisar(deps(criarClienteFalso([duvida({ pergunta: "Com leitura cem vezes maior, o que protege esse banco aí?" })])), pend, pedido(), AGORA + 1000);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
  });


  it("erro do LLM (timeout, inválido, qualquer) devolve ok sem lançar e sem mudar o estado", async () => {
    logs.length = 0;
    const e = estadoEm("APROFUNDAMENTO");
    for (const erro of [new ErroLlm("timeout", "x"), new ErroLlm("invalido", "y"), new Error("boom com dados do candidato")]) {
      const r = await analisar(deps(criarClienteFalso([erro])), e, pedido(), AGORA);
      assert.equal(r.resposta.status, "ok");
      assert.equal(r.estado, e);
      assert.equal(r.diagnostico.origem, "erro");
    }
    const texto = JSON.stringify(logs);
    assert.ok(!texto.includes("Postgres"), "log não pode ter o grafo");
    assert.ok(!texto.includes("boom"), "log não pode ter a mensagem do erro");
  });
});

describe("convite fixo de REQUISITOS (#83)", () => {
  const vazio = { ...pedido("REQUISITOS"), grafo: "", mudancas: "", parado_ha_s: 120 };
  const estado = () => estadoEm("REQUISITOS", { faseIniciadaEm: AGORA - 120_000 });

  it("o servidor escolhe o convite mesmo se o modelo sugerir cumprimento ou silêncio", async () => {
    for (const bruta of [duvida({ pergunta: "Oi, tudo bem? Como você está pensando em abordar esse problema?" }), duvida({ status: "ok" })]) {
      const llm = criarClienteFalso([bruta]);
      const r = await analisar(deps(llm), estado(), vazio, AGORA);
      assert.ok(CONVITES_SILENCIO_INICIAL.some((c) => c === r.resposta.pergunta));
      assert.deepEqual(r.resposta.elementos, []);
      assert.deepEqual(r.resposta.visual, []);
      assert.equal(r.resposta.degrau, null);
      assert.equal(r.estado.observacoes.length, 1);
      assert.equal(llm.chamadas.length, 1, "nenhuma geração extra para o convite");
      assert.match(llm.chamadas[0].sistema.estatico, /nunca cumprimente o candidato de novo/);
      const clicado = transicionar(r.estado, { tipo: "PLIN_CLICADO" }, AGORA + 1).estado;
      const respondeu = transicionar(clicado, { tipo: "CANDIDATO_FALOU", texto: "Vou pensar", fimDeResposta: true }, AGORA + 2).estado;
      const outra = await analisar(deps(criarClienteFalso([bruta])), respondeu, vazio, AGORA + 120_000);
      assert.equal(outra.resposta.status, "ok");
      assert.equal(outra.estado.perguntas.length, 1);
    }
  });

  it("não deixa o modelo antecipar o convite nem convidar com desenho presente", async () => {
    for (const [e, p] of [
      [estadoEm("REQUISITOS", { faseIniciadaEm: AGORA - 119_999 }), vazio],
      [estado(), pedido("REQUISITOS")],
      [estado(), { ...vazio, parado_ha_s: 0 }],
    ] as const) {
      const r = await analisar(deps(criarClienteFalso([duvida()])), e, p, AGORA);
      assert.equal(r.resposta.status, "ok");
      assert.equal(r.estado.plin, "LIVRE");
      assert.equal(r.estado.observacoes.length, 1);
    }
  });

  it("substitui convite antigo pendente sem restaurar o cumprimento pela deduplicação", async () => {
    const antiga = duvida({ pergunta: "Oi, tudo bem? Quando quiser, me conta como está pensando em começar. Pode tirar dúvidas comigo." });
    const e: EstadoSessao = { ...estado(), plin: "PLIN_PENDENTE", perguntaPendente: { ...antiga, criadoEm: AGORA - 1 } };
    const r = await analisar(deps(criarClienteFalso([antiga])), e, vazio, AGORA);
    assert.ok(CONVITES_SILENCIO_INICIAL.some((c) => c === r.resposta.pergunta));
    assert.equal(r.estado.perguntaPendente?.pergunta, r.resposta.pergunta);
    assert.deepEqual(r.resposta.elementos, []);
  });

  it("fala registrada enquanto o modelo respondia derruba o convite na refiltragem", async () => {
    const r = await analisar(deps(criarClienteFalso([duvida()])), estado(), vazio, AGORA);
    const atual = transicionar(estado(), { tipo: "CANDIDATO_FALOU", texto: "Me fala o volume", fimDeResposta: false }, AGORA + 1).estado;
    const filtrada = refiltrarComEstadoAtual(atual, r.resposta, vazio, AGORA, AGORA + 2000);
    assert.equal(filtrada.status, "ok");
    assert.equal(filtrada.pergunta, null);
    assert.equal(filtrada.observacoes.length, 1);
  });
});

describe("guardas", () => {
  it("duplicadas por sobreposição de tokens", () => {
    const a = "Onde está o gargalo com leitura cem vezes maior que a escrita?";
    assert.equal(eQuaseDuplicada("Qual o gargalo com a leitura cem vezes maior que escrita?", [a]), true);
    assert.equal(eQuaseDuplicada("O que acontece se o cache cair?", [a]), false);
    assert.equal(eQuaseDuplicada("E o cache?", ["E o cache?"]), true);
  });
  it("limite de frases", () => {
    assert.equal(limitarFrases("Um. Dois! Três?", 2), "Um. Dois!");
  });
});

describe("foto do quadro", () => {
  const FOTO = "data:image/jpeg;base64,/9j/4AAQ";
  it("vai ao modelo junto do pedido, com a instrução de como usá-la", async () => {
    const llm = criarClienteFalso([{ status: "ok", observacoes: [] }]);
    await analisar(deps(llm), estadoEm("APROFUNDAMENTO"), { ...pedido(), imagem_base64: FOTO }, AGORA);
    assert.equal(llm.chamadas[0].imagem, FOTO);
    assert.match(llm.chamadas[0].sistema.dinamico ?? "", /FOTO DO QUADRO/);
  });
  it("sem foto, nada muda", async () => {
    const llm = criarClienteFalso([{ status: "ok", observacoes: [] }]);
    await analisar(deps(llm), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    assert.equal(llm.chamadas[0].imagem ?? null, null);
    assert.doesNotMatch(llm.chamadas[0].sistema.dinamico ?? "", /FOTO DO QUADRO/);
  });
});

describe("refiltrarComEstadoAtual", () => {
  const falou = (base: EstadoSessao, em: number) => transicionar(base, { tipo: "AGENTE_FALOU", texto: "São 20 mil por dia." }, em).estado;
  const ped = (parado?: number): PedidoAnalise => ({ ...pedido(), ...(parado !== undefined ? { parado_ha_s: parado } : {}) });

  it("fala do agente gravada durante a análise: a bola está com o candidato e a pergunta é silenciada", () => {
    const fresco = falou(estadoEm("APROFUNDAMENTO"), AGORA + 1000);
    const r = refiltrarComEstadoAtual(fresco, duvida(), ped(30), AGORA, AGORA + 2000);
    assert.equal(r.status, "ok");
    assert.equal(r.pergunta, null);
    assert.deepEqual(r.elementos, []);
    assert.equal(r.observacoes.length, 1, "as observações são preservadas");
  });

  it("o tempo decorrido soma-se ao parado_ha_s (conservador: não assume ação durante a análise)", () => {
    const fresco = falou(estadoEm("APROFUNDAMENTO"), AGORA + 1000);
    // 1 s parado + 2 s de análise = 3 s: a fala foi há 1 s do fim, ele continua sem agir depois dela.
    assert.equal(refiltrarComEstadoAtual(fresco, duvida(), ped(1), AGORA, AGORA + 2000).status, "ok");
  });

  it("candidato que agiu depois da fala (parado há pouco) mantém a pergunta", () => {
    const fresco = falou(estadoEm("APROFUNDAMENTO"), AGORA - 5000);
    const r = refiltrarComEstadoAtual(fresco, duvida(), ped(1), AGORA, AGORA + 500);
    assert.equal(r.status, "duvida");
    assert.deepEqual(r.elementos, ["e1"]);
  });

  it("silêncio longo depois da fala mantém a pergunta", () => {
    const fresco = falou(estadoEm("APROFUNDAMENTO"), AGORA - 60_000);
    assert.equal(refiltrarComEstadoAtual(fresco, duvida(), ped(40), AGORA, AGORA + 500).status, "duvida");
  });

  it("sem parado_ha_s a regra não se aplica", () => {
    const fresco = falou(estadoEm("APROFUNDAMENTO"), AGORA + 1000);
    assert.equal(motivoBloqueioPlin(fresco, AGORA + 2000, undefined, { paradoHaS: undefined }), null, "sem relógio, a regra da bola não presume falta de ação");
    assert.equal(refiltrarComEstadoAtual(fresco, duvida({ gancho: "decisao" }), ped(), AGORA, AGORA + 2000).status, "ok", "sem dados não se presume uma pausa real de 4 s");
  });

  it("é idempotente para resposta já silenciada e para resposta já filtrada", () => {
    const livre = estadoEm("APROFUNDAMENTO");
    const silenciada = refiltrarComEstadoAtual(falou(livre, AGORA + 1000), duvida(), ped(30), AGORA, AGORA + 2000);
    assert.deepEqual(refiltrarComEstadoAtual(livre, silenciada, ped(30), AGORA, AGORA + 2000), silenciada);
    const filtrada = refiltrarComEstadoAtual(livre, duvida(), ped(), AGORA, AGORA + 2000);
    assert.deepEqual(refiltrarComEstadoAtual(livre, filtrada, ped(), AGORA, AGORA + 2000), filtrada);
  });
});

describe("analisar: ritmo por conteúdo do quadro (#129, bloco B)", () => {
  const MIN = 60_000;

  it("#140: sem gancho, continua ok antes do teto e as observações ficam", async () => {
    const llm = criarClienteFalso([duvida({ parteFechada: false })]);
    const r = await analisar(deps(llm), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    assert.equal(r.resposta.status, "ok");
    assert.equal(r.resposta.pergunta, null);
    assert.equal(r.estado.plin, "LIVRE");
    assert.ok(r.diagnostico.ajustes.includes("sem_gancho"));
    assert.equal(r.resposta.observacoes.length, 1);
    assert.equal(r.estado.cobertura.escalabilidade.negativo, 1);
  });

  it("#140: parte fechada dentro do piso de 45 s vira ok (piso_entre_perguntas) e as observações ficam", async () => {
    const estado = estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AGORA - 30_000 });
    const r = await analisar(deps(criarClienteFalso([duvida()])), estado, pedido(), AGORA);
    assert.equal(r.resposta.status, "ok");
    assert.equal(r.estado.plin, "LIVRE");
    assert.ok(r.diagnostico.ajustes.includes("piso_entre_perguntas"));
    assert.equal(r.estado.cobertura.escalabilidade.negativo, 1);
  });

  it("parte fechada depois do piso continua virando pergunta", async () => {
    const estado = estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AGORA - 3 * MIN });
    const r = await analisar(deps(criarClienteFalso([duvida()])), estado, pedido(), AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
    assert.equal(r.diagnostico.ajustes.includes("piso_entre_perguntas"), false);
  });

  it("teto: sem parte fechada, 5 min sem pergunta e desenho novo, a pergunta sai", async () => {
    // O grafo do pedido tem r1, e1 e s1; a última pergunta foi feita com só r1 no quadro: há peça nova.
    const estado = estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AGORA - 5 * MIN, desenhoNaUltimaPergunta: ["r1"] });
    const r = await analisar(deps(criarClienteFalso([duvida({ parteFechada: false })])), estado, pedido(), AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
    assert.equal(r.diagnostico.ajustes.includes("sem_parte_fechada"), false);
  });

  it("quebra de silêncio (60 s parado) fura o piso mesmo com a pergunta anterior há 30 s", async () => {
    const estado = estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AGORA - 30_000 });
    const r = await analisar(deps(criarClienteFalso([duvida()])), estado, { ...pedido(), parado_ha_s: 60 }, AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
  });

  it("refiltrar com o estado de agora: pergunta ouvida durante a análise conta para o piso", () => {
    const resposta = duvida();
    const ouviuAgora = estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AGORA - 30_000 });
    assert.equal(refiltrarComEstadoAtual(ouviuAgora, resposta, pedido(), AGORA - 1000, AGORA).status, "ok");
    assert.equal(refiltrarComEstadoAtual(estadoEm("APROFUNDAMENTO"), resposta, pedido(), AGORA - 1000, AGORA).status, "duvida");
  });

  it("o desenho da análise vira o snapshot da pergunta que ela gera", async () => {
    const r = await analisar(deps(criarClienteFalso([duvida()])), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    assert.deepEqual(r.estado.perguntaPendente?.pecas, ["r1", "e1", "s1"]);
    const feita = transicionar(r.estado, { tipo: "PLIN_CLICADO" }, AGORA + 1000).estado;
    assert.deepEqual(feita.desenhoNaUltimaPergunta, ["r1", "e1", "s1"]);
  });
});

describe("brecha da mudança depois dos 60% (#129, decisão G)", () => {
  const total = duracaoTotalS(estadoInicial({ criterios }));
  /** No meio do aprofundamento, com a entrevista começada `fracao` do tempo total atrás. */
  const comFracao = (fracao: number, extra: Partial<EstadoSessao> = {}) =>
    estadoEm("APROFUNDAMENTO", { iniciadaEm: AGORA - fracao * total * 1000, ...extra });
  const anunciada = { id: "x", fala: "f?", requisito: "r", exige: "e", anunciadoEm: AGORA - 1, fase: "ALTO_NIVEL" as const, forcado: false };

  it("só passada a fração da garantia, no meio da entrevista, sem mudança anunciada e com mudança prevista", () => {
    assert.equal(precisaAbrirBrechaDaMudanca(comFracao(0.59), AGORA, true), false);
    assert.equal(precisaAbrirBrechaDaMudanca(comFracao(0.6), AGORA, true), true);
    assert.equal(precisaAbrirBrechaDaMudanca(comFracao(0.7, { empecilho: anunciada }), AGORA, true), false);
    assert.equal(precisaAbrirBrechaDaMudanca({ ...comFracao(0.7), fase: "FECHAMENTO" }, AGORA, true), false);
    assert.equal(precisaAbrirBrechaDaMudanca(comFracao(0.7), AGORA, false), false, "problema sem mudança prevista");
  });

  it("um ciclo por vez: depois de uma brecha, espera o intervalo", () => {
    const e = comFracao(0.7, { brechaEmpecilhoEm: AGORA - 30_000 });
    assert.equal(precisaAbrirBrechaDaMudanca(e, AGORA, true), false);
    assert.equal(precisaAbrirBrechaDaMudanca(e, AGORA + INTERVALO_BRECHA_EMPECILHO_MS - 30_000, true), true);
  });

  it("a análise troca a dúvida por ok, registra o ajuste e guarda a hora da brecha", async () => {
    const r = await analisar(deps(criarClienteFalso([duvida()])), comFracao(0.7), pedido(), AGORA);
    assert.equal(r.resposta.status, "ok");
    assert.ok(r.diagnostico.ajustes.includes("abre_brecha_empecilho"));
    assert.equal(r.estado.brechaEmpecilhoEm, AGORA);
  });

  it("antes da garantia a dúvida segue e nada é registrado", async () => {
    const r = await analisar(deps(criarClienteFalso([duvida()])), comFracao(0.3), pedido(), AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.diagnostico.ajustes.includes("abre_brecha_empecilho"), false);
    assert.equal(r.estado.brechaEmpecilhoEm, undefined);
  });
});

describe("analisar: a pergunta da análise sai em português claro (#129, decisão H)", () => {
  const comVaga = (descricaoVaga?: string) => estadoEm("APROFUNDAMENTO", {
    plano: { cargo: "Engenheiro de logística", senioridade: "pleno", tom: "amigavel", dicas: "livres", foco: [], notas: "", duracaoMin: 30, ...(descricaoVaga ? { descricaoVaga } : {}) } as PlanoDaSessao,
  });

  it("a pergunta com courier vira entregador antes de virar plin", async () => {
    const llm = criarClienteFalso([duvida({ pergunta: "Quando o courier perde o sinal, o que acontece com a entrega?" })]);
    const r = await analisar(deps(llm), comVaga(), pedido(), AGORA);
    assert.equal(r.resposta.pergunta, "Quando o entregador perde o sinal, o que acontece com a entrega?");
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
  });

  it("com o termo na descrição da vaga, a pergunta mantém o termo", async () => {
    const llm = criarClienteFalso([duvida({ pergunta: "Quando o courier perde o sinal, o que acontece?" })]);
    const r = await analisar(deps(llm), comVaga("Entregas com courier próprio."), pedido(), AGORA);
    assert.equal(r.resposta.pergunta, "Quando o courier perde o sinal, o que acontece?");
  });
});

describe("analisar: redirecionamento de escopo (#129, decisão I)", () => {
  const redireciona = (extra: Partial<RespostaAnalise> = {}): RespostaAnalise =>
    duvida({ status: "redirecionar", parteFechada: false, escopo: true, pergunta: "O problema pede a arquitetura, não as telas. Por onde você começaria?", ...extra });
  const semDesenho: PedidoAnalise = { ...pedido(), grafo: "" };

  it("primeiro redirecionamento de escopo com desenho vira plin", async () => {
    const r = await analisar(deps(criarClienteFalso([redireciona()])), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    assert.equal(r.resposta.status, "redirecionar");
    assert.equal(r.resposta.escopo, true);
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
    assert.equal(r.diagnostico.ajustes.length, 0);
  });

  it("sem desenho, o escopo vira ok com o ajuste escopo_sem_desenho", async () => {
    const r = await analisar(deps(criarClienteFalso([redireciona()])), estadoEm("APROFUNDAMENTO"), semDesenho, AGORA);
    assert.equal(r.resposta.status, "ok");
    assert.equal(r.resposta.escopo, false);
    assert.ok(r.diagnostico.ajustes.includes("escopo_sem_desenho"));
  });

  it("na fase de REQUISITOS, o escopo vira ok com o ajuste escopo_fora_da_fase", async () => {
    const r = await analisar(deps(criarClienteFalso([redireciona()])), estadoEm("REQUISITOS"), pedido("REQUISITOS"), AGORA);
    assert.equal(r.resposta.status, "ok");
    assert.ok(r.diagnostico.ajustes.includes("escopo_fora_da_fase"));
  });

  it("segundo redirecionamento antes de 5 min vira ok; depois de 5 min passa", async () => {
    const e = estadoEm("APROFUNDAMENTO", { escopoRedirecionamentos: 1, escopoProvocadoEm: AGORA - 4 * 60_000 });
    const cedo = await analisar(deps(criarClienteFalso([redireciona()])), e, pedido(), AGORA);
    assert.equal(cedo.resposta.status, "ok");
    assert.ok(cedo.diagnostico.ajustes.includes("escopo_espera_lembrete"));
    const tarde = await analisar(deps(criarClienteFalso([redireciona()])), { ...e, escopoProvocadoEm: AGORA - 5 * 60_000 }, pedido(), AGORA);
    assert.equal(tarde.resposta.status, "redirecionar");
  });

  it("terceiro redirecionamento nunca sai", async () => {
    const e = estadoEm("APROFUNDAMENTO", { escopoRedirecionamentos: 2, escopoProvocadoEm: AGORA - 60 * 60_000 });
    const r = await analisar(deps(criarClienteFalso([redireciona()])), e, pedido(), AGORA);
    assert.equal(r.resposta.status, "ok");
    assert.ok(r.diagnostico.ajustes.includes("escopo_ja_redirecionado"));
  });

  it("escopo fora de redirecionar (ex.: duvida) é descartado sem mudar o status", async () => {
    const r = await analisar(deps(criarClienteFalso([duvida({ escopo: true })])), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.resposta.escopo, false);
  });

  it("refiltragem com o estado de agora também barra o terceiro", () => {
    const atual = estadoEm("APROFUNDAMENTO", { escopoRedirecionamentos: 2, escopoProvocadoEm: AGORA - 60 * 60_000 });
    const r = refiltrarComEstadoAtual(atual, redireciona(), pedido(), AGORA, AGORA);
    assert.equal(r.status, "ok");
  });
});

describe("analisar: pergunta obrigatória no teto (#129, bloco B)", () => {
  const MIN = 60_000;
  // 4 min sem pergunta e uma peça nova no grafo (r1 já estava na última pergunta): o teto (3 min) venceu.
  const comTetoVencido = () => estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AGORA - 4 * MIN, desenhoNaUltimaPergunta: ["r1"] });

  it("o teto vencido e um \"ok\" do modelo geram uma segunda chamada, com o aviso, e a pergunta sai", async () => {
    const llm = criarClienteFalso([respostaSilencio(), duvida()]);
    const r = await analisar(deps(llm), comTetoVencido(), pedido(), AGORA);
    assert.equal(llm.chamadas.length, 2);
    assert.ok(llm.chamadas[1]?.sistema.dinamico?.includes("ATENÇÃO: faz tempo que você não pergunta"));
    assert.ok(!llm.chamadas[0]?.sistema.dinamico?.includes("ATENÇÃO: faz tempo que você não pergunta"));
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
    assert.equal(r.diagnostico.ajustes.includes("teto_sem_pergunta"), false);
  });

  it("se a segunda chamada também devolve \"ok\", fica \"ok\" e a análise registra teto_sem_pergunta", async () => {
    const llm = criarClienteFalso([respostaSilencio(), respostaSilencio()]);
    const r = await analisar(deps(llm), comTetoVencido(), pedido(), AGORA);
    assert.equal(llm.chamadas.length, 2);
    assert.equal(r.resposta.status, "ok");
    assert.equal(r.estado.plin, "LIVRE");
    assert.ok(r.diagnostico.ajustes.includes("teto_sem_pergunta"));
  });

  it("se a segunda chamada falha, fica \"ok\" com teto_sem_pergunta (sem lançar)", async () => {
    const llm = criarClienteFalso([respostaSilencio(), new ErroLlm("timeout", "prazo")]);
    const r = await analisar(deps(llm), comTetoVencido(), pedido(), AGORA);
    assert.equal(llm.chamadas.length, 2);
    assert.equal(r.resposta.status, "ok");
    assert.equal(r.diagnostico.origem, "llm");
    assert.ok(r.diagnostico.ajustes.includes("teto_sem_pergunta"));
  });

  it("no máximo uma segunda chamada por análise", async () => {
    const llm = criarClienteFalso([respostaSilencio()]);
    await analisar(deps(llm), comTetoVencido(), pedido(), AGORA);
    assert.equal(llm.chamadas.length, 2);
  });

  it("com outro portão fechado (orçamento de perguntas), o \"ok\" não ganha segunda chamada", async () => {
    const llm = criarClienteFalso([respostaSilencio()]);
    const estado = { ...comTetoVencido(), perguntasFeitas: 50 };
    const r = await analisar(deps(llm), estado, pedido(), AGORA);
    assert.equal(llm.chamadas.length, 1);
    assert.equal(r.diagnostico.ajustes.includes("teto_sem_pergunta"), false);
  });

  it("sem teto vencido, o \"ok\" é o da primeira chamada (nenhuma segunda)", async () => {
    const llm = criarClienteFalso([respostaSilencio()]);
    const estado = estadoEm("APROFUNDAMENTO", { ultimaPerguntaEm: AGORA - 60_000, desenhoNaUltimaPergunta: ["r1"] });
    await analisar(deps(llm), estado, pedido(), AGORA);
    assert.equal(llm.chamadas.length, 1);
  });
});

/** Uma pergunta já feita que citou estas peças (ids do grafo de `pedido()`: r1 Cliente, e1 Postgres). */
function feita(numero: number, elementos: string[]): PerguntaFeita {
  return { numero, status: "duvida", gancho: "raciocinio", pergunta: `Pergunta feita ${numero}?`, nota: null, elementos, degrau: null, fase: "APROFUNDAMENTO", feitaEm: AGORA - 600_000 };
}

describe("analisar: abertura de molde da pergunta (#129, bloco J)", () => {
  const grafo = pedido().grafo;

  it("corta \"Vi que você ...\" e \"Para entender como você ..., \" e mantém a pergunta", () => {
    assert.deepEqual(
      cortarAberturaDeMolde("Vi que você colocou o Postgres. Para entender como você lida com carga, o que acontece quando o Postgres cai?", grafo),
      { texto: "O que acontece quando o Postgres cai?", cortou: true },
    );
  });

  it("corta \"Notei que você\" e \"Percebi que você\" quando sobra pergunta com peça citada", () => {
    assert.equal(cortarAberturaDeMolde("Notei que você ligou o Cliente ao Postgres. Por que essa ligação vai direto ao Postgres?", grafo).texto, "Por que essa ligação vai direto ao Postgres?");
    assert.equal(cortarAberturaDeMolde("Percebi que você ligou o Cliente. Por que o Cliente fala com o Postgres?", grafo).texto, "Por que o Cliente fala com o Postgres?");
  });

  it("\"Para entender como você ...\" sozinho sai, desde que sobre uma pergunta", () => {
    assert.deepEqual(cortarAberturaDeMolde("Para entender como você lida com carga, o que acontece no Postgres?", grafo), { texto: "O que acontece no Postgres?", cortou: true });
  });

  it("não corta se sobraria sem \"?\"", () => {
    const t = "Vi que você colocou o Postgres. Isso faz sentido para o cargo.";
    assert.deepEqual(cortarAberturaDeMolde(t, grafo), { texto: t, cortou: false });
    const p = "Para entender como você lida com carga, veja o Postgres.";
    assert.deepEqual(cortarAberturaDeMolde(p, grafo), { texto: p, cortou: false });
  });

  it("\"Vi que você\" não sai se a pergunta que sobra não cita peça do desenho", () => {
    const t = "Vi que você colocou a fila e o cache, e como eles se falam?";
    assert.deepEqual(cortarAberturaDeMolde(t, grafo), { texto: t, cortou: false });
  });

  it("só corta se o que sobra começa com palavra de pergunta", () => {
    // A vírgula do Redis cortaria no lugar errado: sobra "Redis ou memória, o que...?", que não é pergunta.
    const redis = "Para entender como você lida com cache, Redis ou memória, o que acontece se faltar?";
    assert.deepEqual(cortarAberturaDeMolde(redis, grafo), { texto: redis, cortou: false });
    const sujeito = "Vi que você colocou o Postgres. Postgres aguenta a carga, o que acha?";
    assert.deepEqual(cortarAberturaDeMolde(sujeito, grafo), { texto: sujeito, cortou: false });
    assert.equal(cortarAberturaDeMolde("Vi que você colocou o Postgres. Qual o motivo do Postgres?", grafo).texto, "Qual o motivo do Postgres?");
  });

  it("pergunta sem abertura de molde fica como está", () => {
    const t = "Por que o Postgres, e não outro banco?";
    assert.deepEqual(cortarAberturaDeMolde(t, grafo), { texto: t, cortou: false });
  });

  it("na análise, a abertura sai e o ajuste abertura_de_molde é registrado", async () => {
    const llm = criarClienteFalso([duvida({ pergunta: "Vi que você colocou o Postgres. Para entender como você lida com carga, o que acontece quando o Postgres cai?" })]);
    const r = await analisar(deps(llm), estadoEm("APROFUNDAMENTO"), pedido(), AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.resposta.pergunta, "O que acontece quando o Postgres cai?");
    assert.ok(r.diagnostico.ajustes.includes("abertura_de_molde"));
  });
});

describe("analisar: assunto já explorado (#129, bloco J)", () => {
  // Duas perguntas feitas sobre o Postgres (e1): a peça já foi perguntada duas vezes.
  const comPostgresDuasVezes = () => estadoEm("APROFUNDAMENTO", { perguntas: [feita(1, ["e1"]), feita(2, ["e1"])] });

  it("pergunta só sobre peças já perguntadas duas vezes é assunto repetido", () => {
    const e = comPostgresDuasVezes();
    assert.equal(assuntoJaExplorado({ status: "duvida", elementos: ["e1"] }, e), true);
    assert.equal(assuntoJaExplorado({ status: "dica", elementos: ["e1"] }, e), true);
  });

  it("uma peça nova na pergunta não é repetição, mesmo com a outra já perguntada", () => {
    assert.equal(assuntoJaExplorado({ status: "duvida", elementos: ["e1", "r1"] }, comPostgresDuasVezes()), false);
  });

  it("peça perguntada só uma vez não é repetição", () => {
    const e = estadoEm("APROFUNDAMENTO", { perguntas: [feita(1, ["e1"])] });
    assert.equal(assuntoJaExplorado({ status: "duvida", elementos: ["e1"] }, e), false);
  });

  it("as peças perguntadas juntas (duas peças, cada uma duas vezes) contam como repetição", () => {
    const e = estadoEm("APROFUNDAMENTO", { perguntas: [feita(1, ["e1", "r1"]), feita(2, ["r1", "e1"])] });
    assert.equal(assuntoJaExplorado({ status: "duvida", elementos: ["e1", "r1"] }, e), true);
  });

  it("não vale para ok, redirecionar, FECHAMENTO, quebra de silêncio nem sem elemento citado", () => {
    const e = comPostgresDuasVezes();
    assert.equal(assuntoJaExplorado({ status: "ok", elementos: ["e1"] }, e), false);
    assert.equal(assuntoJaExplorado({ status: "redirecionar", elementos: ["e1"] }, e), false);
    assert.equal(assuntoJaExplorado({ status: "duvida", elementos: ["e1"] }, { ...e, fase: "FECHAMENTO" }), false);
    assert.equal(assuntoJaExplorado({ status: "duvida", elementos: ["e1"] }, e, 60), false);
    assert.equal(assuntoJaExplorado({ status: "duvida", elementos: [] }, e), false);
  });

  it("na análise, pergunta de assunto repetido vira ok (assunto_repetido) e a observação fica", async () => {
    const llm = criarClienteFalso([duvida({ elementos: ["e1"] })]);
    const r = await analisar(deps(llm), comPostgresDuasVezes(), pedido(), AGORA);
    assert.equal(r.resposta.status, "ok");
    assert.equal(r.estado.plin, "LIVRE");
    assert.ok(r.diagnostico.ajustes.includes("assunto_repetido"));
    assert.equal(r.resposta.observacoes.length, 1);
  });

  it("na análise, peça nova na pergunta passa", async () => {
    const llm = criarClienteFalso([duvida({ elementos: ["e1", "r1"] })]);
    const r = await analisar(deps(llm), comPostgresDuasVezes(), pedido(), AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.diagnostico.ajustes.includes("assunto_repetido"), false);
  });

  it("quebra de silêncio (60 s parado) não é bloqueada pela repetição", async () => {
    const llm = criarClienteFalso([duvida({ elementos: ["e1"] })]);
    const r = await analisar(deps(llm), comPostgresDuasVezes(), { ...pedido(), parado_ha_s: 60 }, AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.diagnostico.ajustes.includes("assunto_repetido"), false);
  });

  it("pergunta obrigatória do teto repetida: segunda chamada com o aviso acrescido; se ela trouxer outra parte, sai", async () => {
    // 4 min sem pergunta e peça nova: o teto venceu. A primeira pergunta repete o Postgres.
    const estado = estadoEm("APROFUNDAMENTO", {
      ultimaPerguntaEm: AGORA - 4 * 60_000, desenhoNaUltimaPergunta: ["r1"], perguntas: [feita(1, ["e1"]), feita(2, ["e1"])],
    });
    const outra = duvida({ pergunta: "Se o cliente repetir o pedido, o que acontece?", elementos: ["r1"] });
    const llm = criarClienteFalso([duvida({ elementos: ["e1"] }), outra]);
    const r = await analisar(deps(llm), estado, pedido(), AGORA);
    assert.equal(llm.chamadas.length, 2);
    assert.ok(llm.chamadas[1]?.sistema.dinamico?.includes("A pergunta anterior repetiu um assunto já perguntado"));
    assert.ok(!llm.chamadas[0]?.sistema.dinamico?.includes("A pergunta anterior repetiu um assunto já perguntado"));
    assert.equal(r.resposta.pergunta, "Se o cliente repetir o pedido, o que acontece?");
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.diagnostico.ajustes.includes("assunto_repetido"), false);
  });

  it("pergunta obrigatória repetida: se a segunda também repete, a pergunta do teto fica (ajuste no teto)", async () => {
    const estado = estadoEm("APROFUNDAMENTO", {
      ultimaPerguntaEm: AGORA - 4 * 60_000, desenhoNaUltimaPergunta: ["r1"], perguntas: [feita(1, ["e1"]), feita(2, ["e1"])],
    });
    const llm = criarClienteFalso([duvida({ elementos: ["e1"] }), duvida({ elementos: ["e1"] })]);
    const r = await analisar(deps(llm), estado, pedido(), AGORA);
    assert.equal(llm.chamadas.length, 2);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.estado.plin, "PLIN_PENDENTE");
    assert.ok(r.diagnostico.ajustes.includes("assunto_repetido_no_teto"));
  });

  it("pergunta obrigatória repetida e segunda chamada falha: a pergunta do teto fica (sem lançar)", async () => {
    const estado = estadoEm("APROFUNDAMENTO", {
      ultimaPerguntaEm: AGORA - 4 * 60_000, desenhoNaUltimaPergunta: ["r1"], perguntas: [feita(1, ["e1"]), feita(2, ["e1"])],
    });
    const llm = criarClienteFalso([duvida({ elementos: ["e1"] }), new ErroLlm("timeout", "prazo")]);
    const r = await analisar(deps(llm), estado, pedido(), AGORA);
    assert.equal(r.resposta.status, "duvida");
    assert.equal(r.diagnostico.origem, "llm");
  });
});
