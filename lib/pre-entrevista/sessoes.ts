/**
 * Sessões da pré-entrevista, em memória.
 *
 * O store fica em `globalThis` para sobreviver ao hot reload do `next dev`. Não é banco: se o
 * servidor reiniciar, as sessões somem. Só as configs finais também vão para `data/configs/`.
 *
 * Na Vercel cada requisição pode cair numa instância diferente (ou numa nova, depois de reciclar), e a
 * sessão não está lá: era o "sessão não encontrada" ao publicar. Por isso a tela guarda a `copia` que
 * vem em todo estado e a manda de volta: `sincronizarSessao` reconstrói a sessão a partir dela quando a
 * instância não tem a sessão ou tem uma versão mais velha.
 *
 * Cada fala da recrutadora passa pelo turno (`turno.ts`): cobertura síncrona, planejador, fala do Totti.
 * A extração lenta (`extrair` + cobertura) roda depois, em segundo plano. Se chegar fala nova durante
 * uma rodada, nada roda em paralelo: ao terminar, roda uma rodada extra com a transcrição mais recente
 * (as falas acumuladas viram uma rodada só).
 */
import { randomUUID } from "crypto";
import { findConfig, saveConfig } from "@/lib/config/store";
import { type InterviewConfig, type FocusArea, type SquadRule } from "@/lib/contracts";
import { classificacaoDoFormatoAtivo, type Classificacao, type Vaga } from "./classificador";
import { aplicarCobertura, areasEmJogo, avaliarCobertura, mesclarCobertura, topicosDo, ultimaFalaDoAgente } from "./cobertura";
import { type Competencia, type ResultadoCompetencias } from "./competencias";
import { ErroExtracao, extrair } from "./extrator";
import { ErroChat, houveFallback } from "./llm";
import { diff, registrarEvento, type EventoLog, type MudancaCampo, type NovoEvento } from "./log";
import { descreverPasso, planoInicial, type Passo, type PlanoEstado } from "./planejador";
import { PREFERENCIAS_PADRAO, type Preferencias } from "./preferencias";
import { criarRascunho, rascunhoNoFormatoAtivo, Rascunho as RascunhoSchema, type CampoFixado, type Rascunho, type Turno } from "./rascunho";
import { estadoInicialEnfase, type EstadoEnfase } from "./enfase";
import { camposMudados, fixarCampos, reaplicarFixados, somarVistas } from "./fixados";
import { recalcularRascunho, type DetalhePeso } from "./pesos";

export interface Sessao {
  id: string;
  criadaEm: number;
  vaga: Vaga;
  /** Classificação do Jev, guardada para a abertura do Totti e para a tela. */
  classificacao: Classificacao;
  rascunho: Rascunho;
  transcricao: Turno[];
  /** Sinais e contadores do planejador (ver `planejador.ts`). */
  plano: PlanoEstado;
  /** Tom e dicas que a recrutadora pediu, atualizados a cada fala (ver `preferencias.ts`). */
  preferencias: Preferencias;
  /** Como estava o resumo da última vez que o Totti o falou. Serve para confirmar só o que mudou na revisão. */
  resumo?: {
    preferencias: Preferencias;
    duracaoMin: number;
    /**
     * Formato, nível e foco (áreas com o peso arredondado, ver `focoDoResumo`) do momento do resumo: a confirmação da
     * revisão começa pelo que ela pediu, e não pelo que mudou junto (issue #76). Ausentes em resumos guardados antes.
     */
    mode?: Rascunho["mode"];
    seniority?: Rascunho["seniority"];
    foco?: Array<{ area: FocusArea; weight: number }>;
    /** O último resumo inteiro, como foi falado, para repetir se ela pedir. Some depois de uma revisão (já não vale). */
    texto?: string;
  };
  /** Competências-chave da vaga e se o formato verifica cada uma (ver `competencias.ts`). Não viram pergunta. */
  competencias: Competencia[];
  /** O que a vaga pede, em até 12 palavras, para a abertura da Totti (ver `competencias.ts`). Pode não existir. */
  resumoVaga?: string;
  /** O que esta entrevista não avalia: áreas deixadas para a próxima etapa e competências que o formato não verifica. */
  naoAvaliado: string[];
  /**
   * Ênfase acumulada por área, a partir de cada fala da recrutadora (ver `enfase.ts`). Dispensa e central fixam o estado.
   */
  enfaseEstado: EstadoEnfase;
  /** Fala dela que pediu o tom e fala que pediu as dicas, para o guia. */
  origemPreferencias: { tom?: string; dicas?: string };
  /** Falas dela em que disse algo eliminatório. Usadas quando o extrator não trouxe o trecho. */
  eliminatorioFalas: string[];
  /** Último detalhamento dos pesos por área (ver `pesosPelaEnfase`). */
  pesosDetalhe: DetalhePeso[];
  logs: EventoLog[];
  status: {
    extraindo: boolean;
    versaoExtraida: number;
    /**
     * Quantas revisões manuais já foram guardadas (`salvarRevisao`). A revisão muda só o rascunho, que `maisNova` não
     * enxerga pela transcrição nem pela extração: sem este contador, uma instância com a sessão mais velha descartava
     * a edição. Ausente em cópias de antes: conta como 0.
     */
    versaoRevisao?: number;
  };
  configFinal?: InterviewConfig;
  /**
   * Critérios que o Totti aprendeu com o Tech Lead desta empresa (Memória Viva da Squad), ativos quando a
   * conversa começou. O Totti cita na abertura ("da última vez vocês pediram X") e no resumo.
   */
  regrasSquad?: SquadRule[];
}

/** Estado completo que a tela recebe. */
export interface EstadoSessao {
  id: string;
  criadaEm: number;
  vaga: Vaga;
  classificacao: Omit<Classificacao, "request" | "answers">;
  transcricao: Turno[];
  rascunho: Rascunho;
  topicos: Array<{ id: string; pergunta: string; cobertura: number; coberto: boolean; opcional: boolean }>;
  /** Ids dos tópicos obrigatórios das áreas em jogo ainda não cobertos. */
  faltando: string[];
  /** O que o planejador decidiu por último e o que isso significa agora. */
  planejamento: {
    passo?: Passo;
    descricaoPasso?: string;
    emJogo: FocusArea[];
    sinais: Record<string, number>;
    perguntasPorTopico: Record<string, number>;
    resumos: number;
    /** Decisão sobre a troca de formato por área (ver `planejador.ts`). */
    decisoesTradeoff: PlanoEstado["decisoesTradeoff"];
  };
  competencias: Competencia[];
  naoAvaliado: string[];
  status: Sessao["status"];
  /** Ênfase por área, se ela falou, nota da vaga e peso final (ver `pesos.ts`). */
  pesos: DetalhePeso[];
  logs: EventoLog[];
  configFinal?: InterviewConfig;
  /** A sessão inteira (sem os logs), para a tela devolver quando a instância do servidor não a tiver. A demonstração não tem. */
  copia?: CopiaSessao;
}

/** A sessão como a tela guarda e devolve: tudo menos os logs (que só servem para depurar). */
export type CopiaSessao = Omit<Sessao, "logs">;

interface Store {
  sessoes: Map<string, Sessao>;
  configs: Map<string, InterviewConfig>;
  /** Sessões com uma fala sendo respondida. Fala nova enquanto isso é recusada (409). */
  ocupadas: Set<string>;
  /** Sessões com fala nova durante uma rodada de extração. */
  pendentes: Set<string>;
}

const CHAVE_STORE = "__preEntrevistaStore";
const globalComStore = globalThis as typeof globalThis & { [CHAVE_STORE]?: Store };
const store: Store = (globalComStore[CHAVE_STORE] ??= {
  sessoes: new Map(),
  configs: new Map(),
  ocupadas: new Set(),
  pendentes: new Set(),
});

/** Ids de config vão para um nome de arquivo: só letras, dígitos, `_` e `-`. */
const ID_VALIDO = /^[A-Za-z0-9_-]{1,100}$/;

const trecho = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** O Totti já propôs o formato, o nível e o foco (passo `confirmar_inicio`)? A abertura não propõe (ver `abrirConversa`). */
export function propostaFeita(sessao: Sessao): boolean {
  return (sessao.plano.perguntasPorTopico.confirmou_inicio ?? 0) > 0;
}

/**
 * O Totti só propõe o início depois da primeira fala dela; a resposta que o confirma vem depois da proposta. Uma rodada
 * de segundo plano só pode confirmar o início se a proposta já existia quando ela começou e a transcrição lida termina
 * numa fala dela (a resposta), e não na própria proposta. Mesma regra do turno síncrono (ver `propostaFeita`).
 */
export function rodadaPodeConfirmarInicio(sessao: Sessao, transcricaoLida: Turno[]): boolean {
  return propostaFeita(sessao) && transcricaoLida.at(-1)?.role === "recrutadora";
}

export function getSessao(id: string): Sessao | undefined {
  return store.sessoes.get(id);
}

/** Marca a sessão como ocupada. Devolve false se já havia uma fala sendo respondida. */
export function ocupar(id: string): boolean {
  if (store.ocupadas.has(id)) return false;
  store.ocupadas.add(id);
  return true;
}

export function liberar(id: string): void {
  store.ocupadas.delete(id);
}

/** Há um turno real em curso nesta sessão? Só lê: quem quer saber não trava nada (ver `ocupar`). */
export function estaOcupada(id: string): boolean {
  return store.ocupadas.has(id);
}

/**
 * Cria a sessão com o rascunho inicial (tudo pendente) e grava os eventos iniciais: sessão, classificação
 * e competências (com o motivo, se a extração das competências falhou).
 */
export function criarSessao(
  vaga: Vaga,
  classificacao: Classificacao,
  criadaEm: number,
  competencias: ResultadoCompetencias,
  regrasSquad: SquadRule[] = [],
): Sessao {
  // Com cobertura vazia, todos os tópicos obrigatórios das áreas do foco entram em `pendencias`.
  // Com a trava desligada, formato indisponível vira live coding; a classificação original segue no log (ver `classificacaoDoFormatoAtivo`).
  const classificacaoUsada = classificacaoDoFormatoAtivo(classificacao);
  const rascunho = aplicarCobertura(criarRascunho(vaga, classificacaoUsada), {});
  const sessao: Sessao = {
    id: randomUUID(),
    criadaEm,
    vaga,
    classificacao: classificacaoUsada,
    rascunho,
    transcricao: [],
    plano: planoInicial(),
    preferencias: { ...PREFERENCIAS_PADRAO },
    competencias: competencias.competencias,
    resumoVaga: competencias.resumo,
    naoAvaliado: [],
    enfaseEstado: estadoInicialEnfase(),
    origemPreferencias: {},
    eliminatorioFalas: [],
    pesosDetalhe: [],
    logs: [],
    status: { extraindo: false, versaoExtraida: 0 },
    ...(regrasSquad.length ? { regrasSquad } : {}),
  };
  store.sessoes.set(sessao.id, sessao);

  registrarEvento(sessao, { tipo: "sessao_criada", resumo: `vaga "${vaga.roleTitle}"`, dados: { vaga } });
  const confianca = (c: number) => `${Math.round(c * 100)}%`;
  registrarEvento(sessao, {
    tipo: "classificacao",
    resumo:
      `modo=${classificacao.mode.value} (${confianca(classificacao.mode.confidence)}) ` +
      `senioridade=${classificacao.seniority.value} (${confianca(classificacao.seniority.confidence)}) ` +
      `foco=${classificacao.focus.map((f) => `${f.area}:${f.weight}`).join(" ")} ` +
      `confirmar=[${classificacao.confirmar.join(", ")}]` +
      (classificacaoUsada.mode.value !== classificacao.mode.value ? ` | usado: modo=${classificacaoUsada.mode.value}` : ""),
    ms: classificacao.usage.ms,
    provedor: "typesafe",
    model: classificacao.model,
    dados: {
      request: classificacao.request,
      answers: classificacao.answers,
      focusScores: classificacao.focusScores,
      focus: classificacao.focus,
      confirmar: classificacao.confirmar,
      modoUsado: classificacaoUsada.mode.value,
      rascunhoInicial: rascunho,
    },
  });
  const nomes = competencias.competencias.map((c) => c.nome).join(", ");
  registrarEvento(sessao, {
    tipo: "competencias",
    nivel: competencias.erro ? "aviso" : "info",
    resumo: competencias.erro
      ? `sem competências (${competencias.erro})`
      : `${competencias.competencias.length} competência(s): ${nomes || "nenhuma"}` +
        (competencias.resumo ? ` | resumo: "${competencias.resumo}"` : " | sem resumo"),
    ms: competencias.ms,
    provedor: competencias.provedor,
    model: competencias.model,
    fallback: competencias.erro ? undefined : houveFallback(competencias.tentativas),
    dados: {
      mensagens: competencias.mensagens,
      respostaCrua: competencias.respostaCrua,
      competencias: competencias.competencias,
      resumo: competencias.resumo,
      erro: competencias.erro,
      tentativas: competencias.tentativas,
    },
  });
  aplicarPesosNaSessao(sessao, "início");
  return sessao;
}

/** Notas da classificação da vaga por área (0 a 3). Valem para as áreas de que ela não falou. */
function notasDaVaga(sessao: Sessao): Partial<Record<FocusArea, number>> {
  return Object.fromEntries(sessao.classificacao.focusScores.map((f) => [f.area, f.score]));
}

/**
 * Refaz o foco, os critérios, as origens e o guia a partir do estado da sessão (ênfase, falas, decisões e dispensas).
 * Chamado ao criar a sessão, depois de cada leitura síncrona e na finalização. Registra no log o que cada área pesou.
 */
export function aplicarPesosNaSessao(sessao: Sessao, origem: string): void {
  const antes = sessao.rascunho;
  const decisoes = sessao.plano.decisoesTradeoff;
  const { rascunho, detalhe } = recalcularRascunho(
    sessao.rascunho,
    { estado: sessao.enfaseEstado, notaVaga: notasDaVaga(sessao), decisoes },
    {
      preferencias: sessao.preferencias,
      origemTom: sessao.origemPreferencias.tom,
      origemDicas: sessao.origemPreferencias.dicas,
      eliminatoriosFalas: sessao.eliminatorioFalas,
      naoAvaliado: sessao.naoAvaliado,
    },
  );
  // O que ela editou na revisão e não voltou a falar fica como está (ver `fixados.ts`).
  const respeitado = reaplicarFixados(antes, rascunho);
  sessao.rascunho = aplicarCobertura(respeitado, respeitado.cobertura, areasEmJogo(respeitado.focus, sessao.plano.sinais, decisoes));
  sessao.pesosDetalhe = detalhe;
  const noFoco = detalhe.filter((d) => d.noFoco).map((d) => `${d.area} ${d.peso.toFixed(2)}`);
  registrarEvento(sessao, {
    tipo: "cobertura",
    resumo: `pesos (${origem}): ${noFoco.join(", ") || "nenhuma área"}`,
    dados: { origem: "pesos", leitura: origem, pesos: detalhe, diff: diff(antes, sessao.rascunho) },
  });
}

/** Acrescenta uma fala à transcrição e registra o evento correspondente. */
export function registrarFala(
  sessao: Sessao,
  turno: Turno,
  opcoes: { ms?: number; provedor?: string; model?: string; fallback?: boolean; dados?: Record<string, unknown> } = {},
): void {
  sessao.transcricao.push(turno);
  const evento: NovoEvento = {
    tipo: turno.role === "recrutadora" ? "fala_recrutadora" : "fala_agente",
    resumo: `${turno.role}: ${trecho(turno.text, 160)}`,
    dados: { texto: turno.text, ...opcoes.dados },
  };
  if (opcoes.ms !== undefined) evento.ms = opcoes.ms;
  if (opcoes.provedor !== undefined) evento.provedor = opcoes.provedor;
  if (opcoes.model !== undefined) evento.model = opcoes.model;
  if (opcoes.fallback !== undefined) evento.fallback = opcoes.fallback;
  registrarEvento(sessao, evento);
}

/** A transcrição sem as falas dela que o Totti não entendeu (`naoEntendida`): é o que a extração e a cobertura leem. */
export function falasParaLer(transcricao: Turno[]): Turno[] {
  return transcricao.filter((t) => !t.naoEntendida);
}

/** Tira a última fala da transcrição (usado quando a resposta do Totti falha, para a recrutadora reenviar). */
export function desfazerUltimaFala(sessao: Sessao): void {
  sessao.transcricao.pop();
}

function resumoDiff(mudancas: MudancaCampo[]): string {
  if (mudancas.length === 0) return "nenhuma mudança";
  const nomes = mudancas
    .slice(0, 4)
    .map((m) => m.caminho)
    .join(", ");
  return `${mudancas.length} campo(s) mudaram: ${nomes}${mudancas.length > 4 ? ", ..." : ""}`;
}

/** Substitui o rascunho inteiro (ex.: versão editada na revisão) e registra o diff. */
export function substituirRascunho(sessao: Sessao, novo: Rascunho, origem: string): void {
  const mudancas = diff(sessao.rascunho, novo);
  sessao.rascunho = novo;
  registrarEvento(sessao, {
    tipo: "rascunho_atualizado",
    resumo: `${origem}: ${resumoDiff(mudancas)}`,
    dados: { origem, diff: mudancas },
  });
}

/**
 * Guarda a revisão editada à mão ao voltar à conversa, sem gerar config. O que mudou fica fixado (ver `fixados.ts`):
 * a extração e os pesos não o sobrescrevem enquanto ela não falar daquilo de novo.
 * Cobertura e pendências são do servidor (a tela pode estar atrás); duração dita na revisão vale também nas preferências.
 *
 * Com `base` (o rascunho de que ela partiu ao abrir a revisão), só vale o que ela mudou em relação a ele, aplicado sobre
 * o rascunho ATUAL do servidor: o que a extração trouxe enquanto ela editava (eliminatórios, contexto, campos que ela
 * não tocou) não é desfeito por uma cópia velha da tela. Sem `base` (corpo antigo), vale o rascunho editado inteiro,
 * comparado com o atual.
 */
export function salvarRevisao(sessao: Sessao, editado: Rascunho, base?: Rascunho): CampoFixado[] {
  const atual = sessao.rascunho;
  const mudados = camposMudados(base ?? atual, editado);
  // `conducaoVista` nunca vem da tela: é o que já havia no servidor mais as linhas de condução do rascunho atual e do
  // de que ela partiu. Assim, a linha que ela apagou na revisão fica registrada e a extração não a traz de volta.
  const vistas = somarVistas(atual.conducaoVista, atual.conducao, (base ?? atual).conducao);
  let novo: Rascunho;
  if (base) {
    novo = { ...atual };
    if (mudados.includes("mode")) {
      novo.mode = editado.mode;
      novo.problemId = editado.problemId;
      novo.pedidoProblema = editado.pedidoProblema;
    }
    if (mudados.includes("seniority")) novo.seniority = editado.seniority;
    if (mudados.includes("focus")) novo.focus = editado.focus;
    if (mudados.includes("criteria")) {
      novo.criteria = editado.criteria;
      const doEditado = Object.fromEntries(editado.criteria.filter((c) => editado.origens[c.id]).map((c) => [c.id, editado.origens[c.id]]));
      novo.origens = { ...atual.origens, ...doEditado };
    }
    if (mudados.includes("recruiterNotes")) novo.recruiterNotes = editado.recruiterNotes;
    if (mudados.includes("durationMin")) novo.durationMin = editado.durationMin;
    // O título não passa pelo automático: não fixa nada.
    if (editado.roleTitle !== base.roleTitle) novo.roleTitle = editado.roleTitle;
    if (mudados.includes("conducao")) novo.conducao = editado.conducao;
    novo = fixarCampos({ ...novo, conducaoVista: vistas }, mudados);
  } else {
    novo = fixarCampos(
      { ...editado, fixados: atual.fixados, cobertura: atual.cobertura, pendencias: atual.pendencias, conducaoVista: vistas },
      mudados,
    );
  }
  if (mudados.includes("durationMin")) sessao.preferencias = { ...sessao.preferencias, duracaoMin: novo.durationMin };
  substituirRascunho(sessao, novo, "revisão manual");
  // Mesmo sem campo mudado (só título ou condução) a revisão conta: a cópia da tela precisa vencer a de outra instância.
  sessao.status.versaoRevisao = (sessao.status.versaoRevisao ?? 0) + 1;
  return mudados;
}

/** O que a exceção carrega além da mensagem, para o evento `erro`. */
function detalhesDoErro(err: unknown): Record<string, unknown> {
  if (err instanceof ErroChat) return { tentativas: err.tentativas };
  if (err instanceof ErroExtracao) return { ...err.detalhes };
  return {};
}

/** Uma rodada: extrai do que foi dito até agora, mede a cobertura e aplica no rascunho. Nunca lança. */
async function rodarRodada(sessao: Sessao): Promise<void> {
  // Fala dela que o Totti não entendeu (transcrição quebrada) não vai para a extração (ver `falasParaLer`).
  // Com um turno em curso, a última fala dela ainda não foi respondida e pode virar `naoEntendida`: fica para a
  // extração que a rota agenda depois do turno.
  const ultima = sessao.transcricao.at(-1);
  const versaoTranscricao =
    store.ocupadas.has(sessao.id) && ultima?.role === "recrutadora" ? sessao.transcricao.length - 1 : sessao.transcricao.length;
  const transcricao = falasParaLer(sessao.transcricao.slice(0, versaoTranscricao));
  const antes = sessao.rascunho;
  const podeConfirmarInicio = rodadaPodeConfirmarInicio(sessao, transcricao);
  let etapa = "extracao";
  try {
    const ext = await extrair(antes, transcricao, { modoEscolhido: sessao.plano.modoEscolhido });
    const camposDoPatch = Object.keys(ext.patch).filter((k) => ext.patch[k as keyof typeof ext.patch] !== undefined);
    registrarEvento(sessao, {
      tipo: "extracao",
      resumo: `patch: [${camposDoPatch.join(", ") || "vazio"}] | ${ext.avisos.length} aviso(s)`,
      ms: ext.ms,
      provedor: ext.provedor,
      model: ext.model,
      fallback: houveFallback(ext.tentativas),
      dados: {
        versaoTranscricao,
        mensagens: ext.mensagens,
        respostaCrua: ext.respostaCrua,
        tentativasJson: ext.tentativasJson,
        patch: ext.patch,
        avisos: ext.avisos,
        tentativas: ext.tentativas,
      },
    });
    for (const aviso of ext.avisos) {
      registrarEvento(sessao, { tipo: "aviso", nivel: "aviso", resumo: `extrator: ${aviso}`, dados: { origem: "extracao", aviso } });
    }

    etapa = "cobertura";
    // Com a trava de system design desligada (`SYSTEM_DESIGN_ATIVO = false`), o formato nunca entra no rascunho, nem pelo extrator.
    const extraido = rascunhoNoFormatoAtivo(ext.rascunho);
    const cob = await avaliarCobertura(extraido, transcricao, { ultimaFalaAgente: ultimaFalaDoAgente(transcricao) });
    const faltando = cob.faltando.map((t) => t.id);
    registrarEvento(sessao, {
      tipo: "cobertura",
      resumo: `segundo plano | faltando: ${faltando.join(", ") || "nada"}`,
      ms: cob.ms,
      provedor: "typesafe",
      model: cob.model,
      dados: {
        origem: "segundo_plano",
        versaoTranscricao,
        request: cob.request,
        answers: cob.answers,
        usage: cob.usage,
        cobertura: cob.cobertura,
        faltando,
      },
    });

    // A cobertura síncrona (do turno) pode ter subido enquanto esta rodada rodava: mescla, sem perder nada.
    // Os sinais não entram aqui: quem decide o passo é a leitura do turno, que tem a transcrição mais recente.
    // O foco e as notas não vêm do extrator: são refeitos a partir do estado atual (ver `aplicarPesosNaSessao`).
    // Se ela disse o nível enquanto esta rodada rodava (turno em paralelo), o nível dela vale sobre o do extrator.
    const nivelDeVolta = sessao.rascunho.confirmado.seniority
      ? { seniority: sessao.rascunho.seniority, confirmado: { ...ext.rascunho.confirmado, seniority: true } }
      : {};
    // Questão pedida na fala enquanto esta rodada rodava (ou antes dela): a leitura da fala vale sobre a do extrator.
    const atual = sessao.rascunho;
    const pedidoDeVolta =
      atual.pedidoProblema?.origem === "fala" && atual.mode === extraido.mode
        ? { problemId: atual.problemId, pedidoProblema: atual.pedidoProblema }
        : {};
    // Campo editado na revisão (fixado) não é sobrescrito pela extração: vale o que está na sessão agora.
    sessao.rascunho = reaplicarFixados(atual, {
      ...extraido,
      ...nivelDeVolta,
      ...pedidoDeVolta,
      cobertura: mesclarCobertura(atual.cobertura, podeConfirmarInicio ? cob.cobertura : { ...cob.cobertura, confirmou_inicio: 0 }),
    });
    aplicarPesosNaSessao(sessao, "segundo plano");
    const mudancas = diff(antes, sessao.rascunho);
    registrarEvento(sessao, {
      tipo: "rascunho_atualizado",
      resumo: resumoDiff(mudancas),
      dados: { versaoTranscricao, diff: mudancas },
    });
    sessao.status.versaoExtraida = versaoTranscricao;
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    registrarEvento(sessao, {
      tipo: "erro",
      nivel: "erro",
      resumo: `${etapa}: ${mensagem}`,
      dados: {
        etapa,
        versaoTranscricao,
        mensagem,
        stack: err instanceof Error ? err.stack : undefined,
        ...detalhesDoErro(err),
      },
    });
  }
}

async function rodarExtracao(sessao: Sessao): Promise<void> {
  sessao.status.extraindo = true;
  try {
    do {
      store.pendentes.delete(sessao.id);
      await rodarRodada(sessao);
    } while (store.pendentes.has(sessao.id));
  } finally {
    sessao.status.extraindo = false;
  }
}

/**
 * Agenda uma extração em segundo plano. Se já há uma rodada rodando, só marca que é preciso
 * outra ao terminar: nunca duas rodadas em paralelo na mesma sessão.
 */
export function agendarExtracao(sessao: Sessao): void {
  if (sessao.status.extraindo) {
    store.pendentes.add(sessao.id);
    return;
  }
  void rodarExtracao(sessao);
}

/** Roda a extração e espera ela terminar. Usado pelo simulador, que não tem segundo plano. */
export async function extrairAgora(sessao: Sessao): Promise<void> {
  if (sessao.status.extraindo) {
    await aguardarExtracao(sessao);
    return;
  }
  await rodarExtracao(sessao);
}

/** Espera a extração em curso terminar (com limite). Usado antes de finalizar. */
export async function aguardarExtracao(sessao: Sessao, limiteMs = 60_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (sessao.status.extraindo && Date.now() < fim) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function estadoDaSessao(sessao: Sessao): EstadoSessao {
  const { classificacao, plano } = sessao;
  const emJogo = areasEmJogo(sessao.rascunho.focus, plano.sinais, plano.decisoesTradeoff);
  return {
    id: sessao.id,
    criadaEm: sessao.criadaEm,
    vaga: sessao.vaga,
    classificacao: {
      mode: classificacao.mode,
      seniority: classificacao.seniority,
      focusScores: classificacao.focusScores,
      focus: classificacao.focus,
      nivelExplicito: classificacao.nivelExplicito,
      confirmar: classificacao.confirmar,
      usage: classificacao.usage,
      model: classificacao.model,
    },
    transcricao: sessao.transcricao,
    rascunho: sessao.rascunho,
    topicos: topicosDo(sessao.rascunho).map((t) => ({
      id: t.id,
      pergunta: t.pergunta,
      cobertura: sessao.rascunho.cobertura[t.id] ?? 0,
      coberto: !sessao.rascunho.pendencias.includes(t.id),
      opcional: t.opcional === true,
    })),
    faltando: sessao.rascunho.pendencias,
    planejamento: {
      passo: plano.ultimoPasso,
      descricaoPasso: plano.ultimoPasso ? descreverPasso(plano.ultimoPasso) : undefined,
      emJogo,
      sinais: plano.sinais,
      perguntasPorTopico: plano.perguntasPorTopico,
      resumos: plano.resumos,
      decisoesTradeoff: plano.decisoesTradeoff,
    },
    competencias: sessao.competencias,
    naoAvaliado: sessao.naoAvaliado,
    status: sessao.status,
    pesos: sessao.pesosDetalhe,
    logs: sessao.logs,
    configFinal: sessao.configFinal,
    copia: copiaDaSessao(sessao),
  };
}

function copiaDaSessao(sessao: Sessao): CopiaSessao {
  const copia: Partial<Sessao> = { ...sessao };
  delete copia.logs;
  return copia as CopiaSessao;
}

const ID_SESSAO = /^[0-9a-f-]{36}$/;

/** A cópia tem o formato de uma sessão? Só o essencial: o resto vem do próprio servidor que a gerou. */
function pareceCopia(c: unknown, id: string): c is CopiaSessao {
  if (!c || typeof c !== "object") return false;
  const x = c as Partial<CopiaSessao>;
  return (
    x.id === id &&
    ID_SESSAO.test(id) &&
    typeof x.criadaEm === "number" &&
    !!x.vaga &&
    !!x.classificacao &&
    !!x.rascunho &&
    !!x.plano &&
    Array.isArray(x.transcricao) &&
    Array.isArray(x.competencias) &&
    !!x.status
  );
}

/** A cópia está à frente da sessão desta instância: mais falas ou uma extração mais recente. */
export const maisNova = (c: CopiaSessao, s: Sessao) => {
  if (c.transcricao.length !== s.transcricao.length) return c.transcricao.length > s.transcricao.length;
  // A revisão manual (só o rascunho muda) vale mais que uma extração: o que ela editou não se perde.
  const revisaoC = c.status.versaoRevisao ?? 0;
  const revisaoS = s.status.versaoRevisao ?? 0;
  if (revisaoC !== revisaoS) return revisaoC > revisaoS;
  return c.status.versaoExtraida > s.status.versaoExtraida;
};

/**
 * A sessão desta instância, reconstruída da `copia` da tela quando faltar ou estiver atrás.
 * Uma sessão ocupada (fala sendo respondida) ou extraindo nunca é trocada: ela é a mais nova.
 */
export function sincronizarSessao(id: string, copia?: unknown): Sessao | undefined {
  const atual = store.sessoes.get(id);
  if (!pareceCopia(copia, id)) return atual;
  if (atual && (store.ocupadas.has(id) || atual.status.extraindo || !maisNova(copia, atual))) return atual;
  // Cópia guardada antes de campos novos (`fixados`, `conducao`...) não os tem: o schema põe os padrões. Se nem assim
  // vale, a cópia é inválida e a instância fica com o que tem.
  const rascunho = RascunhoSchema.safeParse(copia.rascunho);
  if (!rascunho.success) return atual;
  const sessao: Sessao = {
    ...structuredClone(copia),
    rascunho: rascunho.data,
    logs: atual?.logs ?? [],
    // A extração que rodava em outra instância não roda aqui: a finalização refaz se estiver atrás.
    status: { extraindo: false, versaoExtraida: copia.status.versaoExtraida, versaoRevisao: copia.status.versaoRevisao ?? 0 },
  };
  store.sessoes.set(id, sessao);
  registrarEvento(sessao, {
    tipo: "aviso",
    resumo: `sessão reconstruída da cópia da tela (${sessao.transcricao.length} falas)`,
    dados: { tinhaSessao: !!atual, falas: sessao.transcricao.length, versaoExtraida: sessao.status.versaoExtraida },
  });
  return sessao;
}

/** A extração não acompanhou a última fala (rodou em outra instância ou falhou): roda agora. */
/** Fala que só aprova o que já está na tela ("pode", "sim, pode finalizar", "tá ótimo"): não muda o plano. */
const SO_APROVACAO =
  /^(?:(?:pode|podemos|sim|isso|ok|okay|beleza|blz|fechado|perfeito|otimo|show|bora|vamos|vai|manda|confirmo|confirmado|certo|ta|esta|tudo|bom|boa|finaliza|finalizar|publica|publicar|pode finalizar|pode publicar|manda ver|segue|seguir|assim|mesmo|ficou|isso mesmo|tudo certo)[\s,.!]*)+$/;

function normalizarFala(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s,.!]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Depois da última extração só entraram falas do Totti e aprovações dela: extrair de novo não muda nada e só
 * segurava o "Montando o plano…" por uma volta inteira do extrator.
 */
export function soAprovacaoDesdeAExtracao(transcricao: Turno[], versaoExtraida: number): boolean {
  if (versaoExtraida <= 0) return false;
  return transcricao.slice(versaoExtraida).every((t) => t.role !== "recrutadora" || t.naoEntendida || SO_APROVACAO.test(normalizarFala(t.text)));
}

/** Teto da espera pela extração ao finalizar: passou disso, o plano sai com o rascunho que a conversa já montou. */
const LIMITE_EXTRACAO_AO_FINALIZAR_MS = 25_000;

export async function extrairSeAtrasada(sessao: Sessao, limiteMs = LIMITE_EXTRACAO_AO_FINALIZAR_MS): Promise<void> {
  const inicio = Date.now();
  await aguardarExtracao(sessao, limiteMs);
  if (sessao.status.extraindo) return;
  if (sessao.status.versaoExtraida >= sessao.transcricao.length) return;
  if (soAprovacaoDesdeAExtracao(sessao.transcricao, sessao.status.versaoExtraida)) return;
  const resto = Math.max(0, limiteMs - (Date.now() - inicio));
  let prazo: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([extrairAgora(sessao), new Promise<void>((r) => { prazo = setTimeout(r, resto); })]);
  clearTimeout(prazo);
}

/** Guarda a config final em memória e em `data/configs/<id>.json`. */
export async function salvarConfig(sessao: Sessao, config: InterviewConfig): Promise<void> {
  sessao.configFinal = config;
  store.configs.set(config.id, config);
  // Mesmo armazenamento que a entrevista usa para achar o plano (Supabase em produção, arquivo em dev).
  await saveConfig(config);
}

/** Busca a config na memória e, se não estiver lá, no arquivo. Id inválido ou inexistente: undefined. */
export async function buscarConfig(id: string): Promise<InterviewConfig | undefined> {
  if (!ID_VALIDO.test(id)) return undefined;
  const emMemoria = store.configs.get(id);
  if (emMemoria) return emMemoria;
  return findConfig(id);
}
