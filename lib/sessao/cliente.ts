import { z } from "zod";
import { ETAPAS_DO_FECHAMENTO, type EtapaDoFechamento } from "../totti/fechamento";
import { EsquemaVisualOpcional, type AcaoVisual } from "../presenca/acoesVisuais";
import type { MarcaDeFala } from "../presenca/vozSincronizada";
import { escolherVozPt } from "../voz/escolherVoz";
import { trechoDeContexto } from "../voz/contrato";
import { velocidadeDaFala } from "../voz/velocidade";
import { urlDaReacao } from "../voz/reacao";
import { comFolga, marcarSaidaDeSom, quadrosAntesDaFala } from "../voz/folga";

// Único ponto de acesso do quadro ao servidor.
// O servidor é o padrão; só "0" liga a sessão de demonstração.
export function usarServidor(): boolean {
  return process.env.NEXT_PUBLIC_USAR_SERVIDOR !== "0";
}

export type Fase =
  | "AGUARDANDO"
  | "APRESENTACAO"
  | "REQUISITOS"
  | "ALTO_NIVEL"
  | "APROFUNDAMENTO"
  | "FECHAMENTO"
  | "ENCERRADA";

export type Sessao = {
  sessao_id: string;
  /** Nome da área do kit de avaliação (ex.: "system design", "marketing"). */
  area: string;
  /** `fala_do_desafio`: o que o agente fala ao apresentar o desafio (natural); sem ela, a fala é montada do título e do enunciado. */
  problema: { titulo: string; enunciado: string; fala_do_desafio?: string };
  /** Duração de cada fase, em segundos. */
  tempos: Partial<Record<Fase, number>>;
  /** Fala de abertura, escrita pelo cérebro. Ausente/null: o agente vai direto ao desafio. */
  apresentacao?: string | null;
  /** Fala de despedida, dita ao encerrar. Ausente/null: sem despedida falada. */
  despedida?: string | null;
};

// --- Contrato com o /analisar (divisão de tarefas, seção 4.1 e 4.2) ---

export type FalaRecente = { quem: "candidato" | "agente"; texto: string };

/** Fala em andamento na legenda: `ate` = quantos caracteres já foram falados. */
export type FalaNaTela = FalaRecente & { ate: number };

export type PedidoAnalise = {
  sessao_id: string;
  fase: Fase;
  /** O desenho em texto (conversor). */
  grafo: string;
  /** O que mudou desde a última análise. */
  mudancas: string;
  conversa_recente: FalaRecente[];
  perguntas_feitas: number;
  imagem_url: string | null;
  /** Miniatura JPEG do quadro (data URL), enviada junto da análise. */
  imagem_base64?: string;
  /** Segundos desde a última atividade do candidato (desenho ou fala). */
  parado_ha_s?: number;
  /** Requisitos já combinados no quadro. */
  requisitos?: string[];
  gestos_recentes?: string[];
};

export type Observacao = {
  criterio: string;
  sinal: "positivo" | "negativo" | "neutro";
  espontaneo: boolean;
  evidencia: string;
};

export type RespostaAnalise = {
  status: "ok" | "duvida" | "redirecionar" | "dica";
  /** O que a voz fala. */
  pergunta: string | null;
  /** Versão curta que o agente escreve no quadro (~40 caracteres). */
  nota: string | null;
  /** IDs (curtos, do conversor) que o agente circula. */
  elementos: string[];
  visual?: AcaoVisual[];
  degrau: number | null;
  observacoes: Observacao[];
  /** O cérebro acha que o candidato já mostrou o suficiente do alto nível: segue para o aprofundamento. */
  avancar_fase?: boolean;
  /** O candidato fechou uma parte do desenho (ver o servidor, `motivoDoConteudo`). Só informativo no quadro. */
  parteFechada?: boolean;
  /** Redirecionamento de escopo (servidor, decisão I). Vale no quadro só para o ritmo: fura o intervalo entre perguntas. */
  escopo?: boolean;
  /** Sequência comum em andamento; ausente quando suspensa ou ainda não iniciada. */
  fechamento?: EtapaDoFechamento;
};

/** Valida a resposta do /analisar. Fora do formato → a análise é descartada (o gatilho tenta de novo depois). */
const EsquemaResposta = z.object({
  status: z.enum(["ok", "duvida", "redirecionar", "dica"]),
  pergunta: z.string().nullable().default(null),
  nota: z.string().nullable().default(null),
  elementos: z.array(z.string()).default([]),
  visual: EsquemaVisualOpcional,
  degrau: z.number().nullable().default(null),
  observacoes: z
    .array(
      z.object({
        criterio: z.string(),
        sinal: z.enum(["positivo", "negativo", "neutro"]),
        espontaneo: z.boolean(),
        evidencia: z.string(),
      }),
    )
    .default([]),
  avancar_fase: z.boolean().default(false),
  parteFechada: z.boolean().default(false),
  escopo: z.boolean().default(false),
  fechamento: z.enum(ETAPAS_DO_FECHAMENTO).optional(),
});

export function validarResposta(dados: unknown): RespostaAnalise {
  const r = EsquemaResposta.parse(dados);
  // Sem pergunta não há o que perguntar: vira "ok".
  if (r.status !== "ok" && !r.pergunta?.trim()) return { ...r, status: "ok" };
  // A nota é curta (~40 caracteres); se vier sem, usa a pergunta.
  return { ...r, nota: (r.nota?.trim() || r.pergunta || "").slice(0, 60) || null };
}

// Só o enunciado vem ao navegador: a ficha de requisitos e a rubrica ficam no servidor.
export async function criarSessao(opcoes: { configId?: string } = {}): Promise<Sessao> {
  vozDoServidorDisponivel = true;
  if (usarServidor()) {
    const servidor = await import("./servidor");
    return servidor.criarSessao({
      avaliacaoId: process.env.NEXT_PUBLIC_AVALIACAO_ID || "demo",
      candidatoId: process.env.NEXT_PUBLIC_CANDIDATO_ID || "demo",
      configId: opcoes.configId,
    });
  }
  return {
    sessao_id: "sessao-de-mentira",
    area: "system design",
    problema: {
      titulo: "Encurtador de URL",
      enunciado:
        "Projete um serviço como o bit.ly: recebe uma URL longa e devolve uma curta. Quem acessa a curta é redirecionado.",
    },
    // Tempos curtos de propósito, para testar o fluxo inteiro rápido.
    tempos: {
      REQUISITOS: 30,
      ALTO_NIVEL: 40,
      APROFUNDAMENTO: 5 * 60,
      FECHAMENTO: 60,
    },
  };
}

// --- Análise de mentira: uma lista fixa que se repete ---

const RESPOSTAS_DE_MENTIRA: Omit<RespostaAnalise, "elementos">[] = [
  { status: "ok", pergunta: null, nota: null, degrau: null, observacoes: [] },
  {
    status: "duvida",
    pergunta: "Com leitura cem vezes maior que escrita, onde fica o gargalo desse desenho?",
    nota: "Leitura 100x: gargalo?",
    degrau: null,
    observacoes: [
      { criterio: "escalabilidade", sinal: "negativo", espontaneo: false, evidencia: "banco único sem cache" },
    ],
  },
  { status: "ok", pergunta: null, nota: null, degrau: null, observacoes: [] },
  {
    status: "duvida",
    pergunta: "Como você garante que dois links nunca recebem o mesmo código?",
    nota: "Colisão de código?",
    degrau: null,
    observacoes: [],
  },
];

let proximaResposta = 0;
let proximaDemo = 0;

/** Uma dúvida pronta para demonstrar o plin, apontando para o último componente desenhado. */
export function duvidaDeDemonstracao(grafo: string): RespostaAnalise {
  const duvidas = RESPOSTAS_DE_MENTIRA.filter((r) => r.status === "duvida");
  const base = duvidas[proximaDemo++ % duvidas.length];
  const alvo = ultimoComponente(grafo);
  return validarResposta({ ...base, elementos: alvo ? [alvo] : [] });
}

/** O último componente citado no grafo (ex.: "- [e1] Postgres (elipse)" → "e1"). */
function ultimoComponente(grafo: string) {
  const secao = grafo.split(/\nCONEX/)[0];
  const ids = [...secao.matchAll(/^- \[([^\]]+)\]/gm)].map((m) => m[1]);
  return ids.at(-1);
}

export async function analisar(pedido: PedidoAnalise, sinal: AbortSignal): Promise<RespostaAnalise> {
  if (usarServidor()) return (await import("./servidor")).analisar(pedido, sinal);
  await new Promise((resolver, rejeitar) => {
    const t = setTimeout(resolver, 800 + Math.random() * 700);
    sinal.addEventListener("abort", () => {
      clearTimeout(t);
      rejeitar(new Error("cancelada"));
    });
  });
  const base = RESPOSTAS_DE_MENTIRA[proximaResposta++ % RESPOSTAS_DE_MENTIRA.length];
  const alvo = ultimoComponente(pedido.grafo);
  return validarResposta({ ...base, elementos: base.status !== "ok" && alvo ? [alvo] : [] });
}

// --- Linha do tempo (POST /api/sessoes/:id/eventos) ---

export async function enviarEventos(sessaoId: string, lote: { horario: string; tipo: string; dados: unknown }[]) {
  if (usarServidor()) return (await import("./servidor")).enviarEventos(sessaoId, lote);
  console.debug(`[linha do tempo] ${sessaoId}: ${lote.length} evento(s)`, lote);
}

/** Fim da entrevista: o servidor gera o scorecard da recrutadora. Sem servidor, não há o que gerar. */
export async function finalizarSessao(sessaoId: string): Promise<void> {
  if (usarServidor()) return (await import("./servidor")).finalizar(sessaoId);
  console.debug(`[fim] ${sessaoId}: sem servidor, nenhum relatório gerado`);
}

// --- Síntese do navegador: só no modo de demonstração (sem servidor não há ElevenLabs) ---

/**
 * Fala o texto. `aoProgresso(n)` recebe quantos caracteres já foram falados (para a legenda andar junto).
 * Se a voz falhar, resolve mesmo assim: a pergunta continua escrita na legenda e no quadro.
 */
function falarNoNavegador(texto: string, aoProgresso: (caracteres: number) => void, sinal: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    let terminou = false;
    let estimativa: ReturnType<typeof setInterval> | undefined;
    let fala: SpeechSynthesisUtterance | undefined;
    const terminar = (completar = true) => {
      if (terminou) return;
      terminou = true;
      if (estimativa !== undefined) clearInterval(estimativa);
      sinal.removeEventListener("abort", cancelar);
      if (fala) fala.onend = fala.onerror = fala.onboundary = null;
      if (completar && !sinal.aborted) aoProgresso(texto.length);
      resolver();
    };
    const cancelar = () => terminar(false);
    if (sinal.aborted) return terminar(false);
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return terminar();
    let comAviso = false;
    const inicio = performance.now();
    try {
      fala = new SpeechSynthesisUtterance(texto);
      fala.lang = "pt-BR";
      fala.rate = 1.05;
      const voz = escolherVozPt(window.speechSynthesis.getVoices());
      if (voz) fala.voice = voz;
      estimativa = setInterval(() => {
        if (!comAviso) aoProgresso(Math.min(texto.length, Math.round(((performance.now() - inicio) / 1000) * 15)));
      }, 80);
      fala.onboundary = (e) => {
        comAviso = true;
        const fimDaPalavra = texto.indexOf(" ", e.charIndex + 1);
        aoProgresso(fimDaPalavra === -1 ? texto.length : fimDaPalavra);
      };
      fala.onend = () => terminar();
      fala.onerror = () => terminar();
      sinal.addEventListener("abort", cancelar, { once: true });
      window.speechSynthesis.speak(fala);
    } catch {
      terminar();
    }
  });
}

/**
 * Sem a voz do ElevenLabs no modo com servidor: a legenda anda no ritmo de uma fala (~15 caracteres/s) e o quadro
 * segue, sem trocar para uma voz do navegador (feminina em vários sistemas).
 */
function legendaSemVoz(texto: string, aoProgresso: (caracteres: number) => void, sinal: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    if (sinal.aborted) return resolver();
    const inicio = performance.now();
    const passo = setInterval(() => {
      const ate = Math.min(texto.length, Math.round(((performance.now() - inicio) / 1000) * 15));
      aoProgresso(ate);
      if (ate >= texto.length) terminar();
    }, 80);
    function terminar() {
      clearInterval(passo);
      sinal.removeEventListener("abort", terminar);
      resolver();
    }
    sinal.addEventListener("abort", terminar, { once: true });
  });
}

// Uma falha passageira do servidor (rede, timeout, 5xx) ganha mais uma tentativa antes de desistir da voz.
const TENTATIVAS_DE_VOZ = 2;

let controleDaVoz: AbortController | null = null;
/** Última fala do Totti sintetizada: vira o texto anterior da próxima, para a prosódia seguir (como no quadro). */
let ultimaFalaDoTotti: string | undefined;
/** Vira false quando o servidor diz que não tem voz (501): até a próxima sessão, nem tenta. */
let vozDoServidorDisponivel = true;

/** A assinatura usada pelo quadro permanece a mesma nos dois modos. */
export function falar(texto: string, aoProgresso?: (caracteres: number) => void, antesDeTocar?: () => Promise<boolean>): Promise<void> {
  return falarComMarcas(texto, [], aoProgresso, antesDeTocar);
}

export async function falarComMarcas(texto: string, marcas: MarcaDeFala[], aoProgresso?: (caracteres: number) => void, antesDeTocar?: () => Promise<boolean>): Promise<void> {
  calar();
  const controle = new AbortController();
  controleDaVoz = controle;
  let iniciou = false;
  const iniciar = async () => {
    if (controle.signal.aborted) return false;
    if (!iniciou && antesDeTocar && !await antesDeTocar()) return false;
    if (controle.signal.aborted) return false;
    iniciou = true;
    return true;
  };
  const disparadas = new Set<number>();
  const marcasUnicas = marcas.map((m, indice) => ({ ...m, aoChegar: () => {
    if (controle.signal.aborted || disparadas.has(indice)) return;
    disparadas.add(indice);
    m.aoChegar();
  } }));
  const progresso = (n: number) => {
    if (!controle.signal.aborted && controleDaVoz === controle) aoProgresso?.(Math.min(texto.length, n));
  };
  try {
    if (usarServidor()) {
      // Com servidor, o agente fala só com a voz do ElevenLabs (Fernando - Casual).
      const servidor = await import("./servidor");
      let tocou = false;
      for (let tentativa = 1; vozDoServidorDisponivel && tentativa <= TENTATIVAS_DE_VOZ; tentativa++) {
        try {
          const voz = await servidor.sintetizarFala(texto, controle.signal, {
            texto_anterior: trechoDeContexto(ultimaFalaDoTotti, true), velocidade: velocidadeDaFala(texto),
          });
          ultimaFalaDoTotti = texto;
          if (!await iniciar()) return;
          // Silêncio nas duas pontas, com a mesma folga do quadro (lib/voz/folga.ts), decidida na hora de tocar.
          const { bytes, alinhamento } = comFolga(voz.bytes, voz.alinhamento, quadrosAntesDaFala());
          const { tocarComAlinhamento } = await import("../presenca/vozSincronizada");
          await tocarComAlinhamento(new Blob([bytes as BlobPart], { type: "audio/mpeg" }), alinhamento, {
            aoProgresso: (n) => { tocou = true; progresso(n); }, marcas: marcasUnicas, sinal: controle.signal,
          });
          marcarSaidaDeSom();
          progresso(texto.length);
          return;
        } catch (erro) {
          if (controle.signal.aborted) return;
          if (erro instanceof servidor.ErroHttp && erro.status === 501) vozDoServidorDisponivel = false;
          // Se o áudio já começou, repetir faria o candidato ouvir a frase duas vezes: as marcas e a legenda fecham.
          if (tocou) {
            marcarSaidaDeSom();
            console.warn("[voz] o áudio parou no meio da fala:", erro);
            marcasUnicas.forEach((m) => m.aoChegar());
            progresso(texto.length);
            return;
          }
          console.warn("[voz] falha na voz do ElevenLabs:", erro);
        }
      }
      if (!controle.signal.aborted && (!antesDeTocar || await iniciar())) {
        marcasUnicas.forEach((m) => m.aoChegar());
        await legendaSemVoz(texto, progresso, controle.signal);
      }
      return;
    }
    if (!controle.signal.aborted && (!antesDeTocar || await iniciar())) {
      marcasUnicas.forEach((m) => m.aoChegar());
      await falarNoNavegador(texto, progresso, controle.signal);
    }
  } catch {
    progresso(texto.length);
  } finally {
    if (controleDaVoz === controle) controleDaVoz = null;
  }
}

/**
 * Toca a gravação curta de uma reação ("Hm.", "Uhum.") sem fala seguinte (lib/voz/reacao.ts). Se a gravação não
 * carrega, a reação some em silêncio: não cai na síntese. A gravação é carregada só quando a reação é tocada.
 */
export async function falarReacao(slug: string, texto: string, aoProgresso?: (caracteres: number) => void, antesDeTocar?: () => Promise<boolean>): Promise<void> {
  calar();
  const controle = new AbortController();
  controleDaVoz = controle;
  try {
    const { tocarGravacao } = await import("../voz/cliente");
    await tocarGravacao(urlDaReacao(slug), texto, controle.signal, {
      aoIniciar: () => {},
      aoProgresso: (n) => { if (!controle.signal.aborted && controleDaVoz === controle) aoProgresso?.(Math.min(texto.length, n)); },
    }, antesDeTocar);
  } catch {
    // Gravação ausente ou falha ao tocar: a reação fica de fora, sem erro.
  } finally {
    if (controleDaVoz === controle) controleDaVoz = null;
  }
}

export function calar() {
  controleDaVoz?.abort();
  controleDaVoz = null;
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  } catch {}
}
