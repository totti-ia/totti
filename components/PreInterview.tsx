"use client";

// "Antes de começar": a última tela antes da entrevista, no mesmo papel e tinta do resto do site
// (tema-recrutador). Pouca coisa: a vaga, três passos curtos do formato (live coding ou system design),
// o essencial em pílulas e um botão. O passo das dicas segue o que a recrutadora combinou (`config.hints`).
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, Clock, Mic } from "lucide-react";
import { DEFAULT_CONFIG } from "@/lib/config/default";
import type { InterviewConfig } from "@/lib/contracts";
import { LANGUAGE_LABELS } from "@/lib/ide-constants";
import { DIFFICULTIES, difficultyForSeniority } from "@/lib/problems";
import { curvaSuave } from "@/lib/design/motion";
import Perola from "@/components/totti/Perola";

type Passo = { titulo: string; texto: string };

/** Os dois primeiros passos de cada formato; o terceiro é o das dicas. */
const PASSOS: Record<InterviewConfig["mode"], Passo[]> = {
  live_coding: [
    { titulo: "Converse primeiro", texto: "O entrevistador apresenta o problema. Pergunte à vontade: esclarecer conta." },
    { titulo: "Explique e programe", texto: "Conte o plano em voz alta, escreva no editor e rode os testes quando quiser." },
  ],
  system_design: [
    { titulo: "Entenda o problema", texto: "O entrevistador apresenta o sistema. Pergunte sobre escala e requisitos." },
    { titulo: "Desenhe no quadro", texto: "Monte a arquitetura no quadro e explique as escolhas e os trade-offs." },
  ],
};

const DICAS: Record<NonNullable<InterviewConfig["hints"]>, Passo> = {
  livres: { titulo: "Peça dicas se precisar", texto: "As dicas são graduais e ficam registradas no relatório." },
  leves: { titulo: "Uma dica, se travar", texto: "Dá para pedir uma dica leve, uma vez só." },
  nenhuma: { titulo: "Sem dicas", texto: "Se travar, conte onde travou e o que já tentou: isso também conta." },
};

/** `vaga`: config da vaga (saída da pré-entrevista da recrutadora); sem ela, a padrão. */
export default function PreInterview({ vaga = DEFAULT_CONFIG, convite }: { vaga?: InterviewConfig; convite?: string }) {
  const router = useRouter();
  const { roleTitle, durationMin, languages, mode } = vaga;
  const passos = [...PASSOS[mode], DICAS[vaga.hints ?? "livres"]];
  const nivel = DIFFICULTIES.find((d) => d.id === (vaga.difficulty ?? difficultyForSeniority(vaga.seniority)))?.label;
  const pilulas = [
    `${durationMin} minutos`,
    mode === "system_design" ? "Quadro de arquitetura" : languages.map((l) => LANGUAGE_LABELS[l] ?? l).join(" ou "),
    nivel ? `Nível ${nivel.toLowerCase()}` : null,
  ].filter((p): p is string => !!p);

  // System design abre o quadro; live coding abre o IDE. A mesma config e o mesmo convite seguem nos dois.
  const iniciar = () =>
    router.push(
      `${mode === "system_design" ? "/entrevista/system-design" : "/entrevista"}?config=${encodeURIComponent(vaga.id)}${convite ? `&convite=${convite}` : ""}${mode === "system_design" ? "&iniciar=1" : ""}`,
    );

  return (
    <div className="tema-recrutador min-h-dvh">
      <header className="mx-auto flex w-full max-w-[560px] items-center gap-2.5 px-5 pt-6">
        <Perola tamanho={20} />
        <span className="font-display text-[20px] leading-none font-bold tracking-[-0.02em] text-texto">totti</span>
      </header>

      <main className="mx-auto flex w-full max-w-[560px] flex-col gap-9 px-5 pt-14 pb-16 sm:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: curvaSuave }}
          className="flex flex-col gap-4"
        >
          <span className="font-mono text-[13px] text-texto-suave">{roleTitle}</span>
          <h1 className="titulo-display text-[40px] leading-[1.05] text-texto sm:text-[48px]">Pronto para começar?</h1>
          <p className="text-[16px] leading-relaxed text-texto-suave">
            Uma entrevista técnica por voz, com um entrevistador de IA que acompanha seu raciocínio. Não há pegadinhas: o objetivo é ver
            como você pensa.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {pilulas.map((p, i) => (
              <span key={p} className="numero flex h-8 items-center gap-1.5 rounded-full bg-superficie-2/70 px-3 text-[13px] text-texto">
                {i === 0 && <Clock size={13} strokeWidth={1.75} className="text-texto-suave" />}
                {p}
              </span>
            ))}
          </div>
        </motion.div>

        <ol className="cartao flex flex-col">
          {passos.map(({ titulo, texto }, i) => (
            <motion.li
              key={titulo}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.36, ease: curvaSuave, delay: 0.12 + 0.06 * i }}
              className="linha-lista flex gap-4 px-5 py-4"
            >
              <span className="font-mono flex size-7 shrink-0 items-center justify-center rounded-full bg-texto text-[12px] text-texto-claro">
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-medium text-texto">{titulo}</span>
                <span className="text-[14px] leading-relaxed text-texto-suave">{texto}</span>
              </span>
            </motion.li>
          ))}
        </ol>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="flex flex-col gap-4"
        >
          <button
            type="button"
            onClick={iniciar}
            className="group flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-texto text-[16px] font-semibold text-texto-claro shadow-[0_14px_40px_-16px_rgb(28_24_18/0.6)] transition-[opacity,transform] duration-[120ms] hover:-translate-y-px active:scale-[0.99]"
          >
            Começar a entrevista
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </button>
          <p className="flex items-center justify-center gap-1.5 text-center text-[13px] text-texto-suave">
            <Mic size={13} strokeWidth={1.75} /> O navegador vai pedir o microfone. Se preferir, dá para usar o chat.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
