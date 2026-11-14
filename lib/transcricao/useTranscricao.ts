"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { iniciarNavegador, reconhecimentoDisponivel } from "./navegador";
import { erroMicrofone, type EstadoTranscricao, type EventosTranscricao, type SessaoTranscricao } from "./tipos";
import { focoAudio } from "../audio/foco";
import { criarMedidorUsoTranscricao } from "./uso";
import { iniciarCapturaAntecipada, type CapturaAntecipada } from "./capturaAntecipada";
import { ErroTokenTranscricao } from "../presenca/tokenTranscricao";

type CapturaAtual = {
  controlador: AbortController; sessao?: SessaoTranscricao; antecipada?: CapturaAntecipada; liberar?: () => void;
  medidor?: ReturnType<typeof criarMedidorUsoTranscricao>;
};

/**
 * Último provedor que o servidor indicou. Enquanto não for "navegador", o microfone começa a capturar no clique,
 * em paralelo ao pedido do token: o reconhecimento do navegador abre o próprio microfone e não usa esse áudio.
 */
let ultimoProvedor: "elevenlabs" | "navegador" | null = null;

/** Pedido da sessão de transcrição: o primeiro token e as reconexões do Scribe passam por aqui. */
async function pedirSessaoTranscricao(signal: AbortSignal) {
  const resposta = await fetch("/api/transcricao/sessao", { method: "POST", signal, cache: "no-store" });
  const dados = await resposta.json() as { provedor?: string; token?: string; erro?: string };
  return { resposta, dados };
}

/**
 * Token novo para reconectar (como em B): sem token com resposta OK, ou com erro 4xx (exceto 429) e 503, repetir
 * não adianta e vira `permanente`.
 */
async function renovarToken(signal: AbortSignal): Promise<string> {
  const { resposta, dados } = await pedirSessaoTranscricao(signal);
  if (resposta.ok && dados.token) return dados.token;
  const permanente = resposta.ok || resposta.status === 503 || (resposta.status >= 400 && resposta.status < 500 && resposta.status !== 429);
  throw new ErroTokenTranscricao(dados.erro ?? `Erro HTTP ${resposta.status} em /api/transcricao/sessao`, permanente);
}

export function useTranscricao({ aoTexto, bloqueada = false, obterStream, liberarStream, sessaoId, termos }: {
  aoTexto: (texto: string) => void;
  bloqueada?: boolean;
  obterStream?: () => Promise<MediaStream>;
  liberarStream?: () => void;
  sessaoId?: string | null;
  /** Vocabulário extra para o Scribe (palavras do título da vaga); a lista de recrutamento técnico já vai sempre. */
  termos?: readonly string[];
}) {
  const [estado, setEstado] = useState<EstadoTranscricao>("inativa");
  const [parcial, setParcial] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [provedor, setProvedor] = useState<"elevenlabs" | "navegador" | null>(null);
  const referencia = useRef<CapturaAtual | null>(null);
  const receber = useRef(aoTexto);
  receber.current = aoTexto;
  const liberar = useRef(liberarStream);
  liberar.current = liberarStream;
  const sessaoIdRef = useRef(sessaoId);
  sessaoIdRef.current = sessaoId;
  const vocabulario = useRef(termos);
  vocabulario.current = termos;
  // Última energia RMS do microfone (o Scribe manda a cada bloco); quem consulta é o fim do turno (lib/audio/fimDoTurno.ts).
  const energiaAtual = useRef(0);
  const energia = useCallback(() => (referencia.current ? energiaAtual.current : 0), []);

  const cancelar = useCallback(() => {
    const atual = referencia.current;
    atual?.medidor?.finalizar();
    referencia.current = null;
    atual?.controlador.abort();
    atual?.antecipada?.cancelar();
    atual?.sessao?.cancelar();
    if (atual) liberar.current?.();
    atual?.liberar?.();
    setParcial("");
    setEstado("inativa");
  }, []);

  /**
   * `captura`: microfone já aberto por quem chama (o detector de interrupção), com o áudio de antes guardado. O hook
   * passa a ser o dono dela.
   */
  const iniciar = useCallback(async (captura?: CapturaAntecipada) => {
    if (bloqueada || referencia.current) { captura?.cancelar(); return; }
    const atual: CapturaAtual = { controlador: new AbortController(), antecipada: captura };
    referencia.current = atual;
    atual.liberar = focoAudio.assumir("entrada", cancelar);
    const vigente = () => referencia.current === atual;
    let falhou = false;
    energiaAtual.current = 0;
    setErro(null);
    setParcial("");
    setEstado("conectando");
    const eventos: EventosTranscricao = {
      aoTexto: (texto) => { if (vigente()) receber.current(texto); },
      aoParcial: (texto) => { if (vigente()) setParcial(texto); },
      aoEnergia: (valor) => { if (vigente()) energiaAtual.current = valor; },
      aoErro: (e) => {
        if (!vigente()) return;
        falhou = true;
        setErro(e.message);
        setEstado("erro");
      },
      aoEncerrar: () => {
        if (!vigente()) return;
        atual.medidor?.finalizar();
        referencia.current = null;
        liberar.current?.();
        atual.liberar?.();
        setParcial("");
        setEstado(falhou ? "erro" : "inativa");
      },
    };
    try {
      if (!window.isSecureContext) throw new Error("Abra o projeto por HTTPS ou localhost para usar o microfone.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não oferece acesso ao microfone.");
      // Começa a ouvir já: o token e o socket levam ~1 s, e era esse o começo da fala que se perdia.
      if (ultimoProvedor !== "navegador") atual.antecipada ??= iniciarCapturaAntecipada({ stream: obterStream?.() });
      const { resposta, dados } = await pedirSessaoTranscricao(atual.controlador.signal);
      if (!vigente()) return;
      if (!resposta.ok) throw new Error(dados.erro ?? "Não consegui iniciar a transcrição.");
      if (dados.provedor === "elevenlabs" && dados.token) {
        ultimoProvedor = "elevenlabs";
        setProvedor("elevenlabs");
        const { iniciarScribe } = await import("./scribe");
        atual.controlador.signal.throwIfAborted();
        atual.antecipada ??= iniciarCapturaAntecipada({ stream: obterStream?.() });
        atual.sessao = await iniciarScribe({
          token: dados.token, termos: vocabulario.current, captura: atual.antecipada,
          signal: atual.controlador.signal, eventos,
          obterToken: () => renovarToken(atual.controlador.signal),
        });
      } else if (dados.provedor === "navegador") {
        ultimoProvedor = "navegador";
        atual.antecipada?.cancelar();
        atual.antecipada = undefined;
        const Construtor = reconhecimentoDisponivel();
        if (!Construtor) throw new Error("Este navegador não oferece reconhecimento de voz. Use Chrome ou configure a transcrição com ElevenLabs.");
        setProvedor("navegador");
        atual.sessao = iniciarNavegador(Construtor, eventos);
      } else {
        throw new Error("Configuração de transcrição inválida.");
      }
      if (!vigente()) { atual.sessao.cancelar(); return; }
      // O ditado envia ao Scribe tudo que o microfone captura, então tempo aberto representa áudio enviado.
      const id = sessaoIdRef.current;
      if (id) atual.medidor = criarMedidorUsoTranscricao(id, { enviar: (corpo, final) => {
        // Beacon recusado (fila cheia) cai no fetch, como no quadro.
        if (final && navigator.sendBeacon?.("/api/uso", new Blob([corpo], { type: "application/json" }))) return;
        void fetch("/api/uso", { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo, keepalive: final }).catch(() => {});
      } });
      setEstado("ouvindo");
    } catch (e) {
      if (!vigente()) return;
      eventos.aoErro(erroMicrofone(e));
      atual.controlador.abort();
      atual.antecipada?.cancelar();
      atual.sessao?.cancelar();
      eventos.aoEncerrar();
    }
  }, [bloqueada, cancelar, obterStream]);

  const parar = useCallback(async () => {
    const atual = referencia.current;
    if (!atual) return;
    if (!atual.sessao) { cancelar(); return; }
    setEstado("finalizando");
    try {
      await atual.sessao.parar();
    } catch (e) {
      // Sem isso o estado ficaria preso em "finalizando" e o envio, bloqueado.
      if (referencia.current !== atual) return;
      setErro(erroMicrofone(e).message);
      cancelar();
    }
  }, [cancelar]);

  useEffect(() => {
    if (bloqueada) cancelar();
  }, [bloqueada, cancelar]);

  useEffect(() => {
    const aoOcultar = () => { if (document.hidden) cancelar(); };
    document.addEventListener("visibilitychange", aoOcultar);
    return () => {
      document.removeEventListener("visibilitychange", aoOcultar);
      cancelar();
    };
  }, [cancelar]);

  const ativa = estado === "conectando" || estado === "ouvindo" || estado === "finalizando";
  return { estado, ativa, parcial, erro, provedor, iniciar, parar, cancelar, energia };
}

export type Transcricao = ReturnType<typeof useTranscricao>;
