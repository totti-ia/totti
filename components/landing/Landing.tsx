"use client";

// Landing do Totti: o que a raiz do site mostra para quem chega sem `?config=` (ver app/page.tsx).
// Hierarquia: o que é (herói) → como funciona, da vaga ao feedback do candidato → por que → pedir demonstração.
// Todo CTA abre o pop-up de demonstração (PedirDemonstracao); a landing não leva ao painel, que tem dados de exemplo.
// As cenas no palco escuro são ilustração do produto, não dados ao vivo.
import { useCallback, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import Perola, { BarrasDeVoz } from "@/components/totti/Perola";
import Revelar from "@/components/totti/Revelar";
import TituloRevelado from "@/components/totti/TituloRevelado";
import Marca from "@/components/vagas/Marca";
import PedirDemonstracao from "./PedirDemonstracao";

const FONTE: [string, "forte" | "normal" | "claro"][] = [
  ["export class LimitadorDeTaxa {", "forte"],
  ["  private janelas = new Map<string, Janela>();", "normal"],
  ["", "normal"],
  ["  permitir(cliente: string, agora = Date.now()) {", "forte"],
  ["    const j = this.janelas.get(cliente);", "normal"],
  ["    if (!j || agora - j.inicio >= this.ms) {", "normal"],
  ["      this.janelas.set(cliente, { inicio: agora, pedidos: 1 });", "normal"],
  ["      return true;", "claro"],
  ["    }", "normal"],
  ["    j.pedidos++;", "forte"],
];
const COR = { forte: "#F5F0E8", normal: "#C9C2B6", claro: "#FFFFFF" } as const;
const LINHA = 26;

const PERGUNTA = "E se dois pedidos chegarem no mesmo milissegundo, na virada da janela?";
const RESPOSTA = "Aí passa o dobro… dá pra trocar por janela deslizante.";

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

const PORQUES = [
  { titulo: "A régua é a vaga", texto: "Os critérios saem da descrição e do que você aprovou no plano. Todo candidato é medido pelo mesmo plano." },
  { titulo: "Cada nota tem prova", texto: "Nada de impressão solta: cada critério aponta o trecho da conversa ou do código e o minuto em que aconteceu." },
  { titulo: "Você no controle", texto: "O Totti conduz e avalia, mas não aprova nem reprova ninguém sozinho. A decisão final fica no seu painel." },
];

/** Um tique a cada `ms`; parado com "reduzir movimento" (mostra o quadro final, sem animar). */
function useTique(ms: number) {
  const [t, setT] = useState(0);
  const [parado, setParado] = useState(false);
  useEffect(() => {
    const reduz = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setParado(reduz);
    if (reduz) return;
    const id = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return { t, parado };
}

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

  return (
    <div className="min-h-dvh bg-fundo text-texto">
      <nav className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-6 py-6">
        <Marca href="/" />
        <div className="flex flex-wrap items-center gap-2">
          <a href="#como" className="hidden px-3.5 py-2.5 text-texto-suave transition-colors hover:text-texto sm:inline">
            Como funciona
          </a>
          <button
            type="button"
            onClick={abrir}
            className="rounded-full px-4 py-2.5 text-texto shadow-[inset_0_0_0_1px_rgb(28_24_18/0.18)] transition-colors hover:bg-superficie"
          >
            Agendar demonstração
          </button>
        </div>
      </nav>

      <Heroi onDemo={abrir} />
      <ComoFunciona />
      <Porques />

      <section className="bg-texto px-6 py-[88px] text-texto-claro">
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

      <footer className="border-t border-borda px-6 py-7">
        <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-3 text-[13.5px] text-texto-suave">
          <span>Totti · Converge Challenge, Porto Digital, Recife</span>
          <span>A câmera do candidato nunca sai do computador dele.</span>
        </div>
      </footer>

      <PedirDemonstracao aberto={demo} onFechar={fechar} />
    </div>
  );
}

/** Texto e palco lado a lado: o palco ilustra o agente trabalhando numa entrevista. */
function Heroi({ onDemo }: { onDemo: () => void }) {
  const { t, parado } = useTique(55);
  // 260 tiques ≈ 14s por volta: digita, lê, pergunta, escuta, fecha a nota.
  const c = parado ? 240 : t % 260;
  let restante = Math.max(0, c) * 4;
  const codigo = FONTE.map(([txt, tom], i) => {
    const visivel = txt.slice(0, Math.max(0, Math.min(txt.length, restante)));
    restante -= txt.length + 1;
    return { n: i + 1, txt: visivel || " ", cor: COR[tom] };
  });
  const alvo = c < 110 ? null : c < 170 ? 9 : 5;
  const faixaY = 22 + (alvo ?? 9) * LINHA;
  const pq = Math.max(0, Math.min(PERGUNTA.length, (c - 115) * 2));
  const pr = Math.max(0, Math.min(RESPOSTA.length, (c - 180) * 2));
  const prog = Math.max(0, Math.min(1, (c - 215) / 18));
  const ease = 1 - Math.pow(1 - prog, 4);
  const falando = pq > 0 && pq < PERGUNTA.length;

  return (
    <section className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 pt-10 pb-20 [grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr))]">
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
          <a
            href="#como"
            className="inline-flex h-[52px] items-center rounded-full bg-superficie px-[22px] text-[16px] font-medium text-texto shadow-[inset_0_0_0_1px_rgb(28_24_18/0.16)] transition-colors hover:bg-superficie-2"
          >
            Ver como funciona
          </a>
        </div>
      </div>

      <div className="anim-subir relative" style={{ animationDuration: ".9s", animationDelay: ".15s" }} aria-hidden>
        <div className="overflow-hidden rounded-[28px] bg-[#13110e] text-[#f5f0e8] shadow-[0_50px_90px_-40px_rgb(28_24_18/0.7)]">
          <div className="flex items-center justify-between border-b border-[#f5f0e8]/8 px-[18px] py-3.5">
            <span className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-2.5 rounded-full bg-[#27231d]" />
              ))}
            </span>
            <span className="font-mono text-[12.5px] text-[#f5f0e8]/70">limitador.ts · Live Coding</span>
            <span className="font-mono text-[12.5px] text-[#f5f0e8]/50">exemplo</span>
          </div>

          <div className="relative min-h-[300px] pt-[22px] pb-[26px] font-mono text-[14px]" style={{ lineHeight: `${LINHA}px` }}>
            <div
              className="absolute inset-x-0 transition-[top,opacity] duration-[900ms] ease-viagem"
              style={{
                top: faixaY,
                height: LINHA,
                opacity: alvo === null ? 0 : 1,
                background: "rgb(245 240 232 / 0.12)",
                boxShadow: "inset 3px 0 0 #F5F0E8",
              }}
            />
            {codigo.map((l) => (
              <div key={l.n} className="relative flex whitespace-pre">
                <span className="w-11 pr-4 text-right text-[#f5f0e8]/30">{l.n}</span>
                <span style={{ color: l.cor }}>{l.txt}</span>
              </div>
            ))}
            {/* o cursor do Totti viaja até a linha que ele está lendo */}
            <div
              className="pointer-events-none absolute transition-[left,top] duration-[900ms] ease-viagem"
              style={{ left: alvo === null ? 380 : alvo === 9 ? 170 : 300, top: alvo === null ? 12 : faixaY + 14 }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20">
                <path d="M3 2 L17 9 L10 11 L7 18 Z" fill="#F5F0E8" stroke="#13110E" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <span className="absolute top-4 left-4 rounded-full bg-[#f5f0e8] px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-[#1c1812] font-sans">
                Totti
              </span>
            </div>
          </div>

          <div className="flex min-h-[92px] flex-col gap-2.5 border-t border-[#f5f0e8]/8 px-[18px] pt-4 pb-5">
            {pq > 0 && (
              <div className="flex items-start gap-2.5">
                <BarrasDeVoz ativo={falando} n={3} altura={16} largura={3} className="mt-[3px] shrink-0 !gap-0.5 text-[#f5f0e8]" />
                <span className="text-[15px]">
                  <b>Totti</b> {PERGUNTA.slice(0, pq)}
                </span>
              </div>
            )}
            {pr > 0 && (
              <div className="flex items-start gap-2.5">
                <span className="mt-[7px] size-2 shrink-0 rounded-full bg-[#f5f0e8]" />
                <span className="text-[15px] text-[#d9d1c4]">
                  <b className="text-[#f5f0e8]">Candidata</b> {RESPOSTA.slice(0, pr)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div
          className="absolute -right-3 -bottom-7 flex items-center gap-3.5 rounded-[18px] bg-superficie px-[18px] py-3.5 shadow-[0_24px_50px_-20px_rgb(28_24_18/0.45)] transition-[opacity,transform] duration-[600ms] ease-saida"
          style={{ opacity: prog > 0 ? 1 : 0, transform: `translateY(${prog > 0 ? 0 : 14}px)` }}
        >
          <span className="flex flex-col">
            <span className="text-[12.5px] text-texto-suave">Modelagem de dados</span>
            <span className="font-mono text-[12px] text-texto-suave">evidência · min 12:40</span>
          </span>
          <span className="titulo-display text-[30px]">{(3.5 * ease).toFixed(1).replace(".", ",")}</span>
        </div>
      </div>
    </section>
  );
}

/** Como funciona: os cinco passos sempre visíveis à esquerda (o ativo se acende), a cena do passo à direita. */
function ComoFunciona() {
  const [ativo, setAtivo] = useState(0);
  const [parado, setParado] = useState(false);
  useEffect(() => {
    const reduz = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setParado(reduz);
    if (reduz) return;
    const id = setInterval(() => setAtivo((a) => (a + 1) % PASSOS.length), 6500);
    return () => clearInterval(id);
  }, [ativo]);

  return (
    <section id="como" className="scroll-mt-4 bg-superficie px-6 py-[96px]">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-14">
        <Revelar className="flex max-w-[680px] flex-col gap-2.5">
          <span className="font-mono text-[13px] text-texto-suave">como funciona</span>
          <h2 className="titulo-display text-[clamp(32px,4vw,48px)] leading-[1.05]">Da vaga ao retorno do candidato, em cinco passos.</h2>
        </Revelar>

        <Revelar atraso={0.08} className="grid items-start gap-10 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
          <ol className="flex flex-col">
            {PASSOS.map((p, i) => {
              const on = i === ativo;
              return (
                <li key={p.titulo} className="relative">
                  <span aria-hidden className="absolute top-0 bottom-0 left-0 w-px bg-borda" />
                  {/* a linha que enche enquanto o passo está ativo */}
                  <span
                    aria-hidden
                    className="absolute top-0 bottom-0 left-0 w-[2px] origin-top bg-texto"
                    style={{
                      transform: `scaleY(${on || i < ativo ? 1 : 0})`,
                      opacity: on ? 1 : i < ativo ? 0.25 : 0,
                      transition: on && !parado ? "transform 6.5s linear, opacity .3s" : "opacity .5s",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setAtivo(i)}
                    aria-current={on ? "step" : undefined}
                    className="group flex w-full flex-col gap-1.5 py-4 pl-7 text-left"
                  >
                    <span className="flex items-baseline gap-3">
                      <span className="font-mono text-[13px] text-texto-suave">{String(i + 1).padStart(2, "0")}</span>
                      <span
                        className="titulo-display text-[clamp(24px,2.8vw,32px)] leading-[1.1] transition-colors duration-[480ms]"
                        style={{ color: on ? "var(--texto)" : "var(--pedra)" }}
                      >
                        {p.titulo}
                      </span>
                    </span>
                    <span className="pl-[34px] font-mono text-[12.5px] text-texto-suave">{p.quem}</span>
                    <span className="pl-[34px] text-[16px] transition-colors duration-[480ms]" style={{ color: on ? "var(--texto)" : "var(--texto-suave)" }}>
                      {p.texto}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="relative min-h-[360px] overflow-hidden rounded-[28px] bg-[#13110e] text-[#f5f0e8] lg:sticky lg:top-8" aria-hidden>
            <CenaDoPasso key={ativo} passo={ativo} />
          </div>
        </Revelar>
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
      <div className="flex h-full min-h-[360px] flex-col justify-center gap-5 p-9">
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
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 p-9">
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
      <div className="flex h-full min-h-[360px] flex-col justify-center gap-6 py-9">
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
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-4 p-9">
        <CartaoEmail de="Time de Recrutamento" assunto="Retorno sobre sua entrevista" estilo={entra(0)}>
          Oi, Marina! Obrigado por participar da entrevista para Backend Pleno. Queremos seguir com você para a próxima etapa.
        </CartaoEmail>
        <span className="font-mono text-[12.5px] text-[#f5f0e8]/70" style={entra(2)}>
          › decisão tomada no painel, retorno enviado
        </span>
      </div>
    );

  return (
    <div className="flex h-full min-h-[360px] flex-col justify-center gap-5 p-9">
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

/** Por que o Totti: três razões, sem número inventado. */
function Porques() {
  return (
    <section className="mx-auto flex max-w-[1240px] flex-col gap-12 px-6 py-[96px]">
      <Revelar className="flex max-w-[640px] flex-col gap-2.5">
        <span className="font-mono text-[13px] text-texto-suave">por que o totti</span>
        <h2 className="titulo-display text-[clamp(32px,4vw,48px)] leading-[1.05]">Entrevista técnica com régua, prova e você no comando.</h2>
      </Revelar>
      <Revelar como="ul" atraso={0.08} className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))]">
        {PORQUES.map((p) => (
          <li key={p.titulo} className="flex flex-col gap-2.5 rounded-[24px] bg-superficie p-7 shadow-padrao">
            <span className="titulo-display text-[26px] leading-[1.1]">{p.titulo}</span>
            <span className="text-[16px] text-texto-suave">{p.texto}</span>
          </li>
        ))}
      </Revelar>
    </section>
  );
}
