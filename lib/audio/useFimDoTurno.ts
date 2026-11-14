"use client";

// Fim do turno do candidato por cima do detector puro (lib/audio/fimDoTurno.ts).
// Enquanto `ativo`, confere a energia do microfone a cada 100 ms; quando `ativo` vira false, reinicia.
import { useCallback, useEffect, useRef } from "react";
import { criarFimDoTurno, type FaixaDeEnergia, type FimDoTurno } from "./fimDoTurno";

const INTERVALO_MS = 100;
const PASSO_MAXIMO_MS = 200;

export function useFimDoTurno(opcoes: {
  ativo: boolean; // false: pausa e reinicia (ex.: Totti falando, microfone desligado)
  obterEnergia: () => number; // energia RMS crua mais recente do microfone (0 a 1)
  aoFechar: () => void;
  aoMedir?: (faixa: FaixaDeEnergia) => void; // a cada tique, com a faixa do bloco medido
}): { marcarFala: () => void } { // marcarFala: texto transcrito prova fala baixa; arma o próximo fechamento (referência estável)
  const { ativo, obterEnergia, aoFechar, aoMedir } = opcoes;
  const detector = useRef<FimDoTurno | null>(null);
  const energia = useRef(obterEnergia);
  const fechar = useRef(aoFechar);
  const medido = useRef(aoMedir);

  if (detector.current === null) detector.current = criarFimDoTurno();
  const marcarFala = useCallback(() => detector.current?.marcarFala(), []);

  useEffect(() => {
    energia.current = obterEnergia;
  }, [obterEnergia]);

  useEffect(() => {
    fechar.current = aoFechar;
  }, [aoFechar]);

  useEffect(() => {
    medido.current = aoMedir;
  }, [aoMedir]);

  useEffect(() => {
    const d = detector.current;
    if (!d) return;
    if (!ativo) {
      d.reiniciar();
      return;
    }
    let ultimoTique = performance.now();
    const id = setInterval(() => {
      const agora = performance.now();
      const passo = Math.min(PASSO_MAXIMO_MS, agora - ultimoTique);
      ultimoTique = agora;
      const { faixa, fechou } = d.medir(energia.current(), passo);
      medido.current?.(faixa);
      if (fechou) fechar.current();
    }, INTERVALO_MS);
    return () => clearInterval(id);
  }, [ativo]);

  return { marcarFala };
}
