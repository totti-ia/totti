"use client";

// A tela inicial da recrutadora. Ela separa as vagas pelo que cada uma precisa, na ordem do fluxo:
//   1. Definir o plano → vagas que ainda não andaram: o plano da entrevista está parado com o Totti.
//   2. Totti cuidando  → vagas publicadas em que o Totti convida e entrevista sozinho; nada a fazer.
//   3. Você decide     → vagas em que metade ou mais dos convidados já fez a entrevista: aprovar ou reprovar.
//      Antes disso a vaga fica com o Totti, mesmo com alguns relatórios prontos (ver prontaParaDecidir).
// O topo mostra os três passos com a contagem de cada um (e leva até a seção); embaixo vêm as seções, com
// busca e filtros valendo para todas. As encerradas ficam num link no fim.
// Os convites saem sozinhos ao publicar, então não há estágio de "enviar convites".
import { useCallback, useDeferredValue, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { MotionConfig, motion } from "motion/react";
import { ArrowRight, SlidersHorizontal, X } from "lucide-react";
import {
  NOME_AREA_VAGA,
  NOME_FORMATO_CURTO,
  NOME_ORDEM,
  NOME_SENIORIDADE_VAGA,
  ORDENS,
  compararVagas,
  descartarRascunho,
  diasDoRascunho,
  estagioDa,
  FRACAO_PARA_DECIDIR,
  fracaoEntrevistada,
  novosDa,
  prontaParaDecidir,
  numero,
  quandoFoi,
  situacaoDoRascunho,
  totaisDas,
  useVagas,
  type Area,
  type OrdemVagas,
  type RascunhoVaga,
  type Senioridade,
  type Totais,
  type VagaEmpresa,
} from "@/lib/vagas/workspace";
import type { InterviewConfig } from "@/lib/contracts";
import { buscaNormalizada, comConvites, useConvitesFeitos } from "@/lib/vagas/candidatos";
import { comReais, comUltimoRelatorio, useEntrevistasReais } from "@/lib/vagas/entrevistas";
import { curvaSaida, curvaSuave } from "@/lib/design/motion";
import TituloRevelado from "@/components/totti/TituloRevelado";
import Casca from "./Casca";
import { Busca, Etiqueta, Grupo, Pilula, Popover } from "./controles";

type Linha = VagaEmpresa & { estagio: ReturnType<typeof estagioDa> };
type Formato = InterviewConfig["mode"];
type IdGrupo = "plano" | "totti" | "decidir";

/** Quantas linhas cada seção mostra antes do "Mostrar mais". */
const POR_VEZ = 5;
// Dentro de cada seção, as vagas mexidas por último vêm primeiro (as reais antes das de exemplo).
const ORDEM_PADRAO: OrdemVagas = "recentes";

const hrefVaga = (id: string, etapa: "escores" | "entrevistas") => `/vagas/vaga?id=${encodeURIComponent(id)}&etapa=${etapa}`;
const hrefRascunho = (id: string) => `/vagas/nova?rascunho=${encodeURIComponent(id)}`;
const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`;

export default function Workspace() {
  const { vagas, rascunhos } = useVagas();
  return <Casca>{vagas && rascunhos && <Conteudo vagas={vagas} rascunhos={rascunhos} />}</Casca>;
}

function Conteudo({ vagas, rascunhos }: { vagas: VagaEmpresa[]; rascunhos: RascunhoVaga[] }) {
  const convites = useConvitesFeitos();
  const reais = useEntrevistasReais();
  // As entrevistas feitas pelo link e os convites feitos aqui entram no funil (e mudam o estágio da vaga).
  const linhas: Linha[] = useMemo(
    () =>
      vagas.map((v) => {
        const funil = comConvites(comReais(v.funil, v.resumo ? reais?.[v.resumo.configId] : undefined), convites[v.id]);
        const comFunil = { ...comUltimoRelatorio(v, v.resumo ? reais?.[v.resumo.configId] : undefined), funil };
        return { ...comFunil, estagio: estagioDa(comFunil) };
      }),
    [vagas, convites, reais],
  );

  const totais = useMemo(() => totaisDas(linhas), [linhas]);

  const [busca, setBusca] = useState("");
  const termo = useDeferredValue(buscaNormalizada(busca.trim()));
  const [area, setArea] = useState<Area | "">("");
  const [senioridade, setSenioridade] = useState<Senioridade | "">("");
  const [formato, setFormato] = useState<Formato | "">("");
  const [time, setTime] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [ordem, setOrdem] = useState<OrdemVagas>(ORDEM_PADRAO);
  const [verEncerradas, setVerEncerradas] = useState(false);

  const temFiltro = !!(area || senioridade || formato || time || responsavel);

  // Busca e gaveta valem para todas as seções.
  const base = useMemo(
    () =>
      linhas
        .filter(
          (v) =>
            (!area || v.area === area) &&
            (!senioridade || v.senioridade === senioridade) &&
            (!formato || v.resumo?.formato === formato) &&
            (!time || v.time === time) &&
            (!responsavel || v.responsavel === responsavel) &&
            (!termo || buscaNormalizada(`${v.cargo} ${v.time} ${v.responsavel} ${NOME_AREA_VAGA[v.area]}`).includes(termo)),
        )
        .sort(compararVagas(ordem)),
    [linhas, area, senioridade, formato, time, responsavel, termo, ordem],
  );
  // Rascunhos não têm área, senioridade, formato, time nem responsável: com esses filtros ligados, eles saem da lista.
  const planos = useMemo(
    () =>
      (temFiltro ? [] : rascunhos.filter((r) => !termo || buscaNormalizada(r.cargo).includes(termo))).sort((a, b) =>
        ordem === "az" ? a.cargo.localeCompare(b.cargo, "pt-BR") : diasDoRascunho(a) - diasDoRascunho(b),
      ),
    [rascunhos, temFiltro, termo, ordem],
  );
  const decidir = base.filter((v) => v.estagio !== "encerrada" && prontaParaDecidir(v));
  // Quem ainda não chegou na metade fica com o Totti. As mais adiantadas vêm primeiro (são as próximas a ir para a
  // decisão); as que passaram da metade sem nada a decidir (já foi tudo decidido) vão para o fim.
  const proximidade = (v: Linha) => (novosDa(v) === 0 && fracaoEntrevistada(v) >= FRACAO_PARA_DECIDIR ? -1 : fracaoEntrevistada(v));
  const totti = base
    .filter((v) => v.estagio !== "encerrada" && !prontaParaDecidir(v))
    .sort((a, b) => (ordem === "pendentes" ? proximidade(b) - proximidade(a) : 0));
  const encerradas = base.filter((v) => v.estagio === "encerrada");

  const refPlano = useRef<HTMLElement>(null);
  const refTotti = useRef<HTMLElement>(null);
  const refDecidir = useRef<HTMLElement>(null);
  const irPara = (id: IdGrupo) => {
    const alvo = { plano: refPlano, totti: refTotti, decidir: refDecidir }[id].current;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    alvo?.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
  };

  const limparGaveta = () => {
    setArea("");
    setSenioridade("");
    setFormato("");
    setTime("");
    setResponsavel("");
  };
  const limparTudo = () => {
    limparGaveta();
    setBusca("");
    setOrdem(ORDEM_PADRAO);
  };
  const unicos = (k: "time" | "responsavel") =>
    [...new Set(linhas.map((v) => v[k]).filter((x) => x && x !== "—"))].sort((a, b) => a.localeCompare(b, "pt-BR"));

  // Os filtros aplicados, à vista: cada um sai no próprio X.
  const aplicados: { rotulo: string; valor: string; tirar: () => void }[] = [
    ...(busca.trim() ? [{ rotulo: "Busca", valor: busca.trim(), tirar: () => setBusca("") }] : []),
    ...(area ? [{ rotulo: "Área", valor: NOME_AREA_VAGA[area], tirar: () => setArea("") }] : []),
    ...(senioridade ? [{ rotulo: "Senioridade", valor: NOME_SENIORIDADE_VAGA[senioridade], tirar: () => setSenioridade("") }] : []),
    ...(formato ? [{ rotulo: "Formato", valor: NOME_FORMATO_CURTO[formato], tirar: () => setFormato("") }] : []),
    ...(time ? [{ rotulo: "Time", valor: time, tirar: () => setTime("") }] : []),
    ...(responsavel ? [{ rotulo: "Responsável", valor: responsavel, tirar: () => setResponsavel("") }] : []),
  ];
  const filtrando = aplicados.length > 0;
  // A chave das seções muda com o filtro: cada uma volta às primeiras linhas.
  const chaveFiltro = `${termo}-${area}-${senioridade}-${formato}-${time}-${responsavel}-${ordem}`;

  return (
    // "user": com reduzir movimento ligado no sistema, o motion tira os deslizes.
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: curvaSuave }}
        className="mx-auto flex max-w-[1040px] flex-col gap-10"
      >
        <Cabecalho totais={totais} />

        <Fluxo planos={planos.length} totti={totti.length} decidir={decidir.length} onIr={irPara} />

        {/* Busca e filtros, valendo para todas as seções. */}
        <div className="-mb-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Busca valor={busca} onMudar={setBusca} placeholder="Buscar vaga, time ou responsável" />
            <Gaveta
              area={area}
              senioridade={senioridade}
              formato={formato}
              time={time}
              responsavel={responsavel}
              ordem={ordem}
              times={unicos("time")}
              responsaveis={unicos("responsavel")}
              onArea={setArea}
              onSenioridade={setSenioridade}
              onFormato={setFormato}
              onTime={setTime}
              onResponsavel={setResponsavel}
              onOrdem={setOrdem}
              onLimpar={limparGaveta}
            />
          </div>
          {filtrando && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[12.5px] text-texto-suave">Filtrando por</span>
              {aplicados.map((a) => (
                <Etiqueta key={a.rotulo} rotulo={a.rotulo} valor={a.valor} onTirar={a.tirar} />
              ))}
              <button
                onClick={limparTudo}
                className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium text-texto underline-offset-4 hover:underline"
              >
                <X size={12} /> Limpar tudo
              </button>
            </div>
          )}
        </div>

        <Secao
          ref={refPlano}
          key={`plano-${chaveFiltro}`}
          passo={1}
          titulo="Definir o plano com o Totti"
          dica="Estas vagas ainda não andaram: termine o plano da entrevista para o Totti começar a convidar."
          vazio={filtrando ? "Nenhuma vaga parada com esse filtro." : "Nenhuma vaga parada. Crie uma nova quando abrir uma posição."}
          total={planos.length}
          pede={planos.length > 0}
          acao={
            <Link
              href="/vagas/nova"
              className="flex h-8 items-center rounded-full bg-superficie-2/70 px-3.5 text-[13px] text-texto transition-colors hover:bg-superficie-2"
            >
              Nova vaga
            </Link>
          }
        >
          {(n) => planos.slice(0, n).map((r, i) => <LinhaRascunho key={r.id} r={r} indice={i} />)}
        </Secao>

        <Secao
          ref={refTotti}
          key={`totti-${chaveFiltro}`}
          passo={2}
          titulo="O Totti está cuidando"
          dica={`Ele convida e entrevista sozinho. Quando ${Math.round(FRACAO_PARA_DECIDIR * 100)}% dos convidados tiverem feito a entrevista, a vaga passa para a decisão.`}
          vazio={filtrando ? "Nenhuma vaga em andamento nesse filtro." : "Nenhuma vaga em andamento."}
          total={totti.length}
        >
          {(n) => totti.slice(0, n).map((v, i) => <LinhaVaga key={v.id} v={v} indice={i} />)}
        </Secao>

        <Secao
          ref={refDecidir}
          key={`decidir-${chaveFiltro}`}
          passo={3}
          titulo="Aprovar ou reprovar candidatos"
          dica="Mais da metade dos convidados já fez a entrevista: dá para comparar e decidir quem segue."
          vazio={filtrando ? "Nenhuma vaga com relatório pronto nesse filtro." : "Nenhum relatório esperando por você."}
          total={decidir.length}
          pede={decidir.length > 0}
        >
          {(n) => decidir.slice(0, n).map((v, i) => <LinhaVaga key={v.id} v={v} indice={i} />)}
        </Secao>

        {encerradas.length > 0 && (
          <section className="flex flex-col gap-3">
            <button
              onClick={() => setVerEncerradas((v) => !v)}
              aria-expanded={verEncerradas}
              className="self-start px-1 text-[13px] text-texto-suave underline-offset-4 hover:text-texto hover:underline"
            >
              {verEncerradas ? "Esconder vagas encerradas" : `Ver vagas encerradas (${numero(encerradas.length)})`}
            </button>
            {verEncerradas && (
              <ul className="cartao flex flex-col overflow-hidden">
                {encerradas.map((v, i) => (
                  <LinhaVaga key={v.id} v={v} indice={i} />
                ))}
              </ul>
            )}
          </section>
        )}
      </motion.div>
    </MotionConfig>
  );
}

// ---------------------------------------------------------------------------
// Topo: cabeçalho e o fluxo com as três contagens
// ---------------------------------------------------------------------------

/** Saudação e o estado geral numa frase: os números viram texto, não cartões. */
function Cabecalho({ totais: t }: { totais: Totais }) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] text-texto-suave first-letter:uppercase">{dataDeHoje()}</span>
        <h1 className="titulo-display text-[44px] text-texto">
          <TituloRevelado texto={saudacao()} />
        </h1>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-texto-suave">
        <span>
          <span className="numero text-texto">{numero(t.vagas)}</span> {t.vagas === 1 ? "vaga aberta" : "vagas abertas"}
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="numero text-texto">{numero(t.inscritos)}</span> inscritos
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="numero text-texto">{numero(t.entrevistados)}</span> já entrevistados pelo Totti
        </span>
      </p>
    </header>
  );
}

/**
 * Os três passos de uma vaga, com quantas estão em cada um. É ao mesmo tempo o "como funciona" (você define,
 * o Totti entrevista, você decide) e o índice da página: clicar leva à seção. Passo seu com vaga esperando fica escuro.
 */
function Fluxo({ planos, totti, decidir, onIr }: { planos: number; totti: number; decidir: number; onIr: (id: IdGrupo) => void }) {
  const passos: { id: IdGrupo; rotulo: string; n: number; texto: string; acao: string; voce: boolean }[] = [
    { id: "plano", rotulo: "Você define o plano", n: planos, texto: planos === 1 ? "vaga parada" : "vagas paradas", acao: "Terminar os planos", voce: true },
    { id: "totti", rotulo: "Totti entrevista", n: totti, texto: totti === 1 ? "vaga em andamento" : "vagas em andamento", acao: "Ver vagas", voce: false },
    { id: "decidir", rotulo: "Você decide", n: decidir, texto: decidir === 1 ? "vaga pronta para decidir" : "vagas prontas para decidir", acao: "Ver relatórios", voce: true },
  ];
  return (
    <nav aria-label="Etapas das vagas" className="grid gap-3 md:grid-cols-3">
      {passos.map((p, i) => {
        const pede = p.voce && p.n > 0;
        return (
          <motion.button
            key={p.id}
            type="button"
            onClick={() => onIr(p.id)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.06, ease: curvaSaida }}
            className={`group flex flex-col gap-3 rounded-[20px] p-5 text-left transition-transform duration-[240ms] ease-saida outline-none hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-texto/30 ${
              pede ? "bg-texto text-texto-claro" : "cartao text-texto"
            }`}
          >
            <span className={`flex items-center gap-2 text-[13px] ${pede ? "text-texto-claro/70" : "text-texto-suave"}`}>
              <span
                aria-hidden
                className={`numero flex size-5 items-center justify-center rounded-full text-[11.5px] font-medium ${
                  pede ? "bg-texto-claro text-texto" : "bg-superficie-2 text-texto"
                }`}
              >
                {i + 1}
              </span>
              {p.rotulo}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="titulo-display text-[34px] leading-none">{numero(p.n)}</span>
              <span className={`text-[13.5px] ${pede ? "text-texto-claro/75" : "text-texto-suave"}`}>{p.texto}</span>
            </span>
            <span className={`mt-auto flex items-center gap-1 text-[13px] font-medium ${pede ? "text-texto-claro" : "text-texto-suave"}`}>
              {p.acao}
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          </motion.button>
        );
      })}
    </nav>
  );
}

/** Uma seção do fluxo: número do passo, título, uma frase do que fazer e as linhas, algumas por vez. */
function Secao({
  ref,
  passo,
  titulo,
  dica,
  vazio,
  total,
  pede = false,
  acao,
  children,
}: {
  ref: Ref<HTMLElement>;
  passo: number;
  titulo: string;
  dica: string;
  vazio: string;
  total: number;
  pede?: boolean;
  acao?: ReactNode;
  children: (quantas: number) => ReactNode;
}) {
  const [quantas, setQuantas] = useState(POR_VEZ);
  const faltam = total - quantas;
  return (
    <section ref={ref} aria-label={titulo} className="flex scroll-mt-20 flex-col gap-4 md:scroll-mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2.5 font-display text-[22px] font-semibold tracking-[-0.02em] text-texto">
            <span
              aria-hidden
              className={`numero flex size-6 shrink-0 items-center justify-center rounded-full font-sans text-[12.5px] font-medium ${
                pede ? "bg-texto text-texto-claro" : "bg-superficie-2 text-texto"
              }`}
            >
              {passo}
            </span>
            {titulo}
            <span className="numero font-sans text-[15px] font-normal text-texto-suave">{numero(total)}</span>
          </h2>
          <p className="text-[14px] text-texto-suave">{dica}</p>
        </div>
        {acao}
      </div>
      {total === 0 ? (
        <p className="rounded-[20px] bg-superficie-2/50 px-5 py-6 text-[14px] text-texto-suave">{vazio}</p>
      ) : (
        <ul className="cartao flex flex-col overflow-hidden">
          {children(quantas)}
          {faltam > 0 && (
            <li className="linha-lista">
              <button
                onClick={() => setQuantas((q) => q + POR_VEZ * 2)}
                className="flex w-full items-center gap-1.5 px-5 py-3.5 text-left text-[13.5px] text-texto-suave transition-colors hover:bg-superficie-2/40 hover:text-texto"
              >
                {faltam > POR_VEZ * 2 ? `Mostrar mais ${POR_VEZ * 2} (faltam ${numero(faltam)})` : `Mostrar as outras ${numero(faltam)}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

const saudacao = () => {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia." : h < 18 ? "Boa tarde." : "Boa noite.";
};
const dataDeHoje = () => new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

/** Entrada de uma linha da lista: sobe 4px e aparece, uma logo depois da outra (no máximo ~0,2s de espera). */
const entradaLinha = (i: number) =>
  ({
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.28,
      delay: 0.04 + Math.min(i, 8) * 0.022,
      ease: curvaSuave,
    },
  }) as const;

// ---------------------------------------------------------------------------
// Linhas da lista
// ---------------------------------------------------------------------------

const classeLinha =
  "group grid items-center gap-x-6 gap-y-3 px-5 py-4 transition-colors outline-none hover:bg-superficie-2/40 focus-visible:bg-superficie-2/60 xl:grid-cols-[minmax(0,1fr)_240px_190px]";

type Estado = { texto: string; ativo: boolean };

/** Em que pé a vaga está, numa frase: o que está acontecendo nela agora. */
function estadoDa(v: Linha): Estado {
  const f = v.funil;
  const novos = novosDa(v);
  if (v.estagio === "encerrada") return { texto: `Encerrada ${quandoFoi(v.encerradaHaDias ?? 0)}`, ativo: false };
  if (prontaParaDecidir(v)) return { texto: `${plural(novos, "relatório pronto", "relatórios prontos")} para decidir`, ativo: false };
  if (f.emAndamento > 0) return { texto: `Entrevistando agora · ${plural(f.emAndamento, "pessoa", "pessoas")}`, ativo: true };
  if (f.inscritos === 0) return { texto: "Esperando os primeiros inscritos", ativo: false };
  if (f.convidados === 0) return { texto: "Enviando os convites", ativo: true };
  if (f.concluiram >= f.convidados) return { texto: "Todas as entrevistas feitas", ativo: false };
  return { texto: "Candidatos agendando", ativo: true };
}

/** O atalho da linha: leva direto para onde a vaga pede atenção. */
function acaoDa(v: Linha): { href: string; texto: string; forte: boolean } {
  const novos = novosDa(v);
  if (v.estagio === "encerrada") return { href: hrefVaga(v.id, "escores"), texto: "Ver resultados", forte: false };
  if (prontaParaDecidir(v)) return { href: hrefVaga(v.id, "escores"), texto: "Ver relatórios", forte: true };
  // Com alguns relatórios, mas ainda longe da metade: dá para espiar, sem pressa.
  if (novos > 0) return { href: hrefVaga(v.id, "escores"), texto: `Espiar ${plural(novos, "relatório", "relatórios")}`, forte: false };
  if (v.funil.concluiram > 0) return { href: hrefVaga(v.id, "escores"), texto: "Ver resultados", forte: false };
  return { href: hrefVaga(v.id, "entrevistas"), texto: "Acompanhar", forte: false };
}

/** A ação da linha: pílula preta quando é com você, link discreto quando é só para olhar. */
function AcaoLinha({ texto, forte }: { texto: string; forte: boolean }) {
  return forte ? (
    <span className="flex h-9 items-center gap-1.5 justify-self-start rounded-full bg-texto px-4 text-[13.5px] font-medium whitespace-nowrap text-texto-claro transition-transform group-hover:-translate-y-px xl:justify-self-end">
      {texto}
      <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[13.5px] font-medium text-texto xl:justify-end">
      <span className="sublinha">{texto}</span>
      <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
    </span>
  );
}

function LinhaVaga({ v, indice }: { v: Linha; indice: number }) {
  const f = v.funil;
  const acao = acaoDa(v);
  const estado = estadoDa(v);
  const meta = [
    v.time && v.time !== "—" ? v.time : null,
    NOME_SENIORIDADE_VAGA[v.senioridade],
    v.resumo ? NOME_FORMATO_CURTO[v.resumo.formato] : null,
    v.estagio === "encerrada" ? null : `aberta ${quandoFoi(v.abertaHaDias)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const fracao = fracaoEntrevistada(v);
  const fatia = Math.max(f.concluiram ? 2 : 0, fracao * 100);

  return (
    <motion.li {...entradaLinha(indice)} className="linha-lista">
      <Link href={acao.href} className={classeLinha}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15.5px] font-medium tracking-[-0.01em] text-texto" title={v.cargo}>
            {v.cargo}
          </span>
          <span className="truncate text-[12.5px] text-texto-suave">{meta}</span>
        </span>

        {/* Em que pé está, e quanto dos convidados já fez a entrevista. O traço marca a metade: dali, a vaga vai para a decisão. */}
        <span className="flex flex-col gap-1.5">
          <span className={`flex items-center gap-1.5 text-[13px] ${acao.forte ? "font-medium text-texto" : "text-texto-suave"}`}>
            {estado.ativo && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-texto/60 anim-pulso" />}
            {estado.texto}
          </span>
          {f.convidados > 0 && (
            <span className="flex items-center gap-2" title={`${numero(f.concluiram)} de ${numero(f.convidados)} convidados entrevistados`}>
              <span aria-hidden className="relative h-1 flex-1 overflow-hidden rounded-full bg-superficie-2">
                {v.estagio !== "encerrada" && (
                  <span className="absolute inset-y-0 w-px bg-texto/35" style={{ left: `${FRACAO_PARA_DECIDIR * 100}%` }} />
                )}
                <motion.span
                  className="block h-full rounded-full bg-texto"
                  initial={{ width: 0 }}
                  animate={{ width: `${fatia}%` }}
                  transition={{ duration: 0.9, delay: 0.1 + Math.min(indice, 8) * 0.04, ease: curvaSaida }}
                />
              </span>
              <span className="numero w-9 shrink-0 text-right text-[11.5px] text-texto-suave">{Math.round(fracao * 100)}%</span>
            </span>
          )}
        </span>

        <AcaoLinha texto={acao.texto} forte={acao.forte} />
      </Link>
    </motion.li>
  );
}

/** Uma vaga com o plano parado no Totti: leva de volta para a conversa. O X, no fim da linha, descarta. */
function LinhaRascunho({ r, indice }: { r: RascunhoVaga; indice: number }) {
  return (
    <motion.li {...entradaLinha(indice)} className="linha-lista group/rascunho relative">
      <Link href={hrefRascunho(r.id)} className={classeLinha}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15.5px] font-medium tracking-[-0.01em] text-texto" title={r.cargo}>
            {r.cargo}
          </span>
          <span className="truncate text-[12.5px] text-texto-suave">criada {quandoFoi(diasDoRascunho(r))}</span>
        </span>
        <span className="text-[13px] text-texto-suave">{situacaoDoRascunho(r)}</span>
        <span className="flex xl:justify-end xl:pr-8">
          <AcaoLinha texto={r.sessaoId ? "Continuar com o Totti" : "Começar com o Totti"} forte />
        </span>
      </Link>
      <button
        onClick={() => descartarRascunho(r.id)}
        aria-label={`Descartar a vaga ${r.cargo}`}
        title="Descartar esta vaga"
        className="absolute right-3 bottom-4 flex size-7 items-center justify-center rounded-full text-texto-suave opacity-0 transition-[opacity,color,background-color] group-hover/rascunho:opacity-100 hover:bg-superficie-2 hover:text-perigo focus-visible:opacity-100 xl:top-1/2 xl:bottom-auto xl:-translate-y-1/2"
      >
        <X size={13} />
      </button>
    </motion.li>
  );
}

// ---------------------------------------------------------------------------
// Gaveta de filtros
// ---------------------------------------------------------------------------

/** O botão "Filtros" (com o número de filtros ligados) e o painel: ordem, formato, área, senioridade, time e responsável. */
function Gaveta({
  area,
  senioridade,
  formato,
  time,
  responsavel,
  ordem,
  times,
  responsaveis,
  onArea,
  onSenioridade,
  onFormato,
  onTime,
  onResponsavel,
  onOrdem,
  onLimpar,
}: {
  area: Area | "";
  senioridade: Senioridade | "";
  formato: Formato | "";
  time: string;
  responsavel: string;
  ordem: OrdemVagas;
  times: string[];
  responsaveis: string[];
  onArea: (v: Area | "") => void;
  onSenioridade: (v: Senioridade | "") => void;
  onFormato: (v: Formato | "") => void;
  onTime: (v: string) => void;
  onResponsavel: (v: string) => void;
  onOrdem: (v: OrdemVagas) => void;
  onLimpar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const fechar = useCallback(() => setAberto(false), []);
  const ativos = [area, senioridade, formato, time, responsavel].filter(Boolean).length;

  return (
    <Popover
      aberto={aberto}
      onFechar={fechar}
      gatilho={
        <button
          onClick={() => setAberto((a) => !a)}
          aria-expanded={aberto}
          aria-label="Filtros e ordem"
          className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] transition-colors ${
            ativos ? "bg-texto text-texto-claro" : "bg-superficie-2/70 text-texto hover:bg-superficie-2"
          }`}
        >
          <SlidersHorizontal size={14} strokeWidth={1.75} />
          Filtros
          {ativos > 0 && <span className="numero rounded-full bg-texto-claro/20 px-1.5 text-[11.5px]">{ativos}</span>}
        </button>
      }
    >
      <Grupo titulo="Ordenar por">
        {ORDENS.map((o) => (
          <Pilula key={o} ativa={ordem === o} onClick={() => onOrdem(o)}>
            {NOME_ORDEM[o]}
          </Pilula>
        ))}
      </Grupo>
      <Grupo titulo="Formato">
        {(Object.keys(NOME_FORMATO_CURTO) as Formato[]).map((m) => (
          <Pilula key={m} ativa={formato === m} onClick={() => onFormato(formato === m ? "" : m)}>
            {NOME_FORMATO_CURTO[m]}
          </Pilula>
        ))}
      </Grupo>
      <Grupo titulo="Área">
        {(Object.keys(NOME_AREA_VAGA) as Area[]).map((a) => (
          <Pilula key={a} ativa={area === a} onClick={() => onArea(area === a ? "" : a)}>
            {NOME_AREA_VAGA[a]}
          </Pilula>
        ))}
      </Grupo>
      <Grupo titulo="Senioridade">
        {(Object.keys(NOME_SENIORIDADE_VAGA) as Senioridade[]).map((s) => (
          <Pilula key={s} ativa={senioridade === s} onClick={() => onSenioridade(senioridade === s ? "" : s)}>
            {NOME_SENIORIDADE_VAGA[s]}
          </Pilula>
        ))}
      </Grupo>
      <Grupo titulo="Time">
        {times.map((t) => (
          <Pilula key={t} ativa={time === t} onClick={() => onTime(time === t ? "" : t)}>
            {t}
          </Pilula>
        ))}
      </Grupo>
      <Grupo titulo="Responsável">
        {responsaveis.map((t) => (
          <Pilula key={t} ativa={responsavel === t} onClick={() => onResponsavel(responsavel === t ? "" : t)}>
            {t}
          </Pilula>
        ))}
      </Grupo>
      {ativos > 0 && (
        <button
          onClick={onLimpar}
          className="self-start text-[12.5px] text-texto-suave underline underline-offset-4 hover:text-texto"
        >
          Limpar filtros ({ativos})
        </button>
      )}
    </Popover>
  );
}
