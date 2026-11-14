"use client";

// A conversa com o Totti. Sem balões coloridos: as falas dele em texto corrido, as do recrutador
// num bloco discreto à direita. Dá para anexar documentos (PDF, TXT, Markdown) pelo clipe:
// o texto vai para o Totti; na tela aparece só o cartão do documento.
// Depois de a pessoa enviar, o Totti "lê" por um instante e só então aparecem os três pontinhos de quem
// está digitando (ver ATRASO_DIGITANDO), como numa conversa de verdade.
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, FileText, Paperclip } from "lucide-react";
import Perola, { BarrasDeVoz, type EstadoPerola } from "@/components/totti/Perola";
import type { Turno } from "@/lib/pre-entrevista/rascunho";
import { ACEITOS, lerDocumento, type Documento } from "@/lib/pre-entrevista/tela/documentos";
import { curvaSaida } from "@/lib/design/motion";
import ListaDocumentos from "./ListaDocumentos";
import { useTranscricao } from "@/lib/transcricao/useTranscricao";
import { acrescentarFala } from "@/lib/transcricao/tipos";
import { termosDoTitulo } from "@/lib/transcricao/vocabulario";
import { DICA_DITADO_ENTER, useEnterDoDitado } from "@/lib/transcricao/enterDoDitado";
import { BotaoDitado, EstadoDitado } from "@/components/transcricao/ControleDitado";
import { JANELA_DO_TRECHO_ATRASADO_MS } from "@/lib/audio/fimDoTurno";
import { useFimDoTurno } from "@/lib/audio/useFimDoTurno";
import { useVozAgente } from "@/lib/voz/useVozAgente";
import { criarDetectorDeInterrupcao, type DetectorDeInterrupcao } from "@/lib/voz/detectorDeInterrupcao";
import type { CapturaAntecipada } from "@/lib/transcricao/capturaAntecipada";
import ControleVoz from "@/components/voz/ControleVoz";
import { criarPedidoDeRascunho, type PedidoDeRascunho } from "@/lib/conversa/pedidoDeRascunho";
import { rascunharFala, usarServidor } from "@/lib/pre-entrevista/tela/cliente";

/** Marca que separa a fala dos documentos anexados (ver `montarMensagem`). */
const MARCA = "\n\n[Documento anexado: ";

/** Quanto tempo depois do envio os três pontinhos aparecem. */
const ATRASO_DIGITANDO = 650;

export function montarMensagem(texto: string, documentos: Documento[]) {
  return texto + documentos.map((d) => `${MARCA}${d.nome}]\n${d.texto}`).join("");
}

/** A mensagem que o envio manda agora (fala e documentos); vazia, não há o que enviar. Usada pelo envio e pelo rascunho. */
function mensagemDoEnvio(texto: string, documentos: Documento[]): string {
  const t = texto.trim() || (documentos.length ? "Segue o documento." : "");
  return t ? montarMensagem(t, documentos) : "";
}

/** Separa o que a pessoa escreveu dos documentos que ela anexou. */
function separar(mensagem: string) {
  const [texto, ...partes] = mensagem.split(MARCA);
  return { texto, documentos: partes.map((p) => p.slice(0, p.indexOf("]"))) };
}

type Props = {
  sessaoId?: string;
  transcricao: Turno[];
  pensando: boolean;
  bloqueada?: boolean;
  pausarEntrada?: boolean;
  /** Falso quando a conversa está escondida (o plano está na tela): sem voz e sem microfone, mas o texto e a rolagem ficam. */
  ativa?: boolean;
  /** A sessão já estava encerrada quando a conversa montou: a última fala do Totti não toca de novo. */
  abrirEmSilencio?: boolean;
  erro: string | null;
  onEnviar: (mensagem: string) => void;
  /** Cargo da vaga: as palavras dele entram no vocabulário da transcrição (keyterms). */
  cargo?: string;
};

export default function ConversaTotti({
  sessaoId,
  transcricao,
  pensando,
  bloqueada: bloqueadaProp = false,
  pausarEntrada: pausarEntradaProp = false,
  ativa = true,
  abrirEmSilencio = false,
  erro,
  onEnviar,
  cargo,
}: Props) {
  // Escondida, a conversa fica travada como se o Totti estivesse pensando: a voz para e o microfone fecha.
  const bloqueada = bloqueadaProp || !ativa;
  const pausarEntrada = pausarEntradaProp || !ativa;
  const [texto, setTexto] = useState("");
  const [anexos, setAnexos] = useState<Documento[]>([]);
  const [erroAnexo, setErroAnexo] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  // O texto também fica num ref: o envio automático acontece depois de um await (fim do ditado), quando o estado
  // do render ainda não tem o último trecho transcrito.
  const textoRef = useRef("");
  const mudarTexto = (valor: string) => { textoRef.current = valor; setTexto(valor); };
  const termos = useMemo(() => termosDoTitulo(cargo), [cargo]);
  // O turno fechou sem texto (o Scribe ainda não confirmou o trecho): o próximo texto envia, se chegar até este prazo.
  const trechoAtrasadoAte = useRef(0);
  // Resposta antecipada: a cada trecho confirmado, pede ao servidor o rascunho da resposta (lib/conversa/pedidoDeRascunho.ts).
  const pedidoDeRascunho = useRef<PedidoDeRascunho | null>(null);
  const ditado = useTranscricao({
    termos,
    bloqueada: pensando || lendo || bloqueada || pausarEntrada,
    aoTexto: (fala) => {
      mudarTexto(acrescentarFala(textoRef.current, fala));
      // Texto transcrito prova fala, mesmo baixa: sem isso quem fala baixo nunca tem o turno fechado.
      marcarFala();
      const dentroDoPrazo = Date.now() < trechoAtrasadoAte.current;
      trechoAtrasadoAte.current = 0;
      if (dentroDoPrazo) void enviarFechado();
      else pedirRascunho();
    },
  });
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);

  const ultima = transcricao.at(-1);
  // As falas que já existiam ao montar com a sessão encerrada não tocam (só as novas).
  const silenciadasAte = useRef(abrirEmSilencio ? transcricao.length - 1 : -1);
  const falaDaVez = ultima?.role === "agente" && transcricao.length - 1 > silenciadasAte.current;
  const voz = useVozAgente({
    ultimaFala: falaDaVez ? { id: String(transcricao.length - 1), texto: ultima.text } : null,
    bloqueada: pensando || bloqueada,
    sessao: sessaoId ? { sessao_id: sessaoId, contexto: "pre" } : null,
  });

  const [digitando, setDigitando] = useState(false);
  useEffect(() => {
    if (!pensando) return setDigitando(false);
    const t = setTimeout(() => setDigitando(true), ATRASO_DIGITANDO);
    return () => clearTimeout(t);
  }, [pensando]);

  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: "smooth" });
  }, [transcricao.length, digitando]);

  // Ao voltar do plano, o campo de texto já está pronto para escrever.
  const jaMontou = useRef(false);
  useEffect(() => {
    if (ativa && jaMontou.current) campo.current?.focus({ preventScroll: true });
    jaMontou.current = true;
  }, [ativa]);

  useEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.style.height = "auto";
    c.style.height = `${Math.min(c.scrollHeight, 140)}px`;
  }, [texto]);

  async function anexar(arquivos: FileList) {
    setErroAnexo(null);
    setLendo(true);
    for (const a of Array.from(arquivos)) {
      try {
        const doc = await lerDocumento(a);
        setAnexos((lista) => (lista.some((d) => d.id === doc.id) ? lista : [...lista, doc]));
      } catch (e) {
        setErroAnexo(e instanceof Error ? e.message : String(e));
      }
    }
    setLendo(false);
  }

  // Lido pelo envio automático, que roda fora do render (timer e await).
  const atual = useRef({ anexos, pensando, lendo, bloqueada, pausarEntrada, onEnviar, turnos: transcricao.length });
  atual.current = { anexos, pensando, lendo, bloqueada, pausarEntrada, onEnviar, turnos: transcricao.length };

  // Um pedido de rascunho por sessão (só com servidor): o que o envio mandaria agora, sem gravar nada.
  useEffect(() => {
    if (!sessaoId || !usarServidor()) return;
    const pedido = criarPedidoDeRascunho((texto, sinal) => rascunharFala(sessaoId, texto, sinal));
    pedidoDeRascunho.current = pedido;
    return () => {
      pedido.cancelar();
      pedidoDeRascunho.current = null;
    };
  }, [sessaoId]);

  // Modo voz: ligar o mic pelo botão entra no modo voz. A fala vai sozinha na pausa e o mic reabre quando o Totti
  // termina de responder. Clicar no mic de novo, parar com Enter ou digitar sai do modo voz (texto fica para revisar).
  const modoVoz = useRef(false);
  const [emModoVoz, setEmModoVoz] = useState(false);
  // Sair do modo voz (mic desligado, texto digitado, conversa escondida) cancela o rascunho em curso.
  const mudarModoVoz = (ligado: boolean) => {
    modoVoz.current = ligado;
    setEmModoVoz(ligado);
    if (!ligado) pedidoDeRascunho.current?.cancelar();
  };
  // Quantos turnos havia quando a pessoa enviou pela voz (null: nada esperando resposta para reabrir o mic).
  const [turnosNoEnvio, setTurnosNoEnvio] = useState<number | null>(null);
  // Ao esconder a conversa, sai do modo voz: o mic não reabre sozinho quando a pessoa voltar.
  useEffect(() => {
    if (ativa) return;
    mudarModoVoz(false);
    setTurnosNoEnvio(null);
  }, [ativa]);
  const vozJaTocou = useRef(false);

  /**
   * Turno da pessoa aberto (modo voz, sem o Totti pensando nem falando): pede o rascunho com a mensagem que o envio
   * mandaria agora. O envio final usa `mensagemDoEnvio` também, então o corpo sai igual (ver `rascunharFala`).
   */
  function pedirRascunho() {
    const a = atual.current;
    if (!modoVoz.current || a.pensando || a.lendo || a.bloqueada || a.pausarEntrada || voz.ativa) return;
    const mensagem = mensagemDoEnvio(textoRef.current, a.anexos);
    if (mensagem) pedidoDeRascunho.current?.pedir(mensagem);
  }

  /** `comDitado`: o envio automático já parou o ditado, mas o estado do hook ainda não foi re-renderizado. */
  function enviar(comDitado = false) {
    const a = atual.current;
    const mensagem = mensagemDoEnvio(textoRef.current, a.anexos);
    if (!mensagem || a.pensando || a.lendo || a.bloqueada || a.pausarEntrada || (!comDitado && ditado.ativa)) return;
    voz.parar();
    a.onEnviar(mensagem);
    mudarTexto("");
    setAnexos([]);
    vozJaTocou.current = false;
    setTurnosNoEnvio(modoVoz.current ? a.turnos : null);
  }

  const pararDitado = ditado.parar;
  async function enviarFechado() {
    await pararDitado();
    if (modoVoz.current) enviar(true);
  }
  // Fim do turno pela regra única (lib/audio/fimDoTurno.ts): silêncio de 3,5 s ou fala baixa de 8 s fecham; voz alta
  // nunca fecha. Enquanto o Totti fala ou pensa, o turno não conta. Com texto, envia já; sem texto, espera o próximo trecho.
  const ativoFimDoTurno = emModoVoz && ditado.estado === "ouvindo" && !pensando && !voz.ativa;
  const { marcarFala } = useFimDoTurno({
    ativo: ativoFimDoTurno,
    obterEnergia: ditado.energia,
    // A pessoa voltou a falar alto: o turno fechado sem texto não vale mais; o próximo fechamento é de outro turno.
    aoMedir: (faixa) => { if (faixa === "alta") trechoAtrasadoAte.current = 0; },
    aoFechar: () => {
      // Trecho ainda sendo transcrito: espera o trecho final (aoTexto), sem prazo. Turno sem texto: espera um trecho curto.
      if (ditado.parcial.trim()) trechoAtrasadoAte.current = Infinity;
      else if (!textoRef.current.trim()) trechoAtrasadoAte.current = Date.now() + JANELA_DO_TRECHO_ATRASADO_MS;
      else void enviarFechado();
    },
  });
  // Turno reaberto ou modo voz encerrado: a marca do turno fechado sem texto não vale mais.
  useEffect(() => { trechoAtrasadoAte.current = 0; }, [ativoFimDoTurno]);
  // Erro no microfone ou na transcrição: sai do modo voz em vez de tentar reabrir em laço.
  useEffect(() => {
    if (ditado.estado === "erro") { mudarModoVoz(false); setTurnosNoEnvio(null); }
  }, [ditado.estado]);

  // Reabre o mic só depois que a resposta do Totti tocou (ou não tem como tocar): o mic corta a voz e a voz espera
  // o mic soltar (lib/audio/foco), então abrir antes cortaria a resposta ou travaria os dois.
  if (turnosNoEnvio !== null && voz.ativa) vozJaTocou.current = true;
  const respostaChegou = turnosNoEnvio !== null && transcricao.length > turnosNoEnvio && ultima?.role === "agente";
  const iniciarDitado = ditado.iniciar;
  useEffect(() => {
    if (!emModoVoz || !respostaChegou) return;
    if (pensando || bloqueada || pausarEntrada || lendo || ditado.ativa || voz.ativa) return;
    // Voz ligada e sem erro: espera ela tocar e terminar. Voz desligada ou com erro: reabre já.
    if (!vozJaTocou.current && voz.habilitada && voz.estado !== "erro") return;
    setTurnosNoEnvio(null);
    void iniciarDitado();
  }, [emModoVoz, respostaChegou, pensando, bloqueada, pausarEntrada, lendo, ditado.ativa, voz.ativa, voz.habilitada, voz.estado, iniciarDitado]);

  // Interromper o Totti: corta a fala e abre o microfone na hora (entra no modo voz). `captura` vem do detector de
  // interrupção, com o áudio de antes do disparo, para a primeira palavra da pessoa não se perder.
  function interromper(captura?: CapturaAntecipada) {
    voz.parar();
    setTurnosNoEnvio(null);
    mudarModoVoz(true);
    void iniciarDitado(captura);
  }
  const interromperRef = useRef(interromper);
  interromperRef.current = interromper;

  // Interrupção pela voz, só no modo voz (o microfone já foi liberado pela pessoa): enquanto o Totti fala, o
  // detector mede o microfone sem mandar nada à transcrição e dispara quando a pessoa fala por cima.
  const detector = useRef<DetectorDeInterrupcao | null>(null);
  const tottiFalando = voz.estado === "falando";
  const podeInterromperPelaVoz = emModoVoz && tottiFalando && !ditado.ativa && !pensando && !bloqueada && !pausarEntrada && !lendo;
  useEffect(() => {
    if (!podeInterromperPelaVoz) return;
    detector.current ??= criarDetectorDeInterrupcao({ aoInterromper: (captura) => interromperRef.current(captura) });
    const atual = detector.current;
    atual.iniciar();
    return () => atual.parar();
  }, [podeInterromperPelaVoz]);

  // Interrupção manual, sempre disponível enquanto o Totti fala: Esc, ou Espaço fora de um campo de texto.
  useEffect(() => {
    if (!voz.ativa || pensando || bloqueada || pausarEntrada || lendo) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      const digitando = !!alvo && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(alvo.tagName));
      if (e.key === "Escape" || (e.key === " " && !digitando)) {
        e.preventDefault();
        interromperRef.current();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [voz.ativa, pensando, bloqueada, pausarEntrada, lendo]);

  // O botão do mic e o Enter passam por aqui para ligar e desligar o modo voz.
  const ditadoComModoVoz: typeof ditado = {
    ...ditado,
    // Com o Totti falando, o botão do mic é uma interrupção: corta a fala e já ouve.
    iniciar: () => { if (voz.ativa) { interromper(); return Promise.resolve(); } mudarModoVoz(true); return ditado.iniciar(); },
    parar: () => {
      mudarModoVoz(false);
      setTurnosNoEnvio(null);
      return ditado.parar();
    },
  };

  // Fora do modo voz: Enter com o microfone ligado para de ouvir; o Enter seguinte envia o que foi transcrito.
  const aoTeclar = useEnterDoDitado(ditadoComModoVoz, () => enviar());

  // O palco: a pérola do Totti no centro, no estado do momento (pensando, falando, ouvindo você).
  const estadoPerola: EstadoPerola =
    digitando || voz.estado === "preparando" ? "pensando" : voz.estado === "falando" ? "falando" : ditado.ativa ? "ouvindo" : "ocioso";
  const legendaEstado =
    estadoPerola === "pensando" ? "Pensando…" : estadoPerola === "falando" ? "Totti está falando · clique para interromper" : estadoPerola === "ouvindo" ? "Ouvindo você…" : "Conversa por voz ou texto";
  const podeInterromper = voz.ativa && !pensando && !bloqueada && !pausarEntrada && !lendo;

  return (
    <section className="tema-noite flex min-h-0 flex-col overflow-hidden rounded-[28px] bg-fundo text-texto">
      <header className="flex items-center justify-end px-4 pt-3">
        <ControleVoz voz={voz} texto={ultima?.role === "agente" ? ultima.text : undefined} disabled={pensando || bloqueada} />
      </header>

      <div className="flex shrink-0 flex-col items-center gap-2 px-6 pt-4 pb-2">
        {podeInterromper ? (
          <button
            type="button"
            onClick={() => interromper()}
            aria-label="Interromper o Totti e falar"
            title="Interromper o Totti (Esc ou Espaço)"
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-texto/40"
          >
            <Perola estado={estadoPerola} tamanho={120} brilho />
          </button>
        ) : (
          <Perola estado={estadoPerola} tamanho={120} brilho />
        )}
        <BarrasDeVoz ativo={estadoPerola === "falando" || estadoPerola === "ouvindo"} n={7} altura={18} largura={3} className="mt-4" />
        <span role="status" className="text-[13px] text-texto-suave">
          {legendaEstado}
        </span>
      </div>

      <div ref={lista} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        <AnimatePresence initial={false}>
          {transcricao.map((t, i) => {
            if (t.role === "agente") {
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.48, ease: curvaSaida }}
                  className="flex max-w-[92%] flex-col gap-0.5 transition-opacity duration-[480ms]"
                  style={{ opacity: i >= transcricao.length - 2 ? 1 : 0.35 }}
                >
                  <span className="text-[12.5px] font-semibold text-texto">Totti</span>
                  <p className="text-[16px] leading-[1.5] whitespace-pre-wrap text-texto">{t.text}</p>
                </motion.div>
              );
            }
            const { texto: fala, documentos } = separar(t.text);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.48, ease: curvaSaida }}
                className="flex max-w-[92%] flex-col gap-0.5 transition-opacity duration-[480ms]"
                style={{ opacity: i >= transcricao.length - 2 ? 1 : 0.35 }}
              >
                <span className="text-[12.5px] font-semibold text-texto">Você</span>
                <p className="text-[16px] leading-[1.5] whitespace-pre-wrap text-[#d9d1c4]">{fala}</p>
                {documentos.map((nome) => (
                  <span
                    key={nome}
                    className="mt-1 flex w-fit items-center gap-2 rounded-pequeno bg-superficie-2 px-2.5 py-1.5 text-[13.5px] text-texto"
                  >
                    <FileText size={14} strokeWidth={1.5} className="text-texto-suave" />
                    {nome}
                  </span>
                ))}
              </motion.div>
            );
          })}
          {digitando && (
            <motion.div
              key="digitando"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.24, ease: curvaSaida }}
              className="flex flex-col gap-1"
              aria-live="polite"
            >
              <span className="text-[12.5px] font-semibold text-texto">Totti</span>
              <Digitando />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {erro && <p className="mx-6 mb-2 text-[13.5px] text-alerta-texto">{erro}</p>}

      <div className="flex flex-col gap-2 p-4">
        {anexos.length > 0 && (
          <ListaDocumentos documentos={anexos} onRemover={(id) => setAnexos((l) => l.filter((d) => d.id !== id))} compacto />
        )}
        {erroAnexo && <p className="text-[13px] text-alerta-texto">{erroAnexo}</p>}
        <EstadoDitado transcricao={ditado} dica={emModoVoz ? "Ouvindo… envio quando você fizer uma pausa." : DICA_DITADO_ENTER} />
        <div className="flex items-end gap-1.5 rounded-[24px] bg-superficie p-1.5 shadow-[inset_0_0_0_1px_rgb(245_240_232/0.1)] transition-shadow duration-[240ms] focus-within:shadow-[inset_0_0_0_1.5px_rgb(245_240_232/0.45)]">
          <button
            type="button"
            onClick={() => seletor.current?.click()}
            aria-label="Anexar documento"
            title="Anexar documento (PDF, TXT, Markdown)"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-texto-suave transition-colors hover:bg-superficie-2 hover:text-texto"
          >
            <Paperclip size={17} strokeWidth={1.6} />
          </button>
          <input
            ref={seletor}
            type="file"
            accept={ACEITOS}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void anexar(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            ref={campo}
            value={texto}
            readOnly={ditado.ativa}
            onChange={(e) => {
              if (modoVoz.current) { mudarModoVoz(false); setTurnosNoEnvio(null); }
              mudarTexto(e.target.value);
            }}
            onKeyDown={aoTeclar}
            rows={1}
            placeholder={lendo ? "Lendo o documento…" : "Escreva para o Totti…"}
            aria-label="Mensagem para o Totti"
            className="max-h-[140px] flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] text-texto outline-none placeholder:text-texto-suave/60"
          />
          <BotaoDitado transcricao={ditadoComModoVoz} campo={campo} disabled={pensando || lendo || bloqueada || pausarEntrada} />
          <button
            onClick={() => enviar()}
            disabled={(!texto.trim() && anexos.length === 0) || pensando || lendo || bloqueada || ditado.ativa}
            aria-label="Enviar"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-marca text-sobre-marca transition-[opacity,transform] duration-[120ms] active:scale-90 disabled:opacity-25"
          >
            <ArrowUp size={17} strokeWidth={2} />
          </button>
        </div>
      </div>
    </section>
  );
}

/** Os três pontinhos de quem está digitando. */
function Digitando() {
  return (
    <span className="flex h-9 w-fit items-center gap-1 rounded-full bg-superficie-2 px-3.5" aria-label="Totti está digitando">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-texto/70"
          animate={{ y: [0, -3.5, 0], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}
