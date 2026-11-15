import { useCallback, useRef, useState } from "react";
import type { RunResult } from "@/lib/contracts";
import { INITIAL_LANGUAGE } from "@/lib/ide-constants";
import type { EventInput } from "./useSession";
import { ContadorDeEscrita, type MudancaDoEditor } from "./contadorDeEscrita";

/** Saída de foco na régua da IDE (`t` em ms desde o começo da sessão), como vai no snapshot (#123). */
export interface SaidaDeFocoDaIde {
  t: number;
  duracaoMs: number;
  motivo: "aba" | "janela";
}

const SNAPSHOT_DEBOUNCE_MS = 1500;
const SNAPSHOT_THROTTLE_MS = 5000;
const PAUSE_MS = 8000;
const PASTE_MIN_CHARS = 40;

interface CaptureDeps {
  sendEvent: (input: EventInput) => Promise<void>;
  nowT: () => number;
  endedRef: { current: boolean };
  /** Código inicial por linguagem do problema atual. */
  starters: Record<string, string>;
  /** Linguagem com que a IDE abre (a primeira da vaga). */
  initialLanguage?: string;
  /** Saídas de foco fechadas desde o último envio (#123): vão no próximo snapshot, sem POST a mais. */
  saidasDeFoco?: () => SaidaDeFocoDaIde[];
}

/** Linhas a mais numa única mudança a partir das quais o bloco conta como colado. */
const PASTE_BLOCK_LINES = 6;

/** Primeira linha (1-based) em que os dois textos diferem. */
function firstChangedLine(a: string, b: string): number {
  const la = a.split("\n");
  const lb = b.split("\n");
  let i = 0;
  while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
  return i + 1;
}

/**
 * Captura de código: snapshot (debounce + throttle), pause, paste, language e run.
 */
export function useCodeCapture({ sendEvent, nowT, endedRef, starters: STARTERS, initialLanguage = INITIAL_LANGUAGE, saidasDeFoco }: CaptureDeps) {
  const [language, setLanguage] = useState<string>(initialLanguage);
  const [code, setCode] = useState<string>(STARTERS[initialLanguage] ?? "");

  const codeRef = useRef(code);
  const langRef = useRef(language);
  const versionRef = useRef(0);
  const lastSentCodeRef = useRef<string | null>(null);
  const lastSnapshotAtRef = useRef(0);
  const lastTypedAtRef = useRef(0);
  /** Última colagem que o editor avisou (onDidPaste). */
  const lastPasteAtRef = useRef(-Infinity);
  const pausedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contadorRef = useRef<ContadorDeEscrita | null>(null);
  contadorRef.current ??= new ContadorDeEscrita();
  const saidasRef = useRef(saidasDeFoco);
  saidasRef.current = saidasDeFoco;

  const flushSnapshot = useCallback(async (): Promise<void> => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (endedRef.current) return;
    const current = codeRef.current;
    if (current === lastSentCodeRef.current) return;
    lastSentCodeRef.current = current;
    lastSnapshotAtRef.current = nowT();
    versionRef.current += 1;
    // Jeito de escrever e saídas de foco (#123) só pegam carona: campos opcionais, nada dispara por eles.
    const escrita = contadorRef.current?.esvaziar() ?? null;
    const foco = saidasRef.current?.() ?? [];
    await sendEvent({
      type: "snapshot",
      code: current,
      version: versionRef.current,
      language: langRef.current,
      ...(escrita ? { escrita } : {}),
      ...(foco.length ? { foco } : {}),
    });
  }, [endedRef, nowT, sendEvent]);

  const onCodeChange = useCallback(
    (next: string) => {
      if (endedRef.current) return;
      const before = codeRef.current;
      codeRef.current = next;
      setCode(next);

      const now = nowT();
      // Um bloco grande de uma vez também é colagem, mesmo quando o editor não avisa (colar pelo menu, arrastar,
      // trocar o conteúdo inteiro): sem isso o relatório dizia "nenhuma colagem" para código copiado de fora.
      const added = next.split("\n").length - before.split("\n").length;
      if (added >= PASTE_BLOCK_LINES && now - lastPasteAtRef.current > 1500) {
        lastPasteAtRef.current = now;
        const startLine = firstChangedLine(before, next);
        setTimeout(() => {
          void flushSnapshot().then(() => sendEvent({ type: "paste", chars: Math.max(0, next.length - before.length), lines: added, startLine }));
        }, 0);
      }
      lastTypedAtRef.current = now;
      pausedRef.current = false;

      // Throttle: enquanto digita sem parar, manda no máximo a cada 5 s.
      if (now - lastSnapshotAtRef.current >= SNAPSHOT_THROTTLE_MS) {
        void flushSnapshot();
      }
      // Debounce: manda 1,5 s depois de parar de digitar.
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void flushSnapshot();
      }, SNAPSHOT_DEBOUNCE_MS);

      // Pause: uma vez por período ocioso, depois de 8 s sem digitar.
      if (idleRef.current !== null) clearTimeout(idleRef.current);
      idleRef.current = setTimeout(() => {
        idleRef.current = null;
        if (endedRef.current || pausedRef.current) return;
        pausedRef.current = true;
        void sendEvent({ type: "pause", idleMs: nowT() - lastTypedAtRef.current });
      }, PAUSE_MS);
    },
    [endedRef, flushSnapshot, nowT, sendEvent],
  );

  /**
   * Colar: manda `paste` se tiver 2+ linhas ou 40+ caracteres. O snapshot com o código colado
   * vai antes, senão o agente analisaria a colagem olhando o código antigo.
   */
  const onPaste = useCallback(
    (text: string, startLine: number, origem?: "editor" | "fora") => {
      if (endedRef.current) return;
      const lines = text.split("\n").length;
      if (lines < 2 && text.length < PASTE_MIN_CHARS) return;
      lastPasteAtRef.current = nowT();
      // setTimeout: o onPaste dispara antes do onChange que atualiza codeRef.
      setTimeout(() => {
        void flushSnapshot().then(() => sendEvent({ type: "paste", chars: text.length, lines, startLine, ...(origem ? { origem } : {}) }));
      }, 0);
    },
    [endedRef, flushSnapshot, sendEvent, nowT],
  );

  /** Mudanças digitadas ou apagadas no editor (#123): só contam, não mandam nada. */
  const onEscrever = useCallback(
    (mudancas: MudancaDoEditor[], colando: boolean) => {
      if (endedRef.current) return;
      contadorRef.current?.registrar(mudancas, performance.now(), colando);
    },
    [endedRef],
  );

  const changeLanguage = useCallback(
    (next: string) => {
      if (endedRef.current) return;
      const prev = langRef.current;
      if (next === prev) return;
      langRef.current = next;
      setLanguage(next);
      // Se o código ainda é o starter da linguagem anterior, troca pelo starter novo.
      if (codeRef.current === (STARTERS[prev] ?? "")) {
        onCodeChange(STARTERS[next] ?? "");
      }
      void sendEvent({ type: "language_changed", language: next });
    },
    [endedRef, onCodeChange, sendEvent, STARTERS],
  );

  /** Antes de cada run, manda um snapshot imediato (se o código mudou). */
  const runWithResult = useCallback(
    async (result: RunResult): Promise<void> => {
      await flushSnapshot();
      await sendEvent({ type: "run", result });
    },
    [flushSnapshot, sendEvent],
  );

  /** Código e linguagem de agora (o que está no editor, mesmo antes do snapshot sair). */
  const getLiveCode = useCallback(() => ({ code: codeRef.current, language: langRef.current }), []);

  return {
    code,
    language,
    flushSnapshot,
    getLiveCode,
    onCodeChange,
    onPaste,
    onEscrever,
    changeLanguage,
    runWithResult,
  };
}
