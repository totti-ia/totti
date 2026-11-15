// Política do "portão de entrada": funções puras que decidem SE a análise pode rodar e SE uma
// resposta pode virar plin. O quadro já aplica intervalo e limite; aqui o servidor repete a checagem
// como defesa barata (evita gastar uma chamada ao LLM que o quadro ia descartar de qualquer jeito).
import { SILENCIO_INICIAL_S, SILENCIO_REQUISITOS_S, SILENCIO_SEM_ACAO_S } from "../../contracts";
import { motivoDoRitmo, orcamentoDeInterrupcoes, RITMO, RITMO_QUADRO, type Ritmo } from "../../interrupcao/politica";
import { garantirMarca, mapearAcoesVisuais, conexoesDoGrafo } from "../../presenca/acoesVisuais";
import { limiarDoFechamentoNoQuadro } from "../../totti/fechamento";
import { emGarantiaDoEmpecilho } from "../../sessao/empecilho";
import type { Kit, Problema } from "../kits/tipos";
import { temMudancaPrevista } from "../kits/empecilhos-genericos";
import { criteriosDoPlanoSemEvidencia, duracaoTotalS, tempoRestanteMs, type EstadoSessao } from "./estado";
import { fechamentoAtivo } from "./fechamento";
import { FASES, type Fase, type RespostaAnalise, type StatusAnalise } from "./tipos";

/** O ritmo das perguntas (orçamento, cota, intervalo) vem da política comum: lib/interrupcao/politica.ts. */
export type Regras = {
  /** Tamanho máximo da nota que o cursor escreve no quadro. */
  maxCaracteresNota: number;
};

/**
 * Silêncio total do candidato (sem mexer no desenho nem falar) depois de uma fala do agente a partir do qual o agente
 * pode quebrá-lo. O quadro usa o mesmo valor em `useEntrevista.ts` (ver `deveForcarAnalise`, lib/sessao/silencio.ts).
 */
export const LIMITE_SILENCIO_S = SILENCIO_SEM_ACAO_S;
/**
 * Idem para o começo (fase REQUISITOS): sem falar, sem escrever na conversa e sem desenhar nada.
 * Provisório. O quadro usa o mesmo valor em `useEntrevista.ts` (SILENCIO_INICIAL_MS).
 */
export const LIMITE_SILENCIO_INICIAL_S = SILENCIO_INICIAL_S;

export const REGRAS_PADRAO: Regras = {
  maxCaracteresNota: 40,
};

/** Duração da entrevista (min) e quando ela começou, para a política comum. */
function relogioDaEntrevista(estado: EstadoSessao, agora: number): { duracaoMin: number; inicioEm: number } {
  const somaS = Object.values(estado.tempos).reduce<number>((s, t) => s + (t ?? 0), 0);
  const duracaoMin = estado.plano?.duracaoMin ?? somaS / 60;
  if (estado.iniciadaEm) return { duracaoMin, inicioEm: estado.iniciadaEm };
  // Estado antigo, sem iniciadaEm: estima pelo tempo das fases já passadas.
  const anteriores = FASES.slice(0, Math.max(0, FASES.indexOf(estado.fase)));
  const passadasMs = anteriores.reduce((s, f) => s + (estado.tempos[f] ?? 0), 0) * 1000;
  return { duracaoMin, inicioEm: (estado.faseIniciadaEm ?? agora) - passadasMs };
}

/** A fase acabou de começar (aprofundamento, fechamento): é um marco, a hora natural de perguntar. */
export function marcoDeFase(fase: string, faseIniciadaEm: number | null, agora: number): boolean {
  return (fase === "APROFUNDAMENTO" || fase === "FECHAMENTO") && faseIniciadaEm !== null && agora - faseIniciadaEm < RITMO.marcoDeFaseMs;
}

/** Situação da sessão para o ritmo da política comum. O convite de REQUISITOS e a pergunta final ficam fora. */
export function ritmoDoEstado(estado: EstadoSessao, agora: number): Ritmo {
  return {
    agora,
    ...relogioDaEntrevista(estado, agora),
    feitas: estado.perguntasFeitas,
    ultimaEm: estado.ultimaPerguntaEm,
    ultimaConversaFimEm: estado.ultimaRespostaEm,
    // Ele acabou de dizer que terminou: é a hora natural de perguntar, como no começo de uma fase.
    marco: marcoDeFase(estado.fase, estado.faseIniciadaEm, agora)
      || (estado.ultimaConclusaoEm != null && agora - estado.ultimaConclusaoEm < RITMO.marcoDeConclusaoMs),
  };
}

/** Por que o quadro não oferece o encerramento agora (`podeOferecerEncerrar`). */
export type MotivoParaNaoEncerrar = "faltam_criterios" | "falta_mudanca";

/**
 * Quando o quadro pode oferecer o encerramento (#129, decisão F). Pode quando (a) faltam até FRACAO_PARA_FECHAR da
 * duração da vaga (limiar em lib/totti/fechamento.ts); ou (b) nenhum critério do plano está sem evidência E a mudança
 * de cenário já saiu (ou a entrevista não tem mudança prevista). Devolve null quando pode, ou o que falta.
 * Sem duração conhecida, não barra (o comportamento de antes).
 */
export function podeOferecerEncerrar(
  estado: EstadoSessao,
  agora: number,
  contexto: { kit: Pick<Kit, "id">; problema: Pick<Problema, "empecilho"> },
): MotivoParaNaoEncerrar | null {
  const duracaoMs = duracaoTotalS(estado) * 1000;
  if (duracaoMs <= 0) return null;
  if (tempoRestanteMs(estado, agora) <= limiarDoFechamentoNoQuadro(duracaoMs)) return null;
  if (criteriosDoPlanoSemEvidencia(estado).length > 0) return "faltam_criterios";
  if (!estado.empecilho && temMudancaPrevista(contexto.kit, contexto.problema)) return "falta_mudanca";
  return null;
}

/**
 * Os dois ajustes do fechamento no quadro para o núcleo (`gatilhoDoFechamento`): o limiar de tempo (a fração da duração
 * da vaga) e se "terminei" pode fechar agora (sem a barra de `podeOferecerEncerrar`, a conclusão não fecha).
 */
export function parametrosDoFechamentoNoQuadro(
  estado: EstadoSessao,
  agora: number,
  contexto: { kit: Pick<Kit, "id">; problema: Pick<Problema, "empecilho"> },
): { limiarTempoMs: number; podeFecharPorConclusao: boolean } {
  return {
    limiarTempoMs: limiarDoFechamentoNoQuadro(duracaoTotalS(estado) * 1000),
    podeFecharPorConclusao: podeOferecerEncerrar(estado, agora, contexto) === null,
  };
}

/** Fases em que "terminei" fala do desenho (como em estado.ts). */
const FASES_DA_CONCLUSAO_BARRADA: Fase[] = ["ALTO_NIVEL", "APROFUNDAMENTO"];

/**
 * Ele disse que terminou há pouco e o quadro barrou o encerramento: a análise recebe a linha que puxa uma parte, um
 * porquê ou um critério (lib/agente/prompts/avaliador.ts). Só no desenho, e sem fechamento em andamento.
 */
export function conclusaoBarradaRecente(
  estado: EstadoSessao,
  agora: number,
  contexto: { kit: Pick<Kit, "id">; problema: Pick<Problema, "empecilho"> },
): MotivoParaNaoEncerrar | null {
  if (estado.fechamento || !FASES_DA_CONCLUSAO_BARRADA.includes(estado.fase)) return null;
  if (estado.ultimaConclusaoEm == null || agora - estado.ultimaConclusaoEm >= RITMO.marcoDeConclusaoMs) return null;
  return podeOferecerEncerrar(estado, agora, contexto);
}

/** Fases em que a pergunta sobre o desenho passa pelo ritmo por conteúdo (`motivoDoConteudo`). */
const FASES_DO_CONTEUDO: Fase[] = ["ALTO_NIVEL", "APROFUNDAMENTO"];
/** Status que fazem pergunta sobre o desenho e passam pelo ritmo por conteúdo. */
const STATUS_DO_CONTEUDO: StatusAnalise[] = ["duvida", "dica"];

/**
 * Há desenho novo desde a última pergunta? Peça que não estava no grafo da análise que a fez (`desenhoNaUltimaPergunta`).
 * Sem pergunta anterior, qualquer peça do quadro conta. Grafo cortado (`pecas` null) não se compara: não conta como novo.
 */
export function desenhoNovoDesdePergunta(estado: EstadoSessao, pecas: string[] | null | undefined): boolean {
  if (!pecas) return false;
  const antes = estado.desenhoNaUltimaPergunta;
  if (!antes) return pecas.length > 0;
  const conhecidas = new Set(antes);
  return pecas.some((id) => !conhecidas.has(id));
}

/**
 * Quantas perguntas já citaram cada peça (#129, bloco J): id do grafo → número de perguntas. Conta por pergunta, não por
 * menção: uma pergunta que cita a mesma peça duas vezes conta uma. Só dados: o prompt mostra o nome e a guarda compara.
 */
export function contagemDePecasPerguntadas(perguntas: { elementos: string[] }[]): Map<string, number> {
  const vezes = new Map<string, number>();
  for (const p of perguntas) {
    for (const id of new Set(p.elementos)) vezes.set(id, (vezes.get(id) ?? 0) + 1);
  }
  return vezes;
}

/**
 * O teto do ritmo por conteúdo venceu: faz `tetoSemPerguntaMs` desde a última pergunta da análise (ou, sem nenhuma, desde
 * o começo da fase). No ALTO_NIVEL exige também desenho novo desde a última pergunta. No APROFUNDAMENTO vence só pelo
 * tempo (decisão do dono: com o desenho já pronto, a pergunta sai mesmo sem peça nova). Aí a pergunta sai sem parte fechada.
 */
export function tetoDaPergunta(estado: EstadoSessao, agora: number, pecas: string[] | null | undefined): boolean {
  const referencia = estado.ultimaPerguntaEm ?? estado.faseIniciadaEm;
  if (referencia === null || referencia === undefined) return false;
  if (agora - referencia < RITMO_QUADRO.tetoSemPerguntaMs) return false;
  return estado.fase === "APROFUNDAMENTO" || desenhoNovoDesdePergunta(estado, pecas);
}

export type ContextoDoConteudo = {
  /** Há quantos segundos ele não mexe no desenho nem fala (vem no pedido de análise). */
  paradoHaS?: number;
  /** Ids das peças do desenho agora (`pecasDoGrafo`); null quando o grafo veio cortado. */
  pecas?: string[] | null;
};

export type MotivoConteudo = "PISO_ENTRE_PERGUNTAS" | "SEM_PARTE_FECHADA";

/**
 * Ritmo por conteúdo (#129, bloco B): por que uma resposta "duvida" ou "dica" de ALTO_NIVEL/APROFUNDAMENTO NÃO vira
 * pergunta agora (null = pode). Vira pergunta quando:
 * (a) o candidato fechou uma parte (`parteFechada`) e o piso entre perguntas (`RITMO_QUADRO`) passou; ou
 * (b) o teto venceu e há desenho novo, mesmo sem parte fechada; ou
 * (c) é quebra de silêncio (parado há `LIMITE_SILENCIO_S`; não respeita o piso) ou marco de conclusão ("terminei").
 * Os portões do ritmo comum (orçamento, cota, intervalo) continuam valendo por cima, em `filtrarResposta`.
 */
export function motivoDoConteudo(
  estado: EstadoSessao,
  resposta: Pick<RespostaAnalise, "status" | "parteFechada">,
  agora: number,
  contexto: ContextoDoConteudo = {},
): MotivoConteudo | null {
  if (!FASES_DO_CONTEUDO.includes(estado.fase) || !STATUS_DO_CONTEUDO.includes(resposta.status)) return null;
  const quebraDeSilencio = contexto.paradoHaS !== undefined && contexto.paradoHaS >= LIMITE_SILENCIO_S;
  const marco = estado.ultimaConclusaoEm != null && agora - estado.ultimaConclusaoEm < RITMO.marcoDeConclusaoMs;
  if (quebraDeSilencio || marco) return null;
  const pisoPassou = estado.ultimaPerguntaEm == null || agora - estado.ultimaPerguntaEm >= RITMO_QUADRO.pisoEntrePerguntasMs;
  if (resposta.parteFechada && pisoPassou) return null;
  if (tetoDaPergunta(estado, agora, contexto.pecas)) return null;
  return resposta.parteFechada ? "PISO_ENTRE_PERGUNTAS" : "SEM_PARTE_FECHADA";
}

/**
 * Um ciclo de brecha por vez: depois da garantia dos 60% (ver `precisaAbrirBrechaDaMudanca`), a análise volta a
 * abrir espaço para a mudança só depois desse intervalo. Não bloqueia perguntas indefinidamente.
 */
export const INTERVALO_BRECHA_EMPECILHO_MS = 60_000;

/**
 * A mudança devida ainda não entrou e a entrevista já passou da fração da garantia (decisão G): a análise responde
 * "ok" por um ciclo para abrir a brecha. Só no meio da entrevista (ALTO_NIVEL e APROFUNDAMENTO) e com a mudança
 * prevista (do problema ou genérica do kit). Função pura.
 */
export function precisaAbrirBrechaDaMudanca(estado: EstadoSessao, agora: number, mudancaPrevista: boolean): boolean {
  if (!mudancaPrevista || estado.empecilho) return false;
  if (estado.fase !== "ALTO_NIVEL" && estado.fase !== "APROFUNDAMENTO") return false;
  if (!emGarantiaDoEmpecilho({ agora, iniciadaEm: estado.iniciadaEm ?? null, duracaoTotalS: duracaoTotalS(estado) })) return false;
  const ultima = estado.brechaEmpecilhoEm;
  return ultima === undefined || ultima === null || agora - ultima >= INTERVALO_BRECHA_EMPECILHO_MS;
}

/** Contexto da pergunta obrigatória: o tempo parado do candidato e se o kit/problema tem mudança prevista. */
export type ContextoDaPerguntaObrigatoria = {
  paradoHaS?: number;
  /** A mudança prevista (do problema ou genérica do kit); ver `temMudancaPrevista`. */
  mudancaPrevista: boolean;
};

/**
 * O teto venceu e nenhum portão bloqueia a pergunta (#129, bloco B; no APROFUNDAMENTO vale só o tempo, ver
 * `tetoDaPergunta`): a análise do desenho é OBRIGADA a perguntar, e "ok" não vale nela. Portões: fase de conteúdo, sem pergunta pendente, ritmo comum (orçamento, cota, intervalo, bola
 * com o candidato, fechamento) e sem a brecha da mudança (decisão G), que é um "ok" de propósito.
 */
export function perguntaObrigatoria(
  estado: EstadoSessao,
  agora: number,
  pecas: string[] | null | undefined,
  contexto: ContextoDaPerguntaObrigatoria,
): boolean {
  if (!FASES_DO_CONTEUDO.includes(estado.fase)) return false;
  if (!tetoDaPergunta(estado, agora, pecas)) return false;
  if (estado.perguntaPendente) return false;
  if (motivoBloqueioPlin(estado, agora, undefined, { paradoHaS: contexto.paradoHaS }) !== null) return false;
  return !precisaAbrirBrechaDaMudanca(estado, agora, contexto.mudancaPrevista);
}

/** Quantos redirecionamentos de escopo a entrevista aceita (#129, decisão I). */
export const LIMITE_REDIRECIONAMENTOS_DE_ESCOPO = 2;
/** Entre o primeiro redirecionamento de escopo e o segundo (o último, mais direto), passam pelo menos isto (#129, decisão I). */
export const ESPERA_SEGUNDO_LEMBRETE_ESCOPO_MS = 300_000;

/** Por que um redirecionamento de escopo não sai agora. São os ajustes da análise (ver lib/agente/analisar.ts). */
export type MotivoEscopo = "escopo_fora_da_fase" | "escopo_sem_desenho" | "escopo_ja_redirecionado" | "escopo_espera_lembrete";

/**
 * Redirecionamento de escopo (#129, decisão I): por que não pode virar plin agora (null = pode). Pode só em ALTO_NIVEL e
 * APROFUNDAMENTO, com alguma peça desenhada para julgar (`pecas` null = grafo grande demais para comparar, então é desenho);
 * até LIMITE_REDIRECIONAMENTOS_DE_ESCOPO vezes, e a segunda só ESPERA_SEGUNDO_LEMBRETE_ESCOPO_MS depois da primeira.
 * O intervalo entre perguntas não entra aqui: ele é furado em `motivoBloqueioPlin` (ver `ContextoDoCandidato.escopo`).
 */
export function motivoRedirecionamentoDeEscopo(
  estado: EstadoSessao,
  agora: number,
  pecas: string[] | null | undefined,
): MotivoEscopo | null {
  if (!FASES_DO_CONTEUDO.includes(estado.fase)) return "escopo_fora_da_fase";
  if (pecas !== null && pecas !== undefined && pecas.length === 0) return "escopo_sem_desenho";
  const feitos = estado.escopoRedirecionamentos ?? 0;
  if (feitos >= LIMITE_REDIRECIONAMENTOS_DE_ESCOPO) return "escopo_ja_redirecionado";
  // Com um feito, a segunda vez espera o lembrete (contado desde o primeiro).
  if (feitos > 0 && agora - (estado.escopoProvocadoEm ?? agora) < ESPERA_SEGUNDO_LEMBRETE_ESCOPO_MS) return "escopo_espera_lembrete";
  return null;
}

/**
 * Aplica a regra do escopo a uma resposta da análise. Fora dela, o redirecionamento vira "ok" e `escopo` cai, e o motivo
 * sai junto para os ajustes. Resposta sem escopo (ou com escopo fora de "redirecionar") passa só com `escopo` normalizado.
 */
export function aplicarRegraDoEscopo(
  estado: EstadoSessao,
  resposta: RespostaAnalise,
  agora: number,
  pecas: string[] | null | undefined,
): { resposta: RespostaAnalise; motivo: MotivoEscopo | null } {
  if (!resposta.escopo) return { resposta, motivo: null };
  if (resposta.status !== "redirecionar") return { resposta: { ...resposta, escopo: false }, motivo: null };
  const motivo = motivoRedirecionamentoDeEscopo(estado, agora, pecas);
  if (!motivo) return { resposta, motivo: null };
  return { resposta: { ...resposta, status: "ok", escopo: false }, motivo };
}

const CODIGO_DO_RITMO = {
  orcamento: "LIMITE_DE_PERGUNTAS",
  cota: "COTA_DO_TEMPO",
  respiro: "INTERVALO_ENTRE_PERGUNTAS",
  intervalo: "INTERVALO_ENTRE_PERGUNTAS",
} as const;

/** Que tipos de plin cada fase aceita. `ok` é sempre permitido (silêncio). */
const PLINS_DA_FASE: Partial<Record<Fase, StatusAnalise[]>> = {
  // REQUISITOS: só `duvida`, para o convite de quem fica em silêncio total no começo (não conta na cota; ver estado.ts).
  REQUISITOS: ["duvida"],
  // ALTO_NIVEL: o modelo decide (pelo tempo parado, ver prompt) se quebra o silêncio; o padrão continua "ok".
  ALTO_NIVEL: ["duvida", "redirecionar", "dica"],
  APROFUNDAMENTO: ["duvida", "redirecionar", "dica"],
  // FECHAMENTO: uma única pergunta final (o limite de "uma" fica em `motivoBloqueio`).
  FECHAMENTO: ["duvida"],
};

export function statusPermitido(fase: Fase, status: StatusAnalise): boolean {
  if (status === "ok") return true;
  return PLINS_DA_FASE[fase]?.includes(status) ?? false;
}

/**
 * O plano da vaga limita as dicas: "nenhuma" bloqueia o status `dica`; "leves" permite uma só.
 * Sem plano, vale só a regra da fase.
 */
export function statusPermitidoNoEstado(estado: EstadoSessao, status: StatusAnalise): boolean {
  if (!statusPermitido(estado.fase, status)) return false;
  if (status !== "dica") return true;
  const dicas = estado.plano?.dicas ?? "livres";
  if (dicas === "nenhuma") return false;
  if (dicas === "leves") return !estado.perguntas.some((p) => p.status === "dica");
  return true;
}

/** Fases em que o /analisar roda (colhe observações). Plin é outra conta: ver PLINS_DA_FASE. */
const FASES_QUE_ANALISAM: Fase[] = ["REQUISITOS", "ALTO_NIVEL", "APROFUNDAMENTO", "FECHAMENTO"];

export type MotivoBloqueio = "FASE_NAO_ANALISA" | "CANDIDATO_RESPONDENDO";

export type MotivoBloqueioPlin =
  | MotivoBloqueio
  | "LIMITE_DE_PERGUNTAS"
  | "COTA_DO_TEMPO"
  | "INTERVALO_ENTRE_PERGUNTAS"
  | "CANDIDATO_JA_FALOU"
  | "CANDIDATO_JA_DESENHOU"
  | "SILENCIO_INICIAL_INSUFICIENTE"
  | "CANDIDATO_EM_ATIVIDADE"
  | "FECHAMENTO"
  | "BOLA_COM_O_CANDIDATO";

/**
 * O que o quadro sabe do candidato no momento da análise. Sem isso a regra "a bola está com ele" não se aplica
 * (o servidor não vê o desenho nem a voz, só o que o quadro manda).
 */
export type ContextoDoCandidato = {
  /** Há quantos segundos ele não mexe no desenho nem fala (vem no pedido de análise). */
  paradoHaS?: number;
  /** O grafo recebido contém elementos do candidato (inclusive texto e traços). */
  temDesenho?: boolean;
  /**
   * A resposta é um redirecionamento de escopo (#129, decisão I): fura intervalo, respiro e cota. Só o orçamento total,
   * a regra da bola e o limite de duas vezes continuam valendo.
   */
  escopo?: boolean;
};

/**
 * Por que a análise não deve rodar agora (null = pode rodar).
 *
 * Só fase e candidato respondendo bloqueiam. O intervalo entre perguntas e o limite de perguntas NÃO
 * bloqueiam a análise: o agente segue colhendo observações para o scorecard, mesmo quando não
 * pode levantar um plin (ver `motivoBloqueioPlin`). Uma dúvida pendente também não bloqueia
 * (é preciso poder substituí-la ou cancelá-la).
 */
export function motivoBloqueio(estado: EstadoSessao): MotivoBloqueio | null {
  if (!FASES_QUE_ANALISAM.includes(estado.fase)) return "FASE_NAO_ANALISA";
  // Candidato no meio da resposta: não se interrompe.
  if (estado.plin === "PERGUNTA_ATIVA") return "CANDIDATO_RESPONDENDO";
  return null;
}

/** A análise pode rodar agora? (`agora` e `regras` ficam na assinatura por compatibilidade.) */
export function podeAnalisar(
  estado: EstadoSessao,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _agora?: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _regras?: Regras,
): boolean {
  return motivoBloqueio(estado) === null;
}

/** Por que um plin não pode ser levantado agora (null = pode). Inclui limite e intervalo. */
export function motivoBloqueioPlin(
  estado: EstadoSessao,
  agora: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _regras: Regras = REGRAS_PADRAO,
  candidato: ContextoDoCandidato = {},
): MotivoBloqueioPlin | null {
  const base = motivoBloqueio(estado);
  if (base) return base;
  // Fechamento comum em andamento (lib/totti/fechamento.ts): as perguntas finais saem dele, uma atrás da outra, na
  // conversa. A análise segue rodando para colher observações, mas não levanta pergunta por cima.
  if (fechamentoAtivo(estado)) return "FECHAMENTO";
  // O convite de REQUISITOS e a pergunta final do FECHAMENTO ficam fora do orçamento, mas são únicos.
  if (estado.fase === "REQUISITOS" && estado.conviteFeito) return "LIMITE_DE_PERGUNTAS";
  if (estado.fase === "REQUISITOS") {
    const inicio = estado.faseIniciadaEm;
    if (estado.conversa.some((f) => f.quem === "candidato" && f.texto.trim() && (inicio === null || f.em >= inicio))) {
      return "CANDIDATO_JA_FALOU";
    }
    if (candidato.temDesenho) return "CANDIDATO_JA_DESENHOU";
    if (inicio === null || agora - inicio < SILENCIO_INICIAL_S * 1000) return "SILENCIO_INICIAL_INSUFICIENTE";
    // A voz/desenho pode ter chegado ao navegador antes de o servidor registrar a fala.
    if (candidato.paradoHaS !== undefined && candidato.paradoHaS < SILENCIO_REQUISITOS_S) return "CANDIDATO_EM_ATIVIDADE";
  }
  if (estado.fase === "FECHAMENTO" && estado.perguntaFinalFeita) return "LIMITE_DE_PERGUNTAS";
  // Ritmo da política comum (lib/interrupcao/politica.ts): orçamento escalado pela duração, cota proporcional ao
  // tempo, intervalo e respiro. Igual no quadro (lib/sessao/estados.ts) e no live coding.
  const ritmo = ritmoDoEstado(estado, agora);
  const extra = estado.fase === "REQUISITOS" || estado.fase === "FECHAMENTO";
  const ritmoDaFase = extra ? { ...ritmo, feitas: 0, marco: true } : ritmo;
  // Redirecionamento de escopo (#129, decisão I, revisado): fora do intervalo, do respiro e da cota ("quanto antes
  // melhor"). Só o orçamento total da entrevista continua valendo.
  if (candidato.escopo) {
    if (ritmoDaFase.feitas >= orcamentoDeInterrupcoes(ritmoDaFase.duracaoMin)) return "LIMITE_DE_PERGUNTAS";
  } else {
    const motivo = motivoDoRitmo(ritmoDaFase);
    if (motivo) return CODIGO_DO_RITMO[motivo.codigo];
  }
  // A bola está com o candidato: depois de qualquer fala solta do agente (resposta, comentário, continuação) ele
  // não pergunta de novo até o candidato agir (falar ou mexer no desenho). Sem ação dele, só um silêncio total de
  // SILENCIO_SEM_ACAO_S libera a pergunta (em todas as fases). O pedido de tempo para pensar conta como essa fala.
  // Exceção: ele acabou de dizer que terminou e o Totti só avisou que ia olhar o desenho. Ali a pergunta é esperada.
  const fala = falaQueContaParaABola(estado);
  const acabouDeConcluir = estado.ultimaConclusaoEm != null && agora - estado.ultimaConclusaoEm < RITMO.marcoDeConclusaoMs
    && (fala == null || fala <= estado.ultimaConclusaoEm);
  if (!acabouDeConcluir && fala != null && candidato.paradoHaS !== undefined) {
    const agiuDepois = agora - candidato.paradoHaS * 1000 > fala;
    if (!agiuDepois && agora - fala < SILENCIO_SEM_ACAO_S * 1000) return "BOLA_COM_O_CANDIDATO";
  }
  return null;
}

/**
 * O candidato pediu tempo para pensar ("calma", "deixa eu pensar") e ainda não agiu desde então (não desenhou nem
 * falou). O pedido conta como fala do Totti para a regra da bola (ver `falaQueContaParaABola`). `paradoHaS` é o tempo
 * desde a última ação dele (ausente: não se sabe, e então não há como dizer que ele agiu).
 */
export function pedidoDeTempoPendente(estado: EstadoSessao, agora: number, paradoHaS?: number): boolean {
  const pedido = estado.pediuTempoEm;
  if (pedido == null) return false;
  return paradoHaS === undefined || agora - paradoHaS * 1000 <= pedido;
}

/** A última fala do agente ou o último pedido de tempo dele (o pedido conta como fala do Totti para a regra da bola). */
export function falaQueContaParaABola(estado: EstadoSessao): number | null {
  const fala = estado.ultimaFalaDoAgenteEm ?? null;
  const pedido = estado.pediuTempoEm ?? null;
  if (fala === null) return pedido;
  if (pedido === null) return fala;
  return Math.max(fala, pedido);
}

/** Uma resposta com este status pode virar plin agora? (fase + intervalo + limite) */
export function podeLevantarPlin(
  estado: EstadoSessao,
  status: StatusAnalise,
  agora: number,
  regras: Regras = REGRAS_PADRAO,
  candidato: ContextoDoCandidato = {},
): boolean {
  if (status === "ok") return false;
  return statusPermitidoNoEstado(estado, status) && motivoBloqueioPlin(estado, agora, regras, candidato) === null;
}

/** Extrai os ids curtos do grafo (linhas "- [e1] Postgres (elipse)" ou "- [s1] A → B"). */
export function extrairIdsDoGrafo(grafo: string): Set<string> {
  return new Set([...grafo.matchAll(/^- \[([^\]]+)\]/gm)].map((m) => m[1]));
}

function cortar(texto: string, max: number) {
  return texto.length <= max ? texto : texto.slice(0, max).trimEnd();
}

/** Resposta de silêncio, mantendo as observações (elas valem para o scorecard mesmo sem plin). */
function silenciar(resposta: RespostaAnalise): RespostaAnalise {
  return { ...resposta, status: "ok", pergunta: null, nota: null, elementos: [], degrau: null, ...(resposta.visual ? { visual: [] } : {}) };
}

/**
 * Última barreira antes de devolver a resposta ao quadro:
 * - rebaixa para `ok` o que a fase/intervalo/limite não permite, ou o plin sem pergunta;
 * - descarta ids de `elementos` que não existem no grafo recebido (e repetidos);
 * - corta a `nota` em ~40 caracteres (sem nota, usa a pergunta cortada, como o quadro faz).
 */
export function filtrarResposta(
  estado: EstadoSessao,
  resposta: RespostaAnalise,
  idsDoGrafo: ReadonlySet<string>,
  agora: number,
  regras: Regras = REGRAS_PADRAO,
  candidato: ContextoDoCandidato = {},
  grafo = "",
): RespostaAnalise {
  const filtrada = filtrarPlin(estado, resposta, idsDoGrafo, agora, regras, grafo, {
    ...candidato,
    temDesenho: candidato.temDesenho || idsDoGrafo.size > 0,
    escopo: resposta.status === "redirecionar" && resposta.escopo === true,
  });
  // O sinal de prontidão independe do plin, mas só vale em ALTO_NIVEL.
  return { ...filtrada, avancar_fase: resposta.avancar_fase === true && estado.fase === "ALTO_NIVEL" };
}

function filtrarPlin(
  estado: EstadoSessao,
  resposta: RespostaAnalise,
  idsDoGrafo: ReadonlySet<string>,
  agora: number,
  regras: Regras,
  grafo: string,
  candidato: ContextoDoCandidato,
): RespostaAnalise {
  if (resposta.status === "ok") return silenciar(resposta);
  const pergunta = resposta.pergunta?.trim();
  if (!pergunta || !podeLevantarPlin(estado, resposta.status, agora, regras, candidato)) {
    return silenciar(resposta);
  }
  const nota = cortar((resposta.nota?.trim() || pergunta).trim(), regras.maxCaracteresNota);
  const elementos = [...new Set(resposta.elementos)].filter((id) => idsDoGrafo.has(id));
  // A pergunta que fala de uma peça sempre a marca (o modelo às vezes manda `visual: []` com elementos citados).
  const visual = garantirMarca(
    resposta.visual ? mapearAcoesVisuais(resposta.visual, (id) => idsDoGrafo.has(id) ? id : null) : undefined,
    elementos, estado.perguntasFeitas, conexoesDoGrafo(grafo));
  return { ...resposta, pergunta, nota, elementos, ...(visual ? { visual } : {}) };
}
