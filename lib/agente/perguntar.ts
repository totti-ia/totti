// Loop rápido (o "/perguntar"): o candidato fala com o entrevistador. Responde só pela ficha.
// Registra CANDIDATO_FALOU / AGENTE_FALOU no estado. Não lança por causa do LLM.
import { neutralizar, REGRA_DADOS } from "../seguranca/injecao";
import { blocoDoBriefing } from "./briefing";
import { candidatasDoQuadro, perguntasJaOuvidas, type ApontarNoQuadro } from "./fechamento";
import { aplicarGuardas, comVezDevolvida, eSoReacao, limitarFrases, semPerguntaNoFim } from "./guardas";
import {
  gatilhoDoFechamento, iniciarFechamento, proximoPasso,
  type EstadoFechamento, type EtapaDoFechamento, type PassoDoFechamento,
} from "../totti/fechamento";
import { devolveAVez, emPortugues, ePerguntaDePorque, perguntaDePorque, pediuParaOlhar, promessaVazia, reacaoAoPensar, reacaoNeutra, semConviteDeSeguir } from "../totti/guardas";
import { frasesSemPergunta } from "../totti/texto";
import {
  avisoDePerguntaSemResposta, avisoDePromessaVazia, avisosDeQueVaiOlhar, falaComObservacaoEPergunta, FALAS_DE_RESERVA_AO_OLHAR, comRespostaDeReserva, decidirTurno, deSaidaDoQuadro, ficouSemResposta, pedePorque, perguntouComClareza,
  sinalDeConclusao,
  type LeituraDoTurno, type SituacaoDoTurno,
} from "../totti/turno";
import { garantirMarca, mapearAcoesVisuais, pecasCitadas, conexoesDoGrafo, olharODesenho, type AcaoVisual } from "../presenca/acoesVisuais";
import { caminhoPrincipalDesenhado } from "./sessao/fechamento";
import { extrairIdsDoGrafo, parametrosDoFechamentoNoQuadro } from "./sessao/politica";
import type { LlmCliente } from "./llm/cliente";
import type { Kit, Problema } from "./kits/tipos";
import {
  EsquemaSaidaPerguntar,
  montarSistemaDinamicoPerguntar,
  montarSistemaEstaticoPerguntar,
  NOME_SCHEMA_PERGUNTAR,
} from "./prompts/entrevistador";
import {
  blocosDoSistemaDinamicoPerguntarV2, FALAS_NO_PROMPT_V2, linhaDoFechamento, montarSistemaEstaticoPerguntarV2, NOME_SCHEMA_PERGUNTAR_V2, tamanhoDosBlocos,
  type ContextoDoFechamento, type NomeDoBloco,
} from "./prompts/entrevistador-v2";
import { historicoDaConversa } from "./prompts/contexto";
import { criteriosDoPlanoSemEvidencia, MAX_SEGUIMENTOS, tempoRestanteMs, transicionar, type Desfecho, type EstadoSessao } from "./sessao/estado";
import type { Fase, FalaRecente } from "./sessao/tipos";
import { logPadrao, type LogMeta } from "./analisar";

export type DepsPerguntar = {
  llm: LlmCliente;
  kit: Kit;
  problema: Problema;
  modelo?: string;
  maxTokens?: number;
  log?: LogMeta;
  /** Versão do Totti no quadro; sem valor, a de TOTTI_QUADRO (padrão v2). */
  versao?: VersaoTottiQuadro;
};

export type VersaoTottiQuadro = "v1" | "v2";

/**
 * Qual Totti responde no quadro: v2 (objetivos, docs/totti-v2-conversa.md), o padrão desde que foi aprovado na voz,
 * ou v1 (regras), só com TOTTI_QUADRO=v1.
 */
export function versaoTottiQuadro(): VersaoTottiQuadro {
  return process.env.TOTTI_QUADRO === "v1" ? "v1" : "v2";
}

export type EntradaPerguntar = {
  fase: Fase;
  texto: string;
  /** Itens que já estão no quadro de requisitos (para não repetir). Opcional. */
  requisitosAtuais?: string[];
  sessao_id?: string;
  grafo?: string;
  perguntaAtiva?: string;
  gestosRecentes?: string[];
  /** Falas recentes que o quadro tem e o servidor talvez não (apresentação, desafio). */
  conversaDoQuadro?: FalaRecente[];
  /** Foto leve do quadro (data URL), para o modelo ver o desenho além do grafo. */
  imagemBase64?: string | null;
  /** O que acabou de mudar no desenho. */
  mudancas?: string;
  /** Há quantos segundos ele não mexe no desenho. Ausente: o quadro não informou. */
  desenhoParadoHaS?: number;
  /** A fala junta a anterior, que ele continuou antes de ouvir a resposta: o passo do fechamento dado por ela é refeito. */
  substitui?: boolean;
};

/** O que um turno fez com o fechamento comum, para a rota reaplicar sobre o estado mais recente da sessão. */
export type PassoNaSessao = {
  /** O turno que começou o fechamento foi substituído por esta fala: ele foi desfeito antes de ela ser lida. */
  desfeito: boolean;
  /** O fechamento começou (`inicio`) ou andou um passo neste turno. */
  atualizado: { inicio: boolean; nucleo: EstadoFechamento; antes: EstadoFechamento | null } | null;
};

export type ResultadoPerguntar = {
  responder: boolean;
  texto: string;
  requisito: string | null;
  /** O candidato disse que terminou ("pronto"): o quadro avança/reanalisa. */
  concluiu: boolean;
  /** Como ele reagiu à pergunta ativa (só quando havia uma). */
  desfecho: Desfecho | null;
  /** A fala termina numa pergunta de continuação do mesmo fio: a pergunta ativa segue aberta. */
  seguimento?: boolean;
  /** Ele pediu para encerrar a entrevista: o quadro se despede e fecha. */
  encerrar?: boolean;
  /**
   * Ele pediu tempo para pensar neste turno. `reagiu`: o Totti disse a reação curta (a primeira vez na entrevista).
   * A rota grava o pedido no estado (`CANDIDATO_PEDIU_TEMPO`).
   */
  pediuTempo?: { reagiu: boolean };
  /** Falha de infraestrutura: não confundir com a decisão deliberada de escutar. */
  falhou?: boolean;
  visual?: AcaoVisual[];
  /** A fala terminou numa pergunta do Conversador (v2): conta no intervalo do plin. */
  perguntou?: boolean;
  /** Custo e tamanho do prompt deste turno, quando o modelo respondeu (a rota grava por sessão). */
  uso?: UsoPerguntar;
  /**
   * A etapa do fechamento comum depois deste turno (lib/totti/fechamento.ts), ou "suspenso" quando ele estava em
   * andamento e deixou de estar (o candidato voltou a desenhar). Ausente: a entrevista não está fechando.
   */
  fechamento?: EtapaDoFechamento | "suspenso";
  /** O que o turno fez com o fechamento (só para a rota: não vai ao navegador). */
  passoDoFechamento?: PassoNaSessao;
  estado: EstadoSessao;
};

/** O que um turno do /perguntar gastou e de que se compôs o prompt dinâmico (issue #63). */
export type UsoPerguntar = {
  modelo: string;
  provedor: string;
  ms?: number;
  tokens_entrada?: number;
  tokens_saida?: number;
  /** Tokens de entrada servidos do cache do provedor, quando ele informa. */
  tokens_cache?: number;
  custo_usd?: number;
  /** Caracteres de cada parte do prompt dinâmico (no v1, tudo em `resto`). */
  blocos: Record<NomeDoBloco, number>;
  /** Tamanho da foto do quadro enviada (caracteres do data URL; 0 sem foto). */
  foto: number;
  /** Falas da conversa que foram no prompt. */
  falas_no_prompt: number;
};

/** Avisos curtos que podem abrir uma fala de comentário, sempre seguidos pelo conteúdo no mesmo turno. */
export const AVISOS_DE_QUE_VAI_OLHAR = avisosDeQueVaiOlhar("quadro");

/** A segunda geração (ele fez uma pergunta clara e o modelo ficou quieto) só roda se a primeira foi rápida... */
const MAX_MS_PARA_GERAR_DE_NOVO = 3500;
/** ...e tem este prazo, para as duas caberem no prazo da rota. */
const PRAZO_SEGUNDA_GERACAO_MS = 3500;
/**
 * No fechamento a fala seguinte não depende do modelo (a sequência é do núcleo): a leitura do turno tem prazo curto
 * e, se não vier, o fechamento segue pelo que a fala mostra.
 */
export const PRAZO_DA_LEITURA_NO_FECHAMENTO_MS = 3500;

/** O contrato do cliente pede timeout; este teto também protege contra um provedor que ignore o cancelamento. */
async function leituraNoPrazo<T>(tarefa: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([tarefa, new Promise<never>((_, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error("prazo da leitura do fechamento")), PRAZO_DA_LEITURA_NO_FECHAMENTO_MS);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** Fases em que há entrevista em andamento (o tempo que resta só conta nelas). */
const FASES_DA_ENTREVISTA: Fase[] = ["REQUISITOS", "ALTO_NIVEL", "APROFUNDAMENTO", "FECHAMENTO"];

const MAX_CARACTERES_REQUISITO = 60;
/** Quantas falas recentes do agente o convite do fim evita repetir. */
const MAX_FALAS_PARA_VARIAR_CONVITE = 8;
export const MAX_FRASES_FALA = 3;

export async function perguntar(
  deps: DepsPerguntar,
  estado: EstadoSessao,
  entrada: EntradaPerguntar,
  agora: number,
  sinal?: AbortSignal,
): Promise<ResultadoPerguntar> {
  const medida: { uso?: UsoPerguntar } = {};
  const turno: PassoNaSessao = { desfeito: false, atualizado: null };
  const r = await responderFala(deps, estado, entrada, agora, sinal, medida, turno);
  // Para o quadro: em que etapa o fechamento ficou, ou que ele foi suspenso neste turno.
  const fechamento = r.estado.fechamento?.nucleo.etapa ?? (estado.fechamento ? "suspenso" as const : undefined);
  return {
    ...r,
    ...(medida.uso ? { uso: medida.uso } : {}),
    ...(fechamento ? { fechamento } : {}),
    ...(turno.desfeito || turno.atualizado ? { passoDoFechamento: turno } : {}),
  };
}

async function responderFala(
  deps: DepsPerguntar,
  recebido: EstadoSessao,
  entrada: EntradaPerguntar,
  agora: number,
  sinal: AbortSignal | undefined,
  medida: { uso?: UsoPerguntar },
  turno: PassoNaSessao,
): Promise<ResultadoPerguntar> {
  const log = deps.log ?? logPadrao;
  // Peças novas no desenho desde que ele disse que terminou: o desenho deixa de estar concluído e o fechamento, se
  // estava em andamento, é suspenso antes de a fala ser lida (ela é tratada como uma fala normal).
  let estado = entrada.grafo !== undefined
    ? transicionar(recebido, { tipo: "DESENHO_ATUALIZADO", grafo: entrada.grafo }, agora).estado
    : recebido;
  // O fechamento comum em andamento (lib/totti/fechamento.ts). Se esta fala substitui a anterior (ele continuou
  // antes de ouvir a resposta), o passo dado pela anterior é refeito: a sequência recomeça de antes dela.
  let nucleo: EstadoFechamento | null = estado.fechamento?.nucleo ?? null;
  if (estado.fechamento && entrada.substitui) {
    if (estado.fechamento.antes) nucleo = estado.fechamento.antes;
    else {
      estado = transicionar(estado, { tipo: "FECHAMENTO_DESFEITO" }, agora).estado;
      nucleo = null;
      turno.desfeito = true;
    }
  }
  // A fala entra na conversa antes de o LLM ver o histórico (ele recebe a fala como mensagem).
  const comFala = transicionar(
    estado,
    { tipo: "CANDIDATO_FALOU", texto: entrada.texto, fimDeResposta: false },
    agora,
  ).estado;
  const mudo = (): ResultadoPerguntar => ({ responder: false, texto: "", requisito: null, concluiu: false, desfecho: null, estado: comFala });
  // A despedida já foi dita: não há mais o que responder, o quadro encerra.
  if (nucleo?.etapa === "encerrada") return { ...mudo(), encerrar: true };

  const v2 = (deps.versao ?? versaoTottiQuadro()) === "v2";
  // O convite do fim varia: não repete um que o Totti acabou de dizer.
  const jaDitas = estado.conversa.filter((f) => f.quem === "agente").slice(-MAX_FALAS_PARA_VARIAR_CONVITE).map((f) => f.texto);
  const minhaUltima = jaDitas.at(-1);
  // A pergunta do fechamento que ele está respondendo: a pergunta final em aberto ou o "quer acrescentar algo?".
  const perguntaDoFechamento = nucleo ? (nucleo.atual?.pergunta ?? (nucleo.etapa === "ultima_palavra" ? minhaUltima : undefined)) : undefined;
  const perguntaAberta = perguntaDoFechamento ?? entrada.perguntaAtiva;
  // O desfecho só vale quando havia pergunta ativa: sem ela, não há assunto para encerrar.
  const haPerguntaAtiva = !!(perguntaAberta || estado.perguntaAtiva);
  // Quantas vezes ele já tinha dito que terminou, antes desta.
  const conclusoesAntes = estado.conclusoes ?? 0;
  // Desde que o Totti devolveu a vez, ele desenhou? (O quadro manda há quantos segundos ele não mexe no desenho.)
  const desenhouDesdeAFala = entrada.desenhoParadoHaS !== undefined && estado.ultimaFalaDoAgenteEm != null
    && agora - entrada.desenhoParadoHaS * 1000 > estado.ultimaFalaDoAgenteEm;
  // A leitura do turno é a do Totti único (lib/totti/turno.ts), a mesma do live coding.
  const situacao: SituacaoDoTurno = {
    sala: "quadro",
    falaDoCandidato: entrada.texto,
    respondiaAoTotti: haPerguntaAtiva || !!minhaUltima?.trim().endsWith("?"),
    falasDoTotti: jaDitas,
    conclusoes: conclusoesAntes,
    paradoHaS: entrada.desenhoParadoHaS,
    // A última fala dele já devolveu a vez, e agora ele só reage: não se repete o convite.
    semAcaoDesdeOConvite: !!minhaUltima && devolveAVez(minhaUltima) && eSoReacao(entrada.texto) && !desenhouDesdeAFala,
  };
  // O que o modelo precisa saber do fim: o desenho está concluído e, no fechamento, em que etapa a conversa está.
  const contextoDoFim: ContextoDoFechamento = {
    desenhoConcluido: !!estado.desenhoConcluido || !!nucleo,
    ...(nucleo?.etapa === "perguntas_finais" || nucleo?.etapa === "ultima_palavra" ? { etapa: nucleo.etapa } : {}),
  };
  const ids = extrairIdsDoGrafo(entrada.grafo ?? "");
  const fasesDeDesenho = entrada.fase === "ALTO_NIVEL" || entrada.fase === "APROFUNDAMENTO" || entrada.fase === "FECHAMENTO";
  const nomeObservado = (entrada.grafo ?? "").match(/-\s*\[[^\]]+\]\s*([^\n(]+)/)?.[1]?.trim();
  const pecasDoGrafo = [...(entrada.grafo ?? "").matchAll(/^-\s*\[[^\]]+\]\s*([^\n(]+)/gm)].map((m) => m[1].trim());
  const ligacoesDoGrafo = [...(entrada.grafo ?? "").split(/\nCONEX(?:ÕES|OES)\n/i)[1]?.matchAll(/^-\s*\[[^\]]+\]\s*(.+?)\s*(?:→|->|—|-)\s*(.+)$/gm) ?? []]
    .map((m) => [m[1].trim(), m[2].trim()] as const);
  const observacaoDoGrafo = (): string => {
    if (!nomeObservado) return FALAS_DE_RESERVA_AO_OLHAR.quadroSemPecas;
    const ligacao = pecasDoGrafo.length
      ? ligacoesDoGrafo.find(([origem]) => origem.toLocaleLowerCase() === pecasDoGrafo[0].toLocaleLowerCase()) ?? ligacoesDoGrafo[0]
      : undefined;
    return ligacao
      ? FALAS_DE_RESERVA_AO_OLHAR.quadroComLigacao(ligacao[0], ligacao[1])
      : FALAS_DE_RESERVA_AO_OLHAR.quadroSemLigacao(nomeObservado);
  };
  /** Um passo do fechamento comum vira a resposta do turno: a fala do núcleo sai como está, sem análise nem ritmo. */
  const comPasso = (
    passo: PassoDoFechamento,
    o: { inicio: boolean; antes: EstadoFechamento | null; base: EstadoSessao; concluiu: boolean; desfecho: Desfecho | null; antesDaFala?: string },
  ): ResultadoPerguntar => {
    turno.atualizado = { inicio: o.inicio, nucleo: passo.estado, antes: o.antes };
    let final = transicionar(o.base, { tipo: "FECHAMENTO_ATUALIZADO", inicio: o.inicio, nucleo: passo.estado, antes: o.antes, grafo: entrada.grafo }, agora).estado;
    const texto = [o.antesDaFala, passo.fala].filter(Boolean).join(" ").trim();
    log("perguntar_fechamento", {
      sessao_id: entrada.sessao_id, fase: entrada.fase, etapa: passo.etapa, inicio: o.inicio, gatilho: passo.estado.gatilho,
      encerrar: passo.encerrar, na_fila: passo.estado.fila.length, origem: passo.estado.atual?.origem,
    });
    const encerrar = passo.encerrar ? { encerrar: true } : {};
    // O núcleo continua ouvindo ("hmm, deixa eu pensar"): nada é dito e a etapa não muda.
    if (!texto) return { responder: false, texto: "", requisito: null, concluiu: o.concluiu, desfecho: o.desfecho, estado: final, ...encerrar };
    const perguntou = texto.endsWith("?");
    final = transicionar(final, { tipo: "AGENTE_FALOU", texto, ...(perguntou ? { perguntou } : {}) }, agora).estado;
    // A pergunta final que veio da análise traz as peças e as marcas dela; as outras marcam a peça que citam pelo nome.
    const apontar = passo.apontar as ApontarNoQuadro | undefined;
    const alvos = (apontar?.elementos ?? (perguntou ? pecasCitadas(texto, entrada.grafo ?? "") : [])).filter((id) => ids.has(id));
    const pediuOlhar = /\b(olh\w*|confere|veja)\b.*\b(desenho|quadro)\b/i.test(entrada.texto);
    const visual = o.concluiu || pediuOlhar ? olharODesenho(entrada.grafo ?? "")
      : garantirMarca(mapearAcoesVisuais(apontar?.visual, (id) => ids.has(id) ? id : null), alvos, estado.conversa.length, conexoesDoGrafo(entrada.grafo ?? ""));
    return {
      responder: true, texto, requisito: null, concluiu: o.concluiu, desfecho: o.desfecho, estado: final,
      ...(perguntou ? { perguntou } : {}), ...encerrar, ...(visual !== undefined ? { visual } : {}),
    };
  };
  /** A leitura do turno pelo modelo. Lança se ele falhar; `prazoMs` encurta a espera (fechamento). */
  const gerar = async (prazoMs?: number, avisoExtra?: string) => {
    const blocos = v2
      ? blocosDoSistemaDinamicoPerguntarV2(estado, deps.kit, entrada.fase, entrada.requisitosAtuais ?? [], entrada.grafo, perguntaAberta, entrada.gestosRecentes, agora, entrada.conversaDoQuadro, entrada.mudancas, !!entrada.imagemBase64, blocoDoBriefing(deps.kit, estado, agora), FALAS_NO_PROMPT_V2, contextoDoFim)
      : [{ bloco: "resto" as const, texto: `${montarSistemaDinamicoPerguntar(estado, entrada.fase, entrada.requisitosAtuais ?? [], entrada.grafo, perguntaAberta, entrada.gestosRecentes, agora, entrada.conversaDoQuadro, entrada.mudancas, !!entrada.imagemBase64, blocoDoBriefing(deps.kit, estado, agora))}\n${linhaDoFechamento(contextoDoFim)}` }];
    const pedido = {
      sistema: {
        estatico: `${v2 ? montarSistemaEstaticoPerguntarV2(deps.kit, deps.problema) : montarSistemaEstaticoPerguntar(deps.kit, deps.problema)}\n\n${REGRA_DADOS}`,
        dinamico: `${blocos.map((b) => b.texto).join("")}${avisoExtra ? `\n\n${avisoExtra}` : ""}`,
      },
      // A fala vai como está (é o que o modelo responde), só sem etiqueta falsa.
      mensagens: [{ role: "user" as const, content: neutralizar(entrada.texto) }],
      schema: EsquemaSaidaPerguntar,
      nomeSchema: v2 ? NOME_SCHEMA_PERGUNTAR_V2 : NOME_SCHEMA_PERGUNTAR,
      modelo: deps.modelo,
      maxTokens: deps.maxTokens ?? 200,
      sinal: prazoMs === undefined ? sinal : AbortSignal.any([AbortSignal.timeout(prazoMs), ...(sinal ? [sinal] : [])]),
      imagem: entrada.imagemBase64 ?? null,
      ...(prazoMs !== undefined ? { timeoutMs: prazoMs } : {}),
    };
    // No fechamento a leitura tem prazo curto (o teto é deste `gerar`, não do chamador, para a segunda geração ter o seu).
    const r = prazoMs === undefined ? await deps.llm.completarJson(pedido) : await leituraNoPrazo(deps.llm.completarJson(pedido));
    let dados = r.dados;
    // Quem respondeu de fato este turno: com reserva e disjuntor no `lib/llm`, o modelo configurado nem sempre é
    // o que fala. Sem isso não dá para saber se o Totti "burro" era o modelo forte ou a reserva.
    medida.uso = {
      modelo: r.modelo ?? "desconhecido",
      provedor: r.provedor ?? "desconhecido",
      ms: r.ms,
      tokens_entrada: r.uso?.entrada,
      tokens_saida: r.uso?.saida,
      ...(r.uso?.cache !== undefined ? { tokens_cache: r.uso.cache } : {}),
      custo_usd: r.uso?.custo,
      blocos: tamanhoDosBlocos(blocos),
      foto: entrada.imagemBase64?.length ?? 0,
      falas_no_prompt: historicoDaConversa(estado.conversa, entrada.conversaDoQuadro, v2 ? FALAS_NO_PROMPT_V2 : undefined).length,
    };
    log("perguntar_llm", { sessao_id: entrada.sessao_id, versao: v2 ? "v2" : "v1", ...medida.uso });
    // Ele fez uma pergunta clara ("o que tu acha", "posso usar um cache?") e o modelo ficou quieto: gera de novo,
    // uma vez, avisando. Se esta falhar, vale a primeira leitura (e a fala de reserva, mais abaixo).
    // Também no fechamento (a pergunta que ele fez sem "?" conta, lib/totti/turno.ts): só a reserva vem depois dela.
    if (r.ms <= MAX_MS_PARA_GERAR_DE_NOVO && ficouSemResposta(deSaidaDoQuadro(dados, situacao), situacao)) {
      log("perguntar_pergunta_sem_resposta", { sessao_id: entrada.sessao_id, fase: entrada.fase });
      // O sinal é o da rota (não o do prazo do fechamento, que pode já ter estourado).
      const deNovo = await leituraNoPrazo(deps.llm.completarJson({
        ...pedido,
        sinal,
        sistema: { ...pedido.sistema, dinamico: `${pedido.sistema.dinamico}\n\n${avisoDePerguntaSemResposta("responder")}` },
        timeoutMs: PRAZO_SEGUNDA_GERACAO_MS,
      })).catch(() => null);
      if (deNovo) dados = deNovo.dados;
    }
    return dados;
  };
  const registrarFalha = (e: unknown) => log("perguntar_falhou", {
    sessao_id: entrada.sessao_id,
    fase: entrada.fase,
    codigo: (e as { codigo?: string }).codigo ?? "desconhecido",
    ...(nucleo ? { fechamento: nucleo.etapa } : {}),
  });

  // Fechamento em andamento: a fala dele vai ao núcleo, e a próxima fala do Totti (reação e pergunta final seguinte,
  // última palavra ou despedida) sai na hora, sem esperar análise do desenho, intervalo nem cota de perguntas.
  if (nucleo) {
    let lida: LeituraDoTurno | null = null;
    try {
      const lido = await gerar(PRAZO_DA_LEITURA_NO_FECHAMENTO_MS);
      const guardada = aplicarGuardas(lido.texto, { falaDoCandidato: entrada.texto, falasDoTotti: jaDitas });
      if (guardada.travas.length) log("perguntar_travas", { sessao_id: entrada.sessao_id, fase: entrada.fase, travas: guardada.travas });
      lida = deSaidaDoQuadro({ ...lido, texto: limitarFrases(emPortugues(guardada.texto, estado.plano?.descricaoVaga), MAX_FRASES_FALA) }, situacao);
    } catch (e) {
      // O fechamento não para por causa do modelo: sem leitura, o núcleo decide pelo que a fala mostra.
      registrarFalha(e);
    }
    if (perguntouComClareza(entrada.texto) && (!lida || !lida.responder || !lida.texto)) {
      lida = comRespostaDeReserva(lida ?? deSaidaDoQuadro({ responder: false, texto: "" }, situacao), situacao).leitura;
    }
    const passo = proximoPasso(nucleo, lida, entrada.texto, { tempoRestanteMs: tempoRestanteMs(estado, agora) });
    return comPasso(passo, { inicio: false, antes: nucleo, base: comFala, concluiu: false, desfecho: null });
  }

  let saida: Awaited<ReturnType<typeof gerar>>;
  let prometeuOlhar = false;
  let regenerouPromessa = false;
  try {
    saida = await gerar();
    prometeuOlhar = promessaVazia(saida.texto);
    if (prometeuOlhar) {
      regenerouPromessa = true;
      const segunda = await gerar(PRAZO_SEGUNDA_GERACAO_MS, avisoDePromessaVazia("quadro")).catch(() => null);
      if (segunda) saida = segunda;
    }
    const pediuOlhar = fasesDeDesenho && (pediuParaOlhar(entrada.texto) || sinalDeConclusao(situacao) || saida.concluiu === true || prometeuOlhar);
    if (pediuOlhar && !falaComObservacaoEPergunta(saida.texto, nomeObservado ?? "peças")) {
      if (!regenerouPromessa) {
        regenerouPromessa = true;
        try { saida = await gerar(PRAZO_SEGUNDA_GERACAO_MS, avisoDePromessaVazia("quadro")); } catch { /* reserva abaixo */ }
      }
    }
  } catch (e) {
    registrarFalha(e);
    if (!(fasesDeDesenho && (pediuParaOlhar(entrada.texto) || sinalDeConclusao(situacao)))) return { ...mudo(), falhou: true };
    saida = { responder: true, texto: "", requisito: null, concluiu: true };
  }

  // Se o candidato terminou é o modelo quem interpreta. O código só serve de rede: "terminei" ou "acho que é isso"
  // com o desenho parado há alguns segundos conta mesmo que o modelo não tenha marcado (lib/totti/turno.ts).
  const peloSinal = saida.concluiu !== true && saida.encerrar !== true && sinalDeConclusao(situacao);
  if (peloSinal) log("perguntar_turno", { sessao_id: entrada.sessao_id, fase: entrada.fase, regras: ["sinal_de_conclusao"] });
  const concluiu = saida.concluiu === true || peloSinal;
  const comConclusao = (e: EstadoSessao) => concluiu ? transicionar(e, { tipo: "CANDIDATO_CONCLUIU", grafo: entrada.grafo }, agora).estado : e;
  // "pensando" não é resposta à pergunta: ele pediu tempo (tratado logo abaixo).
  const desfechoDaSaida: Desfecho | null = haPerguntaAtiva && saida.desfecho !== "pensando" ? (saida.desfecho ?? null) : null;
  // A pergunta do Totti que ele está respondendo: a ativa, ou a última fala dele, se ela terminou em pergunta.
  const perguntaDoTotti = perguntaAberta ?? estado.perguntaAtiva?.pergunta ?? (minhaUltima?.trim().endsWith("?") ? minhaUltima : undefined);
  // Escolha de uma ou poucas palavras a uma pergunta com alternativas: pede o porquê (lib/totti/turno.ts). Quem não
  // sabe ou pula fica de fora (o desfecho já trata). Ali a resposta dele conta como respondida, mesmo sem a marca do modelo.
  const porque = v2 && desfechoDaSaida !== "nao_sabe" && desfechoDaSaida !== "pulou" && pedePorque(perguntaDoTotti, entrada.texto);
  const desfecho: Desfecho | null = porque && haPerguntaAtiva && desfechoDaSaida === null ? "respondeu" : desfechoDaSaida;
  const mudoOuConcluiu = (): ResultadoPerguntar => ({ ...mudo(), concluiu, desfecho, estado: comConclusao(comFala) });
  /** Silêncio, a não ser que ele tenha feito uma pergunta clara: essa nunca fica sem resposta (regra comum às salas). */
  const calar = (): ResultadoPerguntar => {
    const reserva = comRespostaDeReserva(deSaidaDoQuadro({ ...saida, responder: false, texto: "", concluiu }, situacao), situacao);
    if (!reserva.regras.length) return mudoOuConcluiu();
    log("perguntar_turno", { sessao_id: entrada.sessao_id, fase: entrada.fase, regras: reserva.regras });
    const fala = reserva.leitura.texto;
    const final = transicionar(comConclusao(comFala), { tipo: "AGENTE_FALOU", texto: fala, ...(v2 ? { perguntou: true } : {}) }, agora).estado;
    return { responder: true, texto: fala, requisito: null, concluiu, desfecho, estado: final, ...(v2 ? { perguntou: true } : {}) };
  };
  // Ele pediu tempo para pensar ("calma, deixa eu pensar"): não é resposta nem pergunta, e não há o que analisar ainda.
  // Na primeira vez na entrevista o Totti diz uma reação curta; depois disso fica calado. Nunca acrescenta convite nem
  // levanta pergunta, e a bola segue com ele (`pedidoDeTempoPendente`, na política). Não gera observação negativa: o
  // desfecho é null, então nada grava a resposta à pergunta ativa.
  if (v2 && saida.desfecho === "pensando") {
    const reagiu = !estado.reacaoAoPensarDita;
    const fala = reagiu ? reacaoAoPensar(jaDitas) : "";
    log("perguntar_turno", { sessao_id: entrada.sessao_id, fase: entrada.fase, regras: ["pediu_tempo"] });
    const comPedido = transicionar(comFala, { tipo: "CANDIDATO_PEDIU_TEMPO", reagiu }, agora).estado;
    if (!fala) return { responder: false, texto: "", requisito: null, concluiu: false, desfecho: null, pediuTempo: { reagiu }, estado: comPedido };
    const final = transicionar(comPedido, { tipo: "AGENTE_FALOU", texto: fala }, agora).estado;
    return { responder: true, texto: fala, requisito: null, concluiu: false, desfecho: null, pediuTempo: { reagiu }, estado: final };
  }
  const pediuComentario = fasesDeDesenho && (pediuParaOlhar(entrada.texto) || concluiu || prometeuOlhar);
  // As travas da fala são as do Totti único (lib/totti/guardas.ts), as mesmas do live coding: cumprimento fora da
  // abertura, validação, eco do que o candidato disse, reação vazia repetida e, no v2, pergunta que ele já ouviu
  // (do Totti na conversa, da análise do desenho ou da mudança no problema) ou que só devolve a condução.
  // A pergunta de porquê do modelo não é repetida nem de condução: é a pergunta que este turno precisa fazer. O porquê
  // que ele já pediu antes ("Por que no backend?") volta quando a escolha é nova, mesmo que o ponto já tenha sido visto.
  const porqueDoModelo = porque && ePerguntaDePorque(saida.texto);
  const guardada = aplicarGuardas(saida.texto, {
    falaDoCandidato: entrada.texto,
    falasDoTotti: jaDitas,
    perguntasJaFeitas: v2 && !porqueDoModelo
      ? [
        ...estado.conversa.filter((f) => f.quem === "agente" && f.texto.includes("?")).map((f) => f.texto),
        ...estado.perguntas.flatMap((p) => [p.pergunta, ...(p.seguimentos ?? [])]),
      ]
      : undefined,
    barrarConducao: v2 && fasesDeDesenho && !porqueDoModelo,
  });
  if (guardada.travas.length) log("perguntar_travas", { sessao_id: entrada.sessao_id, fase: entrada.fase, travas: guardada.travas });
  if (porque) log("perguntar_turno", { sessao_id: entrada.sessao_id, fase: entrada.fase, regras: ["pede_porque"] });
  const perguntaBarrada = guardada.travas.includes("pergunta_repetida") || guardada.travas.includes("pergunta_de_conducao");
  // Até 3 frases: acolher + reagir + um follow-up curto. O prompt pede falas de uma ou duas.
  // Português claro (decisão H): termo em inglês que a vaga não usa sai antes de a fala ir ao candidato.
  const curto = limitarFrases(emPortugues(guardada.texto, estado.plano?.descricaoVaga), MAX_FRASES_FALA);

  // Pediu para encerrar e fez uma pergunta na mesma fala ("pode encerrar, mas o que é courier?"): a pergunta não cai.
  // O Totti responde e pergunta se tem mais alguma coisa, e o fechamento começa já na última palavra (ele não pediu o
  // anúncio nem as perguntas finais). Não dispara `pediu_encerrar`, então o quadro não se despede neste turno.
  if (saida.encerrar === true && saida.candidatoPerguntou === true) {
    log("perguntar_turno", { sessao_id: entrada.sessao_id, fase: entrada.fase, regras: ["pergunta_ao_encerrar"] });
    const inicial: EstadoFechamento = { ...iniciarFechamento({ sala: "quadro", gatilho: "pediu_encerrar" }), etapa: "ultima_palavra" };
    const leituraDaPergunta = deSaidaDoQuadro({ ...saida, responder: true, texto: curto, encerrar: false }, situacao);
    return comPasso(proximoPasso(inicial, leituraDaPergunta, entrada.texto), { inicio: true, antes: null, base: comConclusao(comFala), concluiu, desfecho });
  }

  // É hora de fechar? Quem decide é o núcleo (lib/totti/fechamento.ts), com o que o quadro sabe do momento: pedido
  // para encerrar vai direto à despedida; "terminei" com o caminho principal desenhado fecha na primeira vez, e sem
  // ele, na segunda; tempo acabando fecha de qualquer jeito. A fala do turno passa a ser a do fechamento (o anúncio
  // já com a primeira pergunta final), no lugar do aviso de que vai olhar e da oferta de encerrar de antes.
  // Decisão F (#129): "terminei" só fecha se a sala não barrou (faltam critérios do plano ou a mudança de cenário), e
  // o tempo que fecha é a fração da duração da vaga (`parametrosDoFechamentoNoQuadro`).
  const restanteMs = tempoRestanteMs(estado, agora);
  const gatilho = gatilhoDoFechamento({
    pediuEncerrar: saida.encerrar === true,
    concluiu,
    conclusoesAntes,
    materialPronto: fasesDeDesenho && caminhoPrincipalDesenhado(entrada.grafo),
    ...parametrosDoFechamentoNoQuadro(estado, agora, deps),
    ...(FASES_DA_ENTREVISTA.includes(entrada.fase) ? { tempoRestanteMs: restanteMs } : {}),
  });
  if (gatilho) {
    // Pedido para encerrar faz as perguntas finais dos critérios do plano que faltam, antes da última palavra (decisão
    // revisada, #129). Com urgência ("tenho que sair agora") ou sem o que perguntar, vai direto à despedida. O núcleo
    // corta pelo tempo e por MAX_PERGUNTAS_AO_PEDIR_FIM.
    const comPerguntasDoPedido = gatilho === "pediu_encerrar" && saida.urgente !== true;
    // As perguntas finais são as que o modelo escreveu no mesmo turno (`perguntasFinais`), e só valem enquanto há critério
    // do plano sem sinal. Cada uma passa pelas travas da fala (eco, repetição, condução); a que as travas mexeram cai.
    const perguntasDoModelo = comPerguntasDoPedido && criteriosDoPlanoSemEvidencia(estado).length > 0
      ? (saida.perguntasFinais ?? []).flatMap((p) => {
        const guardada = aplicarGuardas(p, { falaDoCandidato: entrada.texto, falasDoTotti: jaDitas, perguntasJaFeitas: perguntasJaOuvidas(estado) });
        return guardada.travas.length === 0 && guardada.texto.trim().endsWith("?")
          ? [{ pergunta: emPortugues(guardada.texto, estado.plano?.descricaoVaga), origem: "modelo" }]
          : [];
      })
      : [];
    const inicial = iniciarFechamento({
      sala: "quadro", gatilho, tempoRestanteMs: restanteMs,
      candidatas: comPerguntasDoPedido ? perguntasDoModelo : candidatasDoQuadro(deps.kit, deps.problema, estado, agora),
      perguntasJaFeitas: perguntasJaOuvidas(estado),
      perguntasNoPedidoDeFim: comPerguntasDoPedido,
    });
    const passo = proximoPasso(inicial, undefined, "", { tempoRestanteMs: restanteMs });
    // O tempo acabou no meio de uma pergunta dele: a resposta vem antes do anúncio, para ela não ficar no ar.
    const respostaAntes = gatilho === "tempo" && saida.responder && perguntouComClareza(entrada.texto)
      ? frasesSemPergunta(semConviteDeSeguir(curto))
      : "";
    const perguntaDoFechamento = passo.fala.includes("?")
      ? ""
      : estado.perguntaPendente?.pergunta?.trim()
        || candidatasDoQuadro(deps.kit, deps.problema, estado, agora)[0]?.pergunta
        || FALAS_DE_RESERVA_AO_OLHAR.pergunta(nomeObservado);
    const comentarioAntes = pediuComentario
      ? nomeObservado ? [observacaoDoGrafo(), perguntaDoFechamento].filter(Boolean).join(" ") : observacaoDoGrafo()
      : "";
    const antesDaFala = [respostaAntes, comentarioAntes].filter(Boolean).join(" ");
    return comPasso(passo, { inicio: true, antes: null, base: comConclusao(comFala), concluiu, desfecho, antesDaFala });
  }
  // Ele já disse que terminou o desenho (e não voltou a desenhar): nenhuma fala manda continuar o desenho. Numa
  // entrevista real o Totti respondeu "pode seguir com a próxima parte do seu desenho" a quem tinha acabado de dizer
  // que terminou. Se ele respondia a uma pergunta e só sobrava o convite, fica uma reação curta: a pergunta seguinte
  // vem da análise.
  const desenhoJaConcluido = fasesDeDesenho && (!!estado.desenhoConcluido || concluiu);
  const reservaComentario = (): string => {
    if (!nomeObservado) return FALAS_DE_RESERVA_AO_OLHAR.quadroSemPecas;
    const nome = nomeObservado;
    const pergunta = estado.perguntaPendente?.pergunta?.trim()
      || candidatasDoQuadro(deps.kit, deps.problema, estado, agora)[0]?.pergunta
      || FALAS_DE_RESERVA_AO_OLHAR.pergunta(nome);
    return `${observacaoDoGrafo()} ${pergunta}`;
  };
  const semMandarSeguir = (fala: string): string => {
    if (!desenhoJaConcluido) return fala;
    const semConvite = semConviteDeSeguir(fala);
    if (semConvite === fala) return fala;
    log("perguntar_turno", { sessao_id: entrada.sessao_id, fase: entrada.fase, regras: ["sem_convite_de_seguir"] });
    return semConvite || (situacao.respondiaAoTotti ? reacaoNeutra(jaDitas) : "");
  };
  let texto: string;
  let seguimento = false;
  if (v2) {
    // No v2 quem conduz é o Conversador: depois de uma resposta ele pode puxar um fio; só "não sei"/"pula" perdem a
    // pergunta (e o convite enlatado entra apenas se não sobrar fala nenhuma).
    // (O convite enlatado, a troca da pergunta por um convite e a vez devolvida são decisões comuns às duas salas.)
    let base = curto;
    // A fala inteira era eco ou cumprimento e saiu, mas ele acabou de responder a uma pergunta do Totti e espera uma
    // reação: entra uma curta e neutra no lugar (o convite vem com a vez devolvida).
    const soEcoOuCumprimento = guardada.travas.length > 0 && guardada.travas.every((t) => t === "eco" || t === "cumprimento" || t === "validacao");
    if (saida.responder && !base && saida.texto.trim() && situacao.respondiaAoTotti && soEcoOuCumprimento) base = reacaoNeutra(jaDitas);
    // "Hm." atrás de "Hm." vira bordão na voz: a segunda reação vazia seguida fica em silêncio (a vez já é dele).
    if (eSoReacao(base) && eSoReacao(minhaUltima)) base = "";
    // Ele fez uma escolha curta e a fala não termina em pergunta: o porquê entra no fim, sem convite depois dele (a
    // pergunta já devolve a vez). Se o modelo calou, a pergunta sai sozinha.
    const porqueForcado = porque && !base.trim().endsWith("?");
    // O convite que o modelo pôs ("Tá, pode seguir.") sai antes: a pergunta de porquê já devolve a vez.
    if (porqueForcado) base = [semConviteDeSeguir(base), perguntaDePorque(jaDitas)].filter(Boolean).join(" ");
    // "Não sei" ou "pula" não ganham pergunta nova, e quem acabou de responder a uma pergunta do Totti não ouve só
    // um "Tá." ou um fato solto: sem pergunta nem próximo passo, entra um convite.
    if (pediuComentario && estado.perguntaPendente?.pergunta?.trim()) {
      base = reservaComentario();
      saida = { ...saida, responder: true };
    } else if (pediuComentario && !falaComObservacaoEPergunta(base, nomeObservado ?? "peças")) {
      base = reservaComentario();
      saida = { ...saida, responder: true };
    }
    const decidido = decidirTurno(deSaidaDoQuadro({ ...saida, texto: base, concluiu }, situacao), situacao);
    if (decidido.regras.length) log("perguntar_turno", { sessao_id: entrada.sessao_id, fase: entrada.fase, regras: decidido.regras });
    texto = semMandarSeguir(decidido.leitura.texto);
    // A fala era só a pergunta que a trava barrou (repetida ou de condução): ele fica quieto.
    if (perguntaBarrada && !texto) return calar();
    if (pediuComentario && !falaComObservacaoEPergunta(texto, nomeObservado ?? "peças")) texto = reservaComentario();
    if (!texto || (!saida.responder && !porqueForcado)) return calar();
    // Pergunta de porquê: é continuação do mesmo fio, então a pergunta ativa segue aberta e o quadro espera a resposta.
    if (porque && texto.trim().endsWith("?")) seguimento = true;
  } else {
    // "Não sei" ou "pula": a vez volta com um convite, nunca com outra pergunta. Depois de uma resposta, o modelo
    // pode emendar UMA pergunta de continuação ("aprofundar"), que faz a entrevista andar no mesmo fio, até
    // MAX_SEGUIMENTOS por fio e só nas fases de desenho: depois disso o assunto muda pela análise.
    const ativa = estado.perguntaAtiva ?? (entrada.perguntaAtiva
      ? estado.perguntas.findLast((p) => p.pergunta === entrada.perguntaAtiva || p.seguimentos?.includes(entrada.perguntaAtiva!))
      : undefined);
    const fioAberto = (ativa?.seguimentos?.length ?? 0) < MAX_SEGUIMENTOS;
    const faseDeDesenho = entrada.fase === "ALTO_NIVEL" || entrada.fase === "APROFUNDAMENTO";
    const podeSeguir = desfecho === "respondeu" && saida.aprofundar === true && fioAberto && faseDeDesenho;
    const semAprofundar = desfecho === "nao_sabe" || desfecho === "pulou" || (desfecho === "respondeu" && !podeSeguir);
    texto = semMandarSeguir(comVezDevolvida(semAprofundar ? semPerguntaNoFim(curto, jaDitas) : curto, jaDitas));
    if (!saida.responder || !texto) return calar();
    seguimento = podeSeguir && texto.endsWith("?");
  }
  const requisito = saida.requisito?.trim()
    ? saida.requisito.trim().slice(0, MAX_CARACTERES_REQUISITO)
    : null;
  const repetido = requisito !== null && (entrada.requisitosAtuais ?? []).includes(requisito);

  // v2: a pergunta do Conversador conta no intervalo do plin, para o Pensador não emendar outra logo em seguida.
  const perguntou = v2 && texto.trim().endsWith("?");
  const final = transicionar(comConclusao(comFala), { tipo: "AGENTE_FALOU", texto, ...(perguntou ? { perguntou } : {}) }, agora).estado;
  // A pergunta que cita uma peça pelo nome marca essa peça no quadro, mesmo que o modelo não tenha pedido gesto.
  const citadas = pecasCitadas(texto, entrada.grafo ?? "").filter((id) => ids.has(id));
  const pediuOlhar = /\b(olh\w*|confere|veja)\b.*\b(desenho|quadro)\b/i.test(entrada.texto);
  const visual = concluiu || pediuOlhar ? olharODesenho(entrada.grafo ?? "")
    : garantirMarca(mapearAcoesVisuais(saida.visual, (id) => ids.has(id) ? id : null), citadas, estado.conversa.length, conexoesDoGrafo(entrada.grafo ?? ""));
  return { responder: true, texto, requisito: repetido ? null : requisito, concluiu, desfecho, estado: final,
    ...(perguntou ? { perguntou } : {}),
    ...(seguimento ? { seguimento } : {}),
    ...(visual !== undefined ? { visual } : {}) };
}
