// Relatório da entrevista (visão da recrutadora), o mesmo para System Design (quadro) e Live Coding (IDE): o id
// vale nos dois repositórios e o dado de cada formato converge no tipo comum (lib/relatorio). Lido no servidor.
// O scorecard não é do candidato: fora do ambiente de desenvolvimento, só abre com ?chave=AVALIACOES_API_SECRET
// ou para quem passou pela senha do painel (PAINEL_SENHA; o middleware põe o cabeçalho, nunca o navegador).
import { timingSafeEqual } from "node:crypto";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import GerandoRelatorio from "@/components/relatorio/GerandoRelatorio";
import Relatorio from "@/components/relatorio/Relatorio";
import { resolverAvaliacao } from "@/lib/agente/kits";
import { montarRelatorio, type RelatorioVisto } from "@/lib/agente/relatorio";
import { candidatosPorSessao } from "@/lib/convites/store";
import { relatorioDaIde } from "@/lib/relatorio/da-ide";
import { relatorioDoQuadro } from "@/lib/relatorio/do-quadro";
import { gravacaoDaSessao } from "@/lib/session/gravacao";
import { sessaoViva } from "@/lib/session/persistencia";
import { exemploHabilitado, GRAVACAO_EXEMPLO, relatorioExemplo } from "@/lib/session/relatorio-exemplo";
import { findReport } from "@/lib/session/reports";
import { RELATORIO_EXEMPLO, RELATORIO_EXEMPLO_ENCERRADO, RELATORIO_EXEMPLO_NAO_AVANCAR } from "@/lib/agente/relatorio-exemplo";
import { contexto } from "@/lib/agente/rotas/contexto";
import { devHabilitado } from "@/lib/agente/rotas/scorecard";
import { CABECALHO_AUTENTICADO } from "@/lib/painel/acesso";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatório da entrevista", robots: { index: false } };

/**
 * Relatórios de exemplo do quadro, só em desenvolvimento: dá para revisar o visual sem rodar uma entrevista.
 * O id "exemplo" é o de Live Coding (vale também em produção, é o da demo dos candidatos de demonstração).
 */
const EXEMPLOS: Record<string, RelatorioVisto | undefined> = Object.assign(Object.create(null), {
  "exemplo-quadro": RELATORIO_EXEMPLO,
  "exemplo-encerrado": RELATORIO_EXEMPLO_ENCERRADO,
  "exemplo-nao-avancar": RELATORIO_EXEMPLO_NAO_AVANCAR,
});

function podeVer(chave: string | undefined): boolean {
  if (devHabilitado()) return true;
  // Painel aberto por design (sem senha nem chave configuradas, como na demo): o relatório abre direto.
  if (!process.env.PAINEL_SENHA && !process.env.AGENTE_RELATORIO_CHAVE) return true;
  const segredo = process.env.AVALIACOES_API_SECRET;
  if (!segredo || !chave) return false;
  const a = Buffer.from(segredo);
  const b = Buffer.from(chave);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ chave?: string }> };

// O tema claro vem do layout (o resto do app é escuro); ver app/globals.css.
export default function Page(props: Props) {
  return <Conteudo {...props} />;
}

async function Conteudo({ params, searchParams }: Props) {
  const [{ id }, { chave }, cabecalhos] = await Promise.all([params, searchParams, headers()]);
  const pelaSenhaDoPainel = cabecalhos.get(CABECALHO_AUTENTICADO) === "1";
  if (!(pelaSenhaDoPainel || podeVer(chave)) || id.length > 80) notFound();
  if (exemploHabilitado(id)) {
    return <Relatorio r={relatorioDaIde(relatorioExemplo(), GRAVACAO_EXEMPLO, { demonstracao: true })} gravacao={GRAVACAO_EXEMPLO} />;
  }
  const exemploDoQuadro = devHabilitado() ? EXEMPLOS[id] : undefined;
  if (exemploDoQuadro) return <Relatorio r={relatorioDoQuadro(exemploDoQuadro)} comDecisao={false} />;

  return (await relatorioDoQuadroSalvo(id)) ?? (await relatorioDaIdeSalvo(id)) ?? <SessaoNaoEncontrada />;
}

/** System Design: a sessão do quadro e o scorecard dela. Sem scorecard, a tela de espera. null = não é do quadro. */
async function relatorioDoQuadroSalvo(id: string) {
  const { repositorio } = contexto();
  const sessao = await repositorio.obter(id);
  if (!sessao) return null;
  const alvo = await resolverAvaliacao(sessao.avaliacaoId);
  if (!alvo) return null;

  const scorecard = await repositorio.obterScorecard(id);
  if (!scorecard) return <GerandoRelatorio sessaoId={id} area={alvo.kit.area} problema={alvo.problema.titulo} />;

  const [eventos, imagens] = await Promise.all([repositorio.listarEventos(id), repositorio.listarImagens(id)]);
  return <Relatorio r={relatorioDoQuadro(montarRelatorio({ sessao, scorecard, kit: alvo.kit, problema: alvo.problema, eventos, imagens }))} />;
}

/** Live Coding: o relatório salvo, ou a avaliação em andamento (a tela de espera consulta /api/report). null = não é da IDE. */
async function relatorioDaIdeSalvo(id: string) {
  const nomes = candidatosPorSessao();
  const salvo = await findReport(id);
  if (salvo) {
    const candidato = (await nomes).get(id) ?? null;
    return (
      <Relatorio
        r={relatorioDaIde(salvo.report, salvo.gravacao, { candidato, iniciadaEm: salvo.startedAt })}
        gravacao={salvo.gravacao ?? null}
      />
    );
  }
  const sessao = await sessaoViva(id);
  if (!sessao) return null;
  const pronto = sessao.report?.state === "done" ? sessao.report.report : undefined;
  if (!pronto) return <GerandoRelatorio formato="live_coding" sessaoId={id} problema={sessao.config.roleTitle} />;
  const gravacao = gravacaoDaSessao(sessao);
  const candidato = (await nomes).get(id) ?? null;
  return <Relatorio r={relatorioDaIde(pronto, gravacao, { candidato, iniciadaEm: sessao.startedAt })} gravacao={gravacao} />;
}

function SessaoNaoEncontrada() {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-fundo px-6">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-padrao bg-superficie p-8 shadow-padrao">
        <h1 className="text-2xl font-semibold tracking-tight">Entrevista não encontrada</h1>
        <p className="leading-relaxed text-texto-suave">
          O link pode estar errado, ou o servidor foi reiniciado e as sessões em memória se perderam.
        </p>
      </div>
    </main>
  );
}
