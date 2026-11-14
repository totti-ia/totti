/**
 * A conversa do live coding: uma só, por voz, do começo ao fim da entrevista (como no quadro).
 *
 * - O candidato fala a qualquer momento; cada fala vai ao entrevistador, que decide pela intenção se responde
 *   ou só ouve (pensando em voz alta). Falas que chegam antes de ele ouvir a resposta da anterior se juntam a ela
 *   (lib/audio/filaFalas.ts): o Totti nunca começa uma resposta e troca por outra.
 * - As perguntas do Totti (da análise do código: lib/agents/policy.ts) abrem um FIO: a pergunta é falada numa
 *   pausa e as respostas seguintes vão para ela, até o entrevistador fechar o assunto. Não há balão nem barra:
 *   o fio é só o assunto em andamento.
 * - Uma fala do Totti por vez: nenhuma corta a outra. O grifo de uma fala sai antes da próxima e quando o
 *   assunto fecha.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FilaFalas } from "@/lib/audio/filaFalas";
import { FALAS_DE_REPETICAO } from "@/lib/conversa/falasDeReserva";
import type { Blip, ChatMessage, ChatResponse, EditorCommand } from "@/lib/contracts";
import { postChat } from "./api";
import { falaInterrompida } from "@/lib/totti/interrupcao";
import type { EventInput } from "./useSession";
import { disseQueTerminou } from "@/lib/agents/conclusao";

/** Fala na conversa: a mensagem do contrato mais o horário em que aconteceu (Date.now()). */
export type Fala = ChatMessage & { at: number };

/** Falas fora das perguntas do Totti que vão como contexto para o entrevistador (as mais recentes). */
const MAX_FALAS_LIVRES = 12;
/** Fora de uma pergunta, frases com menos palavras que isso não entram na linha do tempo (o Totti ainda ouve). */
const MIN_PALAVRAS_FALA = 2;
/** Falhou duas vezes ao mandar a fala: o Totti pede para repetir em vez de ficar calado. */
const PEDIDOS_DE_REPETICAO = FALAS_DE_REPETICAO;

export interface ConversaDeps {
  sessionId: string | null;
  sendEvent: (input: EventInput) => Promise<void>;
  applyCommands: (commands: EditorCommand[]) => void;
  /** Sintetiza e toca a fala na vez do Totti. true se tocou até o fim. */
  falar: (texto: string) => Promise<boolean>;
  /** Cala a voz (sem efeito se não há fala). */
  parar: () => void;
  /** A voz já começou a tocar: o candidato está ouvindo a resposta. */
  vozTocando: () => boolean;
  /** Código e linguagem de agora: vão junto de cada turno para o Totti nunca comentar versão velha. */
  getLiveCode?: () => { code: string; language: string };
  /** O candidato pediu, falando, para encerrar a entrevista. */
  onFinishRequest?: () => void;
  onDespedida?: (texto: string) => void;
  /** Uma pergunta do Totti terminou (o assunto fechou). */
  onFioFechado?: (blip: Blip) => void;
  /** A fala não saiu em voz (desligada ou bloqueada pelo navegador): vai para a legenda. */
  onSemVoz?: (texto: string) => void;
  /** O candidato está falando agora (transcrição parcial aberta): a pergunta do Totti não fecha por silêncio. */
  falandoAgora?: () => boolean;
}

/**
 * O "uhum" do Totti assim que o candidato termina de falar, enquanto a resposta é preparada: ele sabe na hora que foi
 * ouvido (a resposta de verdade leva alguns segundos). Curtos para o áudio ficar guardado (lib/voz/cliente.ts).
 */
export const RECONHECIMENTOS = ["Uhum, entendi.", "Legal, hmm.", "Hum, certo.", "Uhum, saquei.", "Tá, entendi."];
/** Falas mais curtas que isso ("tá", "ok") já são um reconhecimento: o Totti não responde com outro. */
const MIN_PALAVRAS_RECONHECER = 4;
/**
 * No máximo um "uhum" nesse intervalo, e nem sempre (CHANCE_DE_RECONHECER): um a cada fala ficava "entendi,
 * entendi, entendi". A resposta que vem depois dele não abre com outro (o servidor tira, ver /api/chat).
 */
const ENTRE_RECONHECIMENTOS_MS = 30_000;
const CHANCE_DE_RECONHECER = 0.5;

/** Sem resposta à pergunta do Totti por tanto tempo (depois de ele terminar de perguntar): o assunto fecha. */
const FIO_SEM_RESPOSTA_MS = 35_000;

type Fio = { blip: Blip; falas: Fala[] };
type Pendente = { versao: number; lista: Fala[]; fala: Fala };

const palavras = (texto: string) => texto.split(/\s+/).filter(Boolean).length;

function tirarUltimaDoCandidato(lista: Fala[]): void {
  const i = lista.findLastIndex((f) => f.role === "candidate");
  if (i >= 0) lista.splice(i);
}

export function useConversa(deps: ConversaDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [fio, setFio] = useState<Blip | null>(null);
  const [pensando, setPensando] = useState(false);

  const fioRef = useRef<Fio | null>(null);
  const livresRef = useRef<Fala[]>([]);
  /** Abertura de uma pergunta em andamento: a fala do candidato espera a pergunta sair antes de ir. */
  const aberturaRef = useRef<Promise<void> | null>(null);
  /** Cada fala do Totti ganha uma versão; uma fala descartada ou trocada deixa de valer. */
  const versaoRef = useRef(0);
  const pendenteRef = useRef<Pendente | null>(null);
  const ultimaFalaDoAgenteEmRef = useRef(0);
  const pedidosEmVooRef = useRef(0);
  const repeticoesRef = useRef(0);
  /** A pergunta do fio já foi feita e ele ainda não respondeu: desde quando. */
  const semRespostaDesdeRef = useRef<number | null>(null);
  const reconheceuEmRef = useRef(0);
  /** A próxima fala que vai ao entrevistador veio depois de um "uhum": a resposta não abre com outro. */
  const reconheceuRef = useRef(false);
  const reconhecimentosRef = useRef(0);
  /** A fala do Totti que está tocando agora, e a lista em que ela está: é a que uma interrupção corta. */
  const tocandoRef = useRef<{ fala: Fala; lista: Fala[] } | null>(null);
  /** Falas que o candidato cortou (#97): no histórico ficam só até onde ele ouviu. */
  const cortadasRef = useRef(new WeakSet<Fala>());
  /** A pergunta do assunto aberto foi cortada: a próxima resposta dele não fecha o assunto. */
  const perguntaCortadaRef = useRef(false);

  const listaAtual = () => fioRef.current?.falas ?? livresRef.current;
  const aparar = () => {
    if (livresRef.current.length > MAX_FALAS_LIVRES) livresRef.current.splice(0, livresRef.current.length - MAX_FALAS_LIVRES);
  };
  const comecarPedido = () => {
    pedidosEmVooRef.current++;
    setPensando(true);
  };
  const terminarPedido = () => {
    pedidosEmVooRef.current = Math.max(0, pedidosEmVooRef.current - 1);
    setPensando(pedidosEmVooRef.current > 0);
  };

  const fecharFio = useCallback((reason: "agent" | "button", porSilencio = false) => {
    const atual = fioRef.current;
    if (!atual) return;
    fioRef.current = null;
    // Fechou porque ele demorou a responder: se a resposta vier agora, como fala livre, ela ainda tem a pergunta junto.
    if (porSilencio) {
      livresRef.current.push(...atual.falas);
      aparar();
    }
    semRespostaDesdeRef.current = null;
    setFio(null);
    void depsRef.current.sendEvent({ type: "blip_closed", blipId: atual.blip.id, reason });
    depsRef.current.applyCommands([{ type: "clear_highlights" }]);
    depsRef.current.onFioFechado?.(atual.blip);
  }, []);

  /**
   * Fala do Totti, uma por vez. O grifo da fala anterior sai antes; o desta fica enquanto o assunto está aberto
   * e sai quando ele fecha. A linha do tempo só recebe a fala que foi dita (uma descartada antes de tocar não vale).
   */
  const responder = useCallback(async (res: Pick<ChatResponse, "reply" | "commands" | "end" | "fechamento" | "despedida">, lista: Fala[], blip: Blip | undefined) => {
    const d = depsRef.current;
    if (res.despedida) { d.onDespedida?.(res.reply); return; }
    const fala: Fala = { role: "agent", text: res.reply, at: Date.now() };
    lista.push(fala);
    if (lista === livresRef.current) aparar();
    const versao = ++versaoRef.current;
    pendenteRef.current = { versao, lista, fala };
    d.applyCommands([{ type: "clear_highlights" }, ...res.commands.filter((c) => c.type !== "clear_highlights")]);
    tocandoRef.current = { fala, lista };
    const tocou = await d.falar(res.reply);
    if (tocandoRef.current?.fala === fala) tocandoRef.current = null;
    if (pendenteRef.current?.versao === versao) pendenteRef.current = null;
    if (versaoRef.current !== versao) return;
    ultimaFalaDoAgenteEmRef.current = Date.now();
    const cortada = cortadasRef.current.has(fala);
    // Cortada: a linha do tempo recebe o que ele ouviu (nada, se não ouviu palavra nenhuma), e não vai para a legenda.
    if (!cortada || lista.includes(fala)) void d.sendEvent({ type: "speech", role: "agent", text: fala.text, blipId: blip?.id });
    if (!tocou && !cortada) d.onSemVoz?.(res.reply);
    // Pergunta feita dentro de um assunto: se ele não responder, o assunto fecha sozinho (ver FIO_SEM_RESPOSTA_MS).
    if (res.fechamento || (!res.end && blip && fioRef.current?.blip.id === blip.id)) semRespostaDesdeRef.current = Date.now();
    if (res.fechamento || !res.end) return;
    if (blip && fioRef.current?.blip.id === blip.id) fecharFio("agent");
    else d.applyCommands([{ type: "clear_highlights" }]);
  }, [fecharFio]);

  /** Uma fala do candidato (já sem as pausas: ver PAUSA_FIM_DA_FALA_MS) indo ao entrevistador. */
  const enviar = useCallback(async (texto: string, sinal: AbortSignal, { substitui }: { substitui: boolean }) => {
    const d = depsRef.current;
    if (d.sessionId === null) return;
    if (aberturaRef.current) await aberturaRef.current;
    semRespostaDesdeRef.current = null;
    const lista = listaAtual();
    if (substitui) tirarUltimaDoCandidato(lista);
    const fala: Fala = { role: "candidate", text: texto, at: Date.now() };
    lista.push(fala);
    const blip = fioRef.current?.blip;
    const reconheceu = reconheceuRef.current;
    reconheceuRef.current = false;
    let res: ChatResponse;
    comecarPedido();
    try {
      const live = d.getLiveCode?.();
      res = await postChat({
        sessionId: d.sessionId,
        ...(live ? { code: live.code, language: live.language } : {}),
        blipId: blip?.id,
        messages: lista.map(({ role, text }) => ({ role, text })),
        ...(reconheceu ? { reconheceu } : {}),
      }, sinal);
      if (sinal.aborted) throw new DOMException("Substituída por uma fala nova.", "AbortError");
    } catch (erro) {
      const i = lista.indexOf(fala);
      if (i >= 0) lista.splice(i, 1);
      throw erro;
    } finally {
      terminarPedido();
    }
    repeticoesRef.current = 0;
    // Um "terminei" solto também vai para a linha do tempo: o segundo, noutra conversa, precisa saber do primeiro.
    if (blip || palavras(texto) >= MIN_PALAVRAS_FALA || disseQueTerminou(texto)) void d.sendEvent({ type: "speech", role: "candidate", text: texto, blipId: blip?.id });
    if (lista === livresRef.current) aparar();
    if (res.despedida) {
      d.onDespedida?.(res.reply);
      return;
    }
    if (res.listening || !res.reply.trim()) {
      // Ele falou e o Totti ficou calado (pediu tempo, pensou alto): a pergunta segue aberta e o relógio dela recomeça,
      // senão o assunto ficava sem relógio e nunca fechava sozinho (#130, item 7).
      if (blip && fioRef.current?.blip.id === blip.id) semRespostaDesdeRef.current = Date.now();
      return;
    }
    // A pergunta foi cortada no meio: o que ele disse agora não é a resposta a ela, e o assunto segue aberto.
    const perguntaCortada = perguntaCortadaRef.current && !!blip && fioRef.current?.blip.id === blip.id;
    perguntaCortadaRef.current = false;
    // A resposta toca sem segurar a fila: se ele voltar a falar antes de ela começar, a fila a substitui.
    void responder(perguntaCortada && res.end && !res.fechamento ? { ...res, end: false } : res, lista, blip);
  }, [responder]);

  /** Fala que não é resposta a nada (apresentação, despedida, pedido para repetir): entra na conversa e é dita. */
  const dizer = useCallback(async (texto: string): Promise<boolean> => {
    const d = depsRef.current;
    const fala: Fala = { role: "agent", text: texto, at: Date.now() };
    listaAtual().push(fala);
    aparar();
    void d.sendEvent({ type: "speech", role: "agent", text: texto, blipId: fioRef.current?.blip.id });
    const versao = ++versaoRef.current;
    pendenteRef.current = null;
    const lista = listaAtual();
    tocandoRef.current = { fala, lista };
    const tocou = await d.falar(texto);
    if (tocandoRef.current?.fala === fala) tocandoRef.current = null;
    if (versaoRef.current === versao) ultimaFalaDoAgenteEmRef.current = Date.now();
    if (!tocou && versaoRef.current === versao && !cortadasRef.current.has(fala)) d.onSemVoz?.(texto);
    return tocou;
  }, []);

  const filaRef = useRef<FilaFalas | null>(null);
  if (!filaRef.current) {
    filaRef.current = new FilaFalas(
      (texto, sinal, opcoes) => enviarRef.current(texto, sinal, opcoes),
      () => void dizerRef.current(PEDIDOS_DE_REPETICAO[repeticoesRef.current++ % PEDIDOS_DE_REPETICAO.length]),
      {
        respostaNaoOuvida: () => pendenteRef.current !== null && !depsRef.current.vozTocando(),
        descartarResposta: () => {
          const p = pendenteRef.current;
          if (!p) return;
          pendenteRef.current = null;
          versaoRef.current++;
          depsRef.current.parar();
          const i = p.lista.indexOf(p.fala);
          if (i >= 0) p.lista.splice(i, 1);
        },
      },
    );
  }
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;
  const dizerRef = useRef(dizer);
  dizerRef.current = dizer;

  useEffect(() => () => {
    filaRef.current?.limpar();
    versaoRef.current++;
    depsRef.current.parar();
  }, []);

  /** Fala do candidato: vai para a pergunta em andamento, ou é uma fala livre. */
  const ouvir = useCallback((texto: string) => {
    reconhecer(texto);
    filaRef.current?.adicionar(texto);
  }, []);

  /**
   * O "uhum" logo que ele termina de responder a uma pergunta do Totti. Só dentro de uma pergunta em aberto: fora
   * dela o microfone pega quem pensa em voz alta, resmunga ou fala com outra pessoa, e o Totti respondia "uhum,
   * entendi" a um sussurro. Se a fala livre era mesmo com ele, quem responde é o entrevistador.
   */
  const reconhecer = (texto: string) => {
    const n = palavras(texto);
    const agora = Date.now();
    if (fioRef.current === null || n < MIN_PALAVRAS_RECONHECER) return;
    if (agora - reconheceuEmRef.current < ENTRE_RECONHECIMENTOS_MS || depsRef.current.vozTocando()) return;
    if (Math.random() >= CHANCE_DE_RECONHECER) return;
    reconheceuEmRef.current = agora;
    reconheceuRef.current = true;
    void depsRef.current.falar(RECONHECIMENTOS[reconhecimentosRef.current++ % RECONHECIMENTOS.length]);
  };

  // Relógio da conversa: pergunta sem resposta não fica pendurada para sempre.
  useEffect(() => {
    const id = setInterval(() => {
      const agora = Date.now();
      const desde = semRespostaDesdeRef.current;
      // Falando agora (a resposta está saindo): o relógio recomeça.
      if (desde !== null && depsRef.current.falandoAgora?.()) semRespostaDesdeRef.current = agora;
      else if (desde !== null && agora - desde >= FIO_SEM_RESPOSTA_MS && pedidosEmVooRef.current === 0 && !filaRef.current?.emAndamento) {
        semRespostaDesdeRef.current = null;
        fecharFio("agent", true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [fecharFio]);

  /** O Totti faz uma pergunta sua (da análise, uma mudança no problema, o encerramento): abre o assunto e fala. */
  const abrirFio = useCallback(async (blip: Blip): Promise<void> => {
    const d = depsRef.current;
    if (d.sessionId === null || fioRef.current) return;
    const atual: Fio = { blip, falas: [] };
    fioRef.current = atual;
    setFio(blip);
    void d.sendEvent({ type: "blip_opened", blipId: blip.id });
    const abertura = (async () => {
      comecarPedido();
      let res: ChatResponse;
      try {
        const live = d.getLiveCode?.();
        res = await postChat({ sessionId: d.sessionId!, ...(live ? { code: live.code, language: live.language } : {}), blipId: blip.id, messages: [] });
      } catch (erro) {
        console.error("POST /api/chat (abertura) falhou", erro);
        if (fioRef.current === atual) fecharFio("agent");
        return;
      } finally {
        terminarPedido();
      }
      if (fioRef.current !== atual) return;
      if (!res.reply.trim()) {
        fecharFio("agent");
        return;
      }
      void responder({ ...res, end: false }, atual.falas, blip);
    })();
    aberturaRef.current = abertura;
    try {
      await abertura;
    } finally {
      if (aberturaRef.current === abertura) aberturaRef.current = null;
    }
  }, [fecharFio, responder]);

  /** Há algo em andamento na conversa: fala esperando, pedido em voo ou resposta não ouvida. */
  const ocupada = useCallback(
    () => pedidosEmVooRef.current > 0 || !!filaRef.current?.emAndamento || pendenteRef.current !== null || aberturaRef.current !== null,
    [],
  );

  /**
   * O Totti fez a pergunta do assunto aberto e só espera a resposta: nada em voo, ninguém falando. Uma pergunta que
   * passa na frente (a da colagem) pode fechar esse assunto.
   */
  const soEsperandoResposta = useCallback(
    () => fioRef.current !== null && semRespostaDesdeRef.current !== null && pedidosEmVooRef.current === 0
      && !filaRef.current?.emAndamento && pendenteRef.current === null && !depsRef.current.falandoAgora?.(),
    [],
  );

  /**
   * O candidato cortou o Totti (#97): a voz para, e a fala que tocava fica no histórico só até onde ele ouviu
   * (`ate`: caracteres já falados), marcada como cortada. Uma pergunta do assunto aberto cortada continua pendente.
   */
  const interromper = useCallback((ate: number) => {
    const tocando = tocandoRef.current;
    tocandoRef.current = null;
    if (tocando) {
      const { fala, lista } = tocando;
      const ouvido = falaInterrompida(fala.text, ate);
      if (ouvido !== fala.text) {
        cortadasRef.current.add(fala);
        if (fioRef.current?.falas === lista && fala.text.includes("?")) perguntaCortadaRef.current = true;
        if (ouvido === null) {
          const i = lista.indexOf(fala);
          if (i >= 0) lista.splice(i, 1);
        } else fala.text = ouvido;
      }
    }
    depsRef.current.parar();
  }, []);

  /** Encerrou a entrevista: nada mais vai ao entrevistador. */
  const parar = useCallback(() => {
    filaRef.current?.limpar();
    versaoRef.current++;
    pendenteRef.current = null;
    semRespostaDesdeRef.current = null;
  }, []);

  return { fio, pensando, ouvir, abrirFio, fecharFio, dizer, ocupada, soEsperandoResposta, parar, interromper, ultimaFalaDoAgenteEmRef, fioRef };
}
