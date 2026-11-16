// Briefing da entrevista: o que o entrevistador precisa ter claro em toda fala.
// Reúne, num bloco só, o que a recrutadora quer descobrir (critérios e peso), o que já temos do candidato
// (as evidências já registradas) e o que ainda falta. Os dois cérebros (a análise do quadro e a conversa por
// voz) leem o mesmo bloco, para não ficarem com visões diferentes da entrevista.
//
// A cobertura é calculada aqui, em código, a partir das observações que a análise já grava. O texto só
// descreve o resultado: quem decide o que perguntar continua sendo o modelo. Só servidor.
import type { FocusArea } from "../contracts";
import { criterioIndireto, type Criterio, type Kit } from "./kits/tipos";
import { tempoDaEntrevista, type EstadoSessao, type EvidenciaDoCriterio, type ObservacaoRegistrada } from "./sessao/estado";
import type { Fase } from "./sessao/tipos";

/**
 * Área do foco da recrutadora que puxa o peso de cada critério da rubrica. Os critérios sem área aqui (requisitos,
 * trade-offs, comunicação) são universais e valem peso 1.
 */
const AREA_DO_CRITERIO: Record<string, FocusArea> = {
  escalabilidade: "escala_produto",
  uso_ia: "uso_ia",
  componentes_fluxo: "tecnico",
  dados_consistencia: "tecnico",
};

/** O critério só se pergunta na etapa de requisitos; depois dela, não é mais alvo de pergunta. */
const CRITERIO_DE_REQUISITOS = "requisitos";

/** Etapas em que o agente já procura evidência dos critérios: antes disso o objetivo é outro. */
const ETAPAS_DE_COBERTURA: Fase[] = ["ALTO_NIVEL", "APROFUNDAMENTO", "FECHAMENTO"];

/** O que o entrevistador quer conseguir em cada etapa. Sem isso o alvo dos critérios não tem contexto. */
const OBJETIVO_DA_ETAPA: Partial<Record<Fase, string>> = {
  REQUISITOS:
    "o candidato entende o problema. Responda as dúvidas dele e deixe-o perguntar; ainda não é hora de aprofundar nem de cobrar os critérios.",
  ALTO_NIVEL:
    "ver a visão geral e, a cada pergunta, preferir um critério ainda sem evidência que tenha gancho no que ele já desenhou.",
  APROFUNDAMENTO:
    "reunir evidência dos critérios que ainda faltam, com perguntas ligadas ao que ele desenhou, uma de cada vez.",
  FECHAMENTO:
    "fazer a última pergunta, no critério de maior peso ainda aberto, e encerrar.",
};

/** Quantas evidências por critério vão ao prompt (as mais recentes). */
const MAX_EVIDENCIAS_NO_BRIEFING = 3;
const MAX_CARACTERES_EVIDENCIA = 160;

/** Folga, em fração do peso total, a partir da qual o ritmo deixa de ser "no ritmo". */
const MARGEM_DO_RITMO = 0.15;
/** Fração do tempo em que a cobertura completa já deveria ter acontecido (o fim fica para o fechamento). */
const FRACAO_DO_TEMPO_PARA_COBRIR = 0.85;
/** Antes disso o ritmo não é julgado: a entrevista mal começou. */
const FRACAO_MINIMA_PARA_JULGAR = 0.2;

export type SituacaoDoCriterio = {
  id: string;
  nome: string;
  peso: number;
  /** Evidência suficiente para o relatório: ver `evidenciaSuficiente`. */
  suficiente: boolean;
  /** Quantas observações o critério tem, de qualquer sinal. */
  total: number;
  /** As evidências mais recentes, da mais antiga à mais nova. */
  evidencias: ObservacaoRegistrada[];
};

export type Ritmo = "no_inicio" | "adiantado" | "no_ritmo" | "atrasado";

export type ResumoDaCobertura = {
  criterios: SituacaoDoCriterio[];
  /** Peso dos critérios suficientes sobre o peso total, de 0 a 1. */
  coberturaPonderada: number;
  /** Fração do tempo da entrevista já gasta, de 0 a 1. */
  tempoGasto: number;
  ritmo: Ritmo;
};

/**
 * Peso de um critério: 1 mais o peso (0 a 1) que a recrutadora deu à área ligada a ele. Um critério sem área,
 * ou uma sessão sem plano, vale 1.
 */
export function pesoDoCriterio(id: string, estado: Pick<EstadoSessao, "plano">): number {
  const area = AREA_DO_CRITERIO[id];
  if (!area) return 1;
  const foco = estado.plano?.foco.find((f) => f.area === area);
  return 1 + (foco?.peso ?? 0);
}

/**
 * Evidência suficiente: pelo menos uma observação com sinal claro (positivo ou negativo), ou duas de qualquer
 * sinal. Uma única observação neutra não prova nada sobre o candidato.
 */
export function evidenciaSuficiente(e: EvidenciaDoCriterio | undefined): boolean {
  if (!e) return false;
  return e.positivo + e.negativo >= 1 || e.positivo + e.negativo + e.neutro >= 2;
}

/** O ritmo da cobertura contra o tempo: quanto já deveria estar coberto neste ponto da entrevista. */
export function ritmoDaCobertura(coberturaPonderada: number, tempoGasto: number): Ritmo {
  if (tempoGasto < FRACAO_MINIMA_PARA_JULGAR) return "no_inicio";
  const esperado = Math.min(1, tempoGasto / FRACAO_DO_TEMPO_PARA_COBRIR);
  const folga = coberturaPonderada - esperado;
  if (folga < -MARGEM_DO_RITMO) return "atrasado";
  if (folga > MARGEM_DO_RITMO) return "adiantado";
  return "no_ritmo";
}

/** A situação de cada critério da rubrica e o ritmo geral, tudo calculado do estado da sessão. */
export function resumoDaCobertura(criterios: Criterio[], estado: EstadoSessao, agora: number): ResumoDaCobertura {
  const situacao: SituacaoDoCriterio[] = criterios.filter((c) => !criterioIndireto(c)).map((c) => {
    const contagem = estado.cobertura[c.id];
    const total = contagem ? contagem.positivo + contagem.negativo + contagem.neutro : 0;
    return {
      id: c.id,
      nome: c.nome,
      peso: pesoDoCriterio(c.id, estado),
      suficiente: evidenciaSuficiente(contagem),
      total,
      evidencias: estado.observacoes.filter((o) => o.criterio === c.id).slice(-MAX_EVIDENCIAS_NO_BRIEFING),
    };
  });
  const pesoTotal = situacao.reduce((s, c) => s + c.peso, 0);
  const pesoCoberto = situacao.filter((c) => c.suficiente).reduce((s, c) => s + c.peso, 0);
  const coberturaPonderada = pesoTotal > 0 ? pesoCoberto / pesoTotal : 0;
  const { totalMin, decorridoMin } = tempoDaEntrevista(estado, agora);
  const tempoGasto = totalMin > 0 ? Math.min(1, decorridoMin / totalMin) : 0;
  return { criterios: situacao, coberturaPonderada, tempoGasto, ritmo: ritmoDaCobertura(coberturaPonderada, tempoGasto) };
}

const ROTULO_RITMO: Record<Ritmo, string> = {
  no_inicio: "a entrevista está começando; não há o que cobrar de ritmo ainda",
  adiantado: "adiantado: dá para aprofundar o ponto mais fraco",
  no_ritmo: "no ritmo",
  atrasado: "atrasado: priorize os critérios que faltam em vez de aprofundar o que já tem evidência",
};

const percentual = (n: number) => `${Math.round(n * 100)}%`;
const peso1 = (n: number) => n.toFixed(1).replace(".", ",");

function recortar(texto: string): string {
  const t = texto.trim().replace(/\s+/g, " ");
  return t.length > MAX_CARACTERES_EVIDENCIA ? `${t.slice(0, MAX_CARACTERES_EVIDENCIA)}…` : t;
}

function linhaDaEvidencia(o: ObservacaoRegistrada): string {
  return `  · ${o.sinal}${o.espontaneo ? ", espontâneo" : ""}: ${recortar(o.evidencia)}`;
}

/**
 * O bloco de briefing que vai ao prompt, na análise e na conversa por voz. Diz o objetivo da etapa e o que já
 * temos do candidato. Da etapa de aprofundamento em diante diz também a cobertura, o ritmo e o que falta, do que
 * mais pesa ao que menos pesa: antes disso os critérios ainda não são o assunto, e um "alvo" só atrapalharia.
 */
export function blocoDoBriefing(kit: Pick<Kit, "criterios">, estado: EstadoSessao, agora: number): string {
  const r = resumoDaCobertura(kit.criterios, estado, agora);
  const cobertos = r.criterios.filter((c) => c.suficiente);
  const objetivo = OBJETIVO_DA_ETAPA[estado.fase];
  const cobrando = ETAPAS_DE_COBERTURA.includes(estado.fase);

  const jaTemos = cobertos.length
    ? cobertos.map((c) => `- ${c.nome}:
${c.evidencias.map(linhaDaEvidencia).join("\n")}`).join("\n")
    : "(nada com evidência suficiente ainda)";
  const cabecalho = `BRIEFING DA ENTREVISTA (para você decidir o que perguntar; nunca cite ao candidato)${objetivo ? `
Objetivo desta etapa: ${objetivo}` : ""}`;

  if (!cobrando) return `${cabecalho}
O que já temos do candidato:
${jaTemos}`;

  // Requisitos só se pergunta na etapa de requisitos: depois dela fica fora do que falta e dos alvos.
  const faltando = r.criterios.filter((c) => !c.suficiente && c.id !== CRITERIO_DE_REQUISITOS).sort((a, b) => b.peso - a.peso);
  const falta = faltando.length
    ? faltando
        .map((c) => {
          const estadoDoCriterio = c.total === 0 ? "nenhuma evidência" : `só ${c.total} observação neutra, ainda sem prova`;
          const peso = c.peso > 1 ? ` (peso ${peso1(c.peso)}: a recrutadora quer ver)` : "";
          return `- ${c.nome}${peso}: ${estadoDoCriterio}`;
        })
        .join("\n")
    : "(todos os critérios têm evidência suficiente)";
  const alvo = faltando[0];
  const rodape = alvo
    ? `Próximo alvo, se houver gancho no desenho: ${alvo.nome}. Critério com evidência suficiente não precisa de outra pergunta; só volte a ele se o candidato trouxer algo novo. Se faltar pouco tempo, a última pergunta vai para o critério de maior peso ainda aberto.`
    : "Tudo coberto: aprofundar só o que o candidato trouxer de novo, sem repetir o que já está nas evidências.";

  return `${cabecalho}
Cobertura: ${cobertos.length} de ${r.criterios.length} critérios com evidência suficiente (${percentual(r.coberturaPonderada)} do peso). Tempo: ${percentual(r.tempoGasto)} gasto. Ritmo: ${ROTULO_RITMO[r.ritmo]}.
O que já temos do candidato:
${jaTemos}
O que ainda falta, do que mais pesa ao que menos pesa:
${falta}
${rodape}`;
}
