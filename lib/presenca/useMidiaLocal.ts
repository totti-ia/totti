"use client";

// Câmera e microfone do candidato.
// A câmera é SÓ local: aparece na janela de chamada e não é enviada, gravada nem analisada.
// O microfone mede o volume e fornece o mesmo stream à transcrição.
import { useCallback, useEffect, useRef, useState } from "react";
import { AUDIO_DO_MICROFONE } from "./microfone";
import { ignorarFocoDurante } from "@/lib/foco/saidasDeFoco";

export type ErroMidia = "camera" | "microfone" | null;

export function useMidiaLocal() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [erro, setErro] = useState<ErroMidia>(null);
  const [cameraLigada, setCameraLigada] = useState(false);
  const [microfoneLigado, setMicrofoneLigado] = useState(false);
  const [volume, setVolume] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const versaoRef = useRef(0);
  const pedidoRef = useRef<Promise<MediaStream> | null>(null);

  const liberar = useCallback(() => {
    versaoRef.current += 1;
    pedidoRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setMicrofoneLigado(false);
    setVolume(0);
  }, []);

  /** Pede só o microfone (a câmera do candidato não é usada). Chamar a partir de um clique ou ao abrir a sala. */
  const pedir = useCallback((): Promise<MediaStream> => {
    if (streamRef.current) return Promise.resolve(streamRef.current);
    if (pedidoRef.current) return pedidoRef.current;
    const versao = versaoRef.current;
    const pedido = (async () => {
      try {
        // O diálogo de permissão tira o foco da janela: não é saída de foco (#123).
        const s = await ignorarFocoDurante(() => navigator.mediaDevices.getUserMedia({
          audio: AUDIO_DO_MICROFONE,
        }));
        if (versaoRef.current !== versao) {
          s.getTracks().forEach((t) => t.stop());
          throw new DOMException("Captura cancelada", "AbortError");
        }
        streamRef.current = s;
        setStream(s);
        setErro(null);
        setMicrofoneLigado(true);
        return s;
      } catch (e) {
        if (versaoRef.current === versao) setErro("microfone");
        throw e;
      } finally {
        if (versaoRef.current === versao) pedidoRef.current = null;
      }
    })();
    pedidoRef.current = pedido;
    return pedido;
  }, []);

  const alternarCamera = useCallback(() => {
    const trilha = streamRef.current?.getVideoTracks()[0];
    if (!trilha) return;
    trilha.enabled = !trilha.enabled;
    setCameraLigada(trilha.enabled);
  }, []);

  const alternarMicrofone = useCallback(() => {
    const trilha = streamRef.current?.getAudioTracks()[0];
    if (!trilha) return;
    trilha.enabled = !trilha.enabled;
    setMicrofoneLigado(trilha.enabled);
  }, []);

  // Volume do microfone (0 a 1), ~20 vezes por segundo.
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const contexto = new AudioContext();
    const fonte = contexto.createMediaStreamSource(stream);
    const analisador = contexto.createAnalyser();
    analisador.fftSize = 512;
    fonte.connect(analisador);
    const amostras = new Float32Array(analisador.fftSize);
    let ultimo = 0;
    let raf = 0;
    const medir = (ts: number) => {
      if (ts - ultimo > 50) {
        ultimo = ts;
        analisador.getFloatTimeDomainData(amostras);
        let soma = 0;
        for (const a of amostras) soma += a * a;
        const rms = Math.sqrt(soma / amostras.length);
        const ligado = stream.getAudioTracks()[0]?.enabled ?? false;
        setVolume(ligado ? Math.min(1, rms * 6) : 0);
      }
      raf = requestAnimationFrame(medir);
    };
    raf = requestAnimationFrame(medir);
    return () => {
      cancelAnimationFrame(raf);
      fonte.disconnect();
      void contexto.close();
    };
  }, [stream]);

  // Desliga tudo ao sair da página.
  useEffect(
    () => () => {
      versaoRef.current += 1;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { stream, erro, cameraLigada, microfoneLigado, volume, pedir, liberar, alternarCamera, alternarMicrofone };
}
