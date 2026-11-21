"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { focoAudio } from "../audio/foco";
import { useLiberarAudio } from "../presenca/useLiberarAudio";
import { definirSessaoDaVoz, reproduzirFala, type ProvedorVoz } from "./cliente";
import { criarFilaDeFalas, type EstadoVoz, type FilaDeFalas, type LegendaAgente } from "./filaDeFalas";
import type { ObservadorDoAudio } from "../conversa/tempoDeResposta";

export { PAUSA_ENTRE_FALAS_MS } from "./filaDeFalas";
export type FalaAgente = { id: string; texto: string };

export function useVozAgente({ ultimaFala = null, bloqueada = false, sessao = null, audio }: {
  audio?: ObservadorDoAudio;
  ultimaFala?: FalaAgente | null;
  bloqueada?: boolean;
  sessao?: { sessao_id: string; contexto: "quadro" | "coding" | "pre" } | null;
} = {}) {
  const sessaoId = sessao?.sessao_id;
  const contexto = sessao?.contexto;
  // Depende do id e do contexto, não do objeto (que quem chama recria a cada render).
  useEffect(() => {
    definirSessaoDaVoz(sessaoId && contexto ? { sessao_id: sessaoId, contexto } : null);
    return () => definirSessaoDaVoz(null);
  }, [sessaoId, contexto]);
  // Sem o destrave, o play() do áudio do ElevenLabs é bloqueado e a fala espera o próximo toque.
  useLiberarAudio();
  const [estado, setEstado] = useState<EstadoVoz>("inativa");
  const [habilitada, setHabilitada] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [provedor, setProvedor] = useState<ProvedorVoz | null>(null);
  const [fala, setFala] = useState<LegendaAgente | null>(null);
  const audioRef = useRef(audio);
  audioRef.current = audio;
  // Uma fala por vez, com pausa entre elas (lib/voz/filaDeFalas.ts). Os setters do React são estáveis.
  const [fila] = useState<FilaDeFalas>(() => criarFilaDeFalas({
    reproduzir: reproduzirFala,
    foco: focoAudio,
    audio: { iniciou: () => audioRef.current?.iniciou(), terminou: (completo) => audioRef.current?.terminou(completo) },
    tela: { estado: setEstado, erro: setErro, aviso: setAviso, provedor: setProvedor, fala: setFala },
  }));
  const habilitadaRef = useRef(true);
  const bloqueadaRef = useRef(bloqueada);
  bloqueadaRef.current = bloqueada;
  const montado = useRef(false);
  const ultimaProgramada = useRef<string | null>(null);

  const parar = fila.parar;

  useEffect(() => {
    montado.current = true;
    const ocultar = () => { if (document.hidden) parar(); };
    document.addEventListener("visibilitychange", ocultar);
    return () => {
      montado.current = false;
      document.removeEventListener("visibilitychange", ocultar);
      ultimaProgramada.current = null;
      parar();
    };
  }, [parar]);

  /**
   * Uma fala nova não corta a que está tocando: toca depois dela, com uma pausa (ver criarFilaDeFalas).
   * `antesDeTocar`: com o áudio pronto e a vez do agente, espera a pessoa fazer uma pausa; false desiste da fala.
   * Devolve true se a fala tocou até o fim (false: voz desligada, bloqueada, cancelada, substituída ou com erro).
   */
  const falar = useCallback(async (texto: string, opcoes?: { antesDeTocar?: () => Promise<boolean> }): Promise<boolean> => {
    if (!montado.current || document.hidden) return false;
    if (!habilitadaRef.current || bloqueadaRef.current || !texto.trim()) return false;
    return fila.falar(texto, opcoes);
  }, [fila]);

  const alternar = useCallback(() => {
    habilitadaRef.current = !habilitadaRef.current;
    setHabilitada(habilitadaRef.current);
    if (!habilitadaRef.current) parar();
  }, [parar]);

  const id = ultimaFala?.id;
  const texto = ultimaFala?.texto;
  useEffect(() => {
    if (id === undefined || texto === undefined) return;
    const chave = JSON.stringify([id, texto]);
    if (bloqueada || ultimaProgramada.current === chave) return;
    ultimaProgramada.current = chave;
    void falar(texto);
  }, [id, texto, bloqueada, falar]);

  useEffect(() => { if (bloqueada) parar(); }, [bloqueada, parar]);

  /** Deixa falas curtas prontas (o "uhum" de quando o candidato termina de falar) para tocarem sem espera. */
  const preparar = useCallback((textos: string[]) => {
    if (habilitadaRef.current && !bloqueadaRef.current) reproduzirFala.preparar(textos);
  }, []);

  return { estado, habilitada, erro, aviso, provedor, fala, falar, parar, alternar, preparar, ativa: estado === "preparando" || estado === "falando" };
}

export type VozAgente = ReturnType<typeof useVozAgente>;
