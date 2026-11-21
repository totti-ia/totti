import type { EventoArmazenado } from "@/lib/agente/armazenamento/repositorio";
import type { AcontecimentoComum, GravacaoDoQuadro } from "./tipos";
import { duracaoCurta } from "./formato";

const faseNome: Record<string, string> = {
  REQUISITOS: "Requisitos", ALTO_NIVEL: "Alto nível", APROFUNDAMENTO: "Aprofundamento", FECHAMENTO: "Fechamento",
};
const objeto = (valor: unknown): Record<string, unknown> => valor && typeof valor === "object" ? valor as Record<string, unknown> : {};
const texto = (valor: unknown): string => typeof valor === "string" ? valor.trim() : "";

/** Converte os eventos persistidos do quadro para um relógio comum, em ms desde o início. */
export function gravacaoDoQuadro(eventos: EventoArmazenado[], imagens: { numero: number; horario: string }[], inicio: number, sessaoId = ""): GravacaoDoQuadro {
  const ordenados = [...eventos].sort((a, b) => Date.parse(a.horario) - Date.parse(b.horario));
  const tDe = (horario: string) => Math.max(0, Date.parse(horario) - inicio);
  const fotoAnterior = (horario: string) => {
    const ts = Date.parse(horario);
    const foto = [...imagens].filter(i => Date.parse(i.horario) <= ts && ts - Date.parse(i.horario) <= 30_000).sort((a, b) => Date.parse(b.horario) - Date.parse(a.horario))[0];
    return foto ? `/api/sessoes/${encodeURIComponent(sessaoId)}/imagens/${foto.numero}` : null;
  };
  const falas: GravacaoDoQuadro["falas"] = [];
  const desenho: GravacaoDoQuadro["desenho"] = [];
  const fases: GravacaoDoQuadro["fases"] = [];
  const acontecimentos: AcontecimentoComum[] = [];
  const atividadeCandidato: number[] = [];
  const marcosDeConversa: number[] = [];
  let ultimoGrafoDoDesenho: string | null = null;
  for (const e of ordenados) {
    const d = objeto(e.dados); const t = tDe(e.horario);
    if (e.tipo === "fase") {
      const f = texto(d.fase);
      if (faseNome[f] && !fases.some(x => x.nome === faseNome[f])) fases.push({ t, nome: faseNome[f] });
    }
    if (e.tipo === "fala" || e.tipo === "resposta") {
      const fala = texto(d.texto);
      const role = d.quem === "agente" ? "agent" : "candidate";
      // O fluxo registra a resposta encerrada e a mesma transcrição como fala do candidato.
      const jaRegistrada = falas.find(f => f.role === role && Math.abs(f.t - t) <= 15_000 && f.text.toLocaleLowerCase("pt-BR") === fala.toLocaleLowerCase("pt-BR"));
      const medida = typeof d.latenciaMs === "number" && Number.isFinite(d.latenciaMs) && d.latenciaMs >= 0 ? { latenciaMs: d.latenciaMs } : {};
      if (jaRegistrada && medida.latenciaMs !== undefined) jaRegistrada.latenciaMs = medida.latenciaMs;
      if (fala && !jaRegistrada) {
        falas.push({ t, role, text: fala, ...medida });
        if (role === "candidate") atividadeCandidato.push(t);
        else marcosDeConversa.push(t);
      }
      if (e.tipo === "fala" && d.origem === "mudanca") acontecimentos.push({ t, tipo: "mudanca", titulo: "Mudança de cenário", detalhe: fala });
      if (role === "candidate" && /terminei/i.test(fala)) acontecimentos.push({ t, tipo: "adaptou", titulo: "Terminou o desenho" });
    }
    if (e.tipo === "desenho") {
      const grafo = texto(d.grafo);
      if (grafo) {
        const linhas = grafo.split("\n").filter(l => /^- \[[^\]]+\]/.test(l));
        const conexoes = linhas.filter(l => /^- \[s\d+\]/.test(l)).length;
        const pecas = linhas.length - conexoes;
        const imagem = texto(d.imagem_url) || fotoAnterior(e.horario);
        const anterior = desenho.at(-1);
        // O fluxo registra o mesmo grafo antes e durante a captura da foto. Consolida esses eventos
        // em uma versão, preservando o instante inicial e a foto anexada no segundo registro.
        if (anterior && ultimoGrafoDoDesenho === grafo && anterior.pecas === pecas && anterior.conexoes === conexoes && t - anterior.t <= 5_000) {
          if (imagem) anterior.imagem = imagem;
        } else {
          desenho.push({ t, pecas, conexoes, imagem });
          atividadeCandidato.push(t);
        }
        ultimoGrafoDoDesenho = grafo;
      }
      const mud = texto(d.mudancas);
      if (/COLAGEM/i.test(mud)) acontecimentos.push({ t, tipo: "colagem", titulo: "Colou um desenho", detalhe: mud.match(/COLAGEM:[^\n]*/i)?.[0] });
    }
    if (e.tipo === "pergunta") {
      const elementos = Array.isArray(d.elementos) ? d.elementos.map(texto).filter(Boolean) : [];
      const assunto = texto(d.nota) || elementos.join(", ");
      const pergunta = texto(d.pergunta);
      acontecimentos.push({ t, tipo: "pergunta", titulo: d.escopo === true ? "Redirecionamento de escopo" : `Pergunta${assunto ? ` sobre ${assunto}` : " do Totti"}`, detalhe: [pergunta, elementos.length ? `Peças citadas: ${elementos.join(", ")}.` : ""].filter(Boolean).join(" · ") || undefined });
    }
    if (e.tipo === "analise") {
      if (typeof d.degrau === "number") acontecimentos.push({ t, tipo: "dica", titulo: `Dica de nível ${d.degrau}`, detalhe: texto(d.pergunta) || undefined });
      if (d.escopo === true) acontecimentos.push({ t, tipo: "mudanca", titulo: "Redirecionamento de escopo" });
    }
  }
  const duracaoMs = Math.max(0, ...ordenados.map(e => tDe(e.horario)));
  const atividade = [...new Set([...atividadeCandidato, ...marcosDeConversa, 0, duracaoMs])].sort((a, b) => a - b);
  for (let i = 1; i < atividade.length; i++) {
    const a = atividade[i - 1], b = atividade[i];
    const candidatoAtivo = atividadeCandidato.some(t => t > a && t < b);
    if (b - a >= 60_000 && !candidatoAtivo) acontecimentos.push({ t: a, fim: b, tipo: "travou", titulo: `Ficou ${duracaoCurta(b - a)} parado` });
  }
  return { duracaoMs, falas, desenho, fases, acontecimentos: acontecimentos.sort((a, b) => a.t - b.t) };
}
