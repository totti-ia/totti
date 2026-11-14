import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import type { Blip, EventsResponse, FaseDaEntrevista, SessionEvent } from "@/lib/contracts";
import { ErroDefinitivo, getPendingBlip, postEvent } from "./api";
import { esperarFila, FilaDeEventos } from "./filaDeEventos";
import { INITIAL_LANGUAGE } from "@/lib/ide-constants";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Evento como a IDE monta antes de sendEvent preencher sessionId e t. */
export type EventInput = DistributiveOmit<SessionEvent, "sessionId" | "t">;

export interface LogEntry {
  id: number;
  label: string;
  t: number;
  failed: boolean;
}

const LOG_LIMIT = 200;
/**
 * Eventos que não podem se perder: sem eles o relatório dizia "não rodou o código" com dois runs feitos. Ficam na
 * fila até o servidor responder 2xx, com reenvio; os outros (pausa, fala, balão) vão uma vez, como antes.
 */
const EVENTOS_GARANTIDOS = new Set<SessionEvent["type"]>(["snapshot", "paste", "run", "session_ended"]);
/** Teto da espera pela fila ao encerrar: a despedida não fica presa numa rede caída. */
const ESPERA_DA_FILA_AO_ENCERRAR_MS = 10_000;
/** Com o candidato parado, o blip só aparece por polling: a cada 3 s. */
const PENDING_POLL_MS = 3000;

/**
 * Sessão: id, relógio (t), cronômetro, fim de sessão e o único ponto de envio (sendEvent).
 */
export function useSession(
  problemId: string = DEFAULT_CONFIG.problemId,
  configId: string = DEFAULT_CONFIG.id,
  durationMin: number = DEFAULT_CONFIG.durationMin,
  initialLanguage: string = INITIAL_LANGUAGE,
) {
  const durationMs = durationMin * 60_000;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [ended, setEnded] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [incomingBlip, setIncomingBlip] = useState<Blip | null>(null);
  /** A fase de verdade da entrevista, decidida pelo servidor (null até a primeira resposta). */
  const [fase, setFase] = useState<FaseDaEntrevista | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const startRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const seqRef = useRef(0);
  const eventsRef = useRef<SessionEvent[]>([]);
  const startedAtRef = useRef<number>(0);

  const nowT = useCallback(
    (): number => (startRef.current === null ? 0 : Math.round(performance.now() - startRef.current)),
    [],
  );

  const pushLog = useCallback((label: string, t: number, failed: boolean) => {
    seqRef.current += 1;
    const entry: LogEntry = { id: seqRef.current, label, t, failed };
    setLog((prev) => [...prev.slice(-(LOG_LIMIT - 1)), entry]);
  }, []);

  /** Aplica a resposta de POST /api/events ou do polling: primeiro tira o balão substituído, depois mostra o novo. */
  const applyResponse = useCallback((res: EventsResponse) => {
    const dismissId = res.dismissBlipId;
    if (dismissId !== undefined) setIncomingBlip((prev) => (prev?.id === dismissId ? null : prev));
    if (res.blip !== undefined) setIncomingBlip(res.blip);
    if (res.fase !== undefined) setFase(res.fase);
  }, []);

  const filaRef = useRef<FilaDeEventos<SessionEvent, EventsResponse> | null>(null);
  filaRef.current ??= new FilaDeEventos({
    enviar: postEvent,
    aoConfirmar: (event, res, tentativas) => {
      if (event.type === "run") console.info(`[events] run confirmado (t=${event.t}${tentativas > 1 ? `, ${tentativas} tentativas` : ""})`);
      applyResponse(res);
    },
    aoFalhar: (event, err, definitivo) => {
      console.error(`POST /api/events falhou${definitivo ? "" : " (vai reenviar)"}`, event.type, err);
      pushLog(`${event.type} (${definitivo ? "falhou" : "reenviando"})`, event.t, true);
    },
    definitivo: (err) => err instanceof ErroDefinitivo,
  });
  // Retoma ao montar: no StrictMode a limpeza roda uma vez logo na entrada, e a fila (guardada no ref) ficaria parada.
  useEffect(() => {
    filaRef.current?.retomar();
    return () => filaRef.current?.parar();
  }, []);

  const sendEvent = useCallback(
    async (input: EventInput): Promise<void> => {
      const id = sessionIdRef.current;
      if (id === null) return;
      const event: SessionEvent = { ...input, sessionId: id, t: nowT() };
      eventsRef.current.push(event);
      pushLog(event.type, event.t, false);
      if (EVENTOS_GARANTIDOS.has(event.type)) {
        if (event.type === "run") console.info(`[events] run enviado (t=${event.t}, ${event.result.passed}/${event.result.total})`);
        await filaRef.current?.enfileirar(event);
        return;
      }
      try {
        applyResponse(await postEvent(event));
      } catch (err) {
        console.error("POST /api/events falhou", event.type, err);
        pushLog(`${event.type} (falhou)`, event.t, true);
      }
    },
    [nowT, pushLog, applyResponse],
  );

  /**
   * Espera a fila de eventos garantidos esvaziar (com teto). O fim da sessão, que dispara o relatório, só sai depois
   * disso. Os eventos garantidos esperam a confirmação em `sendEvent`: quem não pode travar usa esta espera.
   */
  const esperarEventos = useCallback(
    (tetoMs = ESPERA_DA_FILA_AO_ENCERRAR_MS) => (filaRef.current ? esperarFila(filaRef.current, tetoMs) : Promise.resolve(true)),
    [],
  );

  const endSession = useCallback(
    async (reason: "timeout" | "button") => {
      if (endedRef.current) return;
      endedRef.current = true;
      setEnded(true);
      // Os runs e o código final chegam antes do fim: é o session_ended que dispara a avaliação.
      // Nunca espera sem teto: com a rede caída, a despedida segue e os reenvios continuam em segundo plano.
      const esvaziou = await esperarEventos();
      if (!esvaziou) console.warn("[events] encerrando com eventos ainda na fila de reenvio");
      void sendEvent({ type: "session_ended", reason });
      await esperarEventos();
    },
    [sendEvent, esperarEventos],
  );

  // Inicia a sessão uma vez (o ref protege contra o duplo mount do StrictMode).
  useEffect(() => {
    if (sessionIdRef.current !== null) return;
    const id = crypto.randomUUID();
    sessionIdRef.current = id;
    startRef.current = performance.now();
    startedAtRef.current = Date.now();
    setSessionId(id);
    void sendEvent({
      type: "session_started",
      configId,
      problemId,
      language: initialLanguage,
    });
  }, [sendEvent, problemId, configId, initialLanguage]);

  // Polling de blip (GET /api/blip/pending): mostra o balão mesmo sem evento novo do candidato.
  useEffect(() => {
    if (sessionId === null || ended) return;
    let alive = true;
    const id = setInterval(() => {
      getPendingBlip(sessionId)
        .then((res) => {
          if (alive) applyResponse(res);
        })
        .catch(() => {
          // falha transitória do polling: tenta de novo no próximo tick
        });
    }, PENDING_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sessionId, ended, applyResponse]);

  // Cronômetro: atualiza o tempo decorrido e encerra por timeout.
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = nowT();
      setElapsedMs(elapsed);
    }, 1000);
    return () => clearInterval(id);
  }, [nowT, durationMs]);

  return {
    sessionId,
    elapsedMs,
    ended,
    endedRef,
    eventsRef,
    startedAtRef,
    log,
    fase,
    esperarEventos,
    incomingBlip,
    setIncomingBlip,
    applyResponse,
    nowT,
    sendEvent,
    endSession,
  };
}
