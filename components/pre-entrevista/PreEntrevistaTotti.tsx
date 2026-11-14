"use client";

// Pré-entrevista com o Totti, do lado do recrutador:
//   vaga → o Totti lê → conversa → plano (confere, ajusta e publica na mesma tela) → entrevista pronta.
// Quando o Totti dá a conversa por encerrada, a conversa fecha e um cartão no meio mostra o Totti montando
// o plano; quando o plano fica pronto, o botão do canto voa até o cartão (mesmo `layoutId`) como "Revisar o plano".
// Ao publicar, `posPublicacao` (se vier) cobre o plano com o que acontece depois (no workspace, o envio dos
// convites), e o botão "Publicar vaga" voa até lá do mesmo jeito.
// Os dados vêm de lib/pre-entrevista/tela/cliente.ts (rotas reais ou demonstração).
// No workspace (/vagas/nova) tudo acontece aqui, sem trocar de página; um rascunho salvo entra por
// `vagaInicial`/`sessaoInicial` e o Totti começa lendo (ou volta direto para a conversa).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, ChevronLeft } from "lucide-react";
import type { InterviewConfig } from "@/lib/contracts";
import type { Vaga } from "@/lib/pre-entrevista/classificador";
import type { Rascunho } from "@/lib/pre-entrevista/rascunho";
import type { EstadoSessao } from "@/lib/pre-entrevista/sessoes";
import { buscarSessao, criarSessao, enviarFala, finalizar, salvarRascunho, usarServidor } from "@/lib/pre-entrevista/tela/cliente";
import { curvaSuave } from "@/lib/design/motion";
import EntradaVaga from "./EntradaVaga";
import LeituraDaVaga from "./LeituraDaVaga";
import ConversaTotti from "./ConversaTotti";
import RevisaoPlano from "./RevisaoPlano";
import PlanoSeMontando from "./PlanoSeMontando";
import EntrevistaPronta from "./EntrevistaPronta";
import Passos from "./Passos";

type Etapa = "vaga" | "lendo" | "conversa" | "plano" | "pronta";

/** Depois da última fala do Totti, quanto a conversa espera para fechar. */
const ESPERA_FECHAR_MS = 1400;
/** O cartão "montando o plano" fica pelo menos isso na tela. */
const MONTANDO_MINIMO_MS = 1800;

type Props = {
  /** Vaga já cadastrada no workspace: começa direto com o Totti lendo. */
  vagaInicial?: Vaga;
  /** A pessoa enviou o formulário: a vaga vira rascunho antes de o Totti começar a ler. */
  onComecar?: (vaga: Vaga) => void;
  /** Sessão de antes, para retomar a conversa de onde parou. */
  sessaoInicial?: string;
  onSessao?: (id: string) => void;
  onProgresso?: (feitos: number, total: number) => void;
  onPronta?: (config: InterviewConfig) => void;
  /** Volta para a lista de vagas. */
  onSair?: () => void;
  /** Ação principal da tela final (ex.: abrir a vaga publicada). */
  final?: { rotulo: string; acao: () => void };
  /** Depois de publicar, em vez da tela final: cobre o plano com isto (o botão com `layoutId="cta-publicar"` voa até lá). */
  posPublicacao?: (config: InterviewConfig) => ReactNode;
};

export default function PreEntrevistaTotti({
  vagaInicial,
  onComecar,
  sessaoInicial,
  onSessao,
  onProgresso,
  onPronta,
  onSair,
  final,
  posPublicacao,
}: Props = {}) {
  const [etapa, setEtapa] = useState<Etapa>(vagaInicial ? "lendo" : "vaga");
  const [vaga, setVaga] = useState<Vaga | null>(vagaInicial ?? null);
  const [estado, setEstado] = useState<EstadoSessao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pensando, setPensando] = useState(false);
  /** O recrutador quis continuar conversando depois de o Totti encerrar: o botão volta para o canto. */
  const [seguirConversando, setSeguirConversando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [errosRevisao, setErrosRevisao] = useState<string[]>([]);
  const [config, setConfig] = useState<InterviewConfig | null>(null);

  async function comecar(v: Vaga) {
    setVaga(v);
    setErro(null);
    setEstado(null);
    setEtapa("lendo");
    try {
      const novo = await criarSessao(v);
      setEstado(novo);
      onSessao?.(novo.id);
    } catch (e) {
      setErro(`Não consegui ler a vaga: ${e instanceof Error ? e.message : String(e)}`);
      setEtapa("vaga");
    }
  }

  const abrirConversa = useCallback(() => setEtapa("conversa"), []);
  // Do plano de volta à conversa: ela nunca desmonta (só se esconde), então reabre em silêncio, com o texto e a
  // rolagem de antes. `seguirConversando` tira o cartão de "plano pronto" de cima do campo de texto.
  // O que ela editou na revisão é guardado no servidor ao voltar (fica fixado até ela falar daquilo de novo).
  // `base` é o rascunho de que ela partiu ao abrir a revisão: o servidor fixa só o que mudou em relação a ele.
  const editadoNaRevisao = useRef<{ editado: Rascunho; base: Rascunho } | null>(null);
  // A edição que o servidor ainda não confirmou (salvando ou com falha). Enquanto existir, o que chega do servidor (a
  // busca de 1,5 s, a resposta do Totti) não troca o rascunho da tela: senão a edição sumia sem ela ver.
  const edicaoPendente = useRef<Rascunho | null>(null);
  const comPendente = useCallback((e: EstadoSessao): EstadoSessao => (edicaoPendente.current ? { ...e, rascunho: edicaoPendente.current } : e), []);
  const sessaoId = estado?.id;
  const voltarParaConversa = useCallback(() => {
    setSeguirConversando(true);
    setEtapa("conversa");
    const guardado = editadoNaRevisao.current;
    editadoNaRevisao.current = null;
    if (!guardado || !sessaoId) return;
    const { editado, base } = guardado;
    edicaoPendente.current = editado;
    // Já na tela: se ela reabrir o plano antes da resposta, vê o que editou.
    setEstado((atual) => (atual ? { ...atual, rascunho: editado } : atual));
    // Uma segunda tentativa se a primeira falhar; se também falhar, a edição fica na tela (e vai ao publicar) com um aviso.
    salvarRascunho(sessaoId, editado, base)
      .catch(() => salvarRascunho(sessaoId, editado, base))
      .then((novo) => {
        // Outra edição pode ter entrado enquanto esta salvava: só esta limpa o pendente.
        if (edicaoPendente.current === editado) edicaoPendente.current = null;
        setEstado((atual) => (atual?.id === novo.id ? comPendente({ ...atual, rascunho: novo.rascunho }) : atual));
      })
      .catch((e) => {
        setErro(`Não consegui guardar o que você mudou no plano: ${e instanceof Error ? e.message : String(e)}. A edição continua na tela e vai ao publicar.`);
      });
  }, [sessaoId, comPendente]);

  // Workspace: retoma a sessão salva (se ainda existir) ou começa a leitura da vaga. Roda uma vez só.
  const iniciou = useRef(false);
  useEffect(() => {
    if (!vagaInicial || iniciou.current) return;
    iniciou.current = true;
    void (async () => {
      const anterior = sessaoInicial ? await buscarSessao(sessaoInicial).catch(() => null) : null;
      if (anterior) {
        setEstado(anterior);
        setEtapa("conversa");
      } else void comecar(vagaInicial);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function responder(texto: string) {
    if (!estado) return;
    setErro(null);
    setPensando(true);
    // A fala aparece na hora; a resposta do Totti chega depois.
    setEstado({ ...estado, transcricao: [...estado.transcricao, { role: "recrutadora", text: texto }] });
    try {
      const novo = await enviarFala(estado.id, texto);
      setEstado(comPendente(novo));
    } catch (e) {
      setEstado(estado);
      setErro(`O Totti não respondeu: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPensando(false);
    }
  }

  // Com o servidor real, a extração do rascunho roda em segundo plano: busca o estado de tempos em tempos.
  useEffect(() => {
    if (!usarServidor() || (etapa !== "conversa" && etapa !== "plano") || !estado?.id) return;
    const id = estado.id;
    const t = setInterval(async () => {
      try {
        const novo = await buscarSessao(id);
        // Nunca volta para trás: com instâncias diferentes no servidor, uma pode responder com a extração mais velha.
        if (novo)
          setEstado((atual) =>
            atual &&
            (novo.transcricao.length > atual.transcricao.length ||
              (novo.transcricao.length === atual.transcricao.length && novo.status.versaoExtraida >= atual.status.versaoExtraida))
              ? comPendente(novo)
              : atual,
          );
      } catch {
        // Falhas pontuais não interrompem a conversa.
      }
    }, 1500);
    return () => clearInterval(t);
  }, [etapa, estado?.id, comPendente]);

  async function confirmar(rascunho: Rascunho) {
    if (!estado) return;
    setFinalizando(true);
    setErrosRevisao([]);
    try {
      const r = await finalizar(estado.id, rascunho);
      if ("config" in r) {
        setConfig(r.config);
        onPronta?.(r.config);
        // Com `posPublicacao`, a tela fica no plano e o que vem depois aparece por cima dele.
        if (!posPublicacao) setEtapa("pronta");
      } else setErrosRevisao(r.erros);
    } catch (e) {
      setErrosRevisao([e instanceof Error ? e.message : String(e)]);
    } finally {
      setFinalizando(false);
    }
  }

  function novaEntrevista() {
    setEtapa("vaga");
    setEstado(null);
    setConfig(null);
    setErro(null);
  }

  const combinados = estado?.topicos.filter((t) => t.coberto).length ?? 0;
  const total = estado?.topicos.length ?? 0;
  useEffect(() => {
    if (total > 0) onProgresso?.(combinados, total);
  }, [combinados, total, onProgresso]);
  const tottiTerminou = estado?.planejamento.passo?.tipo === "encerrar";
  const atualizando = !!estado?.status.extraindo;
  // O Totti encerrou: um instante depois da última fala (dá tempo de ler), a conversa fecha e o cartão
  // do meio mostra o Totti montando o plano. Ele fica nesse estado ao menos MONTANDO_MINIMO_MS, para o
  // passo ser visto mesmo quando a extração já terminou; aí o botão do canto voa até o cartão.
  const encerrou = tottiTerminou && !pensando && !seguirConversando;
  const [fechada, setFechada] = useState(false);
  const [montou, setMontou] = useState(false);
  useEffect(() => {
    setMontou(false);
    if (!encerrou) return setFechada(false);
    const abrir = setTimeout(() => setFechada(true), ESPERA_FECHAR_MS);
    const minimo = setTimeout(() => setMontou(true), ESPERA_FECHAR_MS + MONTANDO_MINIMO_MS);
    return () => {
      clearTimeout(abrir);
      clearTimeout(minimo);
    };
  }, [encerrou]);
  const planoPronto = fechada && montou && !atualizando;
  // Na tela larga o plano aparece ao lado e leva o status e o botão; na estreita, um cartão cobre a conversa.
  const larga = useTelaLarga();
  // Se a conversa andar de novo (nova fala), o Totti pode encerrar outra vez.
  const falas = estado?.transcricao.length ?? 0;
  useEffect(() => setSeguirConversando(false), [falas]);

  return (
    <main className="relative flex min-h-dvh flex-col">
      {/* Voltar, fora da conversa (lá o cabeçalho já tem a seta de voltar) */}
      {onSair && etapa !== "conversa" && etapa !== "plano" && (
        <button
          onClick={onSair}
          aria-label="Voltar para as vagas"
          className="group absolute top-5 left-5 z-10 flex items-center gap-1.5 rounded-controle px-2.5 py-1.5 text-[13.5px] text-texto-suave transition-colors hover:text-texto"
        >
          <ChevronLeft size={15} className="transition-transform group-hover:-translate-x-0.5" /> Vagas
        </button>
      )}

      <AnimatePresence mode="wait">
        {etapa === "vaga" && (
          <motion.div key="vaga" exit={{ opacity: 0, y: -8 }} className="relative flex flex-1 items-center px-4 py-12">
            <EntradaVaga
              onEnviar={(v) => {
                onComecar?.(v);
                void comecar(v);
              }}
              erro={erro}
              inicial={vaga ?? undefined}
            />
          </motion.div>
        )}

        {etapa === "lendo" && (
          <motion.div key="lendo" className="relative flex flex-1 items-center px-4 py-12">
            <LeituraDaVaga cargo={vaga?.roleTitle ?? ""} estado={estado} onPronto={abrirConversa} />
          </motion.div>
        )}

        {(etapa === "conversa" || etapa === "plano") && estado && (
          <motion.div
            key="conversa-e-plano"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.36, ease: curvaSuave }}
            className="relative flex h-dvh flex-col gap-3 p-3"
          >
            {/* Três colunas iguais nas pontas: as etapas ficam no centro de verdade */}
            <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 max-md:grid-cols-[1fr_auto]">
              <div className="flex min-w-0 items-center gap-1 justify-self-start rounded-full bg-superficie py-1.5 pr-4 pl-1.5">
                <button
                  onClick={onSair ?? novaEntrevista}
                  aria-label={onSair ? "Voltar para as vagas" : "Começar de novo"}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-texto-suave transition-colors hover:bg-fundo hover:text-texto"
                >
                  <ArrowLeft size={16} />
                </button>
                <span className="truncate text-[14px] text-texto">{estado.vaga.roleTitle}</span>
                {etapa === "conversa" && (
                  <span className="numero ml-2 shrink-0 text-[12px] text-texto-suave">
                    {combinados}/{total}
                  </span>
                )}
              </div>
              <div className="justify-self-center max-md:hidden">
                <Passos atual={3} />
              </div>
              <div className="flex justify-self-end">
                {/* Com a conversa encerrada, o status e o botão ficam no plano (ou no cartão, no celular). */}
                {etapa === "conversa" && !fechada && (
                  <motion.button
                    layoutId="cta-plano"
                    onClick={() => setEtapa("plano")}
                    // O plano é montado pela extração em segundo plano: espera ela terminar para mostrar o plano completo.
                    disabled={atualizando || pensando}
                    transition={{ type: "spring", stiffness: 260, damping: 30 }}
                    className="rounded-full bg-texto px-4 py-2.5 text-[14px] font-medium text-texto-claro transition-colors duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
                  >
                    <motion.span layout="position" className="flex items-center gap-2">
                      {atualizando || pensando ? "Atualizando o plano…" : "Concluir conversa"}
                    </motion.span>
                  </motion.button>
                )}
                {/* Um só botão para ir e voltar entre a conversa e o plano. */}
                {etapa === "plano" && !config && (
                  <button
                    onClick={voltarParaConversa}
                    className="flex items-center gap-2 rounded-full bg-superficie px-4 py-2.5 text-[14px] font-medium text-texto transition-colors hover:bg-superficie-2"
                  >
                    <ArrowLeft size={15} /> Voltar à conversa
                  </button>
                )}
              </div>
            </header>

            {/* Conversa e plano ficam montados juntos: a que não está à vista só se esconde (e fica inerte),
                para não perder rolagem nem texto digitado, nem repetir a fala de encerramento. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div
                inert={etapa !== "conversa"}
                aria-hidden={etapa !== "conversa"}
                className={`flex min-h-0 flex-1 flex-col ${etapa !== "conversa" ? "pointer-events-none invisible absolute inset-0" : ""}`}
              >
              <div
                className={`mx-auto grid min-h-0 w-full flex-1 gap-4 transition-[max-width] duration-[900ms] ease-saida [grid-template-rows:minmax(0,1fr)] ${
                  fechada ? "max-w-[1360px] lg:[grid-template-columns:minmax(0,1.3fr)_minmax(360px,1fr)]" : "max-w-[760px]"
                }`}
              >
                {/* A conversa fica limpa: só o palco do Totti. O plano sobe quando ela termina. */}
                <div
                  className={`relative flex min-h-0 flex-col transition-opacity duration-500 [&>section]:min-h-0 [&>section]:flex-1 ${
                    fechada && larga ? "pointer-events-none opacity-55" : ""
                  }`}
                >
                  <ConversaTotti
                    sessaoId={estado.id}
                    cargo={estado.vaga?.roleTitle}
                    transcricao={estado.transcricao}
                    pensando={pensando}
                    bloqueada={finalizando}
                    pausarEntrada={planoPronto}
                    ativa={etapa === "conversa"}
                    abrirEmSilencio={tottiTerminou} /* só vale na montagem: sessão retomada já encerrada */
                    erro={erro}
                    onEnviar={responder}
                  />
                  <AnimatePresence>
                    {fechada && !larga && (
                      <ConversaConcluida
                        pronto={planoPronto}
                        combinados={combinados}
                        onRevisar={() => setEtapa("plano")}
                        onContinuar={() => setSeguirConversando(true)}
                      />
                    )}
                  </AnimatePresence>
                </div>
                <AnimatePresence>
                  {fechada && larga && (
                    <motion.div
                      key="plano-sobe"
                      initial={{ opacity: 0, y: 56 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 24 }}
                      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
                      className="flex min-h-0 flex-col [&>aside]:flex-1"
                    >
                      <PlanoSeMontando
                        rascunho={estado.rascunho}
                        pronto={planoPronto}
                        onRevisar={() => setEtapa("plano")}
                        onContinuar={() => setSeguirConversando(true)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              </div>
              {etapa === "plano" && (
                <div className="relative flex min-h-0 flex-1 flex-col">
                <RevisaoPlano
                  rascunho={estado.rascunho}
                  enviando={finalizando}
                  publicado={!!(posPublicacao && config)}
                  erros={errosRevisao}
                  onConfirmar={confirmar}
                  onMudar={(r, base) => { editadoNaRevisao.current = r ? { editado: r, base } : null; }}
                />
                <AnimatePresence>{posPublicacao && config && posPublicacao(config)}</AnimatePresence>
              </div>
              )}
            </div>
          </motion.div>
        )}

        {etapa === "pronta" && config && (
          <motion.div key="pronta" className="relative flex flex-1 items-center px-4 py-12">
            <EntrevistaPronta
              config={config}
              onNova={final?.acao ?? onSair ?? novaEntrevista}
              rotuloNova={final?.rotulo ?? (onSair ? "Voltar para as vagas" : undefined)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

/**
 * O Totti encerrou: a conversa escurece e um cartão no meio mostra o Totti montando o plano. Quando o plano
 * fica pronto, o cartão troca de conteúdo e o botão do canto do cabeçalho (mesmo `layoutId`) "voa" até aqui.
 */
function ConversaConcluida({
  pronto,
  combinados,
  onRevisar,
  onContinuar,
}: {
  pronto: boolean;
  combinados: number;
  onRevisar: () => void;
  onContinuar: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: curvaSuave }}
      className="absolute inset-0 z-10 flex items-center justify-center rounded-padrao bg-fundo/60 p-4 backdrop-blur-[2px]"
    >
      <motion.div
        layout
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.45, ease: curvaSuave }}
        className="flex w-full max-w-sm flex-col items-center gap-5 rounded-[24px] bg-superficie p-7 text-center shadow-flutuante"
        role="dialog"
        aria-label={pronto ? "Conversa concluída" : "Montando o plano"}
        aria-live="polite"
      >
        <AnimatePresence mode="wait" initial={false}>
          {pronto ? (
            <motion.div
              key="pronto"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: curvaSuave }}
              className="flex flex-col items-center gap-5"
            >
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                className="flex size-12 items-center justify-center rounded-full bg-texto text-texto-claro"
              >
                <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden>
                  <motion.path
                    d="M3.5 8.4 L6.6 11.3 L12.5 4.9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.35, delay: 0.15, ease: [0.32, 0.72, 0, 1] }}
                  />
                </svg>
              </motion.span>
              <div className="flex flex-col gap-1.5">
                <h2 className="titulo-display text-[24px] text-texto">Plano pronto</h2>
                <p className="text-[14.5px] leading-relaxed text-texto-suave">
                  O Totti combinou {combinados} {combinados === 1 ? "ponto" : "pontos"} com você e montou o plano da entrevista.
                  Dê uma olhada e publique.
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="montando"
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-5"
            >
              <Montando />
              <div className="flex flex-col gap-1.5">
                <h2 className="titulo-display text-[24px] text-texto">Montando o plano</h2>
                <p className="text-[14.5px] leading-relaxed text-texto-suave">
                  O Totti está juntando o que vocês combinaram: formato, foco e critérios da entrevista.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {pronto && (
          <motion.button
            layoutId="cta-plano"
            onClick={onRevisar}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="group flex w-full items-center justify-center gap-2 rounded-full bg-texto px-5 py-3 text-[15px] font-medium text-texto-claro hover:opacity-90"
          >
            <motion.span layout="position" className="flex items-center gap-2">
              Revisar o plano <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </motion.span>
          </motion.button>
        )}
        <button onClick={onContinuar} className="text-[13px] text-texto-suave underline-offset-4 hover:text-texto hover:underline">
          Quero falar mais alguma coisa
        </button>
      </motion.div>
    </motion.div>
  );
}

/** Três barras do plano se preenchendo em sequência, em loop: o Totti "escrevendo" o plano. */
function Montando() {
  return (
    <span className="flex size-12 flex-col justify-center gap-[5px] rounded-full bg-superficie-2 px-3" aria-hidden>
      {[0.9, 0.65, 0.8].map((w, k) => (
        <span key={k} className="h-[3px] overflow-hidden rounded-full bg-texto/10" style={{ width: `${w * 100}%` }}>
          <motion.span
            className="block h-full rounded-full bg-texto"
            initial={{ width: "0%" }}
            animate={{ width: ["0%", "100%", "100%", "0%"] }}
            transition={{ duration: 1.8, times: [0, 0.4, 0.8, 1], repeat: Infinity, delay: k * 0.22, ease: "easeInOut" }}
          />
        </span>
      ))}
    </span>
  );
}

/** A tela tem largura para o plano ao lado da conversa (o `lg` do Tailwind). */
function useTelaLarga() {
  const [larga, setLarga] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setLarga(mq.matches);
    const mudar = () => setLarga(mq.matches);
    mq.addEventListener("change", mudar);
    return () => mq.removeEventListener("change", mudar);
  }, []);
  return larga;
}
