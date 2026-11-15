// Análise do desenho (o "/analisar"): portão de entrada -> prompt -> LLM -> guardas -> máquina de estados.
// Nunca lança por causa do LLM: em erro/timeout devolve `ok` (o quadro descarta análises lentas de
// qualquer jeito). Só metadados vão para o log (nada de grafo, fala ou chave).
import { PRAZO_ANALISE_DO_DESENHO_MS } from "../contracts";
import { aplicarGuardas, eQuaseDuplicada, eSoReacao, nomesDasPecas, sobreposicao, LIMIAR_DUPLICADA, trocarIdsPorNomes } from "./guardas";
import { emPortugues } from "../totti/guardas";
import { comMaiuscula } from "../totti/texto";
import type { LlmCliente } from "./llm/cliente";
import type { Kit, Problema } from "./kits/tipos";
import { temMudancaPrevista } from "./kits/empecilhos-genericos";
import { AVISO_DA_PERGUNTA_OBRIGATORIA, AVISO_DO_ASSUNTO_REPETIDO, montarPromptAvaliador, NOME_SCHEMA_ANALISE } from "./prompts/avaliador";
import {
  transicionar,
  type Efeito,
  type EstadoSessao,
} from "./sessao/estado";
import { pecasDoGrafo } from "./sessao/fechamento";
import {
  aplicarRegraDoEscopo,
  contagemDePecasPerguntadas,
  extrairIdsDoGrafo,
  filtrarResposta,
  LIMITE_SILENCIO_S,
  motivoDoConteudo,
  perguntaObrigatoria,
  podeAnalisar,
  podeLevantarPlin,
  precisaAbrirBrechaDaMudanca,
  REGRAS_PADRAO,
  motivoBloqueioPlin,
  type Regras,
} from "./sessao/politica";
import { EsquemaRespostaAnalise, type PedidoAnalise, type RespostaAnalise } from "./sessao/tipos";

// As regras da brecha da mudança (decisão G) moram em sessao/politica.ts (o prompt do avaliador também as usa; importar
// daqui criaria um ciclo). Re-exportadas para quem já importa daqui.
export { INTERVALO_BRECHA_EMPECILHO_MS, precisaAbrirBrechaDaMudanca } from "./sessao/politica";

export type LogMeta = (evento: string, meta: Record<string, unknown>) => void;

export type DepsAnalisar = {
  llm: LlmCliente;
  kit: Kit;
  problema: Problema;
  regras?: Regras;
  modelo?: string;
  maxTokens?: number;
  log?: LogMeta;
};

export type ResultadoAnalise = {
  resposta: RespostaAnalise;
  estado: EstadoSessao;
  efeitos: Efeito[];
  diagnostico: {
    origem: "llm" | "bloqueado" | "erro";
    /** Por que a resposta do LLM foi rebaixada/alterada pelas guardas. */
    ajustes: string[];
    ms?: number;
    uso?: { entrada: number; saida: number; cache?: number; custo?: number; modelo?: string; provedor?: string; reservaDisparada?: boolean };
  };
};

export const logPadrao: LogMeta = (evento, meta) => console.warn(`[agente] ${evento}`, meta);

export const CONVITES_SILENCIO_INICIAL = [
  "Quando quiser, me conta como está pensando em começar. Pode tirar dúvidas comigo.",
  "Pode me contar por onde está pensando em começar. Se tiver alguma dúvida, pode perguntar.",
] as const;

export function respostaSilencio(): RespostaAnalise {
  return { status: "ok", pergunta: null, nota: null, elementos: [], degrau: null, observacoes: [], parteFechada: false, escopo: false };
}

/** Peça já perguntada este tanto de vezes ou mais: o assunto dela está explorado (#129, bloco J). */
export const LIMITE_PECA_PERGUNTADA = 2;

/**
 * Abertura de molde da pergunta (#129, bloco J): "Vi que você ...", "Notei que você ..." e "Percebi que você ..." até o
 * primeiro ponto ou vírgula, e "Para entender como você ..., " no começo. Corta a abertura e mantém a pergunta.
 * Só corta se sobra uma pergunta ("?"); a abertura "Vi que você" só sai se a pergunta que sobra cita uma peça do
 * desenho. Sem isso, a pergunta fica como está. Função pura.
 */
export function cortarAberturaDeMolde(pergunta: string, grafo: string): { texto: string; cortou: boolean } {
  const nomes = [...nomesDasPecas(grafo).values()];
  const citaPeca = (t: string) => nomes.some((n) => new RegExp(`(?<!\\p{L})${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "iu").test(t));
  const original = pergunta.trim();
  let texto = original;
  // `\s` e não `\b` depois de "você": o \b do JS não conta o "ê" como letra.
  const abertura = /^(?:vi|notei|percebi) que voc[êe]\s[^.,]*[.,]\s*/i.exec(texto);
  if (abertura) {
    const resto = texto.slice(abertura[0].length);
    if (resto.includes("?") && citaPeca(resto)) texto = resto;
  }
  const para = /^para entender como voc[êe]\s[^,]*,\s*/i.exec(texto);
  if (para) {
    const resto = texto.slice(para[0].length);
    if (resto.includes("?")) texto = resto;
  }
  // Só sai se o que sobra começa com palavra de pergunta: "Para entender como você lida com cache, Redis ou memória, o que...?"
  // sobraria "Redis ou memória, o que...?", que não é pergunta. Nesse caso fica como está.
  const cortou = texto !== original;
  if (!cortou || !PALAVRAS_DE_PERGUNTA.test(semAcento(texto))) return { texto: pergunta, cortou: false };
  return { texto: comMaiuscula(texto), cortou: true };
}

/** Palavras com que uma pergunta começa (sem acento, minúsculas): a abertura de molde só sai se o que sobra começa assim. */
const PALAVRAS_DE_PERGUNTA = /^(o que|como|qual|quais|por que|e se|quando|onde|quanto|quantos|voce|se|e)\b/;

function semAcento(t: string): string {
  return t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * Assunto já explorado (#129, bloco J): uma pergunta de "duvida" ou "dica" cujos elementos são TODOS peças já perguntadas
 * `LIMITE_PECA_PERGUNTADA` vezes ou mais. Não vale no FECHAMENTO, na quebra de silêncio (parado há `LIMITE_SILENCIO_S`) nem
 * sem elemento citado. Não separa a pergunta obrigatória do teto: `analisar` cuida dela (segunda chamada). Função pura.
 */
export function assuntoJaExplorado(
  resposta: Pick<RespostaAnalise, "status" | "elementos">,
  estado: Pick<EstadoSessao, "fase" | "perguntas">,
  paradoHaS?: number,
): boolean {
  if (resposta.status !== "duvida" && resposta.status !== "dica") return false;
  if (estado.fase === "FECHAMENTO") return false;
  if (paradoHaS !== undefined && paradoHaS >= LIMITE_SILENCIO_S) return false;
  if (!resposta.elementos.length) return false;
  const vezes = contagemDePecasPerguntadas(estado.perguntas);
  return resposta.elementos.every((id) => (vezes.get(id) ?? 0) >= LIMITE_PECA_PERGUNTADA);
}

/** Hash estável do grafo e quantidade de falas; conteúdo da conversa não é persistido nesta assinatura. */
export function assinaturaDaAnalise(pedido: PedidoAnalise, totalFalas: number): string {
  const entrada = `${pedido.grafo}\0${totalFalas}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < entrada.length; i += 1) {
    hash ^= entrada.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${totalFalas}`;
}

export function perguntaBloqueadaNaAnalise(
  estado: EstadoSessao,
  pedido: PedidoAnalise,
  agora: number,
  regras: Regras = REGRAS_PADRAO,
): boolean {
  return motivoBloqueioPlin(estado, agora, regras, { paradoHaS: pedido.parado_ha_s }) !== null;
}

/**
 * Refiltra uma resposta já filtrada com o estado MAIS RECENTE da sessão. A análise leva até alguns segundos
 * e, nesse intervalo, o agente pode ter falado (`ultimaFalaDoAgenteEm`): o estado lido no início não enxerga
 * isso. Conservador: o tempo decorrido desde o início soma-se ao `parado_ha_s`, ou seja, assume que o
 * candidato não agiu durante a análise. Idempotente para resposta já silenciada (nada é ressuscitado).
 * O ritmo por conteúdo (#129) também vale contra o estado atual: uma pergunta que ele ouviu durante a análise
 * conta para o piso entre perguntas.
 */
export function refiltrarComEstadoAtual(
  atual: EstadoSessao,
  resposta: RespostaAnalise,
  pedido: PedidoAnalise,
  inicio: number,
  agora: number,
  regras: Regras = REGRAS_PADRAO,
): RespostaAnalise {
  const paradoHaS = pedido.parado_ha_s === undefined ? undefined : pedido.parado_ha_s + Math.max(0, agora - inicio) / 1000;
  const pecas = pecasDoGrafo(pedido.grafo);
  const porConteudo = resposta.status !== "ok" && motivoDoConteudo(atual, resposta, agora, { paradoHaS, pecas })
    ? { ...resposta, status: "ok" as const }
    : resposta;
  // A regra do escopo (#129, decisão I) vale contra o estado atual: o primeiro redirecionamento pode ter saído na análise.
  const porEscopo = aplicarRegraDoEscopo(atual, porConteudo, agora, pecas).resposta;
  return filtrarResposta(atual, porEscopo, extrairIdsDoGrafo(pedido.grafo), agora, regras, { paradoHaS }, pedido.grafo);
}

export async function analisar(
  deps: DepsAnalisar,
  estado: EstadoSessao,
  pedido: PedidoAnalise,
  agora: number,
  sinal?: AbortSignal,
  bloqueadaAgora = perguntaBloqueadaNaAnalise(estado, pedido, agora, deps.regras ?? REGRAS_PADRAO),
): Promise<ResultadoAnalise> {
  const regras = deps.regras ?? REGRAS_PADRAO;
  const log = deps.log ?? logPadrao;

  if (!podeAnalisar(estado, agora, regras)) {
    return {
      resposta: respostaSilencio(),
      estado,
      efeitos: [],
      diagnostico: { origem: "bloqueado", ajustes: [] },
    };
  }

  const prompt = montarPromptAvaliador(deps.kit, deps.problema, estado, pedido, agora);
  const pecas = pecasDoGrafo(pedido.grafo);
  // Teto da pergunta obrigatória (#129, bloco B): o prompt já cobra a pergunta; se o modelo mesmo assim devolver "ok", há
  // uma segunda chamada (ver abaixo). Mesma conta do prompt (montarSistemaDinamico), então os dois não divergem.
  const obrigada = perguntaObrigatoria(estado, agora, pecas, { paradoHaS: pedido.parado_ha_s, mudancaPrevista: temMudancaPrevista(deps.kit, deps.problema) });
  const chamar = (sistema: { estatico: string; dinamico: string }, timeoutMs: number) => deps.llm.completarJson({
    sistema,
    mensagens: prompt.mensagens,
    schema: EsquemaRespostaAnalise,
    nomeSchema: NOME_SCHEMA_ANALISE,
    modelo: deps.modelo,
    maxTokens: deps.maxTokens,
    timeoutMs,
    sinal,
    imagem: pedido.imagem_base64 ?? null,
    semReserva: bloqueadaAgora,
  });
  let bruta: RespostaAnalise;
  let ms: number | undefined;
  let uso: ResultadoAnalise["diagnostico"]["uso"];
  try {
    const r = await chamar(prompt.sistema, PRAZO_ANALISE_DO_DESENHO_MS);
    bruta = EsquemaRespostaAnalise.parse(r.dados);
    ms = r.ms;
    uso = r.uso;
    if (uso) uso = { ...uso, modelo: r.modelo, provedor: r.provedor, reservaDisparada: r.reservaDisparada };
  } catch (e) {
    // Só metadados: o tipo do erro, nunca mensagem com conteúdo, grafo ou chave.
    const codigo = (e as { codigo?: string }).codigo ?? "desconhecido";
    log("analise_falhou", { sessao_id: pedido.sessao_id, fase: estado.fase, codigo });
    return {
      resposta: respostaSilencio(),
      estado,
      efeitos: [],
      diagnostico: { origem: "erro", ajustes: [`llm_${codigo}`] },
    };
  }

  const ajustes: string[] = [];
  // Assunto repetido só conta com os elementos que existem no grafo (os outros saem na filtragem).
  const idsDoGrafo = extrairIdsDoGrafo(pedido.grafo);
  const repetido = (r: RespostaAnalise) => assuntoJaExplorado({ ...r, elementos: r.elementos.filter((id) => idsDoGrafo.has(id)) }, estado, pedido.parado_ha_s);
  // Pergunta obrigatória sem pergunta (#129, bloco B): UMA segunda chamada, com um aviso curto. O prazo é o da análise,
  // descontado o que a primeira gastou. Se ainda vier "ok" (ou a segunda falhar), fica "ok" e a análise registra o motivo.
  // Com a pergunta obrigatória repetindo um assunto (#129, bloco J), a segunda chamada também sai, com o aviso acrescido.
  // Se ela repetir de novo, ou falhar, a pergunta do teto fica (o teto tem prioridade sobre o assunto).
  const repetiuNoTeto = obrigada && repetido(bruta);
  if ((bruta.status === "ok" || repetiuNoTeto) && obrigada) {
    const restanteMs = PRAZO_ANALISE_DO_DESENHO_MS - (ms ?? 0);
    let segunda: RespostaAnalise | null = null;
    if (restanteMs > 0) {
      try {
        const aviso = repetiuNoTeto ? `${AVISO_DA_PERGUNTA_OBRIGATORIA} ${AVISO_DO_ASSUNTO_REPETIDO}` : AVISO_DA_PERGUNTA_OBRIGATORIA;
        const r2 = await chamar({ ...prompt.sistema, dinamico: `${prompt.sistema.dinamico}\n\n${aviso}` }, restanteMs);
        const validada = EsquemaRespostaAnalise.safeParse(r2.dados);
        if (validada.success) segunda = validada.data;
      } catch {
        // Sem segunda resposta vale o "ok" da primeira: o registro abaixo diz que a pergunta ficou de fora.
      }
    }
    if (segunda) bruta = segunda;
    if (bruta.status === "ok") ajustes.push("teto_sem_pergunta");
  }
  let resposta: RespostaAnalise = bruta;

  if (resposta.status !== "ok") {
    const pendente = estado.perguntaPendente;

    if (
      pendente?.pergunta &&
      resposta.pergunta &&
      sobreposicao(resposta.pergunta, pendente.pergunta) >= LIMIAR_DUPLICADA
    ) {
      // O modelo repetiu a dúvida que já está pendente: mantém a pendente em vez de cancelá-la.
      ajustes.push("repete_pendente");
      resposta = {
        ...resposta,
        status: pendente.status,
        pergunta: pendente.pergunta,
        nota: pendente.nota,
        elementos: pendente.elementos,
        degrau: pendente.degrau,
      };
    } else if (
      resposta.pergunta &&
      eQuaseDuplicada(
        resposta.pergunta,
        estado.perguntas.map((p) => p.pergunta),
      )
    ) {
      ajustes.push("pergunta_repetida");
      resposta = { ...resposta, status: "ok" };
    }
  }

  // O convite é uma decisão do servidor. A análise continua colhendo observações,
  // mas não escolhe a fala nem precisa sugerir uma pergunta para liberar o convite.
  // Também substitui convites antigos ainda pendentes, depois da deduplicação.
  if (estado.fase === "REQUISITOS" && podeLevantarPlin(estado, "duvida", agora, regras, {
    paradoHaS: pedido.parado_ha_s, temDesenho: extrairIdsDoGrafo(pedido.grafo).size > 0,
  })) {
    const indice = Math.abs(estado.faseIniciadaEm ?? 0) % CONVITES_SILENCIO_INICIAL.length;
    resposta = {
      ...resposta, status: "duvida", pergunta: CONVITES_SILENCIO_INICIAL[indice],
      nota: "Pode tirar dúvidas comigo", elementos: [], visual: [], degrau: null,
    };
    ajustes.push("convite_fixo");
  }

  if (resposta.pergunta && /\b[a-z]\d+\b/i.test(resposta.pergunta)) {
    const pergunta = trocarIdsPorNomes(resposta.pergunta, pedido.grafo);
    if (pergunta !== resposta.pergunta) {
      ajustes.push("ids_na_fala");
      resposta = { ...resposta, pergunta, ...(resposta.nota ? { nota: trocarIdsPorNomes(resposta.nota, pedido.grafo) } : {}) };
    }
  }

  // Abertura de molde (#129, bloco J): "Vi que você ..." e "Para entender como você ..., " saem; a pergunta fica.
  if (resposta.status !== "ok" && resposta.pergunta) {
    const aberta = cortarAberturaDeMolde(resposta.pergunta, pedido.grafo);
    if (aberta.cortou) {
      ajustes.push("abertura_de_molde");
      resposta = { ...resposta, pergunta: aberta.texto };
    }
  }

  // A pergunta da análise também é fala do Totti: passa pelas travas comuns (lib/totti/guardas.ts) de cumprimento
  // e de validação. Numa entrevista real ela saiu como "Oi, tudo bem? Como você está pensando em abordar esse
  // problema?", com dois minutos de conversa. Eco, repetição e condução não se aplicam aqui (a repetição já foi
  // conferida acima, contra as perguntas feitas).
  if (resposta.status !== "ok" && resposta.pergunta) {
    const guardada = aplicarGuardas(resposta.pergunta, { barrarConducao: false });
    if (guardada.travas.length) {
      ajustes.push(...guardada.travas.map((t) => `trava_${t}`));
      // Sem pergunta depois da trava (era só o cumprimento ou só a validação), não há o que levantar.
      resposta = guardada.texto && !eSoReacao(guardada.texto) ? { ...resposta, pergunta: guardada.texto } : { ...resposta, status: "ok" };
    }
  }

  // Assunto já explorado (#129, bloco J): pergunta cujas peças já foram perguntadas duas vezes vira "ok" (as observações
  // ficam). A pergunta obrigatória do teto não cai aqui: ficou com a segunda chamada acima (se ela repetiu, fica).
  if (resposta.status !== "ok" && !obrigada && repetido(resposta)) {
    ajustes.push("assunto_repetido");
    resposta = { ...resposta, status: "ok" };
  } else if (obrigada && resposta.status !== "ok" && repetido(resposta)) {
    ajustes.push("assunto_repetido_no_teto");
  }

  // Ritmo por conteúdo (#129, bloco B): a pergunta sobre o desenho só sai com uma parte fechada (ou no teto).
  // Sem isso vira "ok" e as observações ficam. Os portões do ritmo comum ainda valem em `filtrarResposta`.
  if (resposta.status !== "ok") {
    const motivo = motivoDoConteudo(estado, resposta, agora, { paradoHaS: pedido.parado_ha_s, pecas });
    if (motivo) {
      ajustes.push(motivo === "PISO_ENTRE_PERGUNTAS" ? "piso_entre_perguntas" : "sem_parte_fechada");
      resposta = { ...resposta, status: "ok" };
    }
  }

  // Redirecionamento de escopo (#129, decisão I): só com desenho, nas fases de conteúdo, até duas vezes (a segunda depois
  // de 5 min). Fora disso vira "ok" com o motivo nos ajustes. Não passa pelo piso de 2 min: o intervalo é furado em `filtrarResposta`.
  const porEscopo = aplicarRegraDoEscopo(estado, resposta, agora, pecas);
  if (porEscopo.motivo) ajustes.push(porEscopo.motivo);
  resposta = porEscopo.resposta;

  // Brecha da mudança (#129, decisão G): passada a garantia dos 60% e sem a mudança, a pergunta vira "ok" por um
  // ciclo, para o quadro ter uma pausa em que a mudança possa entrar (um ciclo por vez: ver INTERVALO_BRECHA_EMPECILHO_MS).
  const abreBrecha = (resposta.status === "duvida" || resposta.status === "dica")
    && precisaAbrirBrechaDaMudanca(estado, agora, temMudancaPrevista(deps.kit, deps.problema));
  if (abreBrecha) {
    ajustes.push("abre_brecha_empecilho");
    resposta = { ...resposta, status: "ok" };
  }

  // Português claro (decisão H, #129): a pergunta vai ao candidato, então o termo em inglês que a vaga não usa sai aqui.
  if (resposta.pergunta) resposta = { ...resposta, pergunta: emPortugues(resposta.pergunta, estado.plano?.descricaoVaga) };

  const filtrada = filtrarResposta(estado, resposta, extrairIdsDoGrafo(pedido.grafo), agora, regras, { paradoHaS: pedido.parado_ha_s }, pedido.grafo);
  if (resposta.status !== "ok" && filtrada.status === "ok") ajustes.push("rebaixada_pela_politica");

  const t = transicionar(estado, { tipo: "ANALISE_RECEBIDA", resposta: filtrada, pecas }, agora, regras);
  log("analise_ok", {
    sessao_id: pedido.sessao_id,
    fase: estado.fase,
    status: filtrada.status,
    avancar_fase: filtrada.avancar_fase === true,
    ajustes,
    ms,
  });
  return {
    resposta: filtrada,
    estado: abreBrecha ? { ...t.estado, brechaEmpecilhoEm: agora } : t.estado,
    efeitos: t.efeitos,
    diagnostico: { origem: "llm", ajustes, ms, uso },
  };
}
