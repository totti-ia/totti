"use client";

// "Por que o Totti": o custo escondido de entrevistar à mão, lado a lado com o que muda com o Totti.
// Nada de estatística de mercado inventada.
import Revelar from "@/components/totti/Revelar";

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

export default function PesoDaEntrevista() {
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
    </section>
  );
}
