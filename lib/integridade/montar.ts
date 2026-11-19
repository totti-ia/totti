import type { SaidaDeFoco, SessionEvent } from "@/lib/contracts";
import type { EventoEntrada } from "@/lib/agente/armazenamento/repositorio";
import { colagemDeFora } from "@/lib/agents/colagem";
import { tentativasEmTextos } from "@/lib/seguranca/injecao";
import { canarioApareceu, nomeDoCanario } from "./canario";
import { duracao } from "./formato";
import { blocoSemFala, sinaisDaConversa, type FalaDaConversa } from "./conversa";

export { duracao };
import type { BlocoDeIntegridade, SinalDeIntegridade, TipoDeSinal } from "./tipos";

// Os textos não repetem o minuto: a tela já mostra o momento ao lado de cada sinal (e ele abre a gravação ali).
const minuscula = (texto: string) => texto.charAt(0).toLowerCase() + texto.slice(1);
/** Linhas a partir das quais uma colagem de fora vira sinal: uma linha de sintaxe da documentação não é. */
export const LINHAS_DA_COLAGEM_DE_FORA = 3;
type Texto = { t: number; onde: string; texto: string };
type Saida = SaidaDeFoco;

/** Limiares conservadores, só para o relatório; não decidem conduta, nota ou recomendação. */
export const LIMITES = { digitados: 200, trechoSemPausa: 120, janelaEscritaMs: 60_000, depoisDaSaidaMs: 30_000 } as const;

function coletor() {
  const sinais: SinalDeIntegridade[] = [];
  const adicionar = (tipo: TipoDeSinal, t: number, texto: string, extras: { fim?: number; detalhe?: string } = {}) => {
    sinais.push({ id: `${tipo}-${sinais.length + 1}`, tipo, t, texto, ...extras });
  };
  return { sinais, adicionar };
}

/** blur e visibilitychange podem descrever a mesma ausência: um único intervalo de evidência. */
function saidasUnicas(saidas: Saida[]): Saida[] {
  const lista: Saida[] = [];
  for (const s of [...saidas].filter((s) => Number.isFinite(s.t) && s.t >= 0 && Number.isFinite(s.duracaoMs) && s.duracaoMs > 0).sort((a, b) => a.t - b.t)) {
    const ultima = lista.at(-1);
    if (ultima && s.t <= ultima.t + ultima.duracaoMs) {
      ultima.duracaoMs = Math.max(ultima.t + ultima.duracaoMs, s.t + s.duracaoMs) - ultima.t;
    } else lista.push({ ...s });
  }
  return lista;
}

function registrarSaidas(c: ReturnType<typeof coletor>, saidas: Saida[]) {
  for (const s of saidas) c.adicionar("saida_de_foco", s.t, `Saiu da ${s.motivo === "aba" ? "aba" : "janela"} da entrevista por ${duracao(s.duracaoMs)}`, { fim: s.t + s.duracaoMs });
}

function registrarTextos(c: ReturnType<typeof coletor>, sessaoId: string, textos: Texto[]) {
  const nome = nomeDoCanario(sessaoId);
  const primeiro = [...textos].sort((a, b) => a.t - b.t).find((x) => x.onde !== "na fala" && canarioApareceu(nome, x.texto));
  if (primeiro) {
    c.adicionar("canario", primeiro.t, `Apareceu ${primeiro.onde} o nome ${nome}, que só existe no texto copiado do enunciado`, {
      detalhe: "Esse nome não aparece na tela: vai escondido na cópia, como um pedido dirigido a ferramentas de IA",
    });
  }
  for (const i of tentativasEmTextos(textos)) c.adicionar("injecao", i.t, `Apareceu ${i.onde} um texto dirigido à IA que avalia a entrevista`, { detalhe: i.trecho });
}

/** Só foco + atividade posterior são independentes aqui. Dois derivados da mesma escrita nunca convergem. */
function concluir(sinais: SinalDeIntegridade[], dadosPresentes: boolean): BlocoDeIntegridade | null {
  if (!dadosPresentes && !sinais.length) return null;
  sinais.sort((a, b) => a.t - b.t);
  const destaques: BlocoDeIntegridade["destaques"] = sinais.filter((s) => s.tipo === "canario").map((s) => ({ texto: s.texto, t: s.t, sinais: [s.id] }));
  // Cada atividade vira um destaque só: duas saídas antes da mesma colagem são uma história, não duas.
  const porAtividade = new Map<string, { atividade: SinalDeIntegridade; focos: SinalDeIntegridade[] }>();
  for (const foco of sinais.filter((s) => s.tipo === "saida_de_foco")) {
    const fim = foco.fim!;
    const perto = sinais.filter((s) => ["colagem_de_fora", "escrita_linear", "bloco_apos_saida"].includes(s.tipo) && s.t >= fim && s.t - fim <= LIMITES.depoisDaSaidaMs);
    const atividade = perto.find((s) => s.tipo === "bloco_apos_saida") ?? perto[0];
    if (!atividade) continue;
    const grupo = porAtividade.get(atividade.id) ?? { atividade, focos: [] };
    grupo.focos.push(foco);
    porAtividade.set(atividade.id, grupo);
  }
  for (const { atividade, focos } of porAtividade.values()) {
    const ultimo = focos[focos.length - 1];
    const depois = atividade.t - ultimo.fim!;
    const quando = depois < 2_000 ? "logo ao voltar" : `${duracao(depois)} depois de voltar`;
    const total = focos.reduce((soma, f) => soma + (f.fim! - f.t), 0);
    const saiu = focos.length === 1 ? focos[0].texto : `Saiu da entrevista ${focos.length} vezes (${duracao(total)} no total)`;
    destaques.push({ texto: `${saiu} e, ${quando}, ${minuscula(atividade.texto)}`, t: focos[0].t, sinais: [...focos.map((f) => f.id), atividade.id] });
  }
  // Eco e tempo medem comportamentos diferentes. Repetições do mesmo eco não são duas provas.
  const plano = sinais.find((s) => s.tipo === "tempo_plano");
  const ecos = plano ? sinais.filter((s) => s.tipo === "eco_da_pergunta" && s.t >= plano.t && s.t <= plano.fim!) : [];
  if (plano && ecos.length) destaques.push({ texto: "Tempos de resposta próximos em perguntas de conversa e técnicas, junto de repetição das perguntas", t: plano.t, sinais: [plano.id, ...ecos.map((s) => s.id)] });
  for (const bloco of sinais.filter((s) => s.tipo === "bloco_sem_fala")) {
    const foco = sinais.findLast((s) => s.tipo === "saida_de_foco" && s.fim! <= bloco.t && bloco.t - s.fim! <= LIMITES.depoisDaSaidaMs);
    if (foco && !destaques.some((d) => d.sinais.includes(foco.id))) destaques.push({ texto: `${foco.texto} e, ao voltar, ${minuscula(bloco.texto)}`, t: foco.t, sinais: [foco.id, bloco.id] });
  }
  return { sinais, destaques: destaques.sort((a, b) => a.t - b.t) };
}

export function integridadeDaIde(sessaoId: string, eventos: readonly SessionEvent[], starter = ""): BlocoDeIntegridade | null {
  const c = coletor();
  const ordenados = [...eventos].sort((a, b) => a.t - b.t);
  const saidas = saidasUnicas(ordenados.flatMap((e) => e.type === "foco" ? e.saidas : e.type === "snapshot" || e.type === "session_ended" ? e.foco ?? [] : []));
  registrarSaidas(c, saidas);
  const textos: Texto[] = [];
  const colagens = ordenados.filter((e) => e.type === "paste");
  let codigo = starter;
  let anteriorDiferente = starter;
  let ultimaFoto = 0;
  let janela: { inicio: number; digitados: number; apagados: number; maior: number; linhas: number } | undefined;
  let dadosPresentes = false;
  for (const e of ordenados) {
    if (e.type === "foco" || (e.type === "session_ended" && e.foco !== undefined)) dadosPresentes = true;
    if (e.type === "paste") {
      dadosPresentes ||= e.origem !== undefined;
      // Colagem pequena sozinha é sintaxe da documentação; logo depois de sair da janela, é o que ele foi buscar lá fora.
      const logoAposSair = saidas.some((s) => e.t >= s.t + s.duracaoMs && e.t - s.t - s.duracaoMs <= LIMITES.depoisDaSaidaMs);
      if ((e.lines >= LINHAS_DA_COLAGEM_DE_FORA || logoAposSair) && colagemDeFora(e, codigo, anteriorDiferente)) {
        const trecho = e.lines > 1 ? `${e.lines} linhas que não vieram` : `um trecho de ${e.chars} caracteres que não veio`;
        c.adicionar("colagem_de_fora", e.t, `Colou ${trecho} do próprio editor`);
      }
      janela = undefined;
    }
    if (e.type === "speech" && e.role === "candidate") textos.push({ t: e.t, onde: "na fala", texto: e.text });
    if (e.type !== "snapshot") continue;
    textos.push({ t: e.t, onde: "no código", texto: e.code });
    const escrita = e.escrita;
    dadosPresentes ||= escrita !== undefined || e.foco !== undefined;
    const contarLinhas = (texto: string) => texto ? texto.split("\n").length : 0;
    const linhasNovas = Math.max(0, contarLinhas(e.code) - contarLinhas(codigo));
    const houveColagem = colagens.some((p) => p.t > ultimaFoto && p.t <= e.t);
    if (escrita && !houveColagem && !escrita.voltouParaCima && escrita.digitados > 0 && escrita.apagados <= escrita.digitados * 0.05) {
      // Intervalo que atravessa uma saída não prova que a escrita ocorreu depois da volta.
      const atravessou = saidas.some((s) => s.t < e.t && s.t + s.duracaoMs > ultimaFoto);
      if (atravessou || (janela && e.t - janela.inicio > LIMITES.janelaEscritaMs)) janela = undefined;
      if (!atravessou) {
        janela ??= { inicio: ultimaFoto, digitados: 0, apagados: 0, maior: 0, linhas: 0 };
        janela.digitados += escrita.digitados;
        janela.apagados += escrita.apagados;
        janela.maior = Math.max(janela.maior, escrita.maiorTrechoSemPausa);
        janela.linhas += linhasNovas;
        if (janela.digitados >= LIMITES.digitados && janela.maior >= LIMITES.trechoSemPausa) {
          const apagou = janela.apagados ? `apagando ${janela.apagados}` : "sem apagar nada";
          c.adicionar("escrita_linear", janela.inicio, `Digitou ${janela.digitados} caracteres de cima a baixo, ${apagou} e sem voltar a linhas anteriores`, { fim: e.t });
          const foco = saidas.findLast((s) => s.t + s.duracaoMs <= janela!.inicio && janela!.inicio - s.t - s.duracaoMs <= LIMITES.depoisDaSaidaMs);
          const volume = janela.linhas > 0 ? `${janela.linhas} linhas (${janela.digitados} caracteres digitados)` : `${janela.digitados} caracteres digitados`;
          if (foco) c.adicionar("bloco_apos_saida", janela.inicio, `Entraram ${volume} em ${duracao(e.t - janela.inicio)}`, { fim: e.t });
          janela = undefined;
        }
      }
    } else janela = undefined;
    if (e.code !== codigo) anteriorDiferente = codigo;
    codigo = e.code;
    ultimaFoto = e.t;
  }
  registrarTextos(c, sessaoId, textos);
  const falas = ordenados.flatMap((e) => e.type === "speech" ? [e] : []);
  const conversa = sinaisDaConversa(falas);
  c.sinais.push(...conversa.sinais, ...blocoSemFala(ordenados.flatMap((e) => e.type === "snapshot" ? [e] : []), falas, starter,
    colagens.filter((e) => e.origem === "editor" || e.origem === "enunciado").map((e) => e.t)));
  const bloco = concluir(c.sinais, dadosPresentes || conversa.temposDeResposta.length > 0);
  if (bloco && conversa.temposDeResposta.length) bloco.temposDeResposta = conversa.temposDeResposta;
  return bloco;
}

/** Fallback das gravações antigas: só fatos ainda verificáveis no código e nas falas. */
export function integridadeDosTextos(sessaoId: string, textos: Texto[]): BlocoDeIntegridade | null {
  const c = coletor();
  registrarTextos(c, sessaoId, textos);
  return concluir(c.sinais, false);
}

function objeto(dados: unknown): Record<string, unknown> {
  return dados !== null && typeof dados === "object" ? dados as Record<string, unknown> : {};
}

export function integridadeDoQuadro(sessaoId: string, eventos: readonly EventoEntrada[], criadaEm: number): BlocoDeIntegridade | null {
  const c = coletor();
  const ordenados = [...eventos].sort((a, b) => Date.parse(a.horario) - Date.parse(b.horario));
  // Mesma régua de montarRelatorio: primeira mudança de fase, com criação como reserva.
  const primeiraFase = Date.parse(ordenados.find((e) => e.tipo === "fase")?.horario ?? "");
  const inicio = Number.isFinite(primeiraFase) ? primeiraFase : criadaEm;
  const saidas: Saida[] = [];
  const textos: Texto[] = [];
  const falas: FalaDaConversa[] = [];
  let dadosPresentes = false;
  for (const e of ordenados) {
    const d = objeto(e.dados);
    const t = Date.parse(e.horario) - inicio;
    if (!Number.isFinite(t) || t < 0) continue;
    if (e.tipo === "foco") {
      dadosPresentes = true;
      for (const item of Array.isArray(d.saidas) ? d.saidas : []) {
        const s = objeto(item);
        if (typeof s.inicio === "string" && typeof s.duracaoMs === "number" && (s.motivo === "aba" || s.motivo === "janela")) saidas.push({ t: Date.parse(s.inicio) - inicio, duracaoMs: s.duracaoMs, motivo: s.motivo });
      }
    }
    // Peças que entraram de uma vez (o "! COLAGEM" da análise): o equivalente da colagem de fora no quadro.
    if (e.tipo === "colagem" && typeof d.pecas === "number" && d.pecas > 0) {
      dadosPresentes = true;
      c.adicionar("colagem_de_fora", t, `Entraram ${d.pecas} peças no quadro de uma só vez`);
    }
    // O conversor do Excalidraw guarda textos das caixas e anotações em dados.grafo.
    if (e.tipo === "desenho" && typeof d.grafo === "string") textos.push({ t, onde: "numa caixa do quadro", texto: d.grafo });
    const falaDoCandidato = (e.tipo === "fala" && d.quem === "candidato") || (e.tipo === "resposta" && (d.quem === undefined || d.quem === "candidato"));
    if (falaDoCandidato && typeof d.texto === "string") textos.push({ t, onde: "na fala", texto: d.texto });
    if (typeof d.texto === "string" && (falaDoCandidato || (e.tipo === "fala" && d.quem === "agente"))) {
      const fala: FalaDaConversa = { t, role: falaDoCandidato ? "candidate" : "agent", text: d.texto, ...(typeof d.latenciaMs === "number" ? { latenciaMs: d.latenciaMs } : {}) };
      // O quadro antigo registra a mesma resposta como fala e resposta. Não duplica a amostra nem perde a medida.
      const duplicada = falaDoCandidato ? falas.findLast((f) => f.role === fala.role && f.text === fala.text && t - f.t <= 15_000) : undefined;
      if (duplicada) { if (fala.latenciaMs !== undefined) duplicada.latenciaMs = fala.latenciaMs; }
      else falas.push(fala);
    }
  }
  registrarSaidas(c, saidasUnicas(saidas));
  registrarTextos(c, sessaoId, textos);
  const conversa = sinaisDaConversa(falas);
  c.sinais.push(...conversa.sinais);
  const bloco = concluir(c.sinais, dadosPresentes || conversa.temposDeResposta.length > 0);
  if (bloco && conversa.temposDeResposta.length) bloco.temposDeResposta = conversa.temposDeResposta;
  return bloco;
}
