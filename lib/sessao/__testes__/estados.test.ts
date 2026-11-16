import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoInicial as estadoDoServidor } from "@/lib/agente/sessao/estado";
import { motivoBloqueioPlin } from "@/lib/agente/sessao/politica";
import { intervaloMinimoMs, orcamentoDeInterrupcoes, RITMO } from "@/lib/interrupcao/politica";
import {
  aceitaPlin,
  DURACAO_PADRAO_MIN,
  estadoInicial,
  podeAnalisar,
  transicionar,
  type EstadoEntrevista,
  type EventoEntrevista,
} from "../estados";
import type { RespostaAnalise } from "../cliente";

const duvida: RespostaAnalise = {
  status: "duvida",
  pergunta: "Onde está o gargalo?",
  nota: "Gargalo?",
  elementos: ["e1"],
  degrau: null,
  observacoes: [],
};
const ok: RespostaAnalise = { ...duvida, status: "ok", pergunta: null, nota: null, elementos: [] };

test("fechamento comum limpa a pergunta da análise, bloqueia novas e restaura a fase ao suspender", () => {
  const inicial = noAprofundamento();
  const fechando = transicionar({ ...inicial, plin: "PLIN_PENDENTE", perguntaPendente: duvida }, { tipo: "FECHAMENTO_ATUALIZADO", etapa: "perguntas_finais" }, 1000);
  assert.equal(fechando.fase, "FECHAMENTO");
  assert.equal(fechando.plin, "LIVRE");
  assert.equal(transicionar(fechando, { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 2000).plin, "LIVRE");
  const voltou = transicionar(fechando, { tipo: "FECHAMENTO_ATUALIZADO", etapa: null }, 3000);
  assert.equal(voltou.fase, inicial.fase);
  assert.equal(voltou.faseIniciadaEm, inicial.faseIniciadaEm);
  assert.equal(voltou.fechamento, null);
});

test("nova fala: a intervenção pendente espera a próxima brecha, cai só se ficou velha; a ativa continua", () => {
  const pendente = transicionar(noAprofundamento(), { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 0);
  assert.equal(transicionar(pendente, { tipo: "CANDIDATO_CONTINUOU" }, 1).plin, "PLIN_PENDENTE");
  assert.equal(transicionar(pendente, { tipo: "CANDIDATO_CONTINUOU" }, RITMO.pendenteValidaMs).plin, "LIVRE");
  const ativa = transicionar(pendente, { tipo: "PLIN_CLICADO" }, 1);
  assert.equal(transicionar(ativa, { tipo: "CANDIDATO_CONTINUOU" }, 2).plin, "PERGUNTA_ATIVA");
});

function rodar(eventos: [EventoEntrevista, number][], inicio: EstadoEntrevista = estadoInicial()) {
  return eventos.reduce((e, [ev, t]) => transicionar(e, ev, t), inicio);
}

function noAprofundamento(): EstadoEntrevista {
  return { ...estadoInicial(), fase: "APROFUNDAMENTO", faseIniciadaEm: 0 };
}

test("fases seguem a ordem: começar, apresentação, requisitos, desenho", () => {
  const e = rodar([
    [{ tipo: "COMECAR" }, 0],
    [{ tipo: "APRESENTACAO_TERMINOU" }, 10],
    [{ tipo: "CANDIDATO_DESENHOU" }, 20],
  ]);
  assert.equal(e.fase, "ALTO_NIVEL");
  assert.equal(e.faseIniciadaEm, 20);
});

test("tempo da fase acabando avança até encerrar", () => {
  const e = rodar(
    Array.from({ length: 4 }, (_, i) => [{ tipo: "TEMPO_DA_FASE_ACABOU" } as EventoEntrevista, i]),
    { ...estadoInicial(), fase: "REQUISITOS" },
  );
  assert.equal(e.fase, "ENCERRADA");
});

test("sinal de prontidão do cérebro avança o alto nível para o aprofundamento", () => {
  const altoNivel: EstadoEntrevista = { ...estadoInicial(), fase: "ALTO_NIVEL", faseIniciadaEm: 0 };
  const pronto: RespostaAnalise = { ...ok, avancar_fase: true };
  // Cedo demais (menos de 30 s na fase): ignora.
  assert.equal(transicionar(altoNivel, { tipo: "ANALISE_RECEBIDA", resposta: pronto }, 10_000).fase, "ALTO_NIVEL");
  // Passado o mínimo: avança e marca o início da nova fase.
  const e = transicionar(altoNivel, { tipo: "ANALISE_RECEBIDA", resposta: pronto }, 45_000);
  assert.equal(e.fase, "APROFUNDAMENTO");
  assert.equal(e.faseIniciadaEm, 45_000);
  // Sem o sinal, não avança.
  assert.equal(transicionar(altoNivel, { tipo: "ANALISE_RECEBIDA", resposta: ok }, 45_000).fase, "ALTO_NIVEL");
});

test("sinal de prontidão não vale fora do alto nível nem com o candidato respondendo", () => {
  const pronto: RespostaAnalise = { ...ok, avancar_fase: true };
  assert.equal(transicionar(noAprofundamento(), { tipo: "ANALISE_RECEBIDA", resposta: pronto }, 90_000).fase, "APROFUNDAMENTO");
  const requisitos: EstadoEntrevista = { ...estadoInicial(), fase: "REQUISITOS", faseIniciadaEm: 0 };
  assert.equal(transicionar(requisitos, { tipo: "ANALISE_RECEBIDA", resposta: pronto }, 90_000).fase, "REQUISITOS");
  const respondendo: EstadoEntrevista = { ...estadoInicial(), fase: "ALTO_NIVEL", faseIniciadaEm: 0, plin: "PERGUNTA_ATIVA" };
  assert.equal(transicionar(respondendo, { tipo: "ANALISE_RECEBIDA", resposta: pronto }, 90_000).fase, "ALTO_NIVEL");
});

test("candidato concluiu no alto nível vai ao aprofundamento, sem mínimo de tempo", () => {
  const altoNivel: EstadoEntrevista = { ...estadoInicial(), fase: "ALTO_NIVEL", faseIniciadaEm: 0 };
  const e = transicionar(altoNivel, { tipo: "CANDIDATO_CONCLUIU" }, 1_000);
  assert.equal(e.fase, "APROFUNDAMENTO");
  assert.equal(e.faseIniciadaEm, 1_000);
  // Nas outras fases, ou respondendo a um plin, não muda nada.
  assert.equal(transicionar(noAprofundamento(), { tipo: "CANDIDATO_CONCLUIU" }, 1_000).fase, "APROFUNDAMENTO");
  const requisitos: EstadoEntrevista = { ...estadoInicial(), fase: "REQUISITOS", faseIniciadaEm: 0 };
  assert.equal(transicionar(requisitos, { tipo: "CANDIDATO_CONCLUIU" }, 1_000).fase, "REQUISITOS");
  assert.equal(transicionar({ ...altoNivel, plin: "PERGUNTA_ATIVA" }, { tipo: "CANDIDATO_CONCLUIU" }, 1_000).fase, "ALTO_NIVEL");
});

test("requisitos analisa (silêncio inicial); apresentação e pergunta ativa não", () => {
  assert.equal(podeAnalisar({ ...estadoInicial(), fase: "REQUISITOS" }), true);
  assert.equal(podeAnalisar({ ...estadoInicial(), fase: "APRESENTACAO" }), false);
  assert.equal(podeAnalisar(noAprofundamento()), true);
  assert.equal(podeAnalisar({ ...noAprofundamento(), plin: "PERGUNTA_ATIVA" }), false);
});

test("ciclo completo do plin no aprofundamento", () => {
  let e = transicionar(noAprofundamento(), { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 1_000);
  assert.equal(e.plin, "PLIN_PENDENTE");
  e = transicionar(e, { tipo: "PLIN_CLICADO" }, 2_000);
  assert.equal(e.plin, "PERGUNTA_ATIVA");
  assert.equal(e.perguntasFeitas, 1);
  assert.equal(e.perguntaAtiva?.numero, 1);
  e = transicionar(e, { tipo: "RESPOSTA_TERMINOU" }, 5_000);
  assert.equal(e.plin, "LIVRE");
  assert.equal(e.ultimaRespostaEm, 5_000);
});

/** Orçamento, intervalo e respiro da política comum (lib/interrupcao/politica.ts) para a entrevista padrão. */
const LIMITE = orcamentoDeInterrupcoes(DURACAO_PADRAO_MIN);
const INTERVALO = intervaloMinimoMs(DURACAO_PADRAO_MIN);
const RESPIRO = RITMO.respiroMs;
/** No meio do aprofundamento, longe do começo da fase (marco) e com a cota do tempo livre. */
function noMeio(): EstadoEntrevista {
  return { ...noAprofundamento(), faseIniciadaEm: -10 * 60_000, iniciadaEm: -20 * 60_000 };
}
const analisar = (e: EstadoEntrevista, t: number) => transicionar(e, { tipo: "ANALISE_RECEBIDA", resposta: duvida }, t).plin;

test("respeita o respiro da política comum depois da resposta", () => {
  const depois = { ...noMeio(), ultimaPerguntaEm: -5 * 60_000, ultimaRespostaEm: 10_000 };
  assert.equal(analisar(depois, 10_000 + RESPIRO - 1), "LIVRE");
  assert.equal(analisar(depois, 10_000 + RESPIRO), "PLIN_PENDENTE");
});

test("o intervalo conta do início da pergunta e o respiro, do fim da resposta", () => {
  const respondeu = { ...noMeio(), ultimaPerguntaEm: 1_000, ultimaRespostaEm: 100_000 };
  assert.equal(analisar(respondeu, 100_000 + RESPIRO - 1), "LIVRE");
  assert.equal(analisar(respondeu, 100_000 + RESPIRO), "PLIN_PENDENTE");
  const perguntando = { ...noMeio(), ultimaPerguntaEm: 100_000, ultimaRespostaEm: 1_000 };
  assert.equal(analisar(perguntando, 100_000 + INTERVALO - 1), "LIVRE");
  assert.equal(analisar(perguntando, 100_000 + INTERVALO), "PLIN_PENDENTE");
});

test("o clique na pergunta registra ultimaPerguntaEm e o fim da resposta abre o respiro", () => {
  let e = transicionar(noMeio(), { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 0);
  e = transicionar(e, { tipo: "PLIN_CLICADO" }, 5_000);
  assert.equal(e.ultimaPerguntaEm, 5_000);
  e = transicionar(e, { tipo: "RESPOSTA_TERMINOU" }, 50_000);
  const libera = Math.max(5_000 + INTERVALO, 50_000 + RESPIRO);
  assert.equal(analisar(e, libera - 1), "LIVRE");
  assert.equal(analisar(e, libera), "PLIN_PENDENTE");
});

test("estado salvo sem ultimaPerguntaEm continua funcionando", () => {
  const antigo = noMeio();
  delete (antigo as { ultimaPerguntaEm?: number | null }).ultimaPerguntaEm;
  assert.equal(analisar(antigo, 0), "PLIN_PENDENTE");
  const comResposta = { ...antigo, ultimaRespostaEm: 10_000 };
  assert.equal(analisar(comResposta, 10_000 + RESPIRO - 1), "LIVRE");
  assert.equal(analisar(comResposta, 10_000 + RESPIRO), "PLIN_PENDENTE");
});

test("servidor e quadro usam a mesma política (lib/interrupcao/politica.ts)", () => {
  const T = 30 * 60_000;
  const cliente = { ...noMeio(), iniciadaEm: 0, ultimaPerguntaEm: T - 60_000, ultimaRespostaEm: T - 50_000, perguntasFeitas: 3 };
  const servidor = { ...estadoDoServidor(), fase: "APROFUNDAMENTO" as const, faseIniciadaEm: 0, iniciadaEm: 0,
    ultimaPerguntaEm: T - 60_000, ultimaRespostaEm: T - 50_000, perguntasFeitas: 3 };
  for (const t of [T, T - 60_000 + INTERVALO]) {
    assert.equal(analisar(cliente, t) === "PLIN_PENDENTE", motivoBloqueioPlin(servidor, t) === null, `t = ${t}`);
  }
});

test("no máximo o orçamento da entrevista, e acabar o orçamento não pula para o fechamento", () => {
  const fim = { ...noMeio(), iniciadaEm: -34 * 60_000 };
  let e = transicionar({ ...fim, perguntasFeitas: LIMITE - 1 }, { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 0);
  e = transicionar(e, { tipo: "PLIN_CLICADO" }, 1);
  e = transicionar(e, { tipo: "RESPOSTA_TERMINOU" }, 2);
  assert.equal(e.perguntasFeitas, LIMITE);
  assert.equal(e.fase, "APROFUNDAMENTO");
  assert.equal(analisar({ ...fim, perguntasFeitas: LIMITE }, 0), "LIVRE");
});

test("a cota proporcional ao tempo não deixa gastar o orçamento no começo", () => {
  // Aos 4 de 35 min a cota é 4 (orçamento de 20, mais a folga #140).
  const comeco = { ...noMeio(), iniciadaEm: 0, perguntasFeitas: 4 };
  assert.equal(analisar(comeco, 4 * 60_000), "LIVRE");
});

function noFechamento(): EstadoEntrevista {
  return { ...estadoInicial(), fase: "FECHAMENTO", faseIniciadaEm: 0, perguntasFeitas: LIMITE };
}

test("fechamento aceita a dúvida final mesmo com o orçamento usado, depois do respiro", () => {
  const acabouDeResponder = { ...noFechamento(), ultimaRespostaEm: 10_000 };
  assert.equal(analisar(acabouDeResponder, 10_001), "LIVRE");
  let e = transicionar(acabouDeResponder, { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 10_000 + RESPIRO);
  assert.equal(e.plin, "PLIN_PENDENTE");
  e = transicionar(e, { tipo: "PLIN_CLICADO" }, 60_000);
  assert.equal(e.plin, "PERGUNTA_ATIVA");
  assert.equal(e.perguntaAtiva?.numero, LIMITE + 1);
  assert.equal(e.perguntaFinalFeita, true);
  e = transicionar(e, { tipo: "RESPOSTA_TERMINOU" }, 70_000);
  assert.equal(e.fase, "FECHAMENTO");
  assert.equal(e.plin, "LIVRE");
});

test("fechamento faz a pergunta final uma vez só", () => {
  const jaFeita = { ...noFechamento(), perguntaFinalFeita: true };
  assert.equal(transicionar(jaFeita, { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 999_999).plin, "LIVRE");
});

test("fechamento não atropela uma pergunta ativa e só aceita dúvida", () => {
  const ativa = { ...noFechamento(), plin: "PERGUNTA_ATIVA" as const };
  assert.equal(transicionar(ativa, { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 0).plin, "PERGUNTA_ATIVA");
  for (const status of ["dica", "redirecionar"] as const) {
    const e = transicionar(noFechamento(), { tipo: "ANALISE_RECEBIDA", resposta: { ...duvida, status } }, 0);
    assert.equal(e.plin, "LIVRE");
  }
});

test("pergunta feita no aprofundamento não conta como a final", () => {
  let e = transicionar(noAprofundamento(), { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 0);
  e = transicionar(e, { tipo: "PLIN_CLICADO" }, 1);
  assert.equal(e.perguntaFinalFeita, false);
});

test("em requisitos só a dúvida vale e não gasta a cota; em alto nível dúvida e redirecionar valem", () => {
  const requisitos = { ...estadoInicial(), fase: "REQUISITOS" as const };
  const convite = transicionar(requisitos, { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 0);
  assert.equal(convite.plin, "PLIN_PENDENTE");
  assert.equal(transicionar(requisitos, { tipo: "ANALISE_RECEBIDA", resposta: { ...duvida, status: "redirecionar" } }, 0).plin, "LIVRE");
  const clicado = transicionar(convite, { tipo: "PLIN_CLICADO" }, 1);
  assert.equal(clicado.plin, "PERGUNTA_ATIVA");
  assert.equal(clicado.perguntasFeitas, 0);
  const altoNivel = { ...estadoInicial(), fase: "ALTO_NIVEL" as const };
  assert.equal(transicionar(altoNivel, { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 0).plin, "PLIN_PENDENTE");
  const redirecionar = { ...duvida, status: "redirecionar" as const };
  assert.equal(
    transicionar(altoNivel, { tipo: "ANALISE_RECEBIDA", resposta: redirecionar }, 0).plin,
    "PLIN_PENDENTE",
  );
});

test("dúvida nova substitui a pendente; 'ok' cancela a pendente", () => {
  let e = transicionar(noAprofundamento(), { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 0);
  const outra = { ...duvida, pergunta: "E se o cache cair?" };
  e = transicionar(e, { tipo: "ANALISE_RECEBIDA", resposta: outra }, 1);
  assert.equal(e.perguntaPendente?.pergunta, "E se o cache cair?");
  e = transicionar(e, { tipo: "ANALISE_RECEBIDA", resposta: ok }, 2);
  assert.equal(e.plin, "LIVRE");
  assert.equal(e.perguntaPendente, null);
});

test("plin de demonstração ignora fase, intervalo e limite, mas não atropela uma pergunta ativa", () => {
  const cheio = { ...estadoInicial(), fase: "REQUISITOS" as const, perguntasFeitas: 5, ultimaRespostaEm: 0 };
  assert.equal(transicionar(cheio, { tipo: "PLIN_DEMO", resposta: duvida }, 1).plin, "PLIN_PENDENTE");
  const ativa = { ...noAprofundamento(), plin: "PERGUNTA_ATIVA" as const };
  assert.equal(transicionar(ativa, { tipo: "PLIN_DEMO", resposta: duvida }, 1).plin, "PERGUNTA_ATIVA");
  assert.equal(transicionar(estadoInicial(), { tipo: "PLIN_DEMO", resposta: duvida }, 1).plin, "LIVRE");
});

test("um 'ok' da análise não cancela a pergunta de demonstração", () => {
  const demo = transicionar(noAprofundamento(), { tipo: "PLIN_DEMO", resposta: duvida }, 0);
  assert.equal(transicionar(demo, { tipo: "ANALISE_RECEBIDA", resposta: ok }, 1).plin, "PLIN_PENDENTE");
});

test("encerrada ignora tudo", () => {
  const fim = transicionar(noAprofundamento(), { tipo: "ENCERRAR" }, 0);
  assert.equal(fim.fase, "ENCERRADA");
  assert.equal(transicionar(fim, { tipo: "COMECAR" }, 1), fim);
});

test("pergunta de continuação mantém o fio ativo, com a fala nova", () => {
  let e: EstadoEntrevista = { ...estadoInicial(), fase: "APROFUNDAMENTO", faseIniciadaEm: 0 };
  e = transicionar(e, { tipo: "ANALISE_RECEBIDA", resposta: duvida }, 1000);
  e = transicionar(e, { tipo: "PLIN_CLICADO" }, 2000);
  const numero = e.perguntaAtiva?.numero;
  e = transicionar(e, { tipo: "SEGUIMENTO", pergunta: "E se o cache cair num pico?" }, 3000);
  assert.equal(e.plin, "PERGUNTA_ATIVA");
  assert.equal(e.perguntaAtiva?.pergunta, "E se o cache cair num pico?");
  assert.equal(e.perguntaAtiva?.numero, numero);
  assert.equal(e.perguntasFeitas, 1, "a continuação não gasta a cota de perguntas");
  // Sem pergunta ativa, não há fio para continuar.
  const livre = transicionar({ ...estadoInicial(), fase: "APROFUNDAMENTO" }, { tipo: "SEGUIMENTO", pergunta: "x?" }, 0);
  assert.equal(livre.perguntaAtiva, null);
});

test("a pergunta pendente cai se a fala do candidato já respondeu a ela (sem repetir a pergunta)", () => {
  const pendente = transicionar(noAprofundamento(), { tipo: "ANALISE_RECEBIDA", resposta: { ...duvida, pergunta: "Onde fica o gargalo de escrita no banco?" } }, 0);
  assert.equal(transicionar(pendente, { tipo: "CANDIDATO_CONTINUOU", texto: "acho que o gargalo vai ser a escrita no banco principal" }, 1).plin, "LIVRE");
  assert.equal(transicionar(pendente, { tipo: "CANDIDATO_CONTINUOU", texto: "vou colocar um cache na frente da API" }, 1).plin, "PLIN_PENDENTE");
});

test("redirecionamento de escopo fura intervalo e respiro no quadro, como no servidor (#129, decisão I)", () => {
  const T = 1_000_000;
  const estado = { ...estadoInicial(), fase: "ALTO_NIVEL" as const, iniciadaEm: T - 5 * 60_000, duracaoMin: 35, ultimaPerguntaEm: T - 10_000, ultimaRespostaEm: T - 5_000, plin: "LIVRE" as const };
  const resposta = (extra: Partial<RespostaAnalise> = {}): RespostaAnalise => ({
    status: "redirecionar", pergunta: "Por onde começar?", nota: null, elementos: [], degrau: null, observacoes: [], ...extra,
  });
  assert.equal(aceitaPlin(estado, resposta({ escopo: false }), T), false, "sem escopo, o respiro comum barra");
  assert.equal(aceitaPlin(estado, resposta({ escopo: true }), T), true, "com escopo, fura o respiro e o intervalo");
  assert.equal(aceitaPlin({ ...estado, perguntasFeitas: 3 }, resposta({ escopo: false }), T), false, "sem escopo, a cota barra");
  assert.equal(aceitaPlin({ ...estado, perguntasFeitas: 3 }, resposta({ escopo: true }), T), true, "com escopo, a cota não barra (revisado)");
  assert.equal(aceitaPlin({ ...estado, perguntasFeitas: 99 }, resposta({ escopo: true }), T), false, "o orçamento continua valendo");
});
