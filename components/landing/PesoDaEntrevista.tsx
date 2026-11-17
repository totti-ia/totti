"use client";

// "Por que o Totti": o custo escondido de entrevistar à mão, e a conta da vaga de quem está lendo.
// Nada de estatística de mercado inventada: a conta usa só premissas explícitas, que a pessoa ajusta.
import { useState } from "react";
import Revelar from "@/components/totti/Revelar";

/** Premissas da conta (aparecem escritas embaixo dela). */
const HORAS_POR_CANDIDATO = 1.5; // 1h de entrevista + 30 min entre preparar o roteiro e escrever o parecer
const HORAS_COM_TOTTI = 0.25; // ~15 min lendo o relatório com as evidências

const SEM = [
  { titulo: "Um sênior fora do código", texto: "Cada entrevista tira um engenheiro experiente do trabalho dele, com preparo antes e parecer depois." },
  { titulo: "Agenda que não fecha", texto: "Encaixar candidato e entrevistador leva dias. Nesse tempo, o bom candidato aceita outra proposta." },
  { titulo: "Régua que muda", texto: "Cada entrevistador pergunta de um jeito e anota de outro. Comparar candidatos vira palpite." },
  { titulo: "Candidato no vácuo", texto: "Quem não passa raramente recebe retorno, e a marca da empresa paga por isso." },
];

const COM = [
  { titulo: "Plano aprovado uma vez", texto: "Você e o Totti montam a entrevista a partir da vaga. Todo candidato passa pelo mesmo plano." },
  { titulo: "Entrevista no horário do candidato", texto: "O Totti conduz por voz, de manhã ou de madrugada, sem tirar ninguém do time da agenda." },
  { titulo: "Relatório pronto no fim", texto: "Nota por critério, com o trecho e o minuto de cada evidência. Você lê em minutos e decide." },
  { titulo: "Retorno para todos", texto: "Decidiu no painel, o candidato recebe o e-mail. Ninguém fica sem resposta." },
];

const fmtHoras = (h: number) => `${Math.round(h).toLocaleString("pt-BR")} h`;
const fmtReais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function PesoDaEntrevista() {
  const [candidatos, setCandidatos] = useState(20);
  const [vagas, setVagas] = useState(3);
  const [custoHora, setCustoHora] = useState(150);

  const entrevistas = candidatos * vagas;
  const horasSem = entrevistas * HORAS_POR_CANDIDATO;
  const horasCom = entrevistas * HORAS_COM_TOTTI;
  const economia = (horasSem - horasCom) * custoHora;

  return (
    <section className="mx-auto flex max-w-[1240px] flex-col gap-14 px-6 py-[110px]">
      <Revelar className="flex max-w-[760px] flex-col gap-3">
        <span className="font-mono text-[13px] text-texto-suave">por que o totti</span>
        <h2 className="titulo-display text-[clamp(32px,4.4vw,56px)] leading-[1.04]">Entrevista técnica custa caro. E quem paga é o seu time.</h2>
        <p className="max-w-[620px] text-[18px] text-texto-suave">
          Cada vaga técnica vira dezenas de horas de engenheiro sênior entrevistando, anotando e alinhando opinião. O Totti assume a entrevista
          inteira e devolve só a decisão para você.
        </p>
      </Revelar>

      <Revelar atraso={0.06} className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className="flex flex-col gap-1 rounded-[28px] p-8 shadow-[inset_0_0_0_1px_var(--borda)]">
          <span className="mb-3 font-mono text-[12.5px] text-texto-suave">entrevistando à mão</span>
          {SEM.map((s) => (
            <div key={s.titulo} className="flex gap-4 border-t border-borda py-4 first:border-t-0 first:pt-0">
              <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-pedra" />
              <span className="flex flex-col gap-1">
                <span className="text-[17px] font-semibold">{s.titulo}</span>
                <span className="text-[15.5px] text-texto-suave">{s.texto}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1 rounded-[28px] bg-[#13110e] p-8 text-[#f5f0e8]">
          <span className="mb-3 font-mono text-[12.5px] text-[#f5f0e8]/60">com o totti</span>
          {COM.map((s) => (
            <div key={s.titulo} className="flex gap-4 border-t border-[#f5f0e8]/10 py-4 first:border-t-0 first:pt-0">
              <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[#f5f0e8]" />
              <span className="flex flex-col gap-1">
                <span className="text-[17px] font-semibold">{s.titulo}</span>
                <span className="text-[15.5px] text-[#d9d1c4]">{s.texto}</span>
              </span>
            </div>
          ))}
        </div>
      </Revelar>

      <Revelar atraso={0.1} className="rounded-[28px] bg-superficie p-8 shadow-padrao sm:p-10">
        <div className="grid items-center gap-10 [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]">
          <div className="flex flex-col gap-7">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[12.5px] text-texto-suave">faça a conta do seu time</span>
              <h3 className="titulo-display text-[clamp(24px,2.6vw,32px)] leading-[1.1]">Quanto tempo de engenharia vai embora por mês?</h3>
            </div>
            <Controle rotulo="Candidatos entrevistados por vaga" valor={candidatos} min={5} max={80} passo={1} onMudar={setCandidatos} />
            <Controle rotulo="Vagas técnicas abertas por mês" valor={vagas} min={1} max={20} passo={1} onMudar={setVagas} />
            <Controle
              rotulo="Custo da hora do engenheiro"
              valor={custoHora}
              min={50}
              max={400}
              passo={10}
              onMudar={setCustoHora}
              formatar={(v) => fmtReais(v)}
            />
          </div>

          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1 rounded-[20px] p-5 shadow-[inset_0_0_0_1px_var(--borda)]">
                <span className="text-[13.5px] text-texto-suave">Entrevistando à mão</span>
                <span className="titulo-display text-[clamp(34px,4vw,48px)] leading-none tabular-nums">{fmtHoras(horasSem)}</span>
                <span className="font-mono text-[12px] text-texto-suave">de engenheiro sênior</span>
              </div>
              <div className="flex flex-col gap-1 rounded-[20px] bg-[#13110e] p-5 text-[#f5f0e8]">
                <span className="text-[13.5px] text-[#f5f0e8]/70">Com o Totti</span>
                <span className="titulo-display text-[clamp(34px,4vw,48px)] leading-none tabular-nums">{fmtHoras(horasCom)}</span>
                <span className="font-mono text-[12px] text-[#f5f0e8]/60">lendo relatórios</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[15px] text-texto-suave">Tempo de engenharia devolvido ao produto</span>
              <span className="titulo-display text-[clamp(40px,5vw,64px)] leading-none tabular-nums">
                {fmtReais(economia)}
                <span className="text-[0.4em] text-texto-suave"> /mês</span>
              </span>
            </div>
            <p className="font-mono text-[12px] leading-[1.6] text-texto-suave">
              Conta: {entrevistas.toLocaleString("pt-BR")} entrevistas/mês × 1h30 (1h de entrevista + 30 min de preparo e parecer). Com o Totti, ~15
              min por candidato lendo o relatório.
            </p>
          </div>
        </div>
      </Revelar>
    </section>
  );
}

function Controle({
  rotulo,
  valor,
  min,
  max,
  passo,
  onMudar,
  formatar = (v) => String(v),
}: {
  rotulo: string;
  valor: number;
  min: number;
  max: number;
  passo: number;
  onMudar: (v: number) => void;
  formatar?: (v: number) => string;
}) {
  return (
    <label className="flex flex-col gap-2.5">
      <span className="flex items-baseline justify-between gap-4 text-[15px]">
        <span className="text-texto-suave">{rotulo}</span>
        <span className="font-mono text-[15px] font-semibold tabular-nums">{formatar(valor)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={passo}
        value={valor}
        onChange={(e) => onMudar(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-[var(--texto)]"
      />
    </label>
  );
}
