"use client";

// O plano da entrevista, pronto para conferir e publicar. É uma página só: o que o Totti montou já
// aparece organizado em cartões e cada cartão se edita ali mesmo (sem folha lateral nem segunda tela).
//   Como vai ser (formato, senioridade, duração) · O que mais pesa · Critérios · Observações
// O formato manda no resto: área que o formato não mede (ver `MEDE`) fica travada em 0%, e trocar o formato
// ou ligar/desligar uma área refaz os critérios (`ajustarCriterios`), para nunca publicar um plano incoerente.
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { FocusArea, type Criterion, type InterviewMode } from "@/lib/contracts";
import { ajustarCriterios, mede, modoAlternativoQueMede } from "@/lib/pre-entrevista/catalogo";
import { camposMudados } from "@/lib/pre-entrevista/fixados";
import type { Rascunho } from "@/lib/pre-entrevista/rascunho";
import { problemaFixado } from "@/lib/pre-entrevista/problema-pedido";
import { curvaSuave } from "@/lib/design/motion";
import { DESCRICAO_FORMATO, NOME_AREA, NOME_FORMATO, NOME_SENIORIDADE } from "./textos";

type Props = {
  rascunho: Rascunho;
  enviando: boolean;
  /** Já publicada: o botão sai daqui e voa para o que vem depois (mesmo `layoutId`). */
  publicado?: boolean;
  erros: string[];
  onConfirmar: (rascunho: Rascunho) => void;
  /** Avisa a cada mudança: o rascunho editado, ou null se está igual ao original (para quem volta fora daqui). */
  onMudar?: (rascunhoEditado: Rascunho | null, base: Rascunho) => void;
};

const campo =
  "w-full rounded-xl bg-superficie-2/70 px-3 py-2 text-[15px] text-texto outline-none ring-texto/15 transition-[background-color,box-shadow] duration-150 focus:bg-superficie focus:ring-2";

/** Tons de tinta para as áreas na barra de pesos (sem cor de destaque: só opacidade). */
const TOM: Record<FocusArea, string> = {
  tecnico: "bg-texto",
  escala_produto: "bg-texto/65",
  pressao: "bg-texto/40",
  uso_ia: "bg-texto/20",
};

function Segmentado<T extends string>({
  id,
  opcoes,
  valor,
  onMudar,
}: {
  id: string;
  opcoes: { valor: T; nome: string }[];
  valor: T;
  onMudar: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full bg-superficie-2/70 p-1">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onMudar(o.valor)}
          aria-pressed={valor === o.valor}
          className={`relative flex-1 rounded-full px-3 py-1.5 text-[13.5px] whitespace-nowrap transition-colors duration-150 ${
            valor === o.valor ? "text-texto" : "text-texto-suave hover:text-texto"
          }`}
        >
          {valor === o.valor && (
            <motion.span
              layoutId={`seg-${id}`}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
              className="absolute inset-0 rounded-full bg-superficie shadow-[0_1px_3px_rgb(17_17_17/0.1)]"
            />
          )}
          <span className="relative">{o.nome}</span>
        </button>
      ))}
    </div>
  );
}

function Cartao({ titulo, dica, extra, children }: { titulo: string; dica?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: curvaSuave }}
      className="cartao flex flex-col gap-4 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[16px] font-semibold tracking-[-0.015em] text-texto">{titulo}</h3>
          {dica && <p className="text-[13px] text-texto-suave">{dica}</p>}
        </div>
        {extra}
      </div>
      {children}
    </motion.section>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="rotulo text-texto-suave">{rotulo}</span>
      {children}
    </div>
  );
}

/** "Bom: … Ruim: …" vira duas linhas com rótulo; qualquer outro texto aparece como está. */
function Descricao({ texto }: { texto: string }) {
  const partes = /^\s*Bom:\s*([\s\S]*?)\s*Ruim:\s*([\s\S]*)$/i.exec(texto);
  if (!partes) return <span className="text-[14px] leading-relaxed text-texto-suave">{texto}</span>;
  return (
    <span className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[14px] leading-relaxed">
      <span className="rotulo pt-[3px] text-texto">Bom</span>
      <span className="text-texto-suave">{partes[1]}</span>
      <span className="rotulo pt-[3px] text-texto-suave/70">Ruim</span>
      <span className="text-texto-suave">{partes[2]}</span>
    </span>
  );
}

type Pesos = Record<FocusArea, number>;

/** Áreas que entram: peso acima de zero. */
const ativas = (p: Pesos) => FocusArea.options.filter((a) => p[a] > 0);

/** Zera o que o formato não mede; se nada sobrar, a área técnica fica com tudo. */
function pesosDoFormato(p: Pesos, mode: InterviewMode): Pesos {
  const novo = Object.fromEntries(FocusArea.options.map((a) => [a, mede(mode, a) ? p[a] : 0])) as Pesos;
  if (ativas(novo).length === 0) novo.tecnico = 100;
  return novo;
}

export default function RevisaoPlano({ rascunho, enviando, publicado = false, erros, onConfirmar, onMudar }: Props) {
  const [inicial] = useState(() => {
    const base = Object.fromEntries(FocusArea.options.map((a) => [a, 0])) as Pesos;
    for (const f of rascunho.focus) base[f.area] = Math.round(f.weight * 100);
    const pesos = pesosDoFormato(base, rascunho.mode);
    const mudou = FocusArea.options.some((a) => pesos[a] !== base[a]);
    const r = structuredClone(rascunho);
    // `base`: de onde ela partiu. O que ela mudou se mede contra ele, não contra a prop, que a extração em segundo plano atualiza.
    return { pesos, base: structuredClone(rascunho), r: mudou ? { ...r, criteria: ajustarCriterios(r.mode, ativas(pesos), r.criteria) } : r };
  });
  const [r, setR] = useState<Rascunho>(inicial.r);
  const [pesos, setPesos] = useState<Pesos>(inicial.pesos);
  const [editando, setEditando] = useState<string | null>(null);

  function mudarFormato(mode: InterviewMode, ligar?: FocusArea) {
    const novos = pesosDoFormato(ligar ? { ...pesos, [ligar]: Math.max(pesos[ligar], 30) } : pesos, mode);
    setPesos(novos);
    // A questão escolhida era do outro formato: sem ela, a finalização escolhe uma do formato novo.
    setR({ ...r, mode, problemId: undefined, pedidoProblema: undefined, criteria: ajustarCriterios(mode, ativas(novos), r.criteria) });
  }

  function mudarPeso(area: FocusArea, valor: number) {
    const novos = { ...pesos, [area]: valor };
    setPesos(novos);
    if (pesos[area] > 0 !== valor > 0) setR((atual) => ({ ...atual, criteria: ajustarCriterios(atual.mode, ativas(novos), atual.criteria) }));
  }

  const soma = Object.values(pesos).reduce((a, b) => a + b, 0);
  const porcento = (a: FocusArea) => (soma > 0 ? Math.round((pesos[a] / soma) * 100) : 0);
  const duracao = r.durationMin ?? (r.mode === "system_design" ? 45 : 30);
  // Questão que ela pediu pelo nome: aparece no plano (sem controle novo). Sem pedido, a entrevista sorteia.
  const questaoFixada = problemaFixado(r);
  const medidas = FocusArea.options.filter((a) => mede(r.mode, a));
  const naoMedidas = FocusArea.options.filter((a) => !mede(r.mode, a));

  function mudarCriterio(id: string, mudanca: Partial<Criterion>) {
    setR((atual) => ({ ...atual, criteria: atual.criteria.map((c) => (c.id === id ? { ...c, ...mudanca } : c)) }));
  }

  function adicionarCriterio() {
    const id = `novo-${Date.now().toString(36)}`;
    setR({
      ...r,
      criteria: [...r.criteria, { id, name: "", focus: ativas(pesos)[0] ?? "tecnico", weight: 1, description: "" }],
    });
    setEditando(id);
  }

  /** O rascunho como está na tela (foco pelos pesos, sem critério sem nome). */
  function rascunhoDaTela(): Rascunho {
    const focus = FocusArea.options
      .filter((a) => pesos[a] > 0)
      .map((area) => ({ area, weight: soma > 0 ? Math.round((pesos[area] / soma) * 100) / 100 : 0 }));
    return { ...r, criteria: r.criteria.filter((c) => c.name.trim()), focus };
  }

  function confirmar() {
    onConfirmar({ ...rascunhoDaTela(), confirmado: { mode: true, seniority: true, focus: true } });
  }

  // O que ela mudou em relação ao que chegou (null: nada). Só vale com algum critério e peso, como no publicar.
  const tela = rascunhoDaTela();
  const mudou =
    camposMudados(inicial.base, tela).length > 0 ||
    tela.roleTitle !== inicial.base.roleTitle ||
    (tela.conducao ?? []).join("\n") !== (inicial.base.conducao ?? []).join("\n");
  const editado = mudou && soma > 0 && tela.criteria.length > 0 ? tela : null;
  const chaveEditado = JSON.stringify(editado);
  useEffect(() => {
    onMudar?.(editado, inicial.base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveEditado]);

  const podePublicar = !enviando && r.criteria.some((c) => c.name.trim()) && soma > 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-1 pt-6 pb-36">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: curvaSuave }}
            className="flex flex-col gap-2 px-1 pb-2"
          >
            <span className="rotulo text-texto-suave">Plano da entrevista</span>
            <input
              value={r.roleTitle}
              onChange={(e) => setR({ ...r, roleTitle: e.target.value })}
              aria-label="Cargo"
              className="titulo-display -mx-2 rounded-xl bg-transparent px-2 py-1 text-[34px] text-texto outline-none transition-colors hover:bg-superficie-2/50 focus:bg-superficie"
            />
            <p className="text-[15px] text-texto-suave">Confira, ajuste e publique.</p>
          </motion.div>

          <Cartao titulo="Como vai ser">
            <div className="grid gap-4 sm:grid-cols-[1.2fr_1.3fr_auto]">
              <Campo rotulo="Formato">
                <Segmentado
                  id="formato"
                  valor={r.mode}
                  onMudar={(mode: InterviewMode) => mode !== r.mode && mudarFormato(mode)}
                  opcoes={(["system_design", "live_coding"] as InterviewMode[]).map((v) => ({ valor: v, nome: NOME_FORMATO[v] }))}
                />
              </Campo>
              <Campo rotulo="Senioridade">
                <Segmentado
                  id="senioridade"
                  valor={r.seniority}
                  onMudar={(seniority) => setR({ ...r, seniority })}
                  opcoes={(["junior", "pleno", "senior"] as const).map((v) => ({ valor: v, nome: NOME_SENIORIDADE[v] }))}
                />
              </Campo>
              <Campo rotulo="Duração">
                <div className="flex items-center gap-1 rounded-full bg-superficie-2/70 p-1">
                  <button
                    onClick={() => setR({ ...r, durationMin: Math.max(15, duracao - 5) })}
                    aria-label="Diminuir 5 minutos"
                    className="flex size-7 items-center justify-center rounded-full text-texto transition-colors hover:bg-superficie"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="numero w-16 text-center text-[13.5px] text-texto">{duracao} min</span>
                  <button
                    onClick={() => setR({ ...r, durationMin: Math.min(120, duracao + 5) })}
                    aria-label="Aumentar 5 minutos"
                    className="flex size-7 items-center justify-center rounded-full text-texto transition-colors hover:bg-superficie"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </Campo>
            </div>
            <p className="text-[14px] leading-relaxed text-texto-suave">{DESCRICAO_FORMATO[r.mode]}</p>
            {questaoFixada && (
              <p className="text-[14px] leading-relaxed text-texto-suave">
                Questão: <span className="text-texto">{questaoFixada.title}</span>, a pedido seu. Todos os candidatos recebem essa.
              </p>
            )}
          </Cartao>

          <Cartao titulo="O que mais pesa" dica="Arraste para mudar. Área em 0% fica de fora.">
            {/* A divisão inteira numa barra só, para bater o olho */}
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
              {medidas
                .filter((a) => pesos[a] > 0)
                .map((a) => (
                  <motion.span
                    key={a}
                    layout
                    transition={{ duration: 0.3, ease: curvaSuave }}
                    className={`h-full ${TOM[a]}`}
                    style={{ flexGrow: pesos[a] }}
                  />
                ))}
            </div>
            <div className="flex flex-col gap-3">
              {medidas.map((a) => (
                <label key={a} className="grid grid-cols-[190px_minmax(0,1fr)_44px] items-center gap-3 max-sm:grid-cols-[1fr_44px]">
                  <span className="flex items-center gap-2 text-[14.5px] text-texto">
                    <span className={`size-2 rounded-full ${TOM[a]}`} />
                    {NOME_AREA[a]}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={pesos[a]}
                    onChange={(e) => mudarPeso(a, Number(e.target.value))}
                    className="accent-[var(--texto)] max-sm:order-last max-sm:col-span-2"
                    aria-label={`Peso de ${NOME_AREA[a]}`}
                  />
                  <span className={`numero text-right text-[14px] ${pesos[a] > 0 ? "text-texto" : "text-texto-suave/50"}`}>
                    {porcento(a)}%
                  </span>
                </label>
              ))}
            </div>
            {naoMedidas.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-xl bg-superficie-2/50 px-3.5 py-3 text-[13px] text-texto-suave">
                {naoMedidas.map((a) => {
                  const alternativo = modoAlternativoQueMede(r.mode, a);
                  return (
                    <span key={a}>
                      {NOME_FORMATO[r.mode]} não mede <span className="text-texto">{NOME_AREA[a].toLowerCase()}</span>.
                      {alternativo && (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => mudarFormato(alternativo, a)}
                            className="text-texto underline decoration-texto/30 underline-offset-4 hover:decoration-texto"
                          >
                            Trocar para {NOME_FORMATO[alternativo]}
                          </button>
                        </>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </Cartao>

          <Cartao
            titulo={`Critérios de avaliação · ${r.criteria.length}`}
            dica="É com isso que o entrevistador dá a nota. Clique num critério para editar."
          >
            <ul className="-mx-2 flex flex-col">
              <AnimatePresence initial={false}>
                {r.criteria.map((c) => (
                  <motion.li
                    key={c.id}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.26, ease: curvaSuave }}
                    className="linha-lista overflow-hidden"
                  >
                    {editando === c.id ? (
                      <div className="flex flex-col gap-2 rounded-xl bg-superficie-2/40 p-2">
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={c.name}
                            placeholder="Nome do critério"
                            onChange={(e) => mudarCriterio(c.id, { name: e.target.value })}
                            className={campo}
                            aria-label="Nome do critério"
                          />
                          <select
                            value={c.focus}
                            onChange={(e) => mudarCriterio(c.id, { focus: e.target.value as FocusArea })}
                            className="h-[38px] rounded-xl bg-superficie-2/70 px-2 text-[13.5px] text-texto outline-none"
                            aria-label="Área do critério"
                          >
                            {FocusArea.options.filter((a) => a === c.focus || (pesos[a] > 0 && mede(r.mode, a))).map((a) => (
                              <option key={a} value={a}>
                                {NOME_AREA[a]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <textarea
                          value={c.description}
                          placeholder="O que conta como bom e como ruim"
                          onChange={(e) => mudarCriterio(c.id, { description: e.target.value })}
                          rows={3}
                          className={`${campo} resize-y text-[14px] leading-relaxed`}
                          aria-label="O que conta como bom e ruim"
                        />
                        <div className="flex justify-end">
                          <button
                            onClick={() => setEditando(null)}
                            className="rounded-full bg-texto px-3.5 py-1.5 text-[13px] font-medium text-texto-claro transition-opacity hover:opacity-85"
                          >
                            Pronto
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="group flex items-start gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-superficie-2/40">
                        <button onClick={() => setEditando(c.id)} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-medium text-texto">{c.name || "Sem nome"}</span>
                            <span className="flex items-center gap-1.5 text-[12px] text-texto-suave">
                              <span className={`size-1.5 rounded-full ${TOM[c.focus]}`} />
                              {NOME_AREA[c.focus]}
                            </span>
                          </span>
                          {c.description && <Descricao texto={c.description} />}
                        </button>
                        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            onClick={() => setEditando(c.id)}
                            aria-label={`Editar ${c.name}`}
                            className="flex size-8 items-center justify-center rounded-full text-texto-suave hover:bg-superficie hover:text-texto"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setR({ ...r, criteria: r.criteria.filter((x) => x.id !== c.id) })}
                            aria-label={`Remover ${c.name}`}
                            className="flex size-8 items-center justify-center rounded-full text-texto-suave hover:bg-superficie hover:text-perigo"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <button
              onClick={adicionarCriterio}
              className="flex items-center gap-1.5 self-start rounded-full bg-superficie-2/70 px-3.5 py-1.5 text-[13px] text-texto transition-colors hover:bg-superficie-2"
            >
              <Plus size={13} /> Adicionar critério
            </button>
          </Cartao>

          {/* Instruções de comportamento do Totti: não viram critério nem entram na nota. Uma por linha. */}
          <Cartao titulo="Uso de IA na entrevista" dica="Esta regra aparece para o candidato antes de começar.">
            <label className="text-sm">
              Assistência de IA
              <select
                aria-label="Assistência de IA"
                className={`${campo} mt-2`}
                value={r.regraDeIa ?? "sem_ia"}
                onChange={(e) => setR({ ...r, regraDeIa: e.target.value as "sem_ia" | "permitida" })}
              >
                <option value="sem_ia">Resolver sem IA (padrão)</option>
                <option value="permitida">Permitir IA com explicação do uso</option>
              </select>
            </label>
            <p className="text-sm text-texto-suave">Pode permitir IA quando o plano avaliar como a pessoa usa essa ferramenta.</p>
          </Cartao>

          <Cartao titulo="Como o Totti deve conduzir" dica="O que ele faz na entrevista. Não entra na nota. Uma instrução por linha.">
            <textarea
              value={(r.conducao ?? []).join("\n")}
              onChange={(e) => setR({ ...r, conducao: e.target.value.split("\n") })}
              rows={Math.max(2, (r.conducao ?? []).length)}
              placeholder="Ex.: redirecione o candidato se ele errar o escopo."
              className={`${campo} resize-y leading-relaxed`}
              aria-label="Como o Totti deve conduzir"
            />
          </Cartao>

          <Cartao titulo="Observações para o entrevistador" dica="Tom, contexto do time, o que evitar.">
            <textarea
              value={r.recruiterNotes}
              onChange={(e) => setR({ ...r, recruiterNotes: e.target.value })}
              rows={3}
              placeholder="Ex.: o time é pequeno e valoriza autonomia; não pergunte sobre a tecnologia X."
              className={`${campo} resize-y leading-relaxed`}
              aria-label="Observações para o entrevistador"
            />
          </Cartao>
        </div>
      </div>

      {/* Barra de baixo: a única ação que importa aqui */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15, ease: curvaSuave }}
        className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-fundo via-fundo/90 to-transparent px-3 pt-10 pb-4"
      >
        <div className="pointer-events-auto flex w-full max-w-3xl flex-col gap-2 rounded-[20px] bg-superficie p-2 shadow-flutuante">
          {erros.length > 0 && (
            <ul className="flex flex-col gap-1 px-3 pt-2 text-[13.5px] text-perigo">
              {erros.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            {/* Voltar à conversa fica num botão só, no cabeçalho (ver `PreEntrevistaTotti`). */}
            <span className="numero ml-auto hidden pl-3 text-[13px] text-texto-suave sm:block">
              {NOME_FORMATO[r.mode]} · {NOME_SENIORIDADE[r.seniority]} · {duracao} min · {r.criteria.length} critérios
            </span>
            {publicado ? (
              <span className="h-[42px] w-[150px] max-sm:ml-auto" aria-hidden />
            ) : (
              <motion.button
                layoutId="cta-publicar"
                onClick={confirmar}
                disabled={!podePublicar}
                transition={{ type: "spring", stiffness: 260, damping: 30 }}
                className="group flex items-center gap-2 rounded-full bg-texto px-5 py-2.5 text-[14px] font-medium text-texto-claro transition-opacity duration-150 hover:opacity-85 disabled:opacity-40 max-sm:ml-auto"
              >
                <motion.span layout="position" className="flex items-center gap-2">
                  {enviando ? "Publicando…" : "Publicar vaga"}
                  {!enviando && <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />}
                </motion.span>
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
