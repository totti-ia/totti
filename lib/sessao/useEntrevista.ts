"use client";

// Liga a máquina de estados, o gatilho, o quadro e o modo de servidor escolhido.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Quadro } from "@/components/Canvas";
import type { ControleCursor } from "@/components/CursorAgente";
import type { MensagemConversa } from "@/components/quadro/PainelConversa";
import { pedirEmpecilho, pedirFechamento, perguntar, rascunharPergunta, type ContextoDaPergunta } from "@/lib/sessao/servidor";
import { criarPedidoDeRascunho, type PedidoDeRascunho } from "@/lib/conversa/pedidoDeRascunho";
import { DESPEDIDAS, duracaoEfetivaDaFaseS, limiarDoFechamentoNoQuadro, msAteFimDaFase } from "@/lib/totti/fechamento";
import { criarDespedida } from "@/lib/voz/despedida";
import { semFalaSubstituida } from "@/lib/conversa/substituir";
import { concluiuHaPouco, contarComponentes, emGarantiaDoEmpecilho, esperaDoEmpecilho, relaxaPreChecagens } from "@/lib/sessao/empecilho";
import { limparTextoDigitado } from "@/lib/sessao/textoDigitado";
import { montarFalaDoDesafio } from "@/lib/sessao/falaDoDesafio";
import { comoFuncionaQuadro } from "@/lib/conversa/instrucoes";
import { deveAguardarParaFalar, deveAnalisarLogoAposResposta, podeTomarTurno, respostaTerminouPorSilencio } from "@/lib/conversa/turnos";
import { alvosDaAcao, criarMemoriaVisual, mapearAcoesVisuais, resumirGestosRecentes } from "@/lib/presenca/acoesVisuais";
import { deveForcarAnalise } from "@/lib/sessao/silencio";
import { definirSessaoDaVoz } from "@/lib/voz/cliente";
import {
  analisar,
  calar,
  criarSessao,
  duvidaDeDemonstracao,
  enviarEventos,
  falar,
  finalizarSessao,
  falarComMarcas,
  usarServidor,
  type FalaNaTela,
  type FalaRecente,
  type PedidoAnalise,
  type Sessao,
} from "@/lib/sessao/cliente";
import { criarLinhaDoTempo } from "@/lib/sessao/eventos";
import { FilaDoAgente, type Descartado, type MotivoDoDescarte, type OrigemDaFala } from "@/lib/audio/filaDoAgente";
import { apontarEAnotar } from "@/lib/presenca/coreografia";
import type { MarcaDeFala } from "@/lib/presenca/vozSincronizada";
import { interrupcaoAtrasada, motivoDoMomento, pausaDasMaosParaFalarMs, RITMO } from "@/lib/interrupcao/politica";
import { LICENCA_DE_NOVO_MS, LICENCA_SEM_RESPOSTA_MS, liberouAPergunta, pedeParaEncerrar } from "@/lib/conversa/licenca";
import {
  DURACAO_PADRAO_MIN,
  estadoInicial,
  marcoDoCliente,
  podeAnalisar,
  ritmoDoCliente,
  transicionar,
  type EstadoEntrevista,
  type EventoEntrevista,
} from "@/lib/sessao/estados";
import { criarGatilho, type Gatilho } from "@/lib/sessao/gatilho";
import { criarConversor, type Instantaneo } from "@/lib/excalidraw/conversor";
import { descreverMudancas, houveMudancaRelevante } from "@/lib/excalidraw/diff";
import { falaInterrompida } from "@/lib/totti/interrupcao";

/** Como uma fala do Totti entra na fila única (ver lib/audio/filaDoAgente.ts). */
/**
 * Parou de desenhar há pelo menos isso: uma pausa de quem parou para pensar. Ali o Totti pergunta direto, como no
 * live coding, sem o "posso te perguntar uma coisa sobre o desenho?" fixo (soava como robô).
 */
/**
 * Peças que entram no quadro numa única mudança a partir das quais o desenho veio pronto (colado ou duplicado), não
 * desenhado ali. Desenhando à mão entra uma peça por vez (duas, com o rótulo).
 */
const PECAS_DE_UMA_COLAGEM = 6;
/** A colagem ainda sem pergunta acompanha as análises por esse tempo. */
const COLAGEM_VALE_MS = 3 * 60_000;

interface OpcoesDeFala {
  /** A despedida é exclusiva e sua fala já foi registrada antes de pedir o relatório. */
  despedida?: boolean;
  /** Quem pediu a fala; define quando ela ainda vale depois de esperar. Padrão: "sempre" (abertura, desafio, despedida). */
  origem?: OrigemDaFala;
  /** Número da pergunta ativa do Analista (origem "pergunta"). */
  numeroPergunta?: number | null;
  /** Chamado logo depois que a fala saiu da fila e foi para o ar (a versão da fala já é a dela). */
  aoTocar?: () => void;
}

type Acao = { evento: EventoEntrevista; agora: number };

/** O enunciado vai em preto (a cor padrão do traço no Excalidraw); as anotações de pergunta, na cor do agente. */
const COR_ENUNCIADO = "#1e1e1e";
/** Silêncio depois de uma fala sem resposta do agente que encerra a resposta à pergunta ativa. */
/** Sem resposta a uma pergunta de continuação por tanto tempo (desde a última fala de qualquer um): o fio fecha. */
const SILENCIO_FIM_DO_SEGUIMENTO_MS = 30_000;
const SILENCIO_FIM_DA_RESPOSTA_MS = 7_000;
/** Quando o pedido falha de vez: curtas, neutras e variadas. */
const FALAS_DE_REPETICAO = [
  "Desculpa, me perdi aqui. Pode repetir?",
  "Não peguei essa última parte. Pode falar de novo?",
  "Perdi o fio por um instante. Pode repetir o que disse?",
];
/** Entre um pedido de mudança recusado pelo servidor e o próximo. */
const INTERVALO_PEDIDO_EMPECILHO_MS = 15_000;
/** Quanto o encerramento espera pela foto final do quadro antes de gerar o relatório sem ela. */
const PRAZO_FOTO_FINAL_MS = 8_000;
/** Respostas do servidor que encerram as tentativas nesta sessão. */
const MOTIVOS_DEFINITIVOS_EMPECILHO = ["problema sem mudança prevista", "já anunciado"];

function redutor(estado: EstadoEntrevista, acao: Acao) {
  return transicionar(estado, acao.evento, acao.agora);
}

/** Elementos do candidato que contam como desenho de verdade (formas, setas, textos com conteúdo). */
function elementosSignificativos(elementos: readonly { type: string; isDeleted?: boolean; customData?: Record<string, unknown>; width: number; height: number }[]): number {
  return elementos.filter((e) => !e.isDeleted && e.customData?.autor !== "agente" && e.type !== "selection"
    && (e.width > 8 || e.height > 8)).length;
}

/**
 * Assinatura do desenho do candidato (as marcas do Totti não contam): muda quando qualquer peça entra, sai ou muda.
 * O /perguntar só manda foto e bloco de mudanças quando ela muda desde a última foto enviada (issue #63).
 */
function assinaturaDoDesenho(elementos: readonly { id: string; version: number; isDeleted?: boolean; customData?: Record<string, unknown> }[]): string {
  return elementos.filter((e) => !e.isDeleted && e.customData?.autor !== "agente").map((e) => `${e.id}:${e.version}`).join("|");
}

/** Há quantos segundos o desenho está parado (vai ao /perguntar só depois do primeiro traço). */
function desenhoParadoEm(ultimoDesenhoEm: number): number | undefined {
  return ultimoDesenhoEm > 0 ? Math.round((Date.now() - ultimoDesenhoEm) / 1000) : undefined;
}

/**
 * Contexto do /perguntar de uma fala. Só monta: não grava nada. O envio final e o rascunho chamam esta mesma função
 * (o corpo sai igual nos dois); só o envio final marca a foto que levou (`desenhoDaUltimaFoto`).
 */
function montarContextoDaFala(p: {
  grafo?: string;
  mudancas?: string;
  imagem_base64?: string;
  conversa: FalaRecente[];
  perguntaAtiva?: string;
  requisitos: string[];
  gestos: string[];
  desenhoParadoHaS?: number;
  substitui: boolean;
  cortada: boolean;
}): ContextoDaPergunta {
  return {
    grafo: p.grafo,
    mudancas: p.mudancas,
    imagem_base64: p.imagem_base64,
    conversa_do_quadro: p.conversa.slice(-20),
    pergunta_ativa: p.perguntaAtiva,
    requisitos: p.requisitos.slice(-30),
    gestos_recentes: p.gestos,
    ...(p.desenhoParadoHaS !== undefined ? { desenho_parado_ha_s: p.desenhoParadoHaS } : {}),
    ...(p.substitui ? { substitui: true } : {}),
    ...(p.cortada ? { pergunta_cortada: true } : {}),
  };
}

/** Aguarda a prova por até 1,8 s (e a miniatura em data URL por até 600 ms); a tarefa original continua para registrar a URL tardia.
 * Com miniatura, o Totti já enxerga o quadro por ela: a URL (só para o registro) espera no máximo 300 ms. */
export async function pedidoComImagem(
  pedido: PedidoAnalise,
  imagem: Promise<string | null>,
  sinal: AbortSignal,
  dataUrl?: Promise<string | null>,
): Promise<PedidoAnalise> {
  sinal.throwIfAborted();
  let prazo: ReturnType<typeof setTimeout> | undefined;
  let prazoMiniatura: ReturnType<typeof setTimeout> | undefined;
  let cancelar: (() => void) | undefined;
  try {
    // A miniatura em data URL tem prazo próprio: se atrasar, a análise segue sem ela.
    const miniatura = dataUrl
      ? Promise.race([dataUrl.catch(() => null), new Promise<null>((resolver) => { prazoMiniatura = setTimeout(() => resolver(null), 600); })])
      : Promise.resolve(null);
    const url = await Promise.race([
      imagem.catch(() => null),
      new Promise<null>((resolver) => { prazo = setTimeout(() => resolver(null), dataUrl ? 300 : 1800); }),
      new Promise<never>((_, rejeitar) => {
        cancelar = () => rejeitar(sinal.reason);
        sinal.addEventListener("abort", cancelar, { once: true });
      }),
    ]);
    sinal.throwIfAborted();
    const base64 = await miniatura;
    sinal.throwIfAborted();
    if (!url && !base64) return pedido;
    return { ...pedido, ...(url ? { imagem_url: url } : {}), ...(base64 ? { imagem_base64: base64 } : {}) };
  } finally {
    if (prazo !== undefined) clearTimeout(prazo);
    if (prazoMiniatura !== undefined) clearTimeout(prazoMiniatura);
    if (cancelar) sinal.removeEventListener("abort", cancelar);
  }
}

/**
 * `configId`: plano de entrevista da vaga (o servidor escolhe o kit e calibra o agente por ele).
 * `convite`: id do link do e-mail; liga esta sessão ao candidato no painel da vaga.
 */
export function useEntrevista(
  quadro: Quadro | null,
  cursor: React.RefObject<ControleCursor | null>,
  opcoes: { configId?: string; convite?: string } = {},
) {
  const { configId, convite } = opcoes;
  const [sessao, setSessao] = useState<Sessao | null>(null);
  useEffect(() => { definirSessaoDaVoz(sessao ? { sessao_id: sessao.sessao_id, contexto: "quadro" } : null); return () => definirSessaoDaVoz(null); }, [sessao]);
  const criacaoDaSessao = useRef<Promise<Sessao> | null>(null);
  const [estado, despachar] = useReducer(redutor, undefined, estadoInicial);
  const [despedida, setDespedida] = useState<string | null>(null);
  const encerrandoRef = useRef(false);
  const enviar = useCallback(
    (evento: EventoEntrevista) => despachar({ evento, agora: Date.now() }),
    [],
  );

  const estadoAtual = useRef(estado);
  useEffect(() => {
    estadoAtual.current = estado;
  }, [estado]);

  // O que o agente está falando agora (para o orb e a legenda).
  const [falaAtual, setFalaAtual] = useState<FalaNaTela | null>(null);
  /** A fala na tela e até onde ela foi falada: é o que uma interrupção corta (#97). */
  const falaAtualRef = useRef(falaAtual);
  falaAtualRef.current = falaAtual;
  /** O candidato cortou a pergunta ativa: o que ele disser em seguida não é a resposta a ela. */
  const perguntaCortada = useRef(false);
  const [agenteFalando, setAgenteFalando] = useState(false);
  const [vozHabilitada, setVozHabilitada] = useState(true);
  const vozHabilitadaRef = useRef(true);
  const fimDaLegenda = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versaoDaFala = useRef(0);
  const cicloDaSala = useRef(0);
  const ultimaFalaEm = useRef(0);
  /** Última vez que o agente começou ou terminou de falar (o empecilho espera um respiro). */
  const ultimaFalaDoAgenteEm = useRef<number | null>(null);
  /** Quando o servidor disse que ele pediu tempo para pensar (conta como fala do Totti para o silêncio). */
  const pedidoDeTempoEm = useRef<number | null>(null);
  const falaParcial = useRef(false);
  const agenteFalandoRef = useRef(false);
  const pedidosEmAndamento = useRef(0);
  const revisaoDaConversa = useRef(0);
  const [aguardandoResposta, setAguardandoResposta] = useState(false);
  const [preparandoVoz, setPreparandoVoz] = useState(false);
  const preparandoVozRef = useRef(false);
  const memoriaVisual = useRef(criarMemoriaVisual());
  const visualDaConversa = useRef<{ quadro: Quadro; grupo: string; controle: AbortController; tarefa?: Promise<void> } | null>(null);
  const limparVisualDaConversa = useCallback(() => {
    const atual = visualDaConversa.current;
    visualDaConversa.current = null;
    if (!atual) return;
    atual.controle.abort();
    void (atual.tarefa ?? Promise.resolve()).then(() => atual.quadro.agente.apagarGrupo(atual.grupo));
  }, []);

  /** O que o agente estava dizendo (ou ia dizer) na última fala: para saber o que uma fala nova cortou. */
  const textoDaUltimaFala = useRef("");
  /**
   * Fila única das falas do Totti (lib/audio/filaDoAgente.ts): uma fala que chega com OUTRA tocando espera, não corta.
   * `foiParaAFila` diz, logo depois de `void dizer(...)`, se aquela chamada ficou esperando (então `versaoDaFala`
   * ainda é a da fala que toca, não a dela).
   */
  const filaDoAgente = useRef(new FilaDoAgente<{ texto: string; marcas?: MarcaDeFala[]; aoTocar?: () => void }>());
  const foiParaAFila = useRef(false);
  const dizerRef = useRef<(texto: string, marcas?: MarcaDeFala[], opcoes?: OpcoesDeFala) => Promise<void>>(async () => {});
  const registrarDescarte = useCallback((texto: string, origem: OrigemDaFala, motivo: MotivoDoDescarte) => {
    console.warn("[fala] descartada", { motivo, origem, texto });
    linhaDoTempo.current?.registrar("fala", { quem: "agente", texto, falaDescartada: motivo, origem });
  }, []);
  const registrarDescartes = useCallback((lista: Descartado<{ texto: string }>[]) => {
    lista.forEach((d) => registrarDescarte(d.item.carga.texto, d.item.origem, d.motivo));
  }, [registrarDescarte]);
  const dizer = useCallback(async (texto: string, marcas?: MarcaDeFala[], opcoes: OpcoesDeFala = {}) => {
    if (encerrandoRef.current && !opcoes.despedida) return;
    const { origem = "sempre", numeroPergunta = null, aoTocar } = opcoes;
    foiParaAFila.current = false;
    if (vozHabilitadaRef.current) {
      const admissao = filaDoAgente.current.admitir(
        { origem, carga: { texto, marcas, aoTocar }, fase: estadoAtual.current.fase, numeroPergunta },
        agenteFalandoRef.current, Date.now(),
      );
      if (admissao.resultado === "descartar") return registrarDescarte(texto, origem, admissao.motivo);
      if (admissao.resultado === "esperar") {
        foiParaAFila.current = true;
        console.log("[fala] espera a fala atual terminar", { origem, texto });
        return;
      }
    }
    // Uma fala nova corta a que está tocando (falarComMarcas chama calar()). Registra o que foi cortado, para a
    // linha do tempo da sessão mostrar quando o Totti fala por cima de si mesmo.
    const cortou = agenteFalandoRef.current ? textoDaUltimaFala.current : "";
    if (cortou) console.warn("[fala] uma fala nova cortou a que estava tocando", { cortada: cortou, nova: texto });
    textoDaUltimaFala.current = texto;
    const versao = ++versaoDaFala.current;
    ultimaFalaDoAgenteEm.current = Date.now();
    if (fimDaLegenda.current) clearTimeout(fimDaLegenda.current);
    setFalaAtual({ quem: "agente", texto, ate: 0 });
    setAgenteFalando(false);
    agenteFalandoRef.current = false;
    if (!opcoes.despedida) linhaDoTempo.current?.registrar("fala", { quem: "agente", texto, ...(cortou ? { cortouFala: cortou } : {}) });
    if (!vozHabilitadaRef.current) {
      setPreparandoVoz(false);
      preparandoVozRef.current = false;
      marcas?.forEach((marca) => marca.aoChegar());
      setAgenteFalando(false);
      agenteFalandoRef.current = false;
      setFalaAtual({ quem: "agente", texto, ate: texto.length });
      fimDaLegenda.current = setTimeout(() => setFalaAtual(null), 8000);
      return;
    }
    setPreparandoVoz(true);
    preparandoVozRef.current = true;
    // Sintetize enquanto a escuta segue ativa; confira o turno só antes de reproduzir.
    const antesDeTocar = async () => {
      const esperandoDesde = Date.now();
      while (!opcoes.despedida && estadoAtual.current.fase !== "APRESENTACAO" && estadoAtual.current.fase !== "ENCERRADA"
        && deveAguardarParaFalar({ agora: Date.now(), esperandoDesde, ultimaFalaEm: ultimaFalaEm.current, falaParcial: falaParcial.current })) {
        await new Promise<void>((resolver) => setTimeout(resolver, 100));
        if (versao !== versaoDaFala.current) return false;
      }
      if (versao !== versaoDaFala.current) return false;
      setPreparandoVoz(false);
      preparandoVozRef.current = false;
      setAgenteFalando(true);
      agenteFalandoRef.current = true;
      return true;
    };
    const aoProgresso = (ate: number) => {
      if (versao !== versaoDaFala.current) return;
      setFalaAtual((atual) => (versao === versaoDaFala.current && atual && atual.texto === texto && atual.ate !== ate ? { ...atual, ate } : atual));
    };
    if (marcas) await falarComMarcas(texto, marcas, aoProgresso, antesDeTocar);
    else await falar(texto, aoProgresso, antesDeTocar);
    if (versao !== versaoDaFala.current) return;
    ultimaFalaDoAgenteEm.current = Date.now();
    setAgenteFalando(false);
    setPreparandoVoz(false);
    preparandoVozRef.current = false;
    agenteFalandoRef.current = false;
    // A legenda fica um pouco depois da voz, para dar tempo de terminar de ler.
    fimDaLegenda.current = setTimeout(() => setFalaAtual(null), 1800);
    // A fala terminou sozinha (ninguém a cortou): sai a próxima da fila que ainda faz sentido.
    const e = estadoAtual.current;
    const { item, descartados } = filaDoAgente.current.proximo({
      agora: Date.now(), fase: e.fase, numeroPerguntaAtiva: e.perguntaAtiva?.numero ?? null,
      ultimaAtividadeDoCandidatoEm: Math.max(ultimaAtividade.current, ultimaFalaEm.current),
    });
    registrarDescartes(descartados);
    if (item) {
      void dizerRef.current(item.carga.texto, item.carga.marcas, { origem: item.origem, numeroPergunta: item.numeroPergunta });
      item.carga.aoTocar?.();
    }
  }, [registrarDescarte, registrarDescartes]);
  dizerRef.current = dizer;

  const silenciar = useCallback(() => {
    registrarDescartes(filaDoAgente.current.limpar());
    limparVisualDaConversa();
    versaoDaFala.current++;
    if (fimDaLegenda.current) clearTimeout(fimDaLegenda.current);
    calar();
    setAgenteFalando(false);
    setPreparandoVoz(false);
    preparandoVozRef.current = false;
    agenteFalandoRef.current = false;
    setFalaAtual(null);
  }, [limparVisualDaConversa, registrarDescartes]);
  const alternarVoz = useCallback(() => {
    vozHabilitadaRef.current = !vozHabilitadaRef.current;
    setVozHabilitada(vozHabilitadaRef.current);
    if (!vozHabilitadaRef.current) silenciar();
  }, [silenciar]);
  const silenciarSeAtual = useCallback((versao: number) => {
    if (versaoDaFala.current === versao) silenciar();
  }, [silenciar]);

  useEffect(() => () => {
    cicloDaSala.current++;
    versaoDaFala.current++;
    filaDoAgente.current.limpar();
    if (fimDaLegenda.current) clearTimeout(fimDaLegenda.current);
    calar();
    limparVisualDaConversa();
  }, [limparVisualDaConversa]);

  const conversor = useRef(criarConversor());
  const ultimoInstantaneo = useRef<Instantaneo | null>(null);
  /** O desenho como estava na última foto que o /perguntar levou (ver `assinaturaDoDesenho`). */
  const desenhoDaUltimaFoto = useRef<string | null>(null);
  const conversa = useRef<FalaRecente[]>([]);
  /** Última vez que o candidato mexeu no desenho ou falou (vai ao /analisar como `parado_ha_s`). */
  const ultimaAtividade = useRef(Date.now());
  /** Último traço do candidato no quadro (as "mãos" da política comum de interrupção). */
  const ultimoDesenhoEm = useRef(0);
  /** Quantas peças do candidato havia na última mudança (null: ainda não contou). */
  const pecasDoCandidato = useRef<number | null>(null);
  /** Peças que chegaram de uma vez e ainda não viraram pergunta. */
  const colagem = useRef<{ pecas: number; em: number } | null>(null);
  /** Pedido de licença no ar: quando terminou de ser dito (Infinity enquanto toca), ou null. */
  const licencaPedidaEm = useRef<number | null>(null);
  /** Ele pediu para esperar (ou não respondeu): não pede licença de novo antes disso. */
  const licencaDeNovoEm = useRef(0);
  /** Quando o Totti anunciou a mudança no problema (a próxima pergunta espera um respiro depois dela). */
  const empecilhoAnunciadoEm = useRef(-Infinity);
  /** Requisitos já combinados (vão ao /analisar para a análise não inventar contexto). */
  const requisitosCombinados = useRef<string[]>([]);
  const gatilho = useRef<Gatilho | null>(null);
  /** Grava o quadro como está no encerramento (grafo e foto), se mudou desde a última análise. */
  const capturaFinal = useRef<(() => Promise<void>) | null>(null);
  const linhaDoTempo = useRef<ReturnType<typeof criarLinhaDoTempo> | null>(null);
  const registrar = useCallback(
    (...args: Parameters<ReturnType<typeof criarLinhaDoTempo>["registrar"]>) =>
      linhaDoTempo.current?.registrar(...args),
    [],
  );
  /**
   * O candidato cortou o Totti (#97): falando por cima, pelo botão da chamada ou com Esc. A voz para, e a fala fica na
   * conversa que vai ao servidor só até onde ele ouviu, marcada como cortada (lib/totti/interrupcao.ts). Uma pergunta
   * cortada continua ativa e não conta como respondida pela próxima fala dele.
   */
  const interromper = useCallback((como: "voz" | "manual") => {
    const fala = falaAtualRef.current;
    if (fala && agenteFalandoRef.current) {
      const ouvido = falaInterrompida(fala.texto, fala.ate);
      if (ouvido !== fala.texto.trim()) {
        const i = conversa.current.findLastIndex((f) => f.quem === "agente" && f.texto === fala.texto);
        if (i >= 0) {
          if (ouvido === null) conversa.current.splice(i, 1);
          else conversa.current[i] = { quem: "agente", texto: ouvido };
        }
        revisaoDaConversa.current++;
        if (estadoAtual.current.perguntaAtiva?.pergunta === fala.texto) perguntaCortada.current = true;
        registrar("fala", { quem: "agente", texto: ouvido ?? "", interrompida: true, por: como, falaInteira: fala.texto });
      }
    }
    // A vez é dele: o Totti não volta a falar logo depois de ser cortado.
    ultimaFalaEm.current = Date.now();
    silenciar();
  }, [registrar, silenciar]);
  /**
   * Manda já o que está na fila (sem esperar o lote de 5s). Pergunta e resposta mudam o estado
   * do servidor, e a análise seguinte precisa chegar depois delas. O prazo evita travar a análise.
   */
  const descarregarJa = useCallback((prazoMs = 1500) => {
    const linha = linhaDoTempo.current;
    if (!linha) return Promise.resolve();
    return Promise.race([
      linha.descarregar().catch(() => {}),
      new Promise<void>((resolver) => setTimeout(resolver, prazoMs)),
    ]);
  }, []);

  useEffect(() => {
    let cancelado = false;
    criacaoDaSessao.current ??= criarSessao({ configId });
    criacaoDaSessao.current.then((nova) => {
      if (!cancelado) setSessao(nova);
      // Liga a sessão ao convite (painel da vaga). Falhar não atrapalha a entrevista.
      if (convite && usarServidor()) {
        void fetch("/api/convites/sessao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ convite, sessionId: nova.sessao_id }),
        }).catch(() => {});
      }
    }).catch((erro) => console.warn("[sessão] não foi possível iniciar:", erro));
    return () => { cancelado = true; };
  }, [configId, convite]);

  // Linha do tempo da entrevista: vai ao servidor em lotes.
  useEffect(() => {
    if (!sessao) return;
    const linha = criarLinhaDoTempo({ enviar: (lote) => enviarEventos(sessao.sessao_id, lote) });
    linhaDoTempo.current = linha;
    return () => {
      linha.parar();
      void linha.descarregar().catch(() => {});
    };
  }, [sessao]);

  useEffect(() => {
    if (estado.fase !== "AGUARDANDO") registrar("fase", { fase: estado.fase });
  }, [estado.fase, registrar]);

  const finalizacaoEnviada = useRef(false);
  const finalizarNoServidor = useCallback(() => {
    if (!sessao || finalizacaoEnviada.current) return;
    finalizacaoEnviada.current = true;
    void finalizarSessao(sessao.sessao_id).catch((erro) => console.warn("[fim] não foi possível gerar o relatório:", erro));
  }, [sessao]);
  const prepararFinalizacao = useCallback(async () => {
    // Começa junto da despedida, sem esperar a voz. Preserva a captura final da #89/#102 antes do relatório.
    const final = capturaFinal.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (final) await Promise.race([final().catch(() => {}), new Promise<void>((resolver) => { timer = setTimeout(resolver, PRAZO_FOTO_FINAL_MS); })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    // O relatório é gerado com a linha do tempo que já chegou ao servidor: o envio final tem o mesmo prazo da foto,
    // e não o prazo curto usado entre análises (um lote leva mais de um segundo com o banco longe).
    await descarregarJa(PRAZO_FOTO_FINAL_MS);
    finalizarNoServidor();
  }, [descarregarJa, finalizarNoServidor]);
  useEffect(() => {
    // Sair no meio da foto/despedida não perde a finalização. O mesmo flag impede um segundo pedido depois.
    const aoSair = () => { if (encerrandoRef.current) finalizarNoServidor(); };
    window.addEventListener("pagehide", aoSair);
    return () => {
      // A sala desmonta ao abrir /obrigado. Se a preparação ainda não pediu o relatório (foto ou envio lentos), a
      // proteção continua valendo para quem fechar a janela já na página final.
      if (encerrandoRef.current && !finalizacaoEnviada.current) return;
      window.removeEventListener("pagehide", aoSair);
    };
  }, [finalizarNoServidor]);

  // Gatilho da análise.
  useEffect(() => {
    if (!quadro || !sessao) return;
    let ativo = true;
    const imagens = new WeakMap<PedidoAnalise, Promise<string | null>>();
    const miniaturas = new WeakMap<PedidoAnalise, Promise<string | null>>();
    let falaAoAnalisar = 0;
    let conversaAoAnalisar = 0;
    /**
     * Foto do quadro (estes elementos) que vai ao servidor e entra na linha do tempo como "desenho" com
     * `imagem_url`. É a foto que o relatório usa como prova e como desenho final.
     */
    const fotografar = (elementos: ReturnType<typeof quadro.api.getSceneElements>, grafo: string, mudancas: string, horario: string) => {
      const linha = linhaDoTempo.current;
      return (async () => {
        const estadoDaCaptura = quadro.api.getAppState();
        const arquivosDaCaptura = quadro.api.getFiles();
        const apiDaCaptura = {
          ...quadro.api,
          getSceneElements: () => elementos,
          getAppState: () => estadoDaCaptura,
          getFiles: () => arquivosDaCaptura,
        };
        const { imagemDoCandidato } = await import("@/lib/excalidraw/imagem");
        const png = await imagemDoCandidato(apiDaCaptura);
        if (!png) return null;
        if (!usarServidor()) {
          console.log("[desenho] PNG do candidato:", png.size, "bytes");
          return null;
        }
        const { enviarImagem } = await import("@/lib/sessao/servidor");
        const url = await enviarImagem(sessao.sessao_id, png, horario);
        const dados = { grafo, mudancas, imagem_url: url, horario };
        if (ativo && linha) {
          linha.registrar("desenho", dados);
          if (estadoAtual.current.fase === "ENCERRADA") void linha.descarregar().catch(() => {});
        } else {
          await enviarEventos(sessao.sessao_id, [{ horario, tipo: "desenho", dados }]);
        }
        return url;
      })().catch((erro) => {
        console.warn("[desenho] imagem indisponível:", erro);
        return null;
      });
    };
    // Fim da entrevista: o que ele desenhou depois da última análise (que só roda em pausa, com o Totti calado e
    // sem pergunta aberta) ficava sem foto e sem grafo, e o relatório mostrava um desenho velho. Aqui o quadro
    // como está no encerramento vira o último "desenho", com foto, independente das regras da análise.
    capturaFinal.current = async () => {
      const elementos = quadro.api.getSceneElements();
      const r = conversor.current.converter(elementos);
      const mudancas = descreverMudancas(ultimoInstantaneo.current, r.instantaneo);
      if (!mudancas && !houveMudancaRelevante(ultimoInstantaneo.current, r.instantaneo)) return;
      ultimoInstantaneo.current = r.instantaneo;
      registrar("desenho", { grafo: r.texto, mudancas });
      await fotografar(elementos, r.texto, mudancas, new Date().toISOString());
    };
    const g = criarGatilho({
      podeAnalisar: () => !encerrandoRef.current && podeAnalisar(estadoAtual.current) && !falaParcial.current
        && !agenteFalandoRef.current && !preparandoVozRef.current && pedidosEmAndamento.current === 0,
      montarPedido: (forcar) => {
        falaAoAnalisar = ultimaFalaEm.current;
        conversaAoAnalisar = revisaoDaConversa.current;
        const elementos = quadro.api.getSceneElements();
        const r = conversor.current.converter(elementos);
        if (!forcar && !houveMudancaRelevante(ultimoInstantaneo.current, r.instantaneo)) return null;
        const mudou = descreverMudancas(ultimoInstantaneo.current, r.instantaneo);
        // Peças que chegaram de uma vez: a análise fica sabendo até uma pergunta sair (princípio 17 do avaliador).
        const colou = colagem.current && Date.now() - colagem.current.em < COLAGEM_VALE_MS ? colagem.current : null;
        const mudancas = colou
          ? `${mudou}${mudou ? "\n" : ""}! COLAGEM: ${colou.pecas} peças entraram no quadro de uma só vez (desenho trazido pronto, não desenhado aqui) e ele ainda não explicou.`
          : mudou;
        ultimoInstantaneo.current = r.instantaneo;
        const pedido: PedidoAnalise = {
          sessao_id: sessao.sessao_id,
          fase: estadoAtual.current.fase,
          grafo: r.texto,
          mudancas,
          conversa_recente: conversa.current.slice(-6),
          perguntas_feitas: estadoAtual.current.perguntasFeitas,
          imagem_url: null,
          parado_ha_s: Math.round((Date.now() - ultimaAtividade.current) / 1000),
          requisitos: requisitosCombinados.current.slice(-30),
          gestos_recentes: resumirGestosRecentes(memoriaVisual.current),
        };
        console.log("[análise] pedido", pedido);
        if (mudancas) {
          registrar("desenho", { grafo: r.texto, mudancas });
          const imagem = fotografar(elementos, r.texto, mudancas, new Date().toISOString());
          imagens.set(pedido, imagem);
          if (usarServidor()) {
            miniaturas.set(pedido, (async () => {
              const { quadroDataUrl } = await import("@/lib/excalidraw/imagem");
              return quadroDataUrl({
                ...quadro.api,
                getSceneElements: () => elementos,
                getAppState: () => quadro.api.getAppState(),
                getFiles: () => quadro.api.getFiles(),
              });
            })().catch(() => null));
          }
        }
        return pedido;
      },
      analisar: async (pedido, sinal) => {
        const imagem = imagens.get(pedido);
        const comImagem = usarServidor() && imagem ? await pedidoComImagem(pedido, imagem, sinal, miniaturas.get(pedido)) : pedido;
        return analisar(comImagem, sinal);
      },
      aoResultado: (bruta) => {
        if (encerrandoRef.current) return;
        // IDs que não existem no quadro (o modelo inventou ou o candidato apagou) são ignorados.
        const resposta = { ...bruta, elementos: bruta.elementos.filter((c) => conversor.current.idReal(c)) };
        console.log("[análise] resposta", resposta);
        registrar("analise", resposta);
        // A pessoa continuou a explicação: uma intervenção calculada antes disso ficou velha.
        if (ultimaFalaEm.current > falaAoAnalisar || revisaoDaConversa.current !== conversaAoAnalisar
          || pedidosEmAndamento.current > 0) return;
        if (resposta.fechamento || estadoAtual.current.fechamento) {
          enviar({ tipo: "FECHAMENTO_ATUALIZADO", etapa: resposta.fechamento ?? null });
        }
        // A análise que sabia da colagem trouxe uma pergunta: a colagem já teve a vez dela.
        if (resposta.status !== "ok") colagem.current = null;
        enviar({ tipo: "ANALISE_RECEBIDA", resposta });
      },
      aoErro: (erro) => {
        console.warn("[análise] ignorada:", erro);
        // Fica na linha do tempo: sem isso, uma análise perdida (prazo, rede) não deixava rastro nenhum.
        registrar("analise_falhou", { motivo: erro instanceof Error ? erro.message.slice(0, 200) : "desconhecido" });
      },
    });
    gatilho.current = g;
    return () => {
      ativo = false;
      capturaFinal.current = null;
      g.parar();
    };
  }, [quadro, sessao, enviar, registrar]);

  // Tempo de cada fase. O APROFUNDAMENTO acaba no instante em que faltam 15% do tempo total (#129, decisão F), contado
  // do começo da entrevista: o reinício deste efeito não empurra o fim (msAteFimDaFase). O servidor usa a mesma conta
  // (duracaoEfetivaDaFaseS, lib/agente/sessao/estado.ts TICK).
  useEffect(() => {
    if (estado.fechamento || estado.fase === "FECHAMENTO" || encerrandoRef.current) return;
    const ms = msAteFimDaFase(estado.fase, Date.now(), {
      faseIniciadaEm: estado.faseIniciadaEm,
      iniciadaEm: estado.iniciadaEm ?? null,
      duracaoTotalS: (estado.duracaoMin ?? DURACAO_PADRAO_MIN) * 60,
      duracaoFaseS: sessao?.tempos[estado.fase],
    });
    if (ms === undefined) return;
    const t = setTimeout(() => { if (!encerrandoRef.current) enviar({ tipo: "TEMPO_DA_FASE_ACABOU" }); }, ms);
    return () => clearTimeout(t);
  }, [estado.fase, estado.fechamento, estado.faseIniciadaEm, estado.iniciadaEm, estado.duracaoMin, sessao, enviar]);

  // Apresentação: o agente fala e escreve o enunciado no quadro.
  useEffect(() => {
    if (estado.fase !== "APRESENTACAO" || !quadro || !sessao) return;
    let cancelado = false;
    (async () => {
      const { titulo, enunciado } = sessao.problema;
      // O que se ESCREVE no quadro é o enunciado; o que se FALA é a fala natural do desafio (ver falaDoDesafio.ts).
      const falaDoDesafio = `${montarFalaDoDesafio(sessao.problema)} Quando terminar uma etapa ou quiser um comentário sobre o desenho, é só me avisar.`;
      // Antes do desafio, o Totti se apresenta e diz quanto tempo dura, como funciona e que "não sei" é aceito.
      // A apresentação do cérebro já diz tudo isso (lib/agente/prompts/abertura.ts); o texto fixo só entra sem ela,
      // para ele não explicar duas vezes.
      const abertura = sessao.apresentacao || comoFuncionaQuadro(sessao.tempos);
      conversa.current.push({ quem: "agente", texto: abertura });
      await dizer(abertura);
      if (cancelado) return;
      conversa.current.push({ quem: "agente", texto: falaDoDesafio });
      const fala = dizer(falaDoDesafio);
      await quadro.agente.escrever({
        id: "agente-enunciado-titulo",
        grupo: "enunciado",
        texto: titulo,
        x: 40,
        y: 110,
        tamanho: 32,
        cor: COR_ENUNCIADO,
      });
      await quadro.agente.escrever({
        id: "agente-enunciado-texto",
        grupo: "enunciado",
        texto: enunciado,
        x: 40,
        y: 160,
        cor: COR_ENUNCIADO,
      });
      await fala;
      if (!cancelado) enviar({ tipo: "APRESENTACAO_TERMINOU" });
    })();
    return () => {
      cancelado = true;
    };
  }, [estado.fase, quadro, sessao, enviar, dizer]);

  // Pergunta ativa: a mão acompanha a palavra do primeiro alvo quando houver alinhamento.
  // Quando a resposta termina, o agente para (se ainda estiver desenhando) e apaga o que desenhou.
  const numeroPergunta = estado.perguntaAtiva?.numero ?? null;
  useEffect(() => {
    const p = estadoAtual.current.perguntaAtiva;
    if (numeroPergunta === null || !p || !quadro) return;
    const grupo = `pergunta:${numeroPergunta}`;
    // O gesto de uma resposta anterior (grupo conversa:N) não fica na tela durante a pergunta nova.
    limparVisualDaConversa();
    const alvos = p.elementos
      .map((curto) => conversor.current.idReal(curto))
      .filter((id): id is string => !!id);

    registrar("pergunta", { numero: numeroPergunta, pergunta: p.pergunta, nota: p.nota, elementos: p.elementos, status: p.status, escopo: p.escopo === true });
    void descarregarJa();
    const controle = new AbortController();
    let coreografia: Promise<void> | null = null;
    let versaoDestaPergunta = versaoDaFala.current;
    const desenhar = () => {
      if (controle.signal.aborted || coreografia) return;
      coreografia = apontarEAnotar({
        quadro,
        cursor: cursor.current,
        grupo,
        alvos,
        nota: p.nota ?? p.pergunta ?? "?",
        visual: mapearAcoesVisuais(p.visual, (id) => conversor.current.idReal(id)),
        memoria: memoriaVisual.current,
        semente: numeroPergunta * 7919,
        sinal: controle.signal,
      }).catch((erro) => console.warn("[mão do agente]", erro));
    };
    if (p.pergunta) {
      conversa.current.push({ quem: "agente", texto: p.pergunta });
      const alvo = ultimoInstantaneo.current?.componentes.find((c) => c.id === p.elementos[0]);
      void dizer(p.pergunta, [{ trecho: alvo?.nome ?? "", aoChegar: desenhar }], {
        origem: "pergunta", numeroPergunta,
        // Se esperou na fila, a versão da fala só é desta pergunta quando ela começa a tocar.
        aoTocar: () => { versaoDestaPergunta = versaoDaFala.current; },
      });
      versaoDestaPergunta = foiParaAFila.current ? -1 : versaoDaFala.current;
    } else desenhar();

    return () => {
      silenciarSeAtual(versaoDestaPergunta);
      controle.abort();
      void (coreografia ?? Promise.resolve()).then(() => quadro.agente.apagarGrupo(grupo));
    };
  }, [numeroPergunta, quadro, cursor, dizer, silenciarSeAtual, registrar, descarregarJa, limparVisualDaConversa]);

  // A entrevista é só por voz: uma pergunta do Totti não espera clique. Ela fica pendente até a vez dele
  // (candidato em pausa, nada tocando, nenhum pedido em andamento) e então é dita sozinha.
  useEffect(() => {
    if (estado.plin !== "PLIN_PENDENTE") return;
    const id = setInterval(() => {
      const agora = Date.now();
      const e = estadoAtual.current;
      // Política comum (lib/interrupcao/politica.ts): só numa pausa real (sem desenhar há 4 s e com uma brecha na
      // fala), ou numa pausa curta depois de um marco ou quando a pergunta já esperou demais (quem desenha sem
      // parar também é perguntado). Logo depois da mudança no problema, um respiro para ele absorvê-la.
      const esperandoHaMs = agora - (e.pendenteDesde ?? agora);
      const momento = motivoDoMomento({ maosParadasHaMs: agora - ultimoDesenhoEm.current, falaHaMs: agora - ultimaFalaEm.current,
        marco: marcoDoCliente(e, agora), esperandoHaMs,
        atrasada: interrupcaoAtrasada(ritmoDoCliente(e, agora)) });
      const respiroDaMudanca = agora - empecilhoAnunciadoEm.current >= RITMO.respiroMs;
      // Pediu licença e ele não respondeu: está concentrado, a pergunta espera e a licença não é pedida de novo logo.
      if (licencaPedidaEm.current !== null) {
        if (agora - licencaPedidaEm.current >= LICENCA_SEM_RESPOSTA_MS) {
          licencaPedidaEm.current = null;
          licencaDeNovoEm.current = agora + LICENCA_DE_NOVO_MS;
        }
        return;
      }
      if (!respiroDaMudanca || !podeTomarTurno({ agora, ultimaFalaEm: ultimaFalaEm.current,
        falaParcial: falaParcial.current, agenteFalando: agenteFalandoRef.current,
        aguardandoResposta: pedidosEmAndamento.current > 0 || preparandoVozRef.current })) return;
      // Não é só "quando ele parar de desenhar": a pausa das mãos que a pergunta exige cai conforme ela espera
      // (a mesma regra do live coding, lib/interrupcao/politica.ts). Com 4 s fixos, quem desenhava direto podia
      // passar a entrevista sem ouvir pergunta. Nunca no meio de uma fala.
      const maosParadasHaMs = agora - ultimoDesenhoEm.current;
      const pausaCurta = maosParadasHaMs >= pausaDasMaosParaFalarMs({ esperandoHaMs })
        && agora - ultimaFalaEm.current >= RITMO.brechaNaFalaMs;
      if (momento === null || pausaCurta) enviar({ tipo: "PLIN_CLICADO" });
    }, 150);
    return () => clearInterval(id);
  }, [estado.plin, estado.perguntaPendente, enviar, dizer]);

  // Mudança no problema (empecilho): no meio da entrevista, numa pausa do candidato, o agente traz UMA mudança
  // pronta do kit, fala e escreve no quadro como requisito novo. O servidor confere a hora e registra na linha do tempo.
  const [empecilho, setEmpecilho] = useState<{ requisito: string } | null>(null);
  const empecilhoEmAndamento = useRef(false);
  const empecilhoEncerrado = useRef(false);
  const ultimoPedidoEmpecilho = useRef(0);
  const [forcandoEmpecilho, setForcandoEmpecilho] = useState(false);
  const pedirMudanca = useCallback(async (forcar: boolean) => {
    if (!sessao || !quadro || empecilhoEmAndamento.current || empecilhoEncerrado.current) return;
    const fase = estadoAtual.current.fase;
    if (encerrandoRef.current || fase === "AGUARDANDO" || fase === "ENCERRADA" || estadoAtual.current.fechamento) return;
    empecilhoEmAndamento.current = true;
    ultimoPedidoEmpecilho.current = Date.now();
    if (forcar) setForcandoEmpecilho(true);
    try {
      const grafo = conversor.current.converter(quadro.api.getSceneElements()).texto.slice(0, 60_000);
      const r = await pedirEmpecilho(sessao.sessao_id, { fase, grafo, ...(forcar ? { forcar: true } : {}) });
      if (!r.empecilho) {
        if (r.motivo && MOTIVOS_DEFINITIVOS_EMPECILHO.includes(r.motivo)) empecilhoEncerrado.current = true;
        console.log("[empecilho] ainda não:", r.motivo);
        return;
      }
      empecilhoEncerrado.current = true;
      if (encerrandoRef.current || estadoAtual.current.fase === "ENCERRADA" || estadoAtual.current.fechamento) return;
      const { fala, requisito } = r.empecilho;
      empecilhoAnunciadoEm.current = Date.now();
      // O anúncio é fala do Totti: o silêncio do candidato conta a partir dela, não da atividade dele.
      ultimaFalaDoAgenteEm.current = Date.now();
      revisaoDaConversa.current++;
      conversa.current.push({ quem: "agente", texto: fala });
      if (!requisitosCombinados.current.includes(requisito)) requisitosCombinados.current.push(requisito);
      setMensagens((m) => [...m, { id: `empecilho-${++contadorDeMensagens.current}`, quem: "agente", texto: fala, horario: Date.now(), requisito }]);
      setEmpecilho({ requisito });
      void dizer(fala, undefined, { origem: "mudanca" });
    } catch (erro) {
      console.warn("[empecilho] não foi possível pedir a mudança:", erro);
    } finally {
      empecilhoEmAndamento.current = false;
      if (forcar) setForcandoEmpecilho(false);
    }
  }, [sessao, quadro, dizer]);
  /** Demonstração (fora de produção): traz a mudança agora, sem esperar a hora certa. */
  const forcarEmpecilho = useCallback(() => { void pedirMudanca(true); }, [pedirMudanca]);
  useEffect(() => {
    if (!usarServidor() || !sessao || !quadro) return;
    const id = setInterval(() => {
      if (empecilhoEncerrado.current || empecilhoEmAndamento.current) return;
      if (Date.now() - ultimoPedidoEmpecilho.current < INTERVALO_PEDIDO_EMPECILHO_MS) return;
      const e = estadoAtual.current;
      const agora = Date.now();
      // Garantia dos 60% do tempo total (decisão G, lib/sessao/empecilho.ts): depois dela a mudança sai com pausa
      // curta e sem pergunta ativa, sem exigir a fração da fase nem o quadro livre.
      const duracaoTotalS = (e.duracaoMin ?? DURACAO_PADRAO_MIN) * 60;
      const garantia = emGarantiaDoEmpecilho({ agora, iniciadaEm: e.iniciadaEm ?? null, duracaoTotalS });
      // Conclusão recente (decisão F) relaxa as mesmas pré-checagens que a garantia (ver relaxaPreChecagens).
      const relaxa = relaxaPreChecagens({ garantia, ultimaConclusaoEm: e.ultimaConclusaoEm, agora });
      // Sem cortar ninguém: pausa do candidato, agente quieto, nada pendente, nenhuma pergunta no ar.
      const parado = { maosParadasHaMs: agora - ultimoDesenhoEm.current, falaHaMs: agora - ultimaFalaEm.current };
      if (motivoDoMomento(relaxa ? { ...parado, marco: true } : parado) !== null) return;
      if ((relaxa ? e.plin === "PERGUNTA_ATIVA" : e.plin !== "LIVRE") || preparandoVozRef.current || !podeTomarTurno({ agora, ultimaFalaEm: ultimaFalaEm.current,
        falaParcial: falaParcial.current, agenteFalando: agenteFalandoRef.current,
        aguardandoResposta: pedidosEmAndamento.current > 0 })) return;
      // A fração da fase (esperaDoEmpecilho) usa a mesma duração efetiva do timer da fase (#129, decisão F).
      const duracaoDaFaseS = duracaoEfetivaDaFaseS(e.fase, { faseIniciadaEm: e.faseIniciadaEm, iniciadaEm: e.iniciadaEm ?? null, duracaoTotalS, duracaoFaseS: sessao.tempos[e.fase] });
      const base = { agora, fase: e.fase, faseIniciadaEm: e.faseIniciadaEm, duracaoDaFaseS,
        jaAnunciado: false, respondendoPergunta: false, ultimaFalaDoAgenteEm: ultimaFalaDoAgenteEm.current,
        iniciadaEm: e.iniciadaEm ?? null, duracaoTotalS, ultimaPerguntaEm: e.ultimaPerguntaEm ?? null,
        // Ele disse que terminou há pouco: a conclusão conta como brecha para a mudança (decisão F).
        conclusaoRecente: concluiuHaPouco(e.ultimaConclusaoEm, agora) };
      // O grafo só é montado quando o resto já permite (é a parte cara da conta).
      if (esperaDoEmpecilho({ ...base, componentes: Number.MAX_SAFE_INTEGER })) return;
      const componentes = contarComponentes(conversor.current.converter(quadro.api.getSceneElements()).texto);
      if (esperaDoEmpecilho({ ...base, componentes })) return;
      void pedirMudanca(false);
    }, 1000);
    return () => clearInterval(id);
  }, [sessao, quadro, pedirMudanca]);

  // Ao entrar no aprofundamento (por prontidão ou pelo tempo), analisa de novo na hora: é aqui que o plin é liberado.
  useEffect(() => {
    if (estado.fase !== "APROFUNDAMENTO") return;
    const t = setTimeout(() => gatilho.current?.dispararAgora(), 500);
    return () => clearTimeout(t);
  }, [estado.fase]);

  // O silêncio inicial conta a partir do começo de REQUISITOS (depois de o agente se apresentar e passar o desafio).
  useEffect(() => {
    if (estado.fase !== "REQUISITOS") return;
    ultimaAtividade.current = Date.now();
    ultimoDisparoParado.current = 0;
  }, [estado.fase]);

  // Silêncio total do candidato (sem desenhar nem falar): força uma análise, e o modelo decide se quebra o silêncio.
  // A regra está em lib/sessao/silencio.ts (deveForcarAnalise): depois de uma fala do Totti, espera SILENCIO_SEM_ACAO_S e
  // quebra uma vez por período de silêncio.
  const ultimoDisparoParado = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const e = estadoAtual.current;
      if (e.plin === "LIVRE" && deveForcarAnalise({
        agora: Date.now(),
        fase: e.fase,
        ultimaAtividade: ultimaAtividade.current,
        ultimaFalaDoAgente: ultimaFalaDoAgenteEm.current,
        pedidoDeTempoEm: pedidoDeTempoEm.current,
        ultimoDisparo: ultimoDisparoParado.current,
      })) {
        ultimoDisparoParado.current = Date.now();
        gatilho.current?.dispararAgora();
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // O desenho do candidato fica salvo no navegador: se a página recarregar, ele volta.
  const chaveDoDesenho = sessao ? `quadro:${sessao.sessao_id}` : null;
  useEffect(() => {
    if (!quadro || !chaveDoDesenho) return;
    try {
      const salvo = localStorage.getItem(chaveDoDesenho);
      const elementos = salvo ? JSON.parse(salvo) : null;
      if (Array.isArray(elementos) && elementos.length > 0 && quadro.api.getSceneElements().length === 0) {
        quadro.api.updateScene({ elements: elementos, captureUpdate: "NEVER" });
        quadro.api.scrollToContent(undefined, { fitToContent: false, animate: true });
      }
    } catch {
      // Desenho salvo inválido ou armazenamento bloqueado: segue com o quadro vazio.
    }
  }, [quadro, chaveDoDesenho]);

  const salvar = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Chamar quando o desenho do candidato mudar. */
  const desenhoMudou = useCallback(() => {
    if (encerrandoRef.current) return;
    ultimaAtividade.current = Date.now();
    ultimoDesenhoEm.current = Date.now();
    if (quadro) {
      const pecas = quadro.api.getSceneElements().filter((e) => e.customData?.autor !== "agente").length;
      // A primeira contagem é a base (o desenho salvo que volta ao recarregar a página não é colagem).
      if (pecasDoCandidato.current !== null && pecas - pecasDoCandidato.current >= PECAS_DE_UMA_COLAGEM) {
        colagem.current = { pecas: pecas - pecasDoCandidato.current, em: Date.now() };
      }
      pecasDoCandidato.current = pecas;
    }
    // Um risco solto não encerra os requisitos: precisa de pelo menos 2 elementos significativos.
    if (estadoAtual.current.fase !== "REQUISITOS" || (quadro && elementosSignificativos(quadro.api.getSceneElements()) >= 2)) {
      enviar({ tipo: "CANDIDATO_DESENHOU" });
    }
    gatilho.current?.mudou();
    if (salvar.current) clearTimeout(salvar.current);
    salvar.current = setTimeout(() => {
      if (!quadro || !chaveDoDesenho) return;
      try {
        const doCandidato = quadro.api.getSceneElements().filter((e) => e.customData?.autor !== "agente");
        localStorage.setItem(chaveDoDesenho, JSON.stringify(doCandidato));
      } catch {
        // Sem espaço ou armazenamento bloqueado: não salvar não atrapalha a entrevista.
      }
    }, 800);
  }, [enviar, quadro, chaveDoDesenho]);

  const [iniciadaEm, setIniciadaEm] = useState<number | null>(null);
  const comecar = useCallback(() => {
    setIniciadaEm(Date.now());
    // A duração escala o ritmo das perguntas (política comum): soma dos tempos das fases desta sessão.
    const somaS = Object.values(sessao?.tempos ?? {}).reduce<number>((s, t) => s + (t ?? 0), 0);
    enviar({ tipo: "COMECAR", ...(somaS > 0 ? { duracaoMin: somaS / 60 } : {}) });
  }, [enviar, sessao]);
  /** Demonstração: faz o agente ter uma dúvida agora, sobre o último componente desenhado. */
  const perguntaDemo = useCallback(() => {
    if (!quadro) return;
    const { texto } = conversor.current.converter(quadro.api.getSceneElements());
    enviar({ tipo: "PLIN_DEMO", resposta: duvidaDeDemonstracao(texto) });
  }, [enviar, quadro]);
  const terminarResposta = useCallback((texto?: unknown, reanalisar = true) => {
    registrar("resposta", { numero: estadoAtual.current.perguntaAtiva?.numero, quem: "candidato", ...(typeof texto === "string" && texto.trim() ? { texto: texto.trim() } : {}) });
    enviar({ tipo: "RESPOSTA_TERMINOU" });
    // A resposta pode mudar a avaliação: analisa de novo logo depois que o servidor souber dela.
    if (reanalisar) void descarregarJa().then(() => gatilho.current?.dispararAgora());
  }, [descarregarJa, enviar, registrar]);

  /**
   * O modelo escolheu escutar (`responder:false`) no meio da resposta a uma pergunta: se o candidato ficar
   * quieto por um tempo, a resposta acabou. Sem isso a pergunta ficava ativa para sempre e a análise e o
   * quebra-silêncio, bloqueados.
   */
  const fimDaRespostaCalada = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agendarFimDaResposta = useCallback((texto: string, limite = SILENCIO_FIM_DA_RESPOSTA_MS) => {
    if (fimDaRespostaCalada.current) clearTimeout(fimDaRespostaCalada.current);
    const conferir = () => {
      fimDaRespostaCalada.current = null;
      if (estadoAtual.current.plin !== "PERGUNTA_ATIVA") return;
      // O silêncio conta da última fala de qualquer um (depois de uma pergunta do Totti, ele precisa de tempo) e
      // também do desenho e da digitação: quem responde desenhando ainda está respondendo.
      const terminou = respostaTerminouPorSilencio({
        agora: Date.now(), ultimaFalaEm: ultimaFalaEm.current, ultimaFalaDoAgenteEm: ultimaFalaDoAgenteEm.current,
        ultimaAtividade: ultimaAtividade.current, limiteMs: limite, falaParcial: falaParcial.current,
        pedidosEmAndamento: pedidosEmAndamento.current, agenteFalando: agenteFalandoRef.current,
      });
      if (!terminou) {
        fimDaRespostaCalada.current = setTimeout(conferir, 1000);
        return;
      }
      terminarResposta(texto);
    };
    fimDaRespostaCalada.current = setTimeout(conferir, limite);
  }, [terminarResposta]);
  useEffect(() => () => { if (fimDaRespostaCalada.current) clearTimeout(fimDaRespostaCalada.current); }, []);

  /** O pedido falhou mesmo depois de tentar de novo: o agente pede para repetir, em vez de ficar calado. */
  const pedidosDeRepeticao = useRef(0);
  const pedirParaRepetir = useCallback(() => {
    const fase = estadoAtual.current.fase;
    if (fase === "AGUARDANDO" || fase === "ENCERRADA") return;
    const texto = FALAS_DE_REPETICAO[pedidosDeRepeticao.current++ % FALAS_DE_REPETICAO.length];
    conversa.current.push({ quem: "agente", texto });
    void dizer(texto, undefined, { origem: "iniciativa" });
  }, [dizer]);

  // Transcrição da conversa: as falas do candidato (a voz já transcrita) e as respostas do /perguntar.
  const [mensagens, setMensagens] = useState<MensagemConversa[]>([]);
  const contadorDeMensagens = useRef(0);
  /** A última fala do candidato e a resposta dela, enquanto a resposta não tocou (saem se forem substituídas). */
  const mensagensNaoOuvidas = useRef<string[]>([]);
  const versaoRespostaConversa = useRef(-1);
  const encerrarRef = useRef<(texto?: string) => void>(() => {});
  /**
   * Fala do candidato por texto. Com uma pergunta (plin) ativa, conta como a resposta a ela;
   * senão vai para o /perguntar e a resposta do agente é mostrada e falada.
   * Lança erro se o servidor falhar (nada é registrado, para o texto poder ser reenviado).
   * Devolve o requisito combinado, se houver, para quem escreve no quadro.
   */
  const enviarTexto = useCallback(
    async (bruto: string, opcoes: { sinal?: AbortSignal; substitui?: boolean } = {}): Promise<{ requisito: string | null }> => {
      const { sinal, substitui = false } = opcoes;
      const ciclo = cicloDaSala.current;
      const texto = limparTextoDigitado(bruto);
      const atual = estadoAtual.current;
      if (!texto || !sessao || encerrandoRef.current || atual.fase === "AGUARDANDO" || atual.fase === "ENCERRADA") return { requisito: null };
      // Resposta ao pedido de licença: "pode" faz a pergunta; "espera" (ou "agora não") deixa para depois.
      // "Pode encerrar" não responde à licença: segue para o /perguntar, que fecha a entrevista.
      if (licencaPedidaEm.current !== null && pedeParaEncerrar(texto)) {
        licencaPedidaEm.current = null;
        licencaDeNovoEm.current = Date.now() + LICENCA_DE_NOVO_MS;
      }
      if (licencaPedidaEm.current !== null) {
        licencaPedidaEm.current = null;
        registrar("fala", { quem: "candidato", texto });
        conversa.current.push({ quem: "candidato", texto });
        if (liberouAPergunta(texto) && atual.plin === "PLIN_PENDENTE") enviar({ tipo: "PLIN_CLICADO" });
        else licencaDeNovoEm.current = Date.now() + LICENCA_DE_NOVO_MS;
        return { requisito: null };
      }
      const nova = (quem: MensagemConversa["quem"], t: string): MensagemConversa => ({
        id: `texto-${++contadorDeMensagens.current}-${quem}`,
        quem,
        texto: t,
        horario: Date.now(),
      });
      ultimaAtividade.current = Date.now();
      revisaoDaConversa.current++;
      limparVisualDaConversa();
      enviar({ tipo: "CANDIDATO_CONTINUOU", texto });
      // A fala junta as partes da anterior, que ele continuou antes de ouvir a resposta: a anterior (e a resposta
      // que não tocou) saem do histórico. Ver lib/audio/filaFalas.ts.
      const marcarRespostaComoAtual = () => { versaoRespostaConversa.current = versaoDaFala.current; };
      if (substitui) {
        registrarDescartes(filaDoAgente.current.remover((i) => i.origem === "resposta", "substituida"));
        conversa.current = semFalaSubstituida(conversa.current, texto);
        const descartadas = mensagensNaoOuvidas.current;
        mensagensNaoOuvidas.current = [];
        if (descartadas.length) setMensagens((m) => m.filter((x) => !descartadas.includes(x.id)));
      }
      // A fala já entra na conversa que as análises recebem (uma análise pode rodar enquanto o /perguntar espera).
      const falaDoCandidato: FalaRecente = { quem: "candidato", texto };
      conversa.current.push(falaDoCandidato);
      const registrarFalaDoCandidato = () => {
        registrar("fala", { quem: "candidato", texto });
        return nova("candidato", texto);
      };

      let r: Awaited<ReturnType<typeof perguntar>>;
      pedidosEmAndamento.current++;
      setAguardandoResposta(true);
      try {
        const elementos = quadro?.api.getSceneElements();
        const convertido = elementos ? conversor.current.converter(elementos) : undefined;
        const grafo = convertido?.texto.slice(0, 24000);
        // Desenho parado desde a última foto: o grafo em texto já descreve o quadro. Foto e "o que mudou" (que só se
        // atualiza na análise e repetia o mesmo bloco a cada fala) ficam de fora; é a maior parte das falas.
        const desenho = elementos ? assinaturaDoDesenho(elementos) : null;
        const desenhoMudou = desenho !== desenhoDaUltimaFoto.current;
        const mudancas = convertido && desenhoMudou ? descreverMudancas(ultimoInstantaneo.current, convertido.instantaneo) : undefined;
        let imagem_base64: string | undefined;
        if (quadro && usarServidor() && desenhoMudou) {
          try {
            const { quadroDataUrl } = await import("@/lib/excalidraw/imagem");
            imagem_base64 = (await Promise.race([
              quadroDataUrl(quadro.api),
              new Promise<null>((resolver) => setTimeout(() => resolver(null), 600)),
            ])) ?? undefined;
          } catch {
            imagem_base64 = undefined;
          }
        }
        r = await perguntar(sessao.sessao_id, atual.fase, texto, montarContextoDaFala({
          grafo, mudancas: mudancas || undefined, imagem_base64: imagem_base64 || undefined,
          conversa: conversa.current,
          perguntaAtiva: atual.perguntaAtiva?.pergunta ?? undefined,
          requisitos: requisitosCombinados.current,
          gestos: resumirGestosRecentes(memoriaVisual.current),
          // Há quanto tempo ele não mexe no desenho: com "terminei" dito de mãos paradas, o servidor conta a
          // conclusão mesmo que o modelo não marque (lib/totti/turno.ts). Antes do primeiro traço não há o que informar.
          desenhoParadoHaS: desenhoParadoEm(ultimoDesenhoEm.current),
          substitui,
          cortada: perguntaCortada.current,
        }), sinal);
        perguntaCortada.current = false;
        if (r.pediuTempo) pedidoDeTempoEm.current = Date.now();
        if (sinal?.aborted) throw new DOMException("Substituída por uma fala nova.", "AbortError");
        // Só conta como enviada a foto que chegou ao Totti: sem ela (exportação lenta), a próxima fala tenta de novo.
        if (imagem_base64) desenhoDaUltimaFoto.current = desenho;
      } catch (erro) {
        // Não foi enviada: sai da conversa para o texto poder ser reenviado sem duplicar.
        const i = conversa.current.indexOf(falaDoCandidato);
        if (i >= 0) conversa.current.splice(i, 1);
        throw erro;
      } finally {
        pedidosEmAndamento.current--;
        setAguardandoResposta(pedidosEmAndamento.current > 0);
      }
      if (ciclo !== cicloDaSala.current || estadoAtual.current.fase === "ENCERRADA") return { requisito: null };
      const novas = [registrarFalaDoCandidato()];
      mensagensNaoOuvidas.current = [novas[0].id];
      if (r.fechamento || atual.fechamento) {
        enviar({ tipo: "FECHAMENTO_ATUALIZADO", etapa: r.fechamento ?? null });
      }
      // Ele pediu para encerrar a entrevista: o Totti se despede e fecha, como no botão.
      if (r.encerrar) {
        setMensagens((m) => [...m, ...novas]);
        encerrarRef.current(r.texto);
        return { requisito: null };
      }
      // A devolutiva vem do loop rápido, sem flush + nova análise antes de responder.
      // Com uma pergunta de continuação, a conversa segue no mesmo fio: a pergunta continua ativa, agora com a fala
      // nova, e a próxima resposta dele conta para ela ("não sei" ali também encerra o assunto).
      const seguiu = atual.plin === "PERGUNTA_ATIVA" && r.seguimento === true && r.responder && !!r.texto;
      if (seguiu) {
        enviar({ tipo: "SEGUIMENTO", pergunta: r.texto });
        agendarFimDaResposta(texto, SILENCIO_FIM_DO_SEGUIMENTO_MS);
      } else if (atual.plin === "PERGUNTA_ATIVA" && (r.responder || r.concluiu)) terminarResposta(texto, false);
      else if (atual.plin === "PERGUNTA_ATIVA") agendarFimDaResposta(texto);
      // O Totti respondeu com uma pergunta dele: a dúvida pendente cai (não emenda uma pergunta na outra). Se a
      // resposta foi só um fato ou uma reação, a pendente fica e sai na próxima brecha: antes ela era descartada, e
      // uma pergunta concreta sobre o desenho dava lugar a um "quer detalhar algo?".
      if (r.responder && r.texto.trim().endsWith("?")) enviar({ tipo: "AGENTE_RESPONDEU" });
      // Ele disse que terminou e já há uma pergunta pronta sobre o desenho: ela é a resposta, no lugar do aviso.
      const perguntaPronta = !r.fechamento && r.concluiu && !r.texto.trim().endsWith("?") && estadoAtual.current.plin === "PLIN_PENDENTE";
      if (perguntaPronta) {
        enviar({ tipo: "CANDIDATO_CONCLUIU" });
        enviar({ tipo: "PLIN_CLICADO" });
        setMensagens((m) => [...m, ...novas]);
        return { requisito: null };
      }
      if (r.responder && r.texto) {
        conversa.current.push({ quem: "agente", texto: r.texto });
        const alvos = [...new Set((mapearAcoesVisuais(r.visual, (id) => conversor.current.idReal(id)) ?? []).flatMap(alvosDaAcao))];
        novas.push({ ...nova("agente", r.texto), ...(alvos.length ? { alvos } : {}), ...(r.requisito ? { requisito: r.requisito } : {}) });
        if (quadro && r.visual?.length) {
          const atual = { quadro, grupo: `conversa:${contadorDeMensagens.current}`, controle: new AbortController(), tarefa: undefined as Promise<void> | undefined };
          visualDaConversa.current = atual;
          const desenhar = () => {
            if (atual.controle.signal.aborted || atual.tarefa) return;
            atual.tarefa = apontarEAnotar({ quadro, cursor: cursor.current, grupo: atual.grupo, alvos: [], nota: "",
              visual: mapearAcoesVisuais(r.visual, (id) => conversor.current.idReal(id)), memoria: memoriaVisual.current,
              semente: contadorDeMensagens.current * 7919, sinal: atual.controle.signal,
            }).catch((erro) => console.warn("[gesto da conversa]", erro));
          };
          void dizer(r.texto, [{ trecho: "", aoChegar: desenhar }], { origem: "resposta", aoTocar: marcarRespostaComoAtual });
        } else void dizer(r.texto, undefined, { origem: "resposta", aoTocar: marcarRespostaComoAtual });
        // Até começar a tocar, uma fala nova do candidato pode substituir esta resposta (lib/audio/filaFalas.ts).
        // Se ela esperou na fila, a versão só é dela quando começa a tocar (aoTocar); até lá a fila é que a retira.
        if (!foiParaAFila.current) marcarRespostaComoAtual();
        mensagensNaoOuvidas.current.push(novas[novas.length - 1].id);
      }
      setMensagens((m) => [...m, ...novas]);
      if (r.responder && r.requisito && !requisitosCombinados.current.includes(r.requisito)) {
        requisitosCombinados.current.push(r.requisito);
      }
      if (r.concluiu && !r.fechamento) {
        // "Pronto": no alto nível segue para o aprofundamento (que já reanalisa); nas outras fases só reanalisa.
        enviar({ tipo: "CANDIDATO_CONCLUIU" });
        if (atual.fase === "APROFUNDAMENTO" || atual.fase === "FECHAMENTO") {
          setTimeout(() => gatilho.current?.dispararAgora(), 0);
        }
      }
      // Resposta que não devolveu a vez: o Totti analisa o desenho logo depois, para seguir com a socrática.
      // Se ela já devolveu (pergunta ou convite), a bola está com o candidato: a análise espera a pausa dele.
      if (!r.fechamento && r.responder && deveAnalisarLogoAposResposta(r.texto, r.concluiu)) {
        setTimeout(() => gatilho.current?.dispararAgora(), 0);
      }
      return { requisito: r.responder ? r.requisito : null };
    },
    [sessao, quadro, cursor, registrar, dizer, registrarDescartes, terminarResposta, agendarFimDaResposta, enviar, limparVisualDaConversa],
  );
  /**
   * Resposta antecipada: o rascunho é o /perguntar que o envio final mandaria para este texto agora (mesma montagem,
   * `montarContextoDaFala`), sem a foto e sem marcar nada. Atribuído a cada render, como os outros `*Ref`.
   */
  const rascunharRef = useRef<(texto: string, sinal: AbortSignal) => Promise<void>>(async () => {});
  rascunharRef.current = (texto, sinal) => {
    if (!sessao) return Promise.resolve();
    const elementos = quadro?.api.getSceneElements();
    const convertido = elementos ? conversor.current.converter(elementos) : undefined;
    const desenhoMudou = (elementos ? assinaturaDoDesenho(elementos) : null) !== desenhoDaUltimaFoto.current;
    return rascunharPergunta(sessao.sessao_id, estadoAtual.current.fase, texto, montarContextoDaFala({
      grafo: convertido?.texto.slice(0, 24000),
      mudancas: convertido && desenhoMudou ? descreverMudancas(ultimoInstantaneo.current, convertido.instantaneo) || undefined : undefined,
      conversa: [...conversa.current, { quem: "candidato", texto }],
      perguntaAtiva: estadoAtual.current.perguntaAtiva?.pergunta ?? undefined,
      requisitos: requisitosCombinados.current,
      gestos: resumirGestosRecentes(memoriaVisual.current),
      desenhoParadoHaS: desenhoParadoEm(ultimoDesenhoEm.current),
      substitui: false,
      cortada: perguntaCortada.current,
    }), sinal);
  };

  /** A resposta do Totti à última fala ainda não começou a tocar (sendo sintetizada ou esperando a vez). */
  const respostaNaoOuvida = useCallback(
    () => preparandoVozRef.current && !agenteFalandoRef.current && versaoDaFala.current === versaoRespostaConversa.current,
    [],
  );
  const descartarRespostaNaoOuvida = useCallback(() => {
    // A resposta que ainda espera a fala atual terminar também é "não ouvida": sai da fila.
    registrarDescartes(filaDoAgente.current.remover((i) => i.origem === "resposta", "substituida"));
    if (respostaNaoOuvida()) silenciar();
  }, [respostaNaoOuvida, silenciar, registrarDescartes]);
  // Um pedido de rascunho por sessão (só com servidor). Sair da sessão cancela o que estiver em curso.
  const pedidoDeRascunho = useRef<PedidoDeRascunho | null>(null);
  useEffect(() => {
    if (!sessao || !usarServidor()) return;
    const pedido = criarPedidoDeRascunho((texto, sinal) => rascunharRef.current(texto, sinal));
    pedidoDeRascunho.current = pedido;
    return () => {
      pedido.cancelar();
      if (pedidoDeRascunho.current === pedido) pedidoDeRascunho.current = null;
    };
  }, [sessao]);
  /**
   * O candidato falou um trecho confirmado e a vez é dele (o Totti não fala, não prepara a voz nem espera resposta):
   * pede o rascunho com o texto que o envio final mandaria agora. `bruto`: a fala acumulada, como vai para `enviarTexto`.
   */
  const pedirRascunho = useCallback((bruto: string) => {
    const texto = limparTextoDigitado(bruto);
    const atual = estadoAtual.current;
    if (!texto || !sessao || encerrandoRef.current || atual.fase === "AGUARDANDO" || atual.fase === "ENCERRADA") return;
    if (licencaPedidaEm.current !== null || agenteFalandoRef.current || preparandoVozRef.current || pedidosEmAndamento.current > 0) return;
    pedidoDeRascunho.current?.pedir(texto);
  }, [sessao]);

  const registrarFalaParcial = useCallback((texto: string) => {
    falaParcial.current = !!texto.trim();
    if (texto.trim()) {
      limparVisualDaConversa();
      enviar({ tipo: "CANDIDATO_CONTINUOU" });
      ultimaFalaEm.current = Date.now();
      ultimaAtividade.current = Date.now();
    }
  }, [enviar, limparVisualDaConversa]);
  const registrarSom = useCallback(() => {
    if (agenteFalandoRef.current) return;
    ultimaFalaEm.current = Date.now();
    ultimaAtividade.current = Date.now();
  }, []);
  const despedir = useRef<ReturnType<typeof criarDespedida> | null>(null);
  const encerrar = useCallback((texto?: string) => {
    if (!sessao) return;
    despedir.current ??= criarDespedida({
      bloquear: (fala) => {
        encerrandoRef.current = true;
        setDespedida(fala);
        cicloDaSala.current++;
        silenciar();
        gatilho.current?.parar();
        conversa.current.push({ quem: "agente", texto: fala });
        registrar("fala", { quem: "agente", texto: fala });
      },
      finalizar: prepararFinalizacao,
      falar: async (fala) => { await dizer(fala, undefined, { despedida: true }); },
      pararVoz: silenciar,
      concluir: () => {
        enviar({ tipo: "ENCERRAR" });
        try { if (chaveDoDesenho) localStorage.removeItem(chaveDoDesenho); } catch {}
      },
      aoErro: (erro) => console.warn("[despedida]", erro),
    });
    void despedir.current(texto?.trim() || DESPEDIDAS[0]);
  }, [sessao, enviar, silenciar, chaveDoDesenho, registrar, prepararFinalizacao, dizer]);
  encerrarRef.current = encerrar;

  useEffect(() => {
    if (!estado.iniciadaEm || !estado.duracaoMin) return;
    const restante = estado.iniciadaEm + estado.duracaoMin * 60_000 - Date.now();
    const timer = setTimeout(() => encerrarRef.current(), Math.max(0, restante));
    return () => clearTimeout(timer);
  }, [estado.iniciadaEm, estado.duracaoMin]);

  // O tempo restante é da entrevista inteira, não do relógio da fase (que pode ter começado cedo após "terminei").
  const pedindoFechamento = useRef(false);
  useEffect(() => {
    if (!sessao || !iniciadaEm || !usarServidor()) return;
    const duracaoMs = Object.values(sessao.tempos).reduce<number>((s, t) => s + (t ?? 0), 0) * 1000;
    // O mesmo limiar do servidor (decisão F): uma fração da duração da vaga (lib/totti/fechamento.ts).
    const limiarMs = limiarDoFechamentoNoQuadro(duracaoMs);
    let ultimaTentativa = 0;
    const timer = setInterval(() => {
      const e = estadoAtual.current;
      if (encerrandoRef.current || e.fase === "ENCERRADA" || e.fechamento || e.plin !== "LIVRE" || pedindoFechamento.current) return;
      const agora = Date.now();
      if (duracaoMs - (agora - iniciadaEm) > limiarMs || agora - ultimaTentativa < 5000) return;
      if (!podeTomarTurno({ agora, ultimaFalaEm: ultimaFalaEm.current, falaParcial: falaParcial.current,
        agenteFalando: agenteFalandoRef.current, aguardandoResposta: pedidosEmAndamento.current > 0 || preparandoVozRef.current })) return;
      pedindoFechamento.current = true;
      ultimaTentativa = agora;
      const revisao = revisaoDaConversa.current;
      const grafo = quadro ? conversor.current.converter(quadro.api.getSceneElements()).texto.slice(0, 24000) : undefined;
      void pedirFechamento(sessao.sessao_id, { fase: e.fase, grafo, gatilho: "tempo" }).then((r) => {
        if (encerrandoRef.current || estadoAtual.current.fase === "ENCERRADA" || revisao !== revisaoDaConversa.current) return;
        if (r.fechamento) enviar({ tipo: "FECHAMENTO_ATUALIZADO", etapa: r.fechamento });
        if (r.encerrar) { encerrarRef.current(r.texto); return; }
        if (r.responder && r.texto) {
          conversa.current.push({ quem: "agente", texto: r.texto });
          setMensagens((m) => [...m, { id: `tempo-${++contadorDeMensagens.current}`, quem: "agente", texto: r.texto, horario: Date.now() }]);
          void dizer(r.texto, undefined, { origem: "resposta" });
        }
      }).catch((erro) => console.warn("[fechamento] não foi possível iniciar:", erro))
        .finally(() => { pedindoFechamento.current = false; });
    }, 1000);
    return () => clearInterval(timer);
  }, [sessao, iniciadaEm, quadro, dizer, enviar]);

  return {
    sessao,
    estado,
    iniciadaEm,
    falaAtual,
    despedindo: despedida !== null,
    despedida,
    agenteFalando,
    aguardandoResposta: aguardandoResposta || preparandoVoz,
    registrarFalaParcial,
    registrarSom,
    vozHabilitada,
    alternarVoz,
    silenciar,
    interromper,
    desenhoMudou,
    comecar,
    perguntaDemo,
    terminarResposta,
    mensagens,
    enviarTexto,
    pedirRascunho,
    respostaNaoOuvida,
    descartarRespostaNaoOuvida,
    pedirParaRepetir,
    encerrar,
    empecilho,
    forcarEmpecilho,
    forcandoEmpecilho,
  };
}
