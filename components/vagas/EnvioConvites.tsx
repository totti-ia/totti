"use client";

// Logo depois de publicar: os convites saem sozinhos para quem se inscreveu, sem o recrutador escolher
// ninguém. Um cartão no meio da tela mostra cada candidato e o e-mail saindo; o botão de baixo é o mesmo
// "Publicar vaga" (mesmo `layoutId`), que voa da barra até aqui, conta o envio e vira "Abrir a vaga".
// Cada candidato vai numa chamada própria ao /api/convites: a linha só fica pronta quando o servidor responde.
// Só os candidatos de teste (CANDIDATOS_TESTE) e o testador recebem e-mail de verdade; os demais são demonstração.
// Quem está testando o site pode deixar o próprio e-mail aqui e entrar na fila (lib/vagas/testador.ts): o convite
// chega para a pessoa, e ela faz o resto do caminho como candidata. Da segunda vaga em diante já entra sozinha.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Send } from "lucide-react";
import { tocarVaga, type VagaEmpresa } from "@/lib/vagas/workspace";
import { aguardandoConvite, candidatoTestador, convidar, type CandidatoVaga } from "@/lib/vagas/candidatos";
import { lerTestador, salvarTestador } from "@/lib/vagas/testador";
import { curvaSuave } from "@/lib/design/motion";
import { resumoCurto, resumoDoEnvio } from "@/lib/convites/resumo";

/** O servidor devolve isto a cada consulta (lib/convites/fila.ts). */
type Progresso = { lote: string; total: number; enviados: number; simulados: number; falharam: number; pendentes: number; concluido: boolean; falhas: string[] };
type Testador = { status: "enviado" | "simulado" | "erro"; link?: string };

/** De quanto em quanto tempo o painel pergunta ao servidor como vai o lote. */
const POLLING_MS = 1500;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const post = (corpo: unknown) =>
  fetch("/api/convites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

type Props = { vaga: VagaEmpresa; onAbrir: () => void };

export default function EnvioConvites({ vaga, onAbrir }: Props) {
  // `fila`: quem vai receber. `progresso`: o que o servidor já mandou. O envio em si é do servidor (fila + worker).
  const [fila, setFila] = useState<CandidatoVaga[] | null>(null);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [falhouTudo, setFalhouTudo] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  // O testador do site (deixou o e-mail): recebe na hora, e o link aparece aqui quando não há e-mail de verdade.
  const [testador, setTestador] = useState<(Testador & { nome: string; email: string }) | null>(null);
  // O convite para entrar na fila só aparece para quem ainda não deixou o e-mail.
  const [pedirEmail, setPedirEmail] = useState(false);
  const comecou = useRef(false);
  const lote = useRef<string | null>(null);
  const vivo = useRef(true);
  const marcados = useRef(new Set<number>());

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  /** Marca no funil quem já foi convidado (quem falhou fica de fora até o reenvio dar certo). */
  const registrar = useCallback(
    (lista: CandidatoVaga[], p: Progresso) => {
      const falhas = new Set(p.falhas);
      const novos = lista.filter((c) => !falhas.has(c.email.toLowerCase()) && !marcados.current.has(c.i));
      if (!p.concluido || novos.length === 0) return;
      novos.forEach((c) => marcados.current.add(c.i));
      convidar(vaga.id, novos.map((c) => c.i));
      tocarVaga(vaga.id);
    },
    [vaga.id],
  );

  /** Pergunta ao servidor até o lote acabar (cada pergunta também move a fila do lado dele). */
  const acompanhar = useCallback(
    async (id: string, lista: CandidatoVaga[]) => {
      while (vivo.current) {
        try {
          const res = await fetch(`/api/convites/lote/${id}`, { cache: "no-store" });
          if (res.ok) {
            const p = (await res.json()) as Progresso;
            if (!vivo.current) return;
            setProgresso(p);
            registrar(lista, p);
            if (p.concluido) return;
          }
        } catch {
          // Rede instável: tenta de novo na próxima volta.
        }
        await esperar(POLLING_MS);
      }
    },
    [registrar],
  );

  useEffect(() => {
    const plano = vaga.resumo;
    if (comecou.current || !plano) return;
    comecou.current = true;
    setPedirEmail(lerTestador() === null);

    void (async () => {
      const lista = await aguardandoConvite(vaga.id, vaga.funil);
      setFila(lista);
      if (lista.length === 0) return;
      try {
        const res = await post({
          vagaId: vaga.id,
          cargo: vaga.cargo,
          configId: plano.configId,
          formato: plano.formato,
          duracaoMin: plano.duracaoMin,
          candidatos: lista.map((c) => ({ nome: c.nome, email: c.email, ...(c.testador ? { testador: true } : {}) })),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = (await res.json()) as { lote: string; total: number; testador?: Testador };
        lote.current = r.lote;
        const meu = lista.find((c) => c.testador);
        if (r.testador && meu) setTestador({ ...r.testador, nome: meu.nome, email: meu.email });
        setProgresso({ lote: r.lote, total: r.total, enviados: 0, simulados: 0, falharam: 0, pendentes: r.total, concluido: false, falhas: [] });
        await acompanhar(r.lote, lista);
      } catch {
        setFalhouTudo(true);
      }
    })();
  }, [vaga, acompanhar]);

  /** O testador deixou o e-mail: o convite dele sai na hora, num lote só dele, sem esperar a fila. */
  const entrarNaFila = (nome: string, email: string): string | null => {
    const salvo = salvarTestador(nome, email);
    if (!salvo.ok) return salvo.erro;
    const c = candidatoTestador(salvo.testador);
    const plano = vaga.resumo;
    setPedirEmail(false);
    if (!plano) return null;
    void (async () => {
      try {
        const res = await post({
          vagaId: vaga.id,
          cargo: vaga.cargo,
          configId: plano.configId,
          formato: plano.formato,
          duracaoMin: plano.duracaoMin,
          candidatos: [{ nome: c.nome, email: c.email, testador: true }],
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = (await res.json()) as { testador?: Testador };
        setTestador({ ...(r.testador ?? { status: "erro" }), nome: c.nome, email: c.email });
        if (r.testador && r.testador.status !== "erro") {
          convidar(vaga.id, [c.i]);
          tocarVaga(vaga.id);
        }
      } catch {
        setTestador({ status: "erro", nome: c.nome, email: c.email });
      }
    })();
    return null;
  };

  const reenviar = async () => {
    if (!lote.current || !fila) return;
    setReenviando(true);
    try {
      const res = await fetch(`/api/convites/lote/${lote.current}/reenviar`, { method: "POST" });
      if (res.ok) {
        setProgresso((await res.json()) as Progresso);
        await acompanhar(lote.current, fila);
      }
    } finally {
      if (vivo.current) setReenviando(false);
    }
  };

  const total = fila?.length ?? 0;
  const pronto = (progresso?.concluido ?? false) || (fila !== null && total === 0) || falhouTudo || !vaga.resumo;
  const falharam = progresso?.falharam ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: curvaSuave }}
      className="absolute inset-0 z-20 flex items-center justify-center rounded-padrao bg-fundo/60 p-4 backdrop-blur-[2px]"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: curvaSuave }}
        className="flex max-h-full w-full max-w-md flex-col gap-5 rounded-[24px] bg-superficie p-7 shadow-flutuante"
        role="dialog"
        aria-label="Vaga publicada"
      >
        <div className="flex items-center gap-4">
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.15 }}
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-texto text-texto-claro"
          >
            <Visto tamanho={20} atraso={0.3} />
          </motion.span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="titulo-display truncate text-[24px] text-texto">Vaga publicada</h2>
            <p className="text-[14px] leading-snug text-texto-suave">
              {total === 0 && fila !== null
                ? "Ninguém se inscreveu ainda. O link da vaga já está pronto."
                : pronto
                  ? falharam > 0
                    ? "Alguns convites não saíram. Dá para reenviar."
                    : "Todo mundo que se inscreveu recebeu o convite."
                  : "Mandando o convite da entrevista para quem se inscreveu."}
            </p>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {pedirEmail && fila !== null && <EntrarNaFila onEntrar={entrarNaFila} />}
        </AnimatePresence>

        {total > 0 && progresso && (
          <div className="flex flex-col gap-2 rounded-2xl bg-superficie-2 p-4" aria-live="polite">
            <p className="numero text-[15px] text-texto">{resumoDoEnvio(progresso)}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-superficie">
              <motion.div
                className="h-full rounded-full bg-texto"
                animate={{ width: `${progresso.total ? (progresso.enviados / progresso.total) * 100 : 0}%` }}
                transition={{ duration: 0.4, ease: curvaSuave }}
              />
            </div>
            {falharam > 0 && progresso.concluido && (
              <button
                type="button"
                onClick={reenviar}
                disabled={reenviando}
                className="mt-1 self-start rounded-full bg-texto px-4 py-1.5 text-[13px] font-medium text-texto-claro hover:opacity-90 disabled:opacity-60"
              >
                {reenviando ? "Reenviando…" : `Reenviar os ${falharam} que falharam`}
              </button>
            )}
          </div>
        )}

        {testador && (
          <p className="text-[13px] leading-snug text-texto-suave">
            {testador.status === "enviado"
              ? `O seu convite foi para ${testador.email}.`
              : testador.status === "simulado" && testador.link
                ? "Sem e-mail de verdade desta vez (limite de testes). "
                : "Não deu para enviar o seu convite."}
            {testador.status === "simulado" && testador.link && (
              <a href={testador.link} target="_blank" rel="noreferrer" className="text-texto underline underline-offset-2">
                Abrir o convite
              </a>
            )}
          </p>
        )}

        <div className="flex flex-col items-center gap-2.5">
          <motion.button
            layoutId="cta-publicar"
            onClick={pronto ? onAbrir : undefined}
            disabled={!pronto}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="group relative flex w-full items-center justify-center overflow-hidden rounded-full bg-texto px-5 py-3 text-[15px] font-medium text-texto-claro disabled:cursor-default enabled:hover:opacity-90"
          >
            {/* O botão enche da esquerda para a direita conforme os convites saem */}
            {!pronto && total > 0 && progresso && (
              <motion.span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-texto-claro/12"
                animate={{ width: `${progresso && progresso.total ? ((progresso.enviados + progresso.falharam) / progresso.total) * 100 : 0}%` }}
                transition={{ duration: 0.4, ease: curvaSuave }}
              />
            )}
            <motion.span layout="position" className="relative flex items-center gap-2">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={pronto ? "abrir" : "enviando"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-2"
                >
                  {pronto ? (
                    <>
                      Abrir a vaga <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                    </>
                  ) : (
                    <span className="numero">
                      {progresso === null ? "Buscando os inscritos…" : `Enviando convites · ${resumoCurto(progresso)}`}
                    </span>
                  )}
                </motion.span>
              </AnimatePresence>
            </motion.span>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** O campo para quem está testando: nome e e-mail, e a pessoa entra na fila como candidata. */
function EntrarNaFila({ onEntrar }: { onEntrar: (nome: string, email: string) => string | null }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const submeter = (e: FormEvent) => {
    e.preventDefault();
    setErro(onEntrar(nome, email));
  };
  const campo =
    "min-w-0 rounded-full bg-superficie px-3.5 py-2 text-[13.5px] text-texto placeholder:text-texto-suave/70 outline-none ring-1 ring-borda focus:ring-texto/40";
  return (
    <motion.form
      onSubmit={submeter}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: curvaSuave }}
      className="shrink-0 overflow-hidden"
    >
      <div className="flex flex-col gap-3 rounded-2xl bg-superficie-2 p-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-[14px] font-medium text-texto">Quer ver pelo lado do candidato?</p>
          <p className="text-[13px] leading-snug text-texto-suave">
            Deixe seu e-mail e entre na fila. O convite chega para você, a entrevista é com o Totti e a resposta vem no fim.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" autoComplete="name" aria-label="Seu nome" className={campo} />
          <input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErro(null);
            }}
            type="email"
            required
            placeholder="seu@email.com"
            autoComplete="email"
            aria-label="Seu e-mail"
            aria-invalid={erro !== null}
            className={campo}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] text-perigo" role="alert">
            {erro}
          </span>
          <button
            type="submit"
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-texto px-4 py-2 text-[13.5px] font-medium text-texto-claro hover:opacity-90"
          >
            Entrar na fila <Send size={13} strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </motion.form>
  );
}

/** O visto desenhado (o mesmo traço do cartão de conversa concluída). */
function Visto({ tamanho, atraso }: { tamanho: number; atraso: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 16 16" aria-hidden>
      <motion.path
        d="M3.5 8.4 L6.6 11.3 L12.5 4.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, delay: atraso, ease: [0.32, 0.72, 0, 1] }}
      />
    </svg>
  );
}
