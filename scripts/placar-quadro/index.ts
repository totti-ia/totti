// Placar do Totti no quadro: mede, com o LLM real, se ele ficou mais inteligente, mais natural e mais rápido.
//   1. Casos fixos (o que já deu errado), com checagem objetiva.
//   2. Entrevistas simuladas com 3 candidatos (um LLM faz o candidato), pelo mesmo caminho do servidor.
//   3. Um juiz (LLM forte) dá nota a cada fala: escuta, pertinência, naturalidade, concisão e violações.
//   4. Latência do /perguntar e da análise (p50 e p95).
// Salva em test-results/placar-quadro/<data>-<rotulo>.json e .md. O Totti usa os provedores de produção; juiz e candidato, a Featherless (PLACAR_PROVEDOR=openrouter para os pagos).
//
//   npm run placar:quadro -- --rotulo atual
//   npm run placar:quadro -- --rotulo v2 --personas senior_claro,junior_nervoso --so conversas
//   npm run placar:quadro -- --rejulgar test-results/placar-quadro/A.json   (só o juiz, sobre as falas salvas)
//   npm run placar:quadro -- --comparar test-results/placar-quadro/A.json test-results/placar-quadro/B.json
import "../_gasto";
import fs from "node:fs";
import path from "node:path";
import { criarClientePrincipal } from "../../lib/agente/llm/principal";
import { perguntar } from "../../lib/agente/perguntar";
import { CASOS_FALA, conversa, estado, GRAFO, kit, pergunta, problema, REQUISITOS_NO_QUADRO } from "./casos";
import { julgarConversa, julgarFalas, MODELO_JUIZ, type NotaConversa, type NotaFala } from "./juiz";
import { MODELO_CANDIDATO, PERSONAS, simular, type Conversa } from "./simulacao";
import { comparavel, diferencasDeBase } from "./comparabilidade";

const PASTA = path.join("test-results", "placar-quadro");

type ResultadoCaso = { nome: string; candidato: string; totti: string; responder: boolean; ms: number; falhas: string[]; nota?: NotaFala };
type ResultadoConversa = Conversa & { juiz?: NotaConversa; erroJuiz?: string };

type Resumo = {
  casosOk: string;
  /** Médias de 1 a 5 das falas julgadas (casos + conversas). */
  notas: { escuta: number; pertinencia: number; naturalidade: number; concisao: number; media: number };
  geral: { pareceu_pessoa: number; conduziu_bem: number; inteligencia: number };
  violacoes: Record<string, number>;
  falasJulgadas: number;
  latencia: { perguntar: Percentis; analise: Percentis };
  falhasDeProvedor: number;
};
type Percentis = { n: number; p50: number; p95: number; max: number };

type Placar = {
  rotulo: string;
  em: string;
  versaoTotti: string;
  modelos: { conversa: string; analise: string; juiz: string; candidato: string };
  resumo: Resumo;
  casos: ResultadoCaso[];
  conversas: ResultadoConversa[];
};

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function percentis(xs: number[]): Percentis {
  const o = [...xs].sort((a, b) => a - b);
  const p = (q: number) => o[Math.min(o.length - 1, Math.floor(q * o.length))] ?? 0;
  return { n: o.length, p50: p(0.5), p95: p(0.95), max: o.at(-1) ?? 0 };
}

const media = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0);

// ------------------------------------------------------------------ casos fixos

async function rodarCasos(llm: ReturnType<typeof criarClientePrincipal>): Promise<ResultadoCaso[]> {
  const resultados: ResultadoCaso[] = [];
  for (const caso of CASOS_FALA) {
    const agora = Date.now();
    const fase = caso.fase ?? "ALTO_NIVEL";
    const base = estado(fase, agora, {
      conversa: conversa(caso.historico ?? [], agora),
      ...(caso.perguntaAtiva
        ? {
            plin: "PERGUNTA_ATIVA" as const,
            perguntaAtiva: pergunta(1, caso.perguntaAtiva, "Pergunta ativa", agora - 30_000, fase),
            perguntas: [pergunta(1, caso.perguntaAtiva, "Pergunta ativa", agora - 30_000, fase)],
            perguntasFeitas: 1,
          }
        : {}),
      ...(caso.extra?.(agora) ?? {}),
    });
    const inicio = Date.now();
    const r = await perguntar(
      { llm, kit, problema },
      base,
      { fase, texto: caso.texto, grafo: caso.grafo ?? GRAFO, perguntaAtiva: caso.perguntaAtiva, requisitosAtuais: REQUISITOS_NO_QUADRO },
      agora,
    );
    const ms = Date.now() - inicio;
    const falhas = r.falhou ? ["falha do provedor"] : caso.checar(r.texto, r);
    resultados.push({ nome: caso.nome, candidato: caso.texto, totti: r.responder ? r.texto : "", responder: r.responder, ms, falhas });
    console.log(`${falhas.length ? "FALHA" : "OK   "} ${caso.nome} (${ms} ms): ${r.responder ? r.texto : "(quieto)"}${falhas.length ? `\n      -> ${falhas.join("; ")}` : ""}`);
  }
  return resultados;
}

function contextoDoCaso(nome: string): string {
  const c = CASOS_FALA.find((x) => x.nome === nome)!;
  const partes = [`fase ${c.fase ?? "ALTO_NIVEL"}`];
  if (c.perguntaAtiva) partes.push(`o Totti tinha perguntado: "${c.perguntaAtiva}"`);
  if (c.historico) partes.push(`conversa anterior: ${c.historico.map(([q, t]) => `${q}: ${t}`).join(" / ")}`);
  partes.push(c.grafo === "" ? "quadro vazio" : `desenho: ${(c.grafo ?? GRAFO).replace(/\n/g, " ")}`);
  return partes.join("; ");
}

// ------------------------------------------------------------------ resumo e relatório

function resumir(casos: ResultadoCaso[], conversas: ResultadoConversa[]): Resumo {
  const notas: NotaFala[] = [...casos.flatMap((c) => (c.nota ? [c.nota] : [])), ...conversas.flatMap((c) => c.juiz?.falas ?? [])];
  const violacoes: Record<string, number> = {};
  for (const v of notas.flatMap((n) => n.violacoes)) violacoes[v] = (violacoes[v] ?? 0) + 1;
  const turnosTotti = conversas.flatMap((c) => c.turnos.filter((t) => t.fonte !== "candidato"));
  const msPerguntar = [...casos.map((c) => c.ms), ...turnosTotti.filter((t) => t.fonte === "perguntar").map((t) => t.ms ?? 0)];
  const msAnalise = turnosTotti.filter((t) => t.fonte === "analise").map((t) => t.ms ?? 0);
  const gerais = conversas.flatMap((c) => (c.juiz ? [c.juiz.geral] : []));
  const n = { escuta: media(notas.map((x) => x.escuta)), pertinencia: media(notas.map((x) => x.pertinencia)), naturalidade: media(notas.map((x) => x.naturalidade)), concisao: media(notas.map((x) => x.concisao)) };
  return {
    casosOk: `${casos.filter((c) => c.falhas.length === 0).length}/${casos.length}`,
    notas: { ...n, media: media(Object.values(n)) },
    geral: {
      pareceu_pessoa: media(gerais.map((g) => g.pareceu_pessoa)),
      conduziu_bem: media(gerais.map((g) => g.conduziu_bem)),
      inteligencia: media(gerais.map((g) => g.inteligencia)),
    },
    violacoes,
    falasJulgadas: notas.length,
    latencia: { perguntar: percentis(msPerguntar), analise: percentis(msAnalise) },
    falhasDeProvedor: casos.filter((c) => c.falhas.includes("falha do provedor")).length + turnosTotti.filter((t) => t.falhou).length,
  };
}

function markdown(p: Placar): string {
  const r = p.resumo;
  const linhas = [
    `# Placar do Totti no quadro: ${p.rotulo}`,
    "",
    ...(!comparavel(p) ? ["**Resultado incompleto (faltam casos, conversas ou notas do juiz): não usar para comparar versões.**", ""] : []),
    `${p.em} · versão ${p.versaoTotti} · conversa ${p.modelos.conversa} · análise ${p.modelos.analise} · juiz ${p.modelos.juiz} · candidato ${p.modelos.candidato}`,
    "",
    "| Medida | Valor |",
    "|---|---|",
    `| Casos fixos ok | ${r.casosOk} |`,
    `| Escuta / Pertinência / Naturalidade / Concisão | ${r.notas.escuta} / ${r.notas.pertinencia} / ${r.notas.naturalidade} / ${r.notas.concisao} |`,
    `| Nota média das falas (1–5) | **${r.notas.media}** (${r.falasJulgadas} falas) |`,
    `| Pareceu pessoa / Conduziu bem / Inteligência | ${r.geral.pareceu_pessoa} / ${r.geral.conduziu_bem} / ${r.geral.inteligencia} |`,
    `| Violações | ${Object.entries(r.violacoes).map(([k, v]) => `${k}: ${v}`).join(", ") || "nenhuma"} |`,
    `| /perguntar p50 / p95 / máx | ${r.latencia.perguntar.p50} / ${r.latencia.perguntar.p95} / ${r.latencia.perguntar.max} ms (n=${r.latencia.perguntar.n}) |`,
    `| Análise p50 / p95 / máx | ${r.latencia.analise.p50} / ${r.latencia.analise.p95} / ${r.latencia.analise.max} ms (n=${r.latencia.analise.n}) |`,
    `| Falhas do Totti (prazo ou provedor) | ${r.falhasDeProvedor} |`,
    "",
    "## Casos fixos",
    "",
  ];
  for (const c of p.casos) {
    linhas.push(`- **${c.falhas.length ? "FALHA" : "ok"}** ${c.nome} (${c.ms} ms)${c.nota ? ` · nota ${media([c.nota.escuta, c.nota.pertinencia, c.nota.naturalidade, c.nota.concisao])}` : ""}`);
    linhas.push(`  - Candidato: ${c.candidato}`, `  - Totti: ${c.totti || "(quieto)"}`);
    if (c.falhas.length) linhas.push(`  - Falhas: ${c.falhas.join("; ")}`);
    if (c.nota) linhas.push(`  - Juiz: ${c.nota.comentario}${c.nota.violacoes.length ? ` [${c.nota.violacoes.join(", ")}]` : ""}`);
  }
  for (const c of p.conversas) {
    const g = c.juiz?.geral;
    linhas.push("", `## Conversa: ${c.persona}`, "");
    if (g) linhas.push(`Pareceu pessoa ${g.pareceu_pessoa} · conduziu bem ${g.conduziu_bem} · inteligência ${g.inteligencia}. ${g.resumo}`, "");
    if (c.erroJuiz) linhas.push(`(juiz falhou: ${c.erroJuiz})`, "");
    const porN = new Map((c.juiz?.falas ?? []).map((f) => [f.n, f]));
    for (const t of c.turnos) {
      if (t.fonte === "analise" && t.quieto) continue;
      const quem = t.fonte === "candidato" ? "Candidato" : t.fonte === "analise" ? "Totti (iniciativa)" : "Totti";
      const nota = porN.get(t.n);
      linhas.push(
        `${t.n}. **${quem}**${t.ms ? ` (${t.ms} ms)` : ""}: ${t.quieto ? "_(quieto)_" : t.falhou ? "_(falhou)_" : t.texto}` +
          (nota ? `  \n   ↳ ${nota.escuta}/${nota.pertinencia}/${nota.naturalidade}/${nota.concisao} ${nota.comentario}${nota.violacoes.length ? ` [${nota.violacoes.join(", ")}]` : ""}` : ""),
      );
    }
    if (g?.piores_momentos.length) {
      linhas.push("", "Piores momentos:");
      for (const m of g.piores_momentos) linhas.push(`- [${m.n}] ${m.problema} → melhor: "${m.fala_melhor}"`);
    }
  }
  return linhas.join("\n");
}

// ------------------------------------------------------------------ comparar

function comparar(a: Placar, b: Placar) {
  for (const p of [a, b]) {
    if (!p.resumo || !p.casos || !p.conversas || !comparavel(p)) {
      throw new Error(`Comparação recusada: ${p.rotulo} está incompleto (faltam casos, conversas ou notas do juiz).`);
    }
  }
  const diferencas = diferencasDeBase(a, b);
  if (diferencas.length) throw new Error(`Comparação recusada: ${diferencas.join("; ")}.`);
  const linha = (nome: string, va: number | string, vb: number | string, melhorMaior = true) => {
    const na = Number(va);
    const nb = Number(vb);
    const seta = Number.isFinite(na) && Number.isFinite(nb) && na !== nb ? ((nb > na) === melhorMaior ? "  ▲ melhor" : "  ▼ pior") : "";
    console.log(`${nome.padEnd(30)} ${String(va).padStart(10)} ${String(vb).padStart(10)}${seta}`);
  };
  const ra = a.resumo;
  const rb = b.resumo;
  console.log(`${"".padEnd(30)} ${a.rotulo.padStart(10)} ${b.rotulo.padStart(10)}`);
  linha("casos fixos ok", ra.casosOk.split("/")[0], rb.casosOk.split("/")[0]);
  for (const k of ["escuta", "pertinencia", "naturalidade", "concisao", "media"] as const) linha(`nota ${k}`, ra.notas[k], rb.notas[k]);
  for (const k of ["pareceu_pessoa", "conduziu_bem", "inteligencia"] as const) linha(k, ra.geral[k], rb.geral[k]);
  const todas = new Set([...Object.keys(ra.violacoes), ...Object.keys(rb.violacoes)]);
  for (const v of todas) linha(`violação ${v}`, ra.violacoes[v] ?? 0, rb.violacoes[v] ?? 0, false);
  linha("/perguntar p50 (ms)", ra.latencia.perguntar.p50, rb.latencia.perguntar.p50, false);
  linha("/perguntar p95 (ms)", ra.latencia.perguntar.p95, rb.latencia.perguntar.p95, false);
  linha("análise p50 (ms)", ra.latencia.analise.p50, rb.latencia.analise.p50, false);
  linha("falhas do Totti", ra.falhasDeProvedor, rb.falhasDeProvedor, false);
}

// ------------------------------------------------------------------ main

async function main() {
  const comparacao = process.argv.indexOf("--comparar");
  if (comparacao >= 0) {
    const [a, b] = process.argv.slice(comparacao + 1, comparacao + 3).map((f) => JSON.parse(fs.readFileSync(f, "utf8")) as Placar);
    return comparar(a, b);
  }
  const rejulgar = arg("rejulgar");
  const salvo = rejulgar ? (JSON.parse(fs.readFileSync(rejulgar, "utf8")) as Placar & { status?: string }) : null;
  if (salvo?.status === "incompleto") {
    throw new Error(`${rejulgar} é o progresso de uma simulação interrompida: faltam conversas, e rejulgá-lo não produz um placar completo.`);
  }
  const rotulo = arg("rotulo") ?? (salvo ? `${salvo.rotulo}-rejulgado` : "sem-rotulo");
  const so = arg("so");
  const ids = arg("personas")?.split(",");
  const personas = PERSONAS.filter((p) => !ids || ids.includes(p.id));
  const llm = criarClientePrincipal();

  let casos: ResultadoCaso[] = salvo ? salvo.casos.map(({ nota: _n, ...c }) => c) : [];
  if (!salvo && so !== "conversas") {
    console.log("\n== Casos fixos ==");
    casos = await rodarCasos(llm);
  }
  const conversas: ResultadoConversa[] = salvo ? salvo.conversas.map(({ juiz: _j, erroJuiz: _e, ...c }) => c) : [];
  let caminhoParcial: string | undefined;
  if (!salvo && so !== "casos") {
    fs.mkdirSync(PASTA, { recursive: true });
    const parcial = path.join(PASTA, `${new Date().toISOString().replace(/[:.]/g, "-")}-${rotulo}-incompleto.json`);
    caminhoParcial = parcial;
    const guardarParcial = (emAndamento: Conversa) => fs.writeFileSync(parcial, JSON.stringify({ status: "incompleto", rotulo, casos, conversas, emAndamento }, null, 2));
    for (const p of personas) {
      console.log(`\n== Conversa: ${p.id} ==`);
      guardarParcial({ persona: p.id, turnos: [] });
      try {
        conversas.push(await simular(llm, p, console.log, guardarParcial));
      } catch (erro) {
        console.error(`Medição incompleta; progresso preservado em ${parcial}`);
        throw erro;
      }
    }
    fs.writeFileSync(parcial, JSON.stringify({ status: "incompleto", rotulo, casos, conversas }, null, 2));
  }

  // Uma avaliação por vez: duas do Kimi-K2.6 ao mesmo tempo na mesma conta caíam em série com erro de rede (17/11).
  console.log(`\n== Juiz (${MODELO_JUIZ}) ==`);
  if (casos.length) {
    await julgarFalas(casos.map((c, i) => ({ n: i + 1, contexto: contextoDoCaso(c.nome), candidato: c.candidato, totti: c.totti })))
      .then((notas) => notas.forEach((nota) => { if (casos[nota.n - 1]) casos[nota.n - 1].nota = nota; }))
      .catch((e) => console.warn(`juiz dos casos falhou: ${e instanceof Error ? e.message : e}`));
  }
  for (const c of conversas) {
    await julgarConversa(c).then((j) => { c.juiz = j; }).catch((e) => { c.erroJuiz = e instanceof Error ? e.message.slice(0, 200) : String(e); });
  }

  const placar: Placar = {
    rotulo,
    em: new Date().toISOString(),
    versaoTotti: salvo?.versaoTotti ?? (process.env.TOTTI_QUADRO || "v1"),
    modelos: salvo ? { ...salvo.modelos, juiz: MODELO_JUIZ } : {
      conversa:
        process.env.TOTTI_QUADRO === "v2"
          ? process.env.CONVERSA_QUADRO_MODEL || "google/gemini-3.5-flash-lite"
          : process.env.CONVERSA_AO_VIVO_MODEL || "google/gemini-3.5-flash-lite",
      analise: process.env.ANALISE_QUADRO_MODEL || "google/gemini-3.7-flash",
      juiz: MODELO_JUIZ,
      candidato: MODELO_CANDIDATO,
    },
    resumo: resumir(casos, conversas),
    casos,
    conversas,
  };
  fs.mkdirSync(PASTA, { recursive: true });
  const base = path.join(PASTA, `${placar.em.slice(0, 16).replace(/[:T]/g, "-")}-${rotulo}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(placar, null, 2));
  fs.writeFileSync(`${base}.md`, markdown(placar));
  if (!comparavel(placar)) {
    console.error("Placar incompleto (faltam casos, conversas ou notas do juiz); não use como comparação válida.");
    process.exitCode = 1;
  } else if (caminhoParcial) fs.unlinkSync(caminhoParcial);
  console.log(`\n${markdown(placar).split("\n## ")[0]}`);
  console.log(`\nSalvo em ${base}.json e ${base}.md`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
