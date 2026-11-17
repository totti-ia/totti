"use client";

// Pop-up de "agendar uma demonstração": todo CTA da landing abre este formulário. O envio vai para
// POST /api/contato, que manda um e-mail para o time; a conversa para marcar a reunião segue por e-mail.
//
// Vai num portal no <body>: o app/template.tsx anima a página com `transform`, e um ancestral com transform
// faz o `position: fixed` valer para a página inteira em vez da tela (o pop-up abria fora do centro).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useAnimationControls,
} from "motion/react";
import { ArrowRight, X } from "lucide-react";
import { BarrasDeVoz } from "@/components/totti/Perola";
import { CONTATO_PADRAO } from "@/lib/contato/constantes";

type Estado =
  | { fase: "editando" }
  | { fase: "enviando" }
  | { fase: "enviado" }
  | { fase: "erro"; msg: string; campos?: Record<string, string>; vez: number };

const SAIDA = [0.23, 1, 0.32, 1] as const;

export default function PedirDemonstracao({
  aberto,
  onFechar,
}: {
  aberto: boolean;
  onFechar: () => void;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "editando" });
  const [montado, setMontado] = useState(false);
  const primeiro = useRef<HTMLInputElement>(null);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!aberto) return;
    setEstado((e) => (e.fase === "enviado" ? { fase: "editando" } : e));
    const t = setTimeout(() => primeiro.current?.focus(), 120);
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    addEventListener("keydown", aoTeclar);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = overflow;
    };
  }, [aberto, onFechar]);

  async function enviar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const vez = estado.fase === "erro" ? estado.vez + 1 : 1;
    setEstado({ fase: "enviando" });
    const dados = Object.fromEntries(new FormData(ev.currentTarget));
    try {
      const r = await fetch("/api/contato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      if (r.ok) return setEstado({ fase: "enviado" });
      const corpo = (await r.json().catch(() => null)) as {
        campos?: Record<string, string>;
      } | null;
      if (r.status === 400 && corpo?.campos)
        return setEstado({
          fase: "erro",
          msg: "Confira os campos marcados.",
          campos: corpo.campos,
          vez,
        });
      if (r.status === 429)
        return setEstado({
          fase: "erro",
          msg: "Muitos pedidos seguidos. Tente de novo em alguns minutos.",
          vez,
        });
      setEstado({
        fase: "erro",
        msg: `Não deu para enviar agora. Se preferir, escreva para ${CONTATO_PADRAO}.`,
        vez,
      });
    } catch {
      setEstado({
        fase: "erro",
        msg: `Sem conexão. Se preferir, escreva para ${CONTATO_PADRAO}.`,
        vez,
      });
    }
  }

  if (!montado) return null;

  const enviando = estado.fase === "enviando";
  const campos = estado.fase === "erro" ? estado.campos : undefined;
  const vez = estado.fase === "erro" ? estado.vez : 0;

  return createPortal(
    // O portal sai da .tema-recrutador da página: reaplica o tema num embrulho `contents` (sem caixa, então o
    // `background` do tema não pinta nada e o fundo do pop-up continua translúcido).
    <div className="tema-recrutador contents">
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {aberto && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.16 } }}
              transition={{ duration: 0.2 }}
              onClick={onFechar}
              /* m-auto no cartão: centraliza quando cabe e deixa o fundo rolar quando não cabe (sem cortar). */
              className="fixed inset-0 z-50 flex overflow-y-auto overscroll-contain bg-[rgb(19_17_14/0.35)] p-4 backdrop-blur-sm"
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="titulo-demo"
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: 6,
                  scale: 0.98,
                  transition: { duration: 0.16 },
                }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="relative m-auto w-full max-w-[440px] rounded-[24px] bg-superficie p-6 text-texto shadow-[0_40px_80px_-30px_rgb(19_17_14/0.5)] sm:p-7"
              >
                <button
                  type="button"
                  onClick={onFechar}
                  aria-label="Fechar"
                  className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full text-texto-suave transition-colors hover:bg-superficie-2 hover:text-texto"
                >
                  <X size={18} />
                </button>

                <AnimatePresence mode="wait" initial={false}>
                  {estado.fase === "enviado" ? (
                    <Sucesso key="ok" onFechar={onFechar} />
                  ) : (
                    <motion.form
                      key="form"
                      onSubmit={enviar}
                      noValidate
                      exit={{ opacity: 0, transition: { duration: 0.14 } }}
                      className="flex flex-col gap-3.5"
                    >
                      <div className="mb-1 flex flex-col gap-1 pr-10">
                        <h2
                          id="titulo-demo"
                          className="titulo-display text-[28px] leading-[1.05]"
                        >
                          Agende uma demonstração
                        </h2>
                        <p className="text-[15px] text-texto-suave">
                          Deixe seu contato e a gente responde por e-mail para
                          marcar uma conversa.
                        </p>
                      </div>

                      <Campo
                        nome="nome"
                        rotulo="Nome"
                        erro={campos?.nome}
                        vez={vez}
                        autoComplete="name"
                        inputRef={primeiro}
                        obrigatorio
                      />
                      <Campo
                        nome="email"
                        rotulo="E-mail de trabalho"
                        tipo="email"
                        erro={campos?.email}
                        vez={vez}
                        autoComplete="email"
                        obrigatorio
                      />
                      <Campo
                        nome="empresa"
                        rotulo="Empresa"
                        erro={campos?.empresa}
                        vez={vez}
                        autoComplete="organization"
                      />
                      {/* armadilha de robô: escondida de gente e de leitor de tela */}
                      <input
                        type="text"
                        name="site"
                        tabIndex={-1}
                        autoComplete="off"
                        aria-hidden
                        className="hidden"
                      />

                      {estado.fase === "erro" && (
                        <p role="alert" className="text-[14px] text-perigo">
                          {estado.msg}
                        </p>
                      )}

                      <motion.button
                        type="submit"
                        disabled={enviando}
                        whileTap={{ scale: 0.98 }}
                        className="group mt-1 inline-flex h-12 items-center justify-center overflow-hidden rounded-full bg-texto px-6 text-[16px] font-semibold text-texto-claro transition-opacity disabled:cursor-wait"
                      >
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.span
                            key={enviando ? "enviando" : "pedir"}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -12 }}
                            transition={{ duration: 0.2, ease: SAIDA }}
                            className="inline-flex items-center gap-2"
                          >
                            {enviando ? (
                              <>
                                <BarrasDeVoz
                                  ativo
                                  n={4}
                                  altura={14}
                                  largura={3}
                                  className="!gap-[3px] text-texto-claro"
                                />
                                Enviando
                              </>
                            ) : (
                              <>
                                Pedir demonstração
                                <ArrowRight
                                  size={18}
                                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                                />
                              </>
                            )}
                          </motion.span>
                        </AnimatePresence>
                      </motion.button>
                    </motion.form>
                  )}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </MotionConfig>
    </div>,
    document.body,
  );
}

function Sucesso({ onFechar }: { onFechar: () => void }) {
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: SAIDA }}
      className="flex flex-col items-start gap-3 py-2"
    >
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
        <motion.circle
          cx="22"
          cy="22"
          r="20"
          fill="none"
          stroke="var(--texto)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, ease: SAIDA }}
        />
        <motion.path
          d="M13 23 L19.5 29.5 L31 16"
          fill="none"
          stroke="var(--texto)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.35, delay: 0.35, ease: SAIDA }}
        />
      </svg>
      <h2
        id="titulo-demo"
        className="titulo-display text-[28px] leading-[1.05]"
      >
        Pedido enviado.
      </h2>
      <p className="text-[15px] text-texto-suave">
        A gente responde no seu e-mail para combinar o melhor horário e mostrar
        o Totti numa vaga sua.
      </p>
      <button
        type="button"
        onClick={onFechar}
        className="mt-2 inline-flex h-11 items-center justify-center rounded-full px-5 font-medium shadow-[inset_0_0_0_1px_rgb(28_24_18/0.18)] transition-colors hover:bg-superficie-2"
      >
        Fechar
      </button>
    </motion.div>
  );
}

function Campo({
  nome,
  rotulo,
  tipo = "text",
  erro,
  vez,
  autoComplete,
  inputRef,
  obrigatorio = false,
}: {
  nome: string;
  rotulo: string;
  tipo?: string;
  erro?: string;
  /** Muda a cada envio com erro: refaz o tremor mesmo quando o erro é o mesmo. */
  vez: number;
  autoComplete?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  obrigatorio?: boolean;
}) {
  // Treme o campo com erro a cada envio, sem remontar o input (o que apagaria o que a pessoa digitou).
  const tremor = useAnimationControls();
  useEffect(() => {
    if (erro && vez)
      tremor.start({ x: [0, -5, 5, -3, 3, 0], transition: { duration: 0.36 } });
  }, [erro, vez, tremor]);

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[14px] font-medium">
        {rotulo}
        {!obrigatorio && (
          <span className="font-normal text-texto-suave"> (opcional)</span>
        )}
      </span>
      <motion.input
        animate={tremor}
        ref={inputRef}
        name={nome}
        type={tipo}
        required={obrigatorio}
        autoComplete={autoComplete}
        aria-invalid={Boolean(erro)}
        aria-describedby={erro ? `erro-${nome}` : undefined}
        className="h-11 rounded-[14px] bg-fundo px-3.5 text-[15px] shadow-[inset_0_0_0_1px_rgb(28_24_18/0.12)] outline-none transition-[background-color,box-shadow] duration-200 focus:bg-superficie focus:shadow-[inset_0_0_0_1.5px_var(--texto)] aria-invalid:shadow-[inset_0_0_0_1.5px_var(--perigo)]"
      />
      {erro && (
        <span id={`erro-${nome}`} className="text-[13px] text-perigo">
          {erro}
        </span>
      )}
    </label>
  );
}
