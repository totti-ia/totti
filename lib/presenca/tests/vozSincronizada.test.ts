import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  agendaDasMarcas, agendarRampaDeEntrada, esquecerRampaDeEntrada, liberarAudio, progressoDaFala, RAMPA_DE_ENTRADA_MS, tocarComAlinhamento,
} from "../vozSincronizada";
import { comFolga, esquecerSaidaDeSom, QUADROS_ANTES, QUADROS_ANTES_DEPOIS_DE_PARADA, segundosDeQuadros } from "../../voz/folga";
import type { Alinhamento } from "../alinhamento";
import { analisar, calar, criarSessao, enviarEventos, falar, falarComMarcas, usarServidor } from "../../sessao/cliente";
import { pedidoComImagem } from "../../sessao/useEntrevista";
import type { PedidoAnalise } from "../../sessao/cliente";

const andar = () => new Promise<void>((resolver) => setImmediate(resolver));
/** Espera o elemento de áudio existir (quantos: 1 por padrão): o caminho com import dinâmico (sessão) passa por I/O. */
async function esperarAudio(a: { instancias: unknown[] }, quantos = 1) {
  for (let i = 0; i < 200 && a.instancias.length < quantos; i++) await new Promise((resolver) => setTimeout(resolver, 2));
}
const alinhamento: Alinhamento = {
  characters: Array.from("Oi banco"),
  character_start_times_seconds: [0, 0.1, 0.2, 0.5, 0.6, 0.7, 0.8, 0.9],
  character_end_times_seconds: [0.08, 0.18, 0.28, 0.58, 0.68, 0.78, 0.88, 0.98],
};

function definirGlobal(t: TestContext, nome: string, valor: unknown) {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, nome);
  Object.defineProperty(globalThis, nome, { configurable: true, writable: true, value: valor });
  t.after(() => {
    if (anterior) Object.defineProperty(globalThis, nome, anterior);
    else Reflect.deleteProperty(globalThis, nome);
  });
}

function ambiente(t: TestContext, valores: Record<string, string | undefined>) {
  const anteriores = Object.fromEntries(Object.keys(valores).map((chave) => [chave, process.env[chave]]));
  for (const [chave, valor] of Object.entries(valores)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  t.after(() => {
    calar();
    for (const [chave, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
  });
}

function audioFalso(t: TestContext, erroAoTocar = false) {
  const instancias: MidiaFalsa[] = [];
  const quadros = new Map<number, FrameRequestCallback>();
  const revogadas: string[] = [];
  let criadas = 0;
  let proximo = 0;
  class MidiaFalsa {
    currentTime = 0;
    preload = "";
    pausada = false;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) { instancias.push(this); }
    play() { return erroAoTocar ? Promise.reject(new Error("autoplay")) : Promise.resolve(); }
    pause() { this.pausada = true; }
    removeAttribute(nome: string) { if (nome === "src") this.src = ""; }
  }
  definirGlobal(t, "Audio", MidiaFalsa);
  definirGlobal(t, "requestAnimationFrame", (passo: FrameRequestCallback) => { quadros.set(++proximo, passo); return proximo; });
  definirGlobal(t, "cancelAnimationFrame", (id: number) => { quadros.delete(id); });
  t.mock.method(URL, "createObjectURL", () => `blob:teste-${++criadas}`);
  t.mock.method(URL, "revokeObjectURL", (url: string) => { revogadas.push(url); });
  return {
    instancias, quadros, revogadas,
    criadas: () => criadas,
    avancar(tempo: number) {
      instancias.at(-1)!.currentTime = tempo;
      const pendentes = [...quadros.values()];
      quadros.clear();
      pendentes.forEach((passo) => passo(999999));
    },
  };
}

function vozDoNavegador(t: TestContext, falhar = false, concluir = true) {
  const falas: FalaFalsa[] = [];
  class FalaFalsa {
    lang = "";
    rate = 1;
    voice = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: ((e: { charIndex: number }) => void) | null = null;
    constructor(public text: string) {}
  }
  const sintese = {
    getVoices: () => [],
    cancel: () => {},
    speak(fala: FalaFalsa) {
      falas.push(fala);
      if (falhar) throw new Error("síntese indisponível");
      if (concluir) queueMicrotask(() => fala.onend?.());
    },
  };
  definirGlobal(t, "window", { speechSynthesis: sintese });
  definirGlobal(t, "SpeechSynthesisUtterance", FalaFalsa);
  return falas;
}

function pedido(): PedidoAnalise {
  return { sessao_id: "s", fase: "APROFUNDAMENTO", grafo: "COMPONENTES\nCONEXÕES", mudancas: "+ adicionou [r1] API", conversa_recente: [], perguntas_feitas: 0, imagem_url: null };
}

test("agenda pura ordena marcas, normaliza trechos e coloca as ausentes no começo", () => {
  assert.deepEqual(agendaDasMarcas(alinhamento, ["BÁNCO!", "ausente", "Oi", "banco"]), [
    { indice: 1, tempo: 0 }, { indice: 2, tempo: 0 }, { indice: 0, tempo: 0.5 }, { indice: 3, tempo: 0.5 },
  ]);
  assert.deepEqual(agendaDasMarcas(alinhamento, []), []);
});

test("progresso puro usa o relógio da voz e a contagem UTF-16 da legenda", () => {
  assert.equal(progressoDaFala(alinhamento, -1), 0);
  assert.equal(progressoDaFala(alinhamento, 0.55), 4);
  assert.equal(progressoDaFala(alinhamento, Infinity), 8);
  assert.equal(progressoDaFala({ characters: ["🤔"], character_start_times_seconds: [0], character_end_times_seconds: [1] }, 0), 2);
});

test("áudio acompanha currentTime, dispara cada marca uma vez e libera recursos no fim", async (t) => {
  const a = audioFalso(t);
  const progressos: number[] = [];
  const marcas: string[] = [];
  const tocando = tocarComAlinhamento(new Blob(["audio"]), alinhamento, {
    aoProgresso: (n) => progressos.push(n),
    marcas: [
      { trecho: "banco", aoChegar: () => marcas.push("banco") },
      { trecho: "Oi", aoChegar: () => marcas.push("oi") },
      { trecho: "ausente", aoChegar: () => marcas.push("ausente") },
    ],
  });
  await andar();
  assert.deepEqual(marcas, ["oi", "ausente"]);
  a.avancar(0.55);
  a.avancar(0.55);
  a.avancar(0.1);
  a.avancar(0.7);
  assert.deepEqual(marcas, ["oi", "ausente", "banco"]);
  assert.deepEqual(progressos.slice(0, 2), [1, 4]);
  a.instancias[0].onended?.();
  await tocando;
  assert.equal(progressos.at(-1), 8);
  assert.deepEqual(a.revogadas, ["blob:teste-1"]);
  assert.equal(a.quadros.size, 0);
  assert.equal(a.instancias[0].pausada, true);
  assert.equal(a.instancias[0].src, "");
});

test("fim do áudio atualiza marcas mesmo quando não houve quadros intermediários", async (t) => {
  const a = audioFalso(t);
  let chamadas = 0;
  const tocando = tocarComAlinhamento(new Blob(), alinhamento, { marcas: [{ trecho: "banco", aoChegar: () => chamadas++ }] });
  await andar();
  a.instancias[0].onended?.();
  await tocando;
  assert.equal(chamadas, 1);
});

test("play() que falha (sem ser bloqueio de autoplay) rejeita com erro claro e revoga a URL", async (t) => {
  const a = audioFalso(t, true);
  await assert.rejects(tocarComAlinhamento(new Blob(), alinhamento, {}), /áudio indisponível/);
  assert.equal(a.revogadas.length, 1);
  assert.equal(a.quadros.size, 0);
});

test("erro de reprodução e cancelamento limpam áudio e quadros pendentes", async (t) => {
  const a = audioFalso(t);
  const erro = tocarComAlinhamento(new Blob(), alinhamento, {});
  await andar();
  a.instancias[0].onerror?.();
  await assert.rejects(erro, /reproduzir o áudio/);
  const controle = new AbortController();
  let marca = false;
  const cancelada = tocarComAlinhamento(new Blob(), alinhamento, { sinal: controle.signal, marcas: [{ trecho: "banco", aoChegar: () => { marca = true; } }] });
  await andar();
  controle.abort();
  await assert.rejects(cancelada, { name: "AbortError" });
  assert.equal(marca, false);
  assert.equal(a.revogadas.length, 2);
  assert.equal(a.quadros.size, 0);
});

test("sinal já abortado não cria URL nem áudio", async (t) => {
  const a = audioFalso(t);
  const controle = new AbortController();
  controle.abort();
  await assert.rejects(tocarComAlinhamento(new Blob(), alinhamento, { sinal: controle.signal }), { name: "AbortError" });
  assert.equal(a.criadas(), 0);
  assert.equal(a.instancias.length, 0);
});

test("o servidor é o padrão; só o valor 0 liga a demonstração, com sessão, análise e voz locais", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: undefined });
  for (const valor of [undefined, "1", "true", ""]) {
    if (valor === undefined) delete process.env.NEXT_PUBLIC_USAR_SERVIDOR;
    else process.env.NEXT_PUBLIC_USAR_SERVIDOR = valor;
    assert.equal(usarServidor(), true);
  }
  process.env.NEXT_PUBLIC_USAR_SERVIDOR = "0";
  assert.equal(usarServidor(), false);
  const falas = vozDoNavegador(t);
  let chamadas = 0;
  t.mock.method(globalThis, "fetch", async () => { chamadas++; throw new Error("não deveria chamar rota"); });
  t.mock.method(console, "debug", () => {});
  assert.equal((await criarSessao()).sessao_id, "sessao-de-mentira");
  await enviarEventos("s", []);
  await falar("Oi banco");
  assert.equal(falas.length, 1);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const analise = analisar(pedido(), new AbortController().signal);
  t.mock.timers.tick(2000);
  assert.ok((await analise).status);
  assert.equal(chamadas, 0);
});

test("modo real usa IDs públicos, análise e eventos; IDs ausentes usam demo", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1", NEXT_PUBLIC_AVALIACAO_ID: "avaliacao", NEXT_PUBLIC_CANDIDATO_ID: "candidato" });
  const chamadas: { rota: string; opcoes: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (rota: string, opcoes: RequestInit) => {
    chamadas.push({ rota, opcoes });
    if (rota.endsWith("/eventos")) return new Response(null, { status: 204 });
    return Response.json(rota.endsWith("/analisar") ? { status: "ok" } : { sessao_id: "real", area: "system design", problema: { titulo: "Links", enunciado: "Projete" }, tempos: {} });
  });
  assert.equal((await criarSessao()).sessao_id, "real");
  assert.deepEqual(JSON.parse(String(chamadas[0].opcoes.body)), { avaliacao_id: "avaliacao", candidato_id: "candidato" });
  const sinal = new AbortController().signal;
  await analisar(pedido(), sinal);
  assert.equal(chamadas[1].opcoes.signal, sinal);
  await enviarEventos("s", []);
  assert.equal(chamadas[2].rota, "/api/sessoes/s/eventos");
  delete process.env.NEXT_PUBLIC_AVALIACAO_ID;
  delete process.env.NEXT_PUBLIC_CANDIDATO_ID;
  await criarSessao();
  assert.deepEqual(JSON.parse(String(chamadas[3].opcoes.body)), { avaliacao_id: "demo", candidato_id: "demo" });
});

test("voz real toca o MP3 e dispara o desenho no trecho alinhado", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  const a = audioFalso(t);
  const progressos: number[] = [];
  let desenho = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json({ audio_base64: "T2k=", alinhamento }));
  // Com a folga do quadro, a fala começa depois do silêncio: as marcas andam o mesmo tempo.
  esquecerSaidaDeSom();
  const folga = segundosDeQuadros(QUADROS_ANTES_DEPOIS_DE_PARADA);
  const tocando = falarComMarcas("Oi banco", [{ trecho: "banco", aoChegar: () => desenho++ }], (n) => progressos.push(n));
  await esperarAudio(a);
  assert.equal(a.instancias.length, 1);
  assert.equal(desenho, 0);
  a.avancar(folga + 0.55);
  assert.equal(desenho, 1);
  a.instancias[0].onended?.();
  await tocando;
  assert.equal(progressos.at(-1), 8);
});

test("caminho B manda o texto anterior e o ritmo, e toca com a folga do quadro (e marca a saída)", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  const a = audioFalso(t);
  esquecerSaidaDeSom();
  const capturados: Blob[] = [];
  t.mock.method(URL, "createObjectURL", (blob: Blob) => { capturados.push(blob); return "blob:b"; });
  const corpos: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_: string, opcoes: RequestInit) => {
    corpos.push(JSON.parse(String(opcoes.body)));
    return Response.json({ audio_base64: "T2k=", alinhamento });
  });
  const primeira = "Primeira fala do Totti, longa o bastante para não ficar guardada no cache.";
  const segunda = "Segunda fala do Totti, longa o bastante para não ficar guardada no cache.";
  const primeiraTocando = falarComMarcas(primeira, []);
  await esperarAudio(a);
  a.instancias.at(-1)!.onended?.();
  await primeiraTocando;
  const segundaTocando = falarComMarcas(segunda, []);
  await esperarAudio(a, 2);
  a.instancias.at(-1)!.onended?.();
  await segundaTocando;
  assert.equal(corpos[0].velocidade, 1.1);
  assert.equal(corpos[1].texto_anterior, primeira);
  // "Oi" (T2k=) com a folga da primeira fala (saída nunca tocou) e, na segunda, a folga normal (saída acabou de sair).
  const oi = Uint8Array.from([0x4f, 0x69]);
  assert.equal(capturados[0].size, comFolga(oi, alinhamento, QUADROS_ANTES_DEPOIS_DE_PARADA).bytes.length);
  assert.equal(capturados[1].size, comFolga(oi, alinhamento, QUADROS_ANTES).bytes.length);
});

test("áudio fica preparado enquanto aguarda a pessoa terminar o turno", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  const a = audioFalso(t);
  let sintetizou = false;
  t.mock.method(globalThis, "fetch", async () => {
    sintetizou = true;
    return Response.json({ audio_base64: "T2k=", alinhamento });
  });
  let liberar!: (valor: boolean) => void;
  const pausa = new Promise<boolean>((resolver) => { liberar = resolver; });
  const tocando = falarComMarcas("Oi banco", [], undefined, () => pausa);
  await andar();
  assert.equal(sintetizou, true);
  assert.equal(a.instancias.length, 0);
  liberar(true);
  await andar();
  assert.equal(a.instancias.length, 1);
  a.instancias[0].onended?.();
  await tocando;
});

test("cancelar durante a espera pelo turno descarta o áudio preparado", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  const a = audioFalso(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ audio_base64: "T2k=", alinhamento }));
  let liberar!: (valor: boolean) => void;
  const pausa = new Promise<boolean>((resolver) => { liberar = resolver; });
  const tocando = falarComMarcas("Oi banco", [], undefined, () => pausa);
  await andar();
  calar();
  liberar(true);
  await tocando;
  assert.equal(a.instancias.length, 0);
});

test("falha da rota tenta de novo, não usa a voz do navegador e ainda completa a legenda", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  const falas = vozDoNavegador(t);
  t.mock.method(console, "warn", () => {});
  let pedidos = 0;
  t.mock.method(globalThis, "fetch", async () => { pedidos++; return new Response("indisponível", { status: 503 }); });
  const progressos: number[] = [];
  let desenho = 0;
  await falarComMarcas("Oi banco", [{ trecho: "banco", aoChegar: () => desenho++ }], (n) => progressos.push(n));
  assert.equal(pedidos, 2);
  assert.equal(falas.length, 0);
  assert.equal(desenho, 1);
  assert.equal(progressos.at(-1), 8);
});

test("player que não toca não cai na síntese do navegador e não repete marcas", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  audioFalso(t, true);
  const falas = vozDoNavegador(t);
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async () => Response.json({ audio_base64: "T2k=", alinhamento }));
  let desenho = 0;
  await falarComMarcas("Oi banco", [{ trecho: "banco", aoChegar: () => desenho++ }]);
  assert.equal(falas.length, 0);
  assert.equal(desenho, 1);
});

test("calar aborta síntese pendente e não inicia fallback nem desenho tardio", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  const falas = vozDoNavegador(t);
  let sinal: AbortSignal | null = null;
  t.mock.method(globalThis, "fetch", async (_: string, opcoes: RequestInit) => new Promise<Response>((_, rejeitar) => {
    sinal = opcoes.signal!;
    sinal.addEventListener("abort", () => rejeitar(sinal!.reason), { once: true });
  }));
  let desenho = 0;
  const fala = falarComMarcas("Oi banco", [{ trecho: "banco", aoChegar: () => desenho++ }]);
  await andar();
  calar();
  await fala;
  assert.ok(sinal);
  assert.equal((sinal as AbortSignal).aborted, true);
  assert.equal(falas.length, 0);
  assert.equal(desenho, 0);
});

test("calar interrompe reprodução, resolve falar e não completa progresso antigo", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  const a = audioFalso(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ audio_base64: "T2k=", alinhamento }));
  const progressos: number[] = [];
  const fala = falar("Oi banco", (n) => progressos.push(n));
  await andar();
  calar();
  await fala;
  assert.ok(a.instancias[0].pausada);
  assert.equal(a.revogadas.length, 1);
  assert.notEqual(progressos.at(-1), 8);
});

test("uma nova fala cancela a anterior sem progresso ou marcas antigos", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  const a = audioFalso(t);
  let chamadas = 0;
  t.mock.method(globalThis, "fetch", async (_: string, opcoes: RequestInit) => {
    if (++chamadas === 1) return new Promise<Response>((_, rejeitar) => {
      opcoes.signal!.addEventListener("abort", () => rejeitar(opcoes.signal!.reason), { once: true });
    });
    return Response.json({ audio_base64: "T2k=", alinhamento });
  });
  const antiga: number[] = [];
  const nova: number[] = [];
  let marcaAntiga = false;
  const primeira = falarComMarcas("Oi banco", [{ trecho: "banco", aoChegar: () => { marcaAntiga = true; } }], (n) => antiga.push(n));
  await andar();
  const segunda = falar("Oi banco", (n) => nova.push(n));
  await primeira;
  await andar();
  a.instancias[0].onended?.();
  await segunda;
  assert.deepEqual(antiga, []);
  assert.equal(marcaAntiga, false);
  assert.equal(nova.at(-1), 8);
});

test("calar resolve a síntese do navegador mesmo sem evento de término", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "0" });
  const falas = vozDoNavegador(t, false, false);
  const progressos: number[] = [];
  const tocando = falar("Oi banco", (n) => progressos.push(n));
  assert.equal(falas.length, 1);
  calar();
  await tocando;
  assert.equal(falas[0].onend, null);
  assert.deepEqual(progressos, []);
});

test("imagem rápida entra no pedido sem alterar o original", async () => {
  const p = pedido();
  const pronto = await pedidoComImagem(p, Promise.resolve("/imagem.png"), new AbortController().signal);
  assert.equal(pronto.imagem_url, "/imagem.png");
  assert.equal(p.imagem_url, null);
});

test("imagem lenta libera o pedido em 1800 ms e continua disponível para registro posterior", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolver!: (url: string) => void;
  const imagem = new Promise<string>((resolve) => { resolver = resolve; });
  let terminou = false;
  const p = pedido();
  const preparacao = pedidoComImagem(p, imagem, new AbortController().signal).then((pronto) => { terminou = true; return pronto; });
  t.mock.timers.tick(1799);
  await andar();
  assert.equal(terminou, false);
  t.mock.timers.tick(1);
  assert.equal((await preparacao).imagem_url, null);
  resolver("/tardia.png");
  assert.equal(await imagem, "/tardia.png");
});

test("imagem com erro não impede pedido e espera pode ser cancelada", async () => {
  const p = pedido();
  assert.equal(await pedidoComImagem(p, Promise.reject(new Error("PNG indisponível")), new AbortController().signal), p);
  const controle = new AbortController();
  const esperando = pedidoComImagem(p, new Promise<null>(() => {}), controle.signal);
  controle.abort();
  await assert.rejects(esperando, { name: "AbortError" });
});

// Por último: o 501 desliga a voz do servidor para o módulo inteiro até a próxima sessão.
test("voz não implementada (501) não é pedida de novo até a próxima sessão", async (t) => {
  ambiente(t, { NEXT_PUBLIC_USAR_SERVIDOR: "1" });
  const falas = vozDoNavegador(t);
  t.mock.method(console, "warn", () => {});
  const rotas: string[] = [];
  t.mock.method(globalThis, "fetch", async (rota: string) => {
    rotas.push(rota);
    if (rota === "/api/falar") return Response.json({ erro: "voz ainda não implementada" }, { status: 501 });
    return Response.json({ sessao_id: "real", area: "system design", problema: { titulo: "Links", enunciado: "Projete" }, tempos: {} });
  });
  await falar("Oi");
  await falar("Tudo bem?");
  assert.deepEqual(rotas, ["/api/falar"]);
  assert.equal(falas.length, 0);
  await criarSessao();
  await falar("De novo");
  assert.deepEqual(rotas, ["/api/falar", "/api/sessoes", "/api/falar"]);
});

test("relógio da legenda só começa quando o som sai (playing), depois de carregar (canplaythrough)", async (t) => {
  const audio = audioFalso(t);
  const progresso: number[] = [];
  const ouvintes = new Map<string, () => void>();
  let tocou = false;
  class MidiaCarregando {
    currentTime = 0;
    readyState = 1;
    paused = true;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onplaying: (() => void) | null = null;
    constructor(public src: string) { audio.instancias.push(this as never); }
    addEventListener(nome: string, f: () => void) { ouvintes.set(nome, f); }
    removeEventListener(nome: string) { ouvintes.delete(nome); }
    play() { tocou = true; return Promise.resolve(); }
    pause() {}
    removeAttribute() {}
  }
  definirGlobal(t, "Audio", MidiaCarregando);
  const fala = tocarComAlinhamento(new Blob(["x"]), alinhamento, { aoProgresso: (n) => progresso.push(n) });
  await andar();
  assert.equal(tocou, false, "espera o áudio carregar antes do play()");
  ouvintes.get("canplaythrough")?.();
  await andar();
  assert.equal(tocou, true);
  assert.equal(audio.quadros.size, 0, "play() aceito com a mídia ainda parada não inicia o relógio");
  const midia = audio.instancias.at(-1) as unknown as MidiaCarregando;
  midia.paused = false;
  midia.onplaying?.();
  audio.avancar(0.25);
  assert.ok(progresso.length > 0, "com o som saindo, a legenda anda");
  midia.onended?.();
  await fala;
});

test("saída acordada: um tom inaudível enquanto alguma tela que fala está montada", async (t) => {
  const { manterSaidaAcordada } = await import("../vozSincronizada");
  const contextos: { fechado: boolean; ganho: number; frequencia: number }[] = [];
  class ContextoFalso {
    state = "running";
    destination = {};
    registro = { fechado: false, ganho: 1, frequencia: 0 };
    constructor() { contextos.push(this.registro); }
    createOscillator() {
      const registro = this.registro;
      return { frequency: { set value(v: number) { registro.frequencia = v; } }, connect: (n: unknown) => n, start() {} };
    }
    createGain() {
      const registro = this.registro;
      return { gain: { set value(v: number) { registro.ganho = v; } }, connect: (n: unknown) => n };
    }
    resume() { return Promise.resolve(); }
    close() { this.registro.fechado = true; return Promise.resolve(); }
  }
  definirGlobal(t, "window", { AudioContext: ContextoFalso });
  const soltarA = manterSaidaAcordada();
  const soltarB = manterSaidaAcordada();
  assert.equal(contextos.length, 1, "um contexto só para todas as telas");
  assert.ok(contextos[0].ganho > 0 && contextos[0].ganho <= 0.001, "inaudível, mas não zero");
  soltarA();
  soltarA();
  assert.equal(contextos[0].fechado, false, "ainda há uma tela montada");
  soltarB();
  assert.equal(contextos[0].fechado, true);
});

test("rampa: a fala entra com ganho 0 e sobe em 80 ms a partir do começo do som (parte pura)", () => {
  const eventos: unknown[][] = [];
  const ganho = { gain: {
    cancelScheduledValues: (t: number) => eventos.push(["cancelar", t]),
    setValueAtTime: (v: number, t: number) => eventos.push(["valor", v, t]),
    linearRampToValueAtTime: (v: number, t: number) => eventos.push(["rampa", v, t]),
  } } as unknown as { gain: AudioParam };
  agendarRampaDeEntrada(ganho, 3);
  assert.equal(RAMPA_DE_ENTRADA_MS, 80);
  assert.deepEqual(eventos, [["cancelar", 3], ["valor", 0, 3], ["rampa", 1, 3 + RAMPA_DE_ENTRADA_MS / 1000]]);
});

function contextoFalso(t: TestContext) {
  const estado = { state: "running" as string };
  const origens: unknown[] = [];
  const ganhos: unknown[][][] = [];
  const retomadas = { ok: true };
  class ContextoFalso {
    currentTime = 5;
    destination = {};
    get state() { return estado.state; }
    createMediaElementSource(elemento: unknown) { origens.push(elemento); return { connect: (n: unknown) => n }; }
    createGain() {
      const eventos: unknown[][] = [];
      ganhos.push(eventos);
      const gain = {
        cancelScheduledValues: (t: number) => eventos.push(["cancelar", t]),
        setValueAtTime: (v: number, t: number) => eventos.push(["valor", v, t]),
        linearRampToValueAtTime: (v: number, t: number) => eventos.push(["rampa", v, t]),
      };
      return { gain, connect: (n: unknown) => n, context: this };
    }
    resume() { return retomadas.ok ? Promise.resolve() : Promise.reject(new Error("bloqueado")); }
    close() { return Promise.resolve(); }
  }
  definirGlobal(t, "window", { AudioContext: ContextoFalso });
  return { estado, origens, ganhos, retomadas };
}

test("rampa: o elemento só entra pelo grafo com o contexto rodando; a rampa começa no som (playing)", async (t) => {
  esquecerRampaDeEntrada();
  const contexto = contextoFalso(t);
  const a = audioFalso(t);
  const tocando = tocarComAlinhamento(new Blob(), alinhamento, {});
  await andar();
  const midia = a.instancias.at(-1)!;
  (midia as unknown as { onplaying: () => void }).onplaying();
  assert.deepEqual(contexto.origens, [midia]);
  assert.deepEqual(contexto.ganhos[0], [
    ["cancelar", 5], ["valor", 0, 5],
    ["cancelar", 5], ["valor", 0, 5], ["rampa", 1, 5 + RAMPA_DE_ENTRADA_MS / 1000],
  ]);
  midia.onended?.();
  await tocando;
});

test("rampa: contexto parado não liga o elemento ao grafo e a fala toca do mesmo jeito", async (t) => {
  esquecerRampaDeEntrada();
  const contexto = contextoFalso(t);
  contexto.estado.state = "suspended";
  contexto.retomadas.ok = false;
  const a = audioFalso(t);
  const tocando = tocarComAlinhamento(new Blob(), alinhamento, {});
  await andar();
  assert.equal(contexto.origens.length, 0);
  assert.equal(a.instancias.length, 1);
  assert.equal(a.instancias[0].src, "blob:teste-1");
  a.instancias[0].onended?.();
  await tocando;
});

test("rampa: cada elemento é ligado uma vez; se o contexto para, o elemento liberado não toca mudo", async (t) => {
  esquecerRampaDeEntrada();
  const contexto = contextoFalso(t);
  const a = audioFalso(t);
  liberarAudio();
  await andar();
  const liberado = a.instancias[0];
  const primeira = tocarComAlinhamento(new Blob(), alinhamento, {});
  await andar();
  (liberado as unknown as { onplaying: () => void }).onplaying();
  liberado.onended?.();
  await primeira;
  const segunda = tocarComAlinhamento(new Blob(), alinhamento, {});
  await andar();
  (liberado as unknown as { onplaying: () => void }).onplaying();
  liberado.onended?.();
  await segunda;
  assert.deepEqual(contexto.origens, [liberado], "uma ligação só, reaproveitada na segunda fala");
  contexto.estado.state = "suspended";
  const terceira = tocarComAlinhamento(new Blob(), alinhamento, {});
  await andar();
  const nova = a.instancias.at(-1)!;
  assert.notEqual(nova, liberado, "com o contexto parado, a fala sai por um elemento novo");
  nova.onended?.();
  await terceira;
});
