"use client";

// Landing do Totti: o que a raiz do site mostra para quem chega sem `?config=` (ver app/page.tsx).
// Hierarquia: o que é (herói, tela cheia) → como funciona (rolagem guiada, passo a passo) → por que (o custo de
// entrevistar à mão) → pedir demonstração.
// Todo CTA abre o pop-up de demonstração (PedirDemonstracao); a landing não leva ao painel, que tem dados de exemplo.
// As cenas no palco escuro são ilustração do produto, não dados ao vivo.
import { useCallback, useEffect, useRef, useState } from "react";
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
  const como = useRef<HTMLElement>(null);

  return (
    <div className="min-h-dvh overflow-x-clip bg-fundo text-texto">
      <Heroi onDemo={abrir} />
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
            <span>João Pessoa, Brasil</span>
          </div>
        </div>
      </footer>

      <PedirDemonstracao aberto={demo} onFechar={fechar} />
    </div>
  );
}

/** O herói ocupa a tela inteira: navegação no topo, texto e o quadro ao vivo no centro. */
function Heroi({ onDemo }: { onDemo: () => void }) {
  return (
    <header className="relative flex min-h-dvh flex-col">
      <nav className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center justify-between gap-4 px-6 py-6">
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

      <div className="mx-auto grid w-full max-w-[1320px] flex-1 items-center gap-12 px-6 pt-6 pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
        <div className="anim-subir flex flex-col gap-6" style={{ animationDuration: ".8s" }}>
          <span className="inline-flex h-8 items-center gap-2 self-start rounded-full bg-superficie pr-3.5 pl-2.5 text-[13.5px] text-texto-suave shadow-padrao">
            <Perola tamanho={14} />
            Entrevistador técnico por voz
          </span>
          <h1 className="titulo-display text-[clamp(42px,4.9vw,74px)] leading-[0.98]">
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
              <CenaDoPasso key={ativo} passo={ativo} p={Math.min(1, local / 0.8)} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const faixa = (p: number, a: number, b: number) => Math.max(0, Math.min(1, (p - a) / (b - a)));
/** Aparece entre a e b do progresso do passo: sobe e acende. */
const surge = (p: number, a: number, b = a + 0.12): React.CSSProperties => {
  const k = faixa(p, a, b);
  return { opacity: k, transform: `translateY(${(1 - k) * 10}px)` };
};
/** O texto vai sendo escrito conforme a rolagem. */
const escrito = (texto: string, p: number, a: number, b: number) => texto.slice(0, Math.round(texto.length * faixa(p, a, b)));

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

const CRITERIOS_DO_PLANO = ["Node + TypeScript", "Concorrência", "PostgreSQL", "Testes · eliminatório"];
const HORARIOS = ["seg 10:00", "seg 14:30", "ter 09:00", "ter 16:00"];
const CODIGO = ["permitir(cliente) {", "  const j = this.janelas.get(cliente);", "  if (agora - j.inicio >= this.ms) {", "    j.pedidos++;", "  }", "}"];

/**
 * A cena de cada passo, montada pela rolagem: `p` vai de 0 (o passo acabou de entrar) a 1 (cena completa).
 * Rolando, o plano se monta, o horário é escolhido, o código é escrito, a nota fecha e o retorno sai.
 */
function CenaDoPasso({ passo, p }: { passo: number; p: number }) {
  const caixa = "flex h-full flex-col justify-center gap-5 p-7 sm:p-9";

  if (passo === 0) {
    const pergunta = "“Vou propor live coding de 45 minutos, nível pleno. O que reprova direto?”";
    return (
      <div className={caixa}>
        <div className="flex items-start gap-4" style={surge(p, 0, 0.06)}>
          <Perola estado={p < 0.3 ? "falando" : "ouvindo"} tamanho={44} />
          <p className="min-h-[46px] text-[16px] leading-[1.45]">{escrito(pergunta, p, 0.02, 0.3)}</p>
        </div>
        <p className="pl-[60px] text-[15px] text-[#d9d1c4]" style={surge(p, 0.32)}>
          {escrito("Se a pessoa não escrever nenhum teste, nem continuo.", p, 0.32, 0.5)}
        </p>
        <div className="flex flex-wrap gap-2 pl-[60px]">
          {CRITERIOS_DO_PLANO.map((c, i) => (
            <span key={c} className="rounded-full bg-[#f5f0e8] px-3 py-1 text-[13px] font-semibold text-[#1c1812]" style={surge(p, 0.52 + i * 0.07, 0.6 + i * 0.07)}>
              {c}
            </span>
          ))}
        </div>
        <span className="pl-[60px] font-mono text-[12.5px] text-[#f5f0e8]/75" style={surge(p, 0.86)}>
          › plano aprovado: live coding · 45 min · 4 critérios
        </span>
      </div>
    );
  }

  if (passo === 1) {
    const escolhido = p >= 0.55;
    return (
      <div className={`${caixa} items-center`}>
        <CartaoEmail de="Time de Recrutamento" assunto="Sua entrevista técnica: escolha o horário" estilo={surge(p, 0, 0.12)}>
          <div className="flex flex-wrap gap-2">
            {HORARIOS.map((h, i) => (
              <span
                key={h}
                className={`rounded-full px-3 py-1 font-mono text-[12.5px] transition-colors duration-300 ${i === 2 && escolhido ? "bg-[#1c1812] text-[#f5f0e8]" : "shadow-[inset_0_0_0_1px_rgb(28_24_18/0.2)]"}`}
                style={surge(p, 0.14 + i * 0.07, 0.22 + i * 0.07)}
              >
                {h}
              </span>
            ))}
          </div>
        </CartaoEmail>
        <CartaoEmail de="Time de Recrutamento" assunto="Confirmado: terça, 09:00" estilo={surge(p, 0.66, 0.8)}>
          <span className="font-mono text-[12.5px]">totti.ia.br/entrevista · link da sala</span>
        </CartaoEmail>
      </div>
    );
  }

  if (passo === 2) {
    const total = CODIGO.reduce((n, l) => n + l.length, 0);
    let resta = Math.round(total * faixa(p, 0, 0.5));
    const lendo = p >= 0.56;
    return (
      <div className="flex h-full flex-col justify-center gap-6 py-7 sm:py-9">
        <div className="font-mono text-[13px] leading-[26px] sm:text-[14px]">
          {CODIGO.map((l, i) => {
            const visivel = l.slice(0, Math.max(0, resta));
            resta -= l.length;
            const marcada = lendo && i === 2;
            return (
              <div
                key={i}
                className={`flex whitespace-pre pr-6 transition-colors duration-300 ${marcada ? "bg-[#f5f0e8]/12 text-[#f5f0e8] shadow-[inset_3px_0_0_#f5f0e8]" : "text-[#c9c2b6]"}`}
              >
                <span className="w-12 shrink-0 pr-4 text-right text-[#f5f0e8]/30">{i + 1}</span>
                {visivel}
                {resta > -l.length && resta < 0 && <span className="ml-px inline-block h-[18px] w-[2px] translate-y-[4px] bg-[#f5f0e8]" />}
              </div>
            );
          })}
        </div>
        <div className="flex min-h-[72px] flex-col gap-1.5 px-7 sm:px-9">
          <span className="font-mono text-[12.5px] text-[#f5f0e8]/70" style={surge(p, 0.56)}>
            › Totti leu a linha 3 e pergunta:
          </span>
          <span className="text-[16px] leading-[1.45]">{escrito("“Por que >= e não >? O que acontece na virada da janela?”", p, 0.62, 0.95)}</span>
        </div>
      </div>
    );
  }

  if (passo === 3) {
    const nota = 3.5 * faixa(p, 0.55, 0.9);
    return (
      <div className={caixa}>
        <span className="font-mono text-[12.5px] text-[#f5f0e8]/70" style={surge(p, 0)}>
          modelagem de dados · min 12:40
        </span>
        <p className="max-w-[420px] text-[19px] leading-[1.55]" style={surge(p, 0.04)}>
          “Eu usaria janela deslizante{" "}
          <span
            className="bg-no-repeat [background-position:0_100%] [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
            style={{ backgroundImage: "linear-gradient(#f5f0e8, #f5f0e8)", backgroundSize: `${faixa(p, 0.2, 0.5) * 100}% 2px` }}
          >
            porque a fixa deixa passar o dobro
          </span>
          .”
        </p>
        <div className="h-2 max-w-[360px] overflow-hidden rounded-full bg-[#f5f0e8]/15" style={surge(p, 0.5)}>
          <div className="h-full rounded-full bg-[#f5f0e8]" style={{ width: `${(nota / 4) * 100}%` }} />
        </div>
        <span className="titulo-display text-[44px] tabular-nums" style={surge(p, 0.52)}>
          {nota.toFixed(1).replace(".", ",")}
          <span className="text-[20px] text-[#f5f0e8]/60"> / 4</span>
        </span>
      </div>
    );
  }

  const decidido = p >= 0.3;
  return (
    <div className={`${caixa} items-center`}>
      <div className="flex w-full max-w-[400px] items-center justify-between gap-3 rounded-[18px] bg-[#f5f0e8]/8 p-4" style={surge(p, 0, 0.1)}>
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold">Marina Costa</span>
          <span className="font-mono text-[12px] text-[#f5f0e8]/60">3,5 / 4 · recomenda seguir</span>
        </span>
        <span
          className={`rounded-full px-4 py-1.5 text-[13.5px] font-semibold transition-colors duration-300 ${decidido ? "bg-[#f5f0e8] text-[#1c1812]" : "shadow-[inset_0_0_0_1px_rgb(245_240_232/0.3)]"}`}
        >
          {decidido ? "Seguir ✓" : "Seguir"}
        </span>
      </div>
      <CartaoEmail de="Time de Recrutamento" assunto="Retorno sobre sua entrevista" estilo={surge(p, 0.38, 0.5)}>
        {escrito("Oi, Marina! Obrigado por participar da entrevista para Backend Pleno. Queremos seguir com você para a próxima etapa.", p, 0.45, 0.85)}
      </CartaoEmail>
      <span className="font-mono text-[12.5px] text-[#f5f0e8]/70" style={surge(p, 0.88)}>
        › retorno enviado
      </span>
    </div>
  );
}
