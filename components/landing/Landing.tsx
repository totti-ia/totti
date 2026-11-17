"use client";

// Landing do Totti: o que a raiz do site mostra para quem chega sem `?config=` (ver app/page.tsx).
// Hierarquia: o que é (herói, tela cheia) → como funciona (rolagem guiada, passo a passo) → por que (o custo de
// entrevistar à mão) → pedir demonstração. Ao sair do herói, a navegação vira uma pílula flutuante no topo, que
// some durante o "como funciona" para o foco ficar nos passos.
// Todo CTA abre o pop-up de demonstração (PedirDemonstracao); a landing não leva ao painel, que tem dados de exemplo.
// As cenas no palco escuro são ilustração do produto, não dados ao vivo.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Mail } from "lucide-react";
import Perola from "@/components/totti/Perola";
import Revelar from "@/components/totti/Revelar";
import TituloRevelado from "@/components/totti/TituloRevelado";
import Marca from "@/components/vagas/Marca";
import { CONTATO_PADRAO } from "@/lib/contato/constantes";
import PedirDemonstracao from "./PedirDemonstracao";
import PesoDaEntrevista from "./PesoDaEntrevista";
import QuadroAoVivo from "./QuadroAoVivo";


/** O caminho completo, na ordem em que acontece. `quem` diz quem age em cada passo. */
const PASSOS = [
  {
    titulo: "Plano da vaga",
    quem: "Recrutadora e Totti",
    texto: "Você cola a descrição da vaga e conversa por voz com o Totti. Ele propõe formato, nível e critérios, pergunta o que reprova direto, e você aprova o plano.",
  },
  {
    titulo: "Convite e agendamento",
    quem: "Candidato",
    texto: "Cada candidato recebe o convite por e-mail, escolhe o horário e recebe a confirmação com o link da sala.",
  },
  {
    titulo: "Entrevista",
    quem: "Totti e candidato",
    texto: "Por voz, em live coding ou system design. O Totti acompanha o código e o desenho em tempo real e pergunta no momento certo.",
  },
  {
    titulo: "Relatório",
    quem: "Você",
    texto: "Nota por critério da vaga, com o trecho e o minuto de cada evidência. O Totti recomenda; quem decide é você.",
  },
  {
    titulo: "Feedback",
    quem: "Candidato",
    texto: "Quando você decide no painel, o candidato recebe o retorno por e-mail. Ninguém fica sem resposta.",
  },
];

/** Quanto de rolagem (em alturas de tela) cada passo do "como funciona" ocupa. */
const TELAS_POR_PASSO = 0.9;

const reduzMovimento = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Rola a página até `y` com uma curva suave (sem mexer no endereço, ao contrário de um link `#ancora`).
 * Se a pessoa girar a roda ou tocar na tela no meio do caminho, a rolagem automática para e devolve o controle.
 */
function rolarAte(y: number) {
  const destino = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight));
  if (reduzMovimento()) {
    scrollTo(0, destino);
    return;
  }
  const inicio = scrollY;
  const distancia = destino - inicio;
  const duracao = Math.min(1400, 650 + Math.abs(distancia) * 0.25);
  const t0 = performance.now();
  let raf = 0;
  const parar = () => {
    cancelAnimationFrame(raf);
    removeEventListener("wheel", parar);
    removeEventListener("touchstart", parar);
  };
  addEventListener("wheel", parar, { passive: true });
  addEventListener("touchstart", parar, { passive: true });
  const passo = (agora: number) => {
    const t = Math.min(1, (agora - t0) / duracao);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    scrollTo(0, inicio + distancia * e);
    if (t < 1) raf = requestAnimationFrame(passo);
    else parar();
  };
  raf = requestAnimationFrame(passo);
}

const rolarPara = (id: string) => {
  const el = document.getElementById(id);
  if (el) rolarAte(el.getBoundingClientRect().top + scrollY);
};

const BOTAO_PRINCIPAL =
  "group inline-flex h-[52px] items-center gap-2 rounded-full bg-texto px-6 text-[16px] font-semibold text-texto-claro shadow-[0_14px_40px_-16px_rgb(28_24_18/0.6)] transition-transform duration-rapida hover:-translate-y-px active:scale-[0.98]";

function BotaoDemo({ onClick, children = "Agendar uma demonstração" }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={BOTAO_PRINCIPAL}>
      {children}
      <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export default function Landing() {
  const [demo, setDemo] = useState(false);
  const abrir = useCallback(() => setDemo(true), []);
  const fechar = useCallback(() => setDemo(false), []);
  const heroi = useRef<HTMLElement>(null);
  const como = useRef<HTMLElement>(null);
  const [pilula, setPilula] = useState(false);

  // A pílula aparece depois que o herói vai embora e some enquanto o "como funciona" está preso na tela.
  useEffect(() => {
    let raf = 0;
    const medir = () => {
      raf = 0;
      const h = heroi.current?.getBoundingClientRect();
      const c = como.current?.getBoundingClientRect();
      const passouDoHeroi = h ? h.bottom < innerHeight * 0.45 : false;
      const noComo = c ? c.top <= 1 && c.bottom >= innerHeight - 1 : false;
      setPilula(passouDoHeroi && !noComo);
    };
    const aoRolar = () => {
      if (!raf) raf = requestAnimationFrame(medir);
    };
    medir();
    addEventListener("scroll", aoRolar, { passive: true });
    addEventListener("resize", aoRolar);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", aoRolar);
      removeEventListener("resize", aoRolar);
    };
  }, []);

  return (
    <div className="min-h-dvh overflow-x-clip bg-fundo text-texto">
      <Heroi ref={heroi} onDemo={abrir} />
      <Pilula visivel={pilula && !demo} onDemo={abrir} />
      <ComoFunciona ref={como} />
      <PesoDaEntrevista />

      <section className="bg-texto px-6 py-[96px] text-texto-claro">
        <Revelar className="mx-auto flex max-w-[1240px] flex-col items-start gap-6">
          <h2 className="titulo-display max-w-[720px] text-[clamp(32px,4vw,52px)] leading-[1.05]">Quer ver o Totti entrevistando para uma vaga sua?</h2>
          <p className="max-w-[560px] text-[17px] text-texto-claro/75">
            Deixe seu contato. A gente responde por e-mail, marca uma conversa e mostra o caminho inteiro, do plano ao relatório.
          </p>
          <button
            type="button"
            onClick={abrir}
            className="group inline-flex h-[52px] items-center gap-2 rounded-full bg-texto-claro px-6 text-[16px] font-semibold text-texto transition-transform duration-rapida hover:-translate-y-px active:scale-[0.98]"
          >
            Agendar uma demonstração
            <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        </Revelar>
      </section>

      <footer className="px-6 pt-14 pb-10">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-10">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div className="flex flex-col gap-3">
              <Marca href="/" />
              <p className="max-w-[320px] pl-2 text-[15px] text-texto-suave">Entrevistador técnico por voz. Do plano da vaga ao relatório com evidências.</p>
            </div>
            <div className="flex flex-col gap-2 pl-2 sm:items-end sm:pl-0">
              <span className="font-mono text-[12.5px] text-texto-suave">contato</span>
              <a href={`mailto:${CONTATO_PADRAO}`} className="inline-flex items-center gap-2 text-[16px] font-medium text-texto underline-offset-4 hover:underline">
                <Mail size={16} />
                {CONTATO_PADRAO}
              </a>
            </div>
          </div>
          <div className="flex flex-wrap justify-between gap-3 border-t border-borda pt-6 pl-2 text-[13px] text-texto-suave">
            <span>© {new Date().getFullYear()} totti</span>
            <span>Recife, Brasil</span>
          </div>
        </div>
      </footer>

      <PedirDemonstracao aberto={demo} onFechar={fechar} />
    </div>
  );
}

/** A navegação que acompanha a rolagem: pílula no topo, centralizada. Vai num portal (o app/template.tsx anima com transform). */
function Pilula({ visivel, onDemo }: { visivel: boolean; onDemo: () => void }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4">
      <nav
        aria-label="Navegação"
        aria-hidden={!visivel}
        inert={!visivel}
        className="tema-recrutador pointer-events-auto flex items-center gap-1 rounded-full p-1.5 pl-3 text-texto shadow-[0_1px_2px_rgb(28_24_18/0.06),0_18px_40px_-18px_rgb(28_24_18/0.45),inset_0_0_0_1px_rgb(28_24_18/0.08)] backdrop-blur-xl"
        style={{
          // inline: o .tema-recrutador pinta o fundo opaco, e a pílula é vidro
          background: "color-mix(in srgb, var(--superficie) 85%, transparent)",
          opacity: visivel ? 1 : 0,
          transform: visivel ? "none" : "translateY(-14px) scale(0.96)",
          transition: "opacity .35s var(--curva-saida), transform .5s var(--curva-saida)",
          pointerEvents: visivel ? "auto" : "none",
        }}
      >
        <button type="button" onClick={() => rolarAte(0)} className="flex items-center gap-2 rounded-full py-1 pr-3 pl-0.5" aria-label="Voltar ao topo">
          <Perola estado="pensando" tamanho={22} />
          <span className="font-display text-[18px] leading-none font-bold tracking-[-0.02em]">totti</span>
        </button>
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-borda sm:block" />
        <button type="button" onClick={() => rolarPara("como")} className="hidden rounded-full px-3.5 py-2 text-[14.5px] text-texto-suave transition-colors hover:text-texto sm:block">
          Como funciona
        </button>
        <button type="button" onClick={onDemo} className="rounded-full bg-texto px-4 py-2 text-[14.5px] font-semibold text-texto-claro transition-transform duration-rapida hover:-translate-y-px active:scale-[0.98]">
          Agendar demonstração
        </button>
      </nav>
    </div>,
    document.body,
  );
}

/** O herói ocupa a tela inteira: navegação no topo, texto e o quadro ao vivo no centro. */
function Heroi({ ref, onDemo }: { ref: React.Ref<HTMLElement>; onDemo: () => void }) {
  return (
    <header ref={ref} className="relative flex min-h-dvh flex-col">
      <nav className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-4 px-6 py-6">
        <Marca href="/" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => rolarPara("como")} className="hidden px-3.5 py-2.5 text-texto-suave transition-colors hover:text-texto sm:inline">
            Como funciona
          </button>
          <button
            type="button"
            onClick={onDemo}
            className="rounded-full px-4 py-2.5 text-texto shadow-[inset_0_0_0_1px_rgb(28_24_18/0.18)] transition-colors hover:bg-superficie"
          >
            Agendar demonstração
          </button>
        </div>
      </nav>

      <div className="mx-auto grid w-full max-w-[1240px] flex-1 items-center gap-14 px-6 pt-6 pb-24 [grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr))]">
        <div className="anim-subir flex flex-col gap-6" style={{ animationDuration: ".8s" }}>
          <span className="inline-flex h-8 items-center gap-2 self-start rounded-full bg-superficie pr-3.5 pl-2.5 text-[13.5px] text-texto-suave shadow-padrao">
            <Perola tamanho={14} />
            Entrevistador técnico por voz
          </span>
          <h1 className="titulo-display text-[clamp(44px,6vw,80px)] leading-[0.98]">
            <TituloRevelado texto="Cole a vaga." atraso={0.1} />
            <br />
            <TituloRevelado texto="O Totti entrevista." atraso={0.3} />
            <br />
            <em className="italic text-texto [font-variation-settings:'SOFT'_100,'WONK'_1]">Você decide.</em>
          </h1>
          <p className="max-w-[520px] text-[19px] text-texto-suave">
            O Totti monta o plano da entrevista com você, conduz a conversa por voz acompanhando o código e o desenho do candidato, e entrega a nota de
            cada critério com a evidência.
          </p>
          <div className="flex flex-wrap gap-3">
            <BotaoDemo onClick={onDemo} />
            <button
              type="button"
              onClick={() => rolarPara("como")}
              className="inline-flex h-[52px] items-center rounded-full bg-superficie px-[22px] text-[16px] font-medium text-texto shadow-[inset_0_0_0_1px_rgb(28_24_18/0.16)] transition-colors hover:bg-superficie-2"
            >
              Ver como funciona
            </button>
          </div>
        </div>

        <div className="anim-subir" style={{ animationDuration: ".9s", animationDelay: ".15s" }}>
          <QuadroAoVivo />
        </div>
      </div>
    </header>
  );
}

/**
 * Como funciona, guiado pela rolagem: a seção é alta e o conteúdo fica preso na tela. Cada trecho de rolagem
 * avança um passo (a linha do passo enche junto com a rolagem) e troca a cena à direita.
 * Clicar num passo rola até ele. Com "reduzir movimento", a rolagem até o passo é direta.
 */
function ComoFunciona({ ref }: { ref: React.RefObject<HTMLElement | null> }) {
  const [progresso, setProgresso] = useState(0);

  useEffect(() => {
    let raf = 0;
    const medir = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const curso = r.height - innerHeight;
      setProgresso(curso > 0 ? Math.max(0, Math.min(1, -r.top / curso)) : 0);
    };
    const aoRolar = () => {
      if (!raf) raf = requestAnimationFrame(medir);
    };
    medir();
    addEventListener("scroll", aoRolar, { passive: true });
    addEventListener("resize", aoRolar);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", aoRolar);
      removeEventListener("resize", aoRolar);
    };
  }, [ref]);

  const n = PASSOS.length;
  const bruto = progresso * n;
  const ativo = Math.min(n - 1, Math.floor(bruto));
  const local = Math.min(1, bruto - ativo);

  const irPara = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const curso = el.offsetHeight - innerHeight;
    rolarAte(el.getBoundingClientRect().top + scrollY + ((i + 0.08) / n) * curso);
  };

  return (
    <section ref={ref} id="como" className="relative bg-superficie" style={{ height: `${100 + n * TELAS_POR_PASSO * 100}dvh` }}>
      <div className="sticky top-0 flex h-dvh items-center overflow-hidden px-6">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 md:gap-10">
          <div className="flex max-w-[680px] flex-col gap-2.5">
            <span className="font-mono text-[13px] text-texto-suave">
              como funciona · {String(ativo + 1).padStart(2, "0")}/{String(n).padStart(2, "0")}
            </span>
            <h2 className="titulo-display hidden text-[clamp(30px,3.6vw,46px)] leading-[1.05] md:block">Da vaga ao retorno do candidato, em cinco passos.</h2>
          </div>

          <div className="grid items-center gap-6 md:gap-10 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
            <ol className="flex flex-col">
              {PASSOS.map((p, i) => {
                const on = i === ativo;
                const feito = i < ativo;
                return (
                  <li key={p.titulo} className="relative">
                    <span aria-hidden className="absolute top-0 bottom-0 left-0 w-px bg-borda" />
                    {/* a linha enche junto com a rolagem dentro do passo */}
                    <span
                      aria-hidden
                      className="absolute top-0 bottom-0 left-0 w-[2px] origin-top bg-texto"
                      style={{ transform: `scaleY(${on ? Math.max(0.04, local) : feito ? 1 : 0})`, opacity: on ? 1 : feito ? 0.25 : 0, transition: "opacity .4s" }}
                    />
                    <button
                      type="button"
                      onClick={() => irPara(i)}
                      aria-current={on ? "step" : undefined}
                      className="group flex w-full flex-col py-2.5 pl-7 text-left md:py-3.5"
                    >
                      <span className="flex items-baseline gap-3">
                        <span className="font-mono text-[13px] text-texto-suave">{String(i + 1).padStart(2, "0")}</span>
                        <span
                          className="titulo-display text-[clamp(22px,2.6vw,32px)] leading-[1.1] transition-colors duration-[480ms]"
                          style={{ color: on ? "var(--texto)" : "var(--pedra)" }}
                        >
                          {p.titulo}
                        </span>
                      </span>
                      {/* só o passo ativo abre o texto: cabe numa tela só, em qualquer altura */}
                      <span
                        className="grid transition-[grid-template-rows,opacity] duration-500 ease-saida"
                        style={{ gridTemplateRows: on ? "1fr" : "0fr", opacity: on ? 1 : 0 }}
                      >
                        <span className="flex flex-col gap-1.5 overflow-hidden pl-[34px]">
                          <span className="pt-1.5 font-mono text-[12.5px] text-texto-suave">{p.quem}</span>
                          <span className="text-[15.5px] text-texto md:text-[16px]">{p.texto}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="relative h-[clamp(260px,40dvh,460px)] overflow-hidden rounded-[28px] bg-[#13110e] text-[#f5f0e8] md:h-[clamp(340px,56dvh,480px)]" style={{ "--fundo": "#13110e" } as React.CSSProperties} aria-hidden>
              <CenaDoPasso key={ativo} passo={ativo} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Um cartão de e-mail no palco escuro (convite e feedback). */
function CartaoEmail({ de, assunto, children, estilo }: { de: string; assunto: string; children: React.ReactNode; estilo: React.CSSProperties }) {
  return (
    <div className="w-full max-w-[400px] rounded-[18px] bg-[#f5f0e8] p-5 text-[#1c1812]" style={estilo}>
      <span className="font-mono text-[12px] text-[#6b675f]">de: {de}</span>
      <p className="mt-1 text-[16px] font-semibold">{assunto}</p>
      <div className="mt-3 text-[14.5px] leading-[1.5] text-[#3a352d]">{children}</div>
    </div>
  );
}

/** A cena de cada passo. Tudo entra em cascata ao trocar de passo. */
function CenaDoPasso({ passo }: { passo: number }) {
  const entra = (i: number) => ({ animation: `subir .6s var(--curva-saida) ${0.12 * i}s both` });

  if (passo === 0)
    return (
      <div className="flex h-full min-h-[280px] sm:min-h-[360px] flex-col justify-center gap-5 p-9">
        <div className="flex items-center gap-4" style={entra(0)}>
          <Perola estado="falando" tamanho={56} brilho />
          <p className="text-[16px] leading-[1.45]">“Vou propor live coding de 45 minutos, nível pleno. O que reprova direto?”</p>
        </div>
        <p className="pl-[72px] text-[15px] text-[#d9d1c4]" style={entra(1)}>
          Se a pessoa não escrever nenhum teste, nem continuo.
        </p>
        <div className="mt-2 flex flex-wrap gap-2" style={entra(2)}>
          {["Node + TypeScript", "Concorrência", "PostgreSQL", "Testes · eliminatório"].map((c) => (
            <span key={c} className="rounded-full bg-[#f5f0e8] px-3 py-1 text-[13px] font-semibold text-[#1c1812]">
              {c}
            </span>
          ))}
        </div>
        <span className="font-mono text-[12.5px] text-[#f5f0e8]/70" style={entra(3)}>
          › plano aprovado: live coding · 45 min · 4 critérios
        </span>
      </div>
    );

  if (passo === 1)
    return (
      <div className="flex h-full min-h-[280px] sm:min-h-[360px] flex-col items-center justify-center gap-4 p-9">
        <CartaoEmail de="Time de Recrutamento" assunto="Sua entrevista técnica: escolha o horário" estilo={entra(0)}>
          <div className="flex flex-wrap gap-2">
            {["seg 10:00", "seg 14:30", "ter 09:00", "ter 16:00"].map((h, i) => (
              <span
                key={h}
                className={`rounded-full px-3 py-1 font-mono text-[12.5px] ${i === 2 ? "bg-[#1c1812] text-[#f5f0e8]" : "shadow-[inset_0_0_0_1px_rgb(28_24_18/0.2)]"}`}
              >
                {h}
              </span>
            ))}
          </div>
        </CartaoEmail>
        <span className="font-mono text-[12.5px] text-[#f5f0e8]/70" style={entra(2)}>
          › horário confirmado, link da sala no e-mail
        </span>
      </div>
    );

  if (passo === 2)
    return (
      <div className="flex h-full min-h-[280px] sm:min-h-[360px] flex-col justify-center gap-6 py-9">
        {/* a faixa fica na própria linha (e não num `top` fixo), então acompanha o código em qualquer altura do palco */}
        <div className="font-mono text-[14px] leading-[26px]">
          {["permitir(cliente) {", "  const j = this.janelas.get(cliente);", "  if (agora - j.inicio >= this.ms) {", "    j.pedidos++;", "  }", "}"].map((l, i) => {
            const lendo = i === 2;
            return (
              <div
                key={i}
                className={`flex whitespace-pre pr-6 ${lendo ? "bg-[#f5f0e8]/12 text-[#f5f0e8] shadow-[inset_3px_0_0_#f5f0e8]" : "text-[#c9c2b6]"}`}
                style={entra(i)}
              >
                <span className="w-12 shrink-0 pr-4 text-right text-[#f5f0e8]/30">{i + 1}</span>
                {l}
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-1.5 px-9" style={entra(7)}>
          <span className="font-mono text-[12.5px] text-[#f5f0e8]/70">› Totti leu a linha 3 e pergunta:</span>
          <span className="text-[16px] leading-[1.45]">“Por que &gt;= e não &gt;? O que acontece na virada da janela?”</span>
        </div>
      </div>
    );

  if (passo === 4)
    return (
      <div className="flex h-full min-h-[280px] sm:min-h-[360px] flex-col items-center justify-center gap-4 p-9">
        <CartaoEmail de="Time de Recrutamento" assunto="Retorno sobre sua entrevista" estilo={entra(0)}>
          Oi, Marina! Obrigado por participar da entrevista para Backend Pleno. Queremos seguir com você para a próxima etapa.
        </CartaoEmail>
        <span className="font-mono text-[12.5px] text-[#f5f0e8]/70" style={entra(2)}>
          › decisão tomada no painel, retorno enviado
        </span>
      </div>
    );

  return (
    <div className="flex h-full min-h-[280px] sm:min-h-[360px] flex-col justify-center gap-5 p-9">
      <span className="font-mono text-[12.5px] text-[#f5f0e8]/70" style={entra(0)}>
        modelagem de dados · min 12:40
      </span>
      <p className="max-w-[420px] text-[19px] leading-[1.55]" style={entra(1)}>
        “Eu usaria janela deslizante{" "}
        {/* a evidência: um traço que corre por baixo do trecho, linha a linha quando ele quebra */}
        <span
          className="bg-no-repeat [background-position:0_100%] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
          style={{ backgroundImage: "linear-gradient(#f5f0e8, #f5f0e8)", backgroundSize: "100% 2px", animation: "sublinhar 1s var(--curva-saida) .9s both" }}
        >
          porque a fixa deixa passar o dobro
        </span>
        .”
      </p>
      <div className="h-2 max-w-[360px] overflow-hidden rounded-full bg-[#f5f0e8]/15" style={entra(3)}>
        <div className="h-full rounded-full bg-[#f5f0e8]" style={{ width: "88%", transformOrigin: "left", animation: "crescer 1s var(--curva-saida) .7s both" }} />
      </div>
      <span className="titulo-display text-[44px]" style={entra(4)}>
        3,5<span className="text-[20px] text-[#f5f0e8]/60"> / 4</span>
      </span>
    </div>
  );
}
