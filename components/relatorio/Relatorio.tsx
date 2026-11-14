"use client";

// O relatório da entrevista, um só para os dois formatos (System Design no quadro e Live Coding na IDE).
// É o modelo dos dados mockados: veredito e nota, números que importam, nota por critério com a prova a um clique,
// linha do tempo, regra de reprovação, adaptação e aprendizado, e a decisão no fim. Quem alimenta é o tipo comum
// de `lib/relatorio` (ver `do-quadro.ts` e `da-ide.ts`); aqui não se sabe de onde o dado veio.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronDown, Printer, TriangleAlert, X } from "lucide-react";
import VoltarLink from "@/components/VoltarLink";
import DecisaoFinal from "@/components/report/DecisaoFinal";
import HistoriaDaEntrevista, { type Acontecimento } from "@/components/report/HistoriaDaEntrevista";
import MomentoDaSessao, { type MomentoProva } from "@/components/report/MomentoDaSessao";
import NotasDosCriterios, { type NotaCriterio } from "@/components/report/NotasDosCriterios";
import AprendidoComOTime from "@/components/squad/AprendidoComOTime";
import type { Gravacao } from "@/lib/contracts";
import { formatMs } from "@/lib/format";
import {
  NOME_DA_RECOMENDACAO,
  NOME_DO_STATUS_ELIMINATORIO,
  type AdaptacaoComum,
  type AprendizadoComum,
  type EliminatorioComum,
  type ProvaComum,
  type RelatorioComum,
} from "@/lib/relatorio/tipos";

const ORIGEM_ADAPTACAO = "Adaptação à mudança";
const ORIGEM_APRENDIZADO = "Aprendizado";
const ORIGEM_HISTORIA = "Acontecimento";
const ORIGEM_ELIMINATORIO = "Regra de reprovação";

/** "Próxima conversa" só faz sentido quando a pessoa segue no processo ou ainda falta evidência. */
const ROTULO_DO_BRIEFING: Record<RelatorioComum["recomendacao"], string> = {
  avancar: "Para a próxima conversa",
  avancar_com_ressalvas: "Para a próxima conversa",
  talvez: "Para a próxima conversa",
  evidencia_insuficiente: "Para a próxima conversa",
  nao_avancar: "O que sustenta a recomendação",
};

const nota1 = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Uma prova e de onde ela vem (critério, adaptação...): é o que o painel de momentos percorre. */
interface ProvaIndexada {
  prova: ProvaComum;
  origem: string;
  texto: string;
}

type DesenharProva = (p: ProvaComum, origem: string, chave: number) => ReactNode;

type Props = {
  r: RelatorioComum;
  /** Código, falas e execuções (Live Coding): com ela, cada prova abre o momento da sessão. */
  gravacao?: Gravacao | null;
  /** Mostra "Avançar / Não avançar" no fim. Desligado nos relatórios de exemplo do quadro, que não existem de verdade. */
  comDecisao?: boolean;
};

export default function Relatorio({ r, gravacao = null, comDecisao = true }: Props) {
  const [aberto, setAberto] = useState<number | null>(null);
  const [imagem, setImagem] = useState<string | null>(null);
  const fechar = useCallback(() => setAberto(null), []);

  // A prova só abre se há o que mostrar: com a gravação, o momento da sessão; sem ela, a foto do quadro.
  const abrivel = useCallback((p: ProvaComum) => (gravacao ? p.t !== null : !!p.imagem), [gravacao]);

  // Todas as provas do relatório, em ordem de tempo (sem minuto, no fim).
  const { todas, provas, indices } = useMemo(() => {
    const lista: ProvaIndexada[] = [];
    const add = (ps: ProvaComum[], origem: string) => ps.forEach((p) => lista.push({ prova: p, origem, texto: p.texto }));
    for (const c of r.criterios) if (c.nota !== null) add(c.provas, c.nome);
    for (const e of r.eliminatorios) add(e.provas, ORIGEM_ELIMINATORIO);
    if (r.adaptacao) add(r.adaptacao.provas, ORIGEM_ADAPTACAO);
    if (r.aprendizado) add(r.aprendizado.provas, ORIGEM_APRENDIZADO);
    for (const a of r.acontecimentos) {
      const texto = a.detalhe ? `${a.titulo}. ${a.detalhe}` : a.titulo;
      lista.push({ prova: { t: a.t, texto, tipo: "fala", elementos: [], imagem: null }, origem: ORIGEM_HISTORIA, texto });
    }
    const ordenada = lista
      .filter((p) => abrivel(p.prova))
      .sort((a, b) => (a.prova.t ?? Infinity) - (b.prova.t ?? Infinity));
    const emOrdem = [...lista].sort((a, b) => (a.prova.t ?? Infinity) - (b.prova.t ?? Infinity));
    return { todas: emOrdem, provas: ordenada, indices: new Map(ordenada.map((p, i) => [p.prova, i])) };
  }, [r, abrivel]);

  const momentos = useMemo<MomentoProva[]>(() => provas.map((p) => ({ t: p.prova.t ?? 0, origem: p.origem, text: p.texto })), [provas]);

  const abrir = useCallback(
    (i: number) => {
      if (gravacao) return setAberto(i);
      const url = provas[i]?.prova.imagem;
      if (url) setImagem(url);
    },
    [gravacao, provas],
  );

  const indiceDe = (p: ProvaComum) => indices.get(p);
  const abrirAdiante = gravacao || provas.some((p) => p.prova.imagem) ? abrir : undefined;

  const desenharProva: DesenharProva = (p, origem, chave) => {
    const indice = indiceDe(p);
    const tempo = p.t !== null ? <span className="numero shrink-0 font-medium">{formatMs(p.t)}</span> : null;
    const miolo = (
      <>
        {tempo}
        <span className="min-w-0">
          {p.texto}
          {p.elementos.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {p.elementos.map((nome, i) => (
                <span key={`${nome}-${i}`} className="rounded-full bg-superficie-2 px-2.5 py-0.5 text-[12.5px] text-texto">
                  {nome}
                </span>
              ))}
            </span>
          )}
        </span>
      </>
    );
    if (indice === undefined) {
      return (
        <p key={chave} className="flex items-baseline gap-2 py-1 text-corpo text-texto-suave">
          {miolo}
        </p>
      );
    }
    return (
      <button
        key={chave}
        type="button"
        onClick={() => abrir(indice)}
        aria-label={`Ver o momento${p.t !== null ? ` ${formatMs(p.t)}` : ""}: ${gravacao ? "código e conversa" : "o quadro"}`}
        title={origem}
        className="group -mx-2 flex w-[calc(100%+1rem)] items-baseline gap-2 rounded-controle px-2 py-1 text-left text-corpo text-texto-suave outline-none transition-colors duration-150 hover:bg-superficie-2 hover:text-texto focus-visible:ring-2 focus-visible:ring-marca"
      >
        {miolo}
      </button>
    );
  };

  const provasDe = (ps: ProvaComum[]) => ps.map(indiceDe).filter((i): i is number => i !== undefined);

  const notas: NotaCriterio[] = r.criterios.map((c) => ({
    id: c.id,
    nome: c.nome,
    nota: c.nota,
    resumo: c.justificativa || c.provas[0]?.texto,
    detalhe: c.nota !== null && c.significado ? `Nível ${c.nota} da rubrica: ${c.significado}` : undefined,
    provas: c.nota === null ? [] : provasDe(c.provas),
    regras: c.regras,
  }));
  const notasFora: NotaCriterio[] = [
    ...(r.adaptacao
      ? [{ id: "adaptacao", nome: ORIGEM_ADAPTACAO, nota: r.adaptacao.nota, resumo: r.adaptacao.justificativa || undefined, provas: provasDe(r.adaptacao.provas) }]
      : []),
    ...(r.aprendizado
      ? [{ id: "aprendizado", nome: ORIGEM_APRENDIZADO, nota: r.aprendizado.nota, resumo: r.aprendizado.provas[0]?.texto, provas: provasDe(r.aprendizado.provas) }]
      : []),
  ];

  const acontecimentos: Acontecimento[] = r.acontecimentos.map((a) => {
    const texto = a.detalhe ? `${a.titulo}. ${a.detalhe}` : a.titulo;
    const i = provas.findIndex((p) => p.origem === ORIGEM_HISTORIA && p.prova.t === a.t && p.texto === texto);
    return { ...a, momento: i >= 0 ? i : undefined };
  });

  const totalDeProvas = todas.filter((p) => p.origem !== ORIGEM_HISTORIA).length;
  const comNota = r.criterios.filter((c) => c.nota !== null).length;
  const semProva = r.criterios.filter((c) => c.nota === null);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-12 px-4 py-8 sm:px-8">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <VoltarLink texto="Voltar aos resultados" />
          <div className="flex items-center gap-2">
            {r.demonstracao && <span className="rounded-full bg-superficie-2 px-2.5 py-1 text-xs text-texto-suave">Dados de demonstração</span>}
            <button
              type="button"
              onClick={() => print()}
              className="inline-flex items-center gap-1.5 rounded-full border border-borda bg-superficie px-3.5 py-1.5 text-xs font-medium text-texto-suave outline-none transition-colors hover:text-texto focus-visible:ring-2 focus-visible:ring-marca"
            >
              <Printer size={14} aria-hidden />
              Salvar em PDF
            </button>
          </div>
        </div>

        {/* Veredito: o que o Totti recomenda, a nota geral e o porquê */}
        <header className="flex flex-col gap-4">
          <p className="text-[13px] text-texto-suave">
            {r.titulo} · {r.contexto}
          </p>
          {(r.candidato || r.realizadaEm || r.duracao) && (
            <p className="flex flex-wrap gap-x-2 text-[14px] text-texto-suave">
              {[r.candidato, r.realizadaEm, r.duracao].filter(Boolean).map((t, i) => (
                <span key={i} className={i === 0 && r.candidato ? "text-texto" : undefined}>
                  {i > 0 && <span aria-hidden>· </span>}
                  {t}
                </span>
              ))}
            </p>
          )}
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-texto-suave">O Totti recomenda</span>
              <h1 className="titulo-display text-[44px] leading-none">{NOME_DA_RECOMENDACAO[r.recomendacao]}</h1>
            </div>
            <NotaGeral nota={r.notaGeral} comNota={comNota} total={r.criterios.length} />
          </div>
          {r.resumo && <p className="max-w-3xl text-[16px] leading-relaxed text-pretty">{r.resumo}</p>}
          {r.briefing && (
            <div className="flex max-w-3xl flex-col gap-1">
              <span className="text-[13px] text-texto-suave">{ROTULO_DO_BRIEFING[r.recomendacao]}</span>
              <p className="text-[15px] leading-relaxed text-pretty">{r.briefing}</p>
            </div>
          )}
        </header>

        {r.fatos.length > 0 && (
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-padrao border border-borda bg-borda sm:grid-cols-3 lg:grid-cols-5">
            {r.fatos.map((f) => (
              <div key={f.nome} className="flex flex-col gap-1 bg-superficie px-4 py-3.5 odd:last:col-span-2 lg:odd:last:col-span-1">
                <dt className="text-[12.5px] text-texto-suave">{f.nome}</dt>
                <dd className="numero text-[16px] font-medium tabular-nums">{f.valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <Lista titulo="Pontos fortes" icone={<Check size={13} strokeWidth={2.5} />} itens={r.pontosFortes} vazio="Nada a destacar." />
        <Lista titulo="Pontos de atenção" icone={<TriangleAlert size={12} strokeWidth={2.25} />} itens={r.pontosDeAtencao} vazio="Nada a destacar." />
      </section>

      {(r.resumoDaSolucao || r.enunciado || r.desenhoFinal) && (
        <section className="flex flex-col gap-4 rounded-padrao bg-superficie p-5 sm:p-6">
          {r.resumoDaSolucao && <Bloco titulo="O que o candidato propôs" texto={r.resumoDaSolucao} />}
          {r.enunciado && <Bloco titulo="O problema proposto" texto={r.enunciado} />}
          {r.desenhoFinal && (
            <div className="flex flex-col gap-2">
              <h2 className="text-[13px] font-medium text-texto-suave">Desenho final, como estava ao encerrar</h2>
              <button
                type="button"
                onClick={() => setImagem(r.desenhoFinal)}
                aria-label="Ampliar o desenho final"
                className="group overflow-hidden rounded-pequeno outline-none focus-visible:ring-2 focus-visible:ring-marca"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- PNG servido pela sessão, sem otimização */}
                <img src={r.desenhoFinal} alt="Desenho final do candidato" className="max-h-[420px] w-full object-contain" />
              </button>
            </div>
          )}
        </section>
      )}

      {r.eliminatorios.length > 0 && <Eliminatorios lista={r.eliminatorios} desenharProva={desenharProva} />}

      <NotasDosCriterios
        titulo="Nota por critério"
        descricao="De 1 a 4. A nota geral é a média dos critérios com prova."
        notas={notas}
        onAbrir={abrirAdiante}
      />
      {semProva.length > 0 && r.formato === "system_design" && (
        <p className="-mt-8 text-[13px] text-texto-suave">
          {r.recomendacao === "nao_avancar" ? "O que ficou sem prova: " : "Sem prova, para a próxima conversa: "}
          {semProva.map((c) => c.nome).join(", ")}.
        </p>
      )}
      {notasFora.length > 0 && (
        <NotasDosCriterios
          titulo="Também observado"
          descricao="Como ele reagiu à mudança no problema e à ajuda. Não entra na nota geral."
          notas={notasFora}
          onAbrir={abrirAdiante}
        />
      )}

      {r.formato === "live_coding" ? (
        <HistoriaDaEntrevista
          duracao={gravacao?.durationMs ?? r.duracaoMs ?? 0}
          gravacao={gravacao}
          acontecimentos={acontecimentos}
          onAbrir={gravacao ? abrir : undefined}
        />
      ) : (
        <LinhaDoTempo provas={todas.filter((p) => p.origem !== ORIGEM_HISTORIA)} indices={indices} onAbrir={abrir} />
      )}

      <details className="group -mt-6 rounded-padrao border border-borda">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[14px] font-medium select-none [&::-webkit-details-marker]:hidden">
          Ver todas as provas em texto
          <span className="flex items-center gap-1 text-sm font-normal text-texto-suave">
            {totalDeProvas} {totalDeProvas === 1 ? "prova" : "provas"}
            <ChevronDown size={14} strokeWidth={1.75} className="transition-transform duration-150 group-open:rotate-180" aria-hidden />
          </span>
        </summary>
        <div className="space-y-6 border-t border-borda px-4 py-4">
          <section className="space-y-3">
            {r.criterios.map((c) => (
              <div key={c.id} className="rounded-padrao bg-superficie p-4 shadow-cartao">
                <p className="flex justify-between gap-3 font-medium">
                  {c.nome}
                  <span className="numero shrink-0">{c.nota === null ? "Sem nota" : `${c.nota}/4`}</span>
                </p>
                {c.justificativa && <p className="mt-1 text-corpo">{c.justificativa}</p>}
                {c.nota !== null && c.provas.map((p, i) => desenharProva(p, c.nome, i))}
                <div className="mt-3 empty:hidden">
                  <AprendidoComOTime regras={c.regras} />
                </div>
              </div>
            ))}
          </section>
          {r.adaptacao && <Adaptacao a={r.adaptacao} desenharProva={desenharProva} />}
          {r.aprendizado && <Aprendizado l={r.aprendizado} desenharProva={desenharProva} />}
        </div>
      </details>

      <div className="flex flex-col gap-4">
        {r.proximosPassos.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[17px] font-medium">Se avançar, explore na próxima etapa</h2>
            <ul className="flex flex-col gap-1.5 text-[14.5px] leading-snug">
              {r.proximosPassos.map((p) => (
                <li key={p} className="flex gap-2.5">
                  <ArrowRight size={14} strokeWidth={1.75} className="mt-[3px] shrink-0 text-texto-suave" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          </section>
        )}
        {comDecisao && <DecisaoFinal sessionId={r.id} />}
      </div>

      {(r.provasConferidas !== null || r.ajustes.length > 0) && (
        <footer className="flex flex-col gap-2 text-sm text-texto-suave">
          {r.provasConferidas !== null && (
            <p className="numero text-[12.5px]">
              {r.provasConferidas === 1 ? "1 prova conferida" : `${r.provasConferidas} provas conferidas`} na gravação
            </p>
          )}
          {r.ajustes.length > 0 && (
            <details>
              <summary className="w-fit cursor-pointer list-none text-texto underline decoration-transparent underline-offset-4 outline-none transition-[text-decoration-color] hover:decoration-texto focus-visible:underline">
                {r.ajustes.length === 1 ? "1 ajuste automático" : `${r.ajustes.length} ajustes automáticos`}
              </summary>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {r.ajustes.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </details>
          )}
        </footer>
      )}

      {gravacao && <MomentoDaSessao gravacao={gravacao} momentos={momentos} aberto={aberto} onFechar={fechar} onAbrir={setAberto} />}
      <ImagemAmpliada url={imagem} aoFechar={() => setImagem(null)} />
    </main>
  );
}

/** Nota geral: o número grande e uma barra de 0 a 4 preenchida até ele. */
function NotaGeral({ nota, comNota, total }: { nota: number | null; comNota: number; total: number }) {
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <span className="text-[13px] text-texto-suave">Nota geral</span>
      <span className="titulo-display text-[44px] leading-none tabular-nums">
        {nota === null ? "—" : nota1(nota)}
        <span className="text-[24px] text-texto-suave">/4</span>
      </span>
      <span className="relative h-1.5 w-40 overflow-hidden rounded-full bg-texto/10" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-texto" style={{ width: `${((nota ?? 0) / 4) * 100}%` }} />
      </span>
      {total > 0 && (
        <span className="text-[12.5px] text-texto-suave">
          {comNota} de {total} critérios com prova
        </span>
      )}
    </div>
  );
}

function Bloco({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-[13px] font-medium text-texto-suave">{titulo}</h2>
      <p className="max-w-[68ch] leading-relaxed text-pretty">{texto}</p>
    </div>
  );
}

/** Lista curta num cartão, com o mesmo ícone em cada item: forte ou atenção se distinguem pela forma, não pela cor. */
function Lista({ titulo, icone, itens, vazio }: { titulo: string; icone: ReactNode; itens: string[]; vazio: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-padrao bg-superficie p-5">
      <h2 className="text-[15px] font-medium">{titulo}</h2>
      {itens.length === 0 ? (
        <p className="text-[14px] text-texto-suave">{vazio}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {itens.map((i) => (
            <li key={i} className="flex gap-2.5 text-[14px] leading-snug">
              <span className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full bg-superficie-2 text-texto" aria-hidden>
                {icone}
              </span>
              {i}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Regra de reprovação: … · atendida / violada / não observada". Violada pesa em tinta cheia. */
function Eliminatorios({ lista, desenharProva }: { lista: EliminatorioComum[]; desenharProva: DesenharProva }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[17px] font-medium">Regras de reprovação</h2>
        <p className="text-sm text-texto-suave">Combinadas com a recrutadora na pré-entrevista. Regra violada pesa na recomendação.</p>
      </div>
      <ul className="divide-y divide-borda rounded-padrao bg-superficie px-4 sm:px-6">
        {lista.map((e, i) => (
          <li key={i} className="flex flex-col gap-1.5 py-4">
            <p className="text-[15px] font-medium">
              Regra de reprovação: {e.regra} ·{" "}
              <span className={e.status === "violada" ? "rotulo-destaque" : "text-texto-suave"}>{NOME_DO_STATUS_ELIMINATORIO[e.status]}</span>
            </p>
            {e.justificativa && <p className="text-[13.5px] leading-snug text-pretty text-texto-suave">{e.justificativa}</p>}
            {e.provas.map((p, k) => desenharProva(p, ORIGEM_ELIMINATORIO, k))}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A mudança que o Totti trouxe no meio e como ele se adaptou. Nota à parte, fora da geral. */
function Adaptacao({ a, desenharProva }: { a: AdaptacaoComum; desenharProva: DesenharProva }) {
  return (
    <section className="space-y-3">
      <h2 className="titulo">{ORIGEM_ADAPTACAO}</h2>
      <div className="rounded-padrao bg-superficie p-4 shadow-cartao">
        <p className="flex justify-between gap-3 font-medium">
          {a.titulo}
          <span className="numero shrink-0">{a.nota === null ? "Sem nota" : `${a.nota}/4`}</span>
        </p>
        <p className="label-pequena">{a.descricao} · fora da nota geral</p>
        {a.justificativa && <p className="mt-2 text-corpo">{a.justificativa}</p>}
        {a.nota !== null && a.significado && <p className="text-sm text-texto-suave">Nível {a.nota} da escala: {a.significado}</p>}
        {a.detalhes.length > 0 && <p className="mt-2 text-corpo text-texto-suave">{a.detalhes.join(" ")}</p>}
        {a.provas.map((p, i) => desenharProva(p, ORIGEM_ADAPTACAO, i))}
      </div>
    </section>
  );
}

/** Como ele pensa e aprende: que dica precisou, quanto levou para destravar e como reagiu à mudança. Fora da nota geral. */
function Aprendizado({ l, desenharProva }: { l: AprendizadoComum; desenharProva: DesenharProva }) {
  return (
    <section className="space-y-3">
      <h2 className="titulo">{ORIGEM_APRENDIZADO}</h2>
      <div className="rounded-padrao bg-superficie p-4 shadow-cartao">
        <p className="flex justify-between gap-3 font-medium">
          Como destravou e usou a ajuda
          <span className="numero shrink-0">{l.nota === null ? "Sem nota" : `${l.nota}/4`}</span>
        </p>
        <p className="label-pequena">{l.resumo} · fora da nota geral</p>
        {l.momentos.length === 0 ? (
          <p className="mt-2 text-corpo">Não travou nem precisou de dica nesta entrevista.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-corpo">
            {l.momentos.map((m, i) => (
              <li key={i} className="flex gap-3">
                <span className="numero shrink-0 text-texto-suave">{formatMs(m.t)}</span>
                <span>
                  <span className="font-medium">{m.titulo}</span> — {m.texto}
                </span>
              </li>
            ))}
          </ul>
        )}
        {l.provas.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-borda pt-3">{l.provas.map((p, i) => desenharProva(p, ORIGEM_APRENDIZADO, i))}</div>
        )}
      </div>
    </section>
  );
}

/** Sem gravação (quadro): as provas em ordem de tempo, cada uma com o critério de onde veio. Abre a foto do quadro. */
function LinhaDoTempo({ provas, indices, onAbrir }: { provas: ProvaIndexada[]; indices: Map<ProvaComum, number>; onAbrir: (i: number) => void }) {
  const comTempo = provas.map((p) => ({ p, i: indices.get(p.prova) })).filter(({ p }) => p.prova.t !== null);
  if (comTempo.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[17px] font-medium">Como foi a entrevista</h2>
        <p className="text-sm text-texto-suave">As provas em ordem de tempo, com o critério a que pertencem.</p>
      </div>
      <ol className="divide-y divide-borda rounded-padrao bg-superficie px-4 sm:px-6">
        {comTempo.map(({ p, i }, k) => {
          const abre = i !== undefined && !!p.prova.imagem;
          const conteudo = (
            <>
              <span className="numero w-12 shrink-0 text-texto">{formatMs(p.prova.t!)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-texto-suave">{p.origem}</span>
                <span className="block text-[14px] leading-snug text-pretty">{p.texto}</span>
              </span>
              {abre && <ChevronDown size={14} className="-rotate-90 text-texto-suave" aria-hidden />}
            </>
          );
          return (
            <li key={k}>
              {abre ? (
                <button
                  type="button"
                  onClick={() => onAbrir(i!)}
                  aria-label={`Ver o quadro no minuto ${formatMs(p.prova.t!)}`}
                  className="flex w-full items-center gap-3 py-3 text-left outline-none hover:bg-superficie-2/50 focus-visible:ring-2 focus-visible:ring-marca"
                >
                  {conteudo}
                </button>
              ) : (
                <div className="flex items-center gap-3 py-3">{conteudo}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ImagemAmpliada({ url, aoFechar }: { url: string | null; aoFechar: () => void }) {
  return (
    <AnimatePresence>
      {url && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={aoFechar}
          onKeyDown={(e) => e.key === "Escape" && aoFechar()}
          role="dialog"
          aria-modal="true"
          aria-label="Quadro do candidato"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-8 backdrop-blur-md print:hidden"
        >
          <div className="relative max-h-full max-w-5xl overflow-hidden rounded-padrao bg-superficie shadow-flutuante">
            {/* eslint-disable-next-line @next/next/no-img-element -- PNG servido pela sessão */}
            <img src={url} alt="O quadro do candidato" className="max-h-[85dvh] w-auto object-contain" />
            <button
              type="button"
              autoFocus
              onClick={aoFechar}
              aria-label="Fechar"
              className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-vidro text-texto-suave shadow-padrao outline-none hover:text-texto focus-visible:ring-2 focus-visible:ring-marca"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
