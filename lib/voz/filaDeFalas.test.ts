import assert from "node:assert/strict";
import { test } from "node:test";
import { FocoAudio } from "../audio/foco";
import type { ReproduzirFala, ReproduzirGravacao } from "./cliente";
import { criarFilaDeFalas, type EstadoVoz } from "./filaDeFalas";
import { ESPERA_DA_REACAO_MS } from "./reacao";

// Tempos curtos para o teste: o que importa é a ordem e a pausa, não os valores reais.
const PAUSA = 60;
const SINTESE = 20;
const DURACAO = 80;
/** Folga para a imprecisão dos timers. */
const FOLGA = 3;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Monta uma fila com um "ElevenLabs" falso que registra quando cada áudio começa e termina de tocar. */
function montar(opcoes: { falhar?: string[]; duracao?: Record<string, number>; aguardarGesto?: string[]; gravacaoFalha?: string[] } = {}) {
  const t0 = Date.now();
  const agora = () => Date.now() - t0;
  const audios: { texto: string; inicio: number; fim?: number; cortado?: boolean }[] = [];
  const estados: { em: number; estado: EstadoVoz }[] = [];
  /** O que foi sintetizado (um pedido à ElevenLabs) e as gravações de reação que tocaram. */
  const sinteses: string[] = [];
  const gravacoes: { url: string; texto: string; inicio: number; fim?: number }[] = [];
  const erros: string[] = [];
  let tocandoAgora = 0;
  let maximoSimultaneo = 0;

  const reproduzir: ReproduzirFala = async (texto, sinal, eventos, antesDeTocar) => {
    sinteses.push(texto);
    await dormir(SINTESE);
    sinal.throwIfAborted();
    if (opcoes.falhar?.includes(texto)) throw new Error(`voz indisponível para ${texto}`);
    if (antesDeTocar && !(await antesDeTocar())) return;
    sinal.throwIfAborted();
    if (opcoes.aguardarGesto?.includes(texto)) {
      // O navegador bloqueou o som: o áudio fica parado até um toque que nunca vem (só sai abortado).
      eventos.aoAguardarGesto?.();
      await new Promise<never>((_, falha) => sinal.addEventListener("abort", () => falha(sinal.reason), { once: true }));
    }
    const audio: (typeof audios)[number] = { texto, inicio: agora() };
    audios.push(audio);
    tocandoAgora++;
    maximoSimultaneo = Math.max(maximoSimultaneo, tocandoAgora);
    eventos.aoIniciar("elevenlabs");
    try {
      await new Promise<void>((ok, falha) => {
        const id = setTimeout(ok, opcoes.duracao?.[texto] ?? DURACAO);
        sinal.addEventListener("abort", () => { clearTimeout(id); falha(sinal.reason); }, { once: true });
      });
    } catch (erro) {
      audio.cortado = true;
      throw erro;
    } finally {
      tocandoAgora--;
      audio.fim = agora();
    }
  };

  // A gravação falsa segue o mesmo caminho da fala: carrega (dormir), pergunta a vez e toca pelo tempo de uma fala.
  const reproduzirGravacao: ReproduzirGravacao = async (url, texto, sinal, eventos, antesDeTocar) => {
    await dormir(SINTESE);
    if (opcoes.gravacaoFalha?.includes(url)) throw new Error(`gravação ausente: ${url}`);
    sinal.throwIfAborted();
    if (antesDeTocar && !(await antesDeTocar())) return;
    sinal.throwIfAborted();
    const gravacao: (typeof gravacoes)[number] = { url, texto, inicio: agora() };
    gravacoes.push(gravacao);
    eventos.aoIniciar("elevenlabs");
    try {
      await new Promise<void>((ok, falha) => {
        const id = setTimeout(ok, DURACAO);
        sinal.addEventListener("abort", () => { clearTimeout(id); falha(sinal.reason); }, { once: true });
      });
    } finally {
      gravacao.fim = agora();
    }
  };

  const foco = new FocoAudio();
  const fila = criarFilaDeFalas({
    reproduzir,
    reproduzirGravacao,
    foco,
    pausaMs: PAUSA,
    tela: {
      estado: (estado) => estados.push({ em: agora(), estado }),
      erro: (erro) => { if (erro) erros.push(erro); },
      aviso: () => {},
      provedor: () => {},
      fala: () => {},
    },
  });
  const audio = (texto: string) => {
    const a = audios.find((x) => x.texto === texto);
    assert.ok(a, `o áudio "${texto}" deveria ter tocado`);
    return a;
  };
  return { fila, foco, audios, estados, audio, agora, maximoSimultaneo: () => maximoSimultaneo, sinteses, gravacoes, erros };
}

test("fala nova com outra tocando espera ela terminar e a pausa, sem sobrepor", async () => {
  const { fila, audio, maximoSimultaneo } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE + 30); // A já está tocando
  const b = fila.falar("B");
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.equal(audio("A").cortado, undefined, "A não pode ser cortada pela B");
  assert.ok(audio("B").inicio >= audio("A").fim! + PAUSA - FOLGA, "B só começa depois do fim de A mais a pausa");
  assert.equal(maximoSimultaneo(), 1);
});

test("a pausa vale mesmo quando a fala seguinte chega depois que a anterior já terminou", async () => {
  const { fila, audio } = montar();
  assert.equal(await fila.falar("A"), true);
  // Ex.: a resposta acabou e a pergunta de um balão chega logo em seguida.
  assert.equal(await fila.falar("B"), true);
  assert.ok(audio("B").inicio >= audio("A").fim! + PAUSA - FOLGA);
});

test("uma fala que ainda não começou a tocar é substituída pela mais nova", async () => {
  const { fila, audios, audio } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE + 30);
  const b = fila.falar("B"); // na fila atrás de A
  await dormir(10);
  const c = fila.falar("C"); // B ainda não tocava: fica velha
  assert.deepEqual(await Promise.all([a, b, c]), [true, false, true]);
  assert.deepEqual(audios.map((x) => x.texto), ["A", "C"]);
  assert.ok(audio("C").inicio >= audio("A").fim! + PAUSA - FOLGA, "C espera A mesmo com B descartada no meio");
});

test("depois de um corte (parar), a fala seguinte também espera a pausa", async () => {
  const { fila, audio } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE + 30);
  fila.parar(); // ex.: o candidato abriu um balão
  const b = fila.falar("B");
  assert.deepEqual(await Promise.all([a, b]), [false, true]);
  assert.equal(audio("A").cortado, true);
  assert.ok(audio("B").inicio >= audio("A").fim! + PAUSA - FOLGA, "B espera a pausa contada do corte de A");
});

test("numa rajada de falas nunca toca mais de uma ao mesmo tempo", async () => {
  const { fila, audios, maximoSimultaneo } = montar();
  const pedidas: Promise<boolean>[] = [];
  for (const texto of ["A", "B", "C", "D", "E"]) {
    pedidas.push(fila.falar(texto));
    await dormir(DURACAO + SINTESE); // cada uma chega com a anterior ainda tocando ou na pausa
  }
  await Promise.all(pedidas);
  assert.equal(maximoSimultaneo(), 1);
  for (let i = 1; i < audios.length; i++) {
    assert.ok(audios[i].inicio >= audios[i - 1].fim! + PAUSA - FOLGA, `${audios[i].texto} encostou em ${audios[i - 1].texto}`);
  }
});

test("na pausa entre duas falas o agente segue ocupado (ninguém toma a vez dele)", async () => {
  const { fila, estados, audio } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE + 30);
  const b = fila.falar("B");
  await Promise.all([a, b]);
  const naPausa = estados.filter((e) => e.em >= audio("A").fim! && e.em < audio("B").inicio).map((e) => e.estado);
  assert.ok(!naPausa.includes("inativa"), `estado na pausa: ${naPausa.join(", ")}`);
  assert.equal(estados.at(-1)?.estado, "inativa", "no fim de tudo o agente fica inativo");
});

test("parar descarta também as falas da fila", async () => {
  const { fila, audios } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE + 30);
  const b = fila.falar("B");
  fila.parar();
  assert.deepEqual(await Promise.all([a, b]), [false, false]);
  await dormir(DURACAO + PAUSA + SINTESE);
  assert.deepEqual(audios.map((x) => x.texto), ["A"]);
});

test("erro na fala da fila não derruba a que está tocando", async () => {
  const { fila, estados, audio } = montar({ falhar: ["B"] });
  const a = fila.falar("A");
  await dormir(SINTESE + 10);
  const b = fila.falar("B");
  assert.deepEqual(await Promise.all([a, b]), [true, false]);
  assert.equal(audio("A").cortado, undefined);
  const enquantoA = estados.filter((e) => e.em > audio("A").inicio && e.em < audio("A").fim!).map((e) => e.estado);
  assert.ok(!enquantoA.includes("erro"), `estado enquanto A tocava: ${enquantoA.join(", ")}`);
});

test("a fala espera o candidato fazer uma pausa (antesDeTocar) só depois da pausa do agente", async () => {
  const { fila, audio, agora } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE + 30);
  let perguntouEm = -1;
  const b = fila.falar("B", {
    antesDeTocar: async () => { perguntouEm = agora(); await dormir(40); return true; },
  });
  await Promise.all([a, b]);
  assert.ok(perguntouEm >= audio("A").fim! + PAUSA - FOLGA, "a vez do candidato só é consultada depois da pausa");
  assert.ok(audio("B").inicio >= perguntouEm + 40 - FOLGA);
});

test("o microfone abrindo durante a preparação cancela a fala, que não toca depois do ditado", async () => {
  const { fila, foco, audios } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE / 2); // A ainda sintetizando
  const soltarMicrofone = foco.assumir("entrada", () => {});
  assert.equal(await a, false);
  soltarMicrofone();
  await dormir(SINTESE + PAUSA + DURACAO);
  assert.deepEqual(audios, [], "nenhuma fala velha toca depois do ditado");
});

test("o microfone abrindo na pausa entre duas falas descarta a da fila", async () => {
  const { fila, foco, audios, audio } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE + 30);
  const b = fila.falar("B");
  await a;
  await dormir(PAUSA / 2); // na pausa entre A e B
  const soltarMicrofone = foco.assumir("entrada", () => {});
  assert.equal(await b, false);
  soltarMicrofone();
  await dormir(PAUSA + DURACAO);
  assert.deepEqual(audios.map((x) => x.texto), ["A"]);
  assert.ok(audio("A").fim! > 0);
});

test("com a fila vazia o foco volta: o microfone abre sem cancelar nada", async () => {
  const { fila, foco } = montar();
  assert.equal(await fila.falar("A"), true);
  let cancelou = false;
  const soltar = foco.assumir("entrada", () => { cancelou = true; });
  soltar();
  assert.equal(cancelou, false);
  assert.equal(await fila.falar("B"), true, "a fila assume o foco de novo na fala seguinte");
});

test("fala substituída enquanto espera a pausa do candidato não segura a próxima", async () => {
  const { fila, audio, agora } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE + 30);
  let liberarCandidato!: () => void;
  const candidatoPausou = new Promise<boolean>((r) => { liberarCandidato = () => r(true); });
  const b = fila.falar("B", { antesDeTocar: () => candidatoPausou }); // o candidato não para de falar
  await a;
  await dormir(PAUSA + SINTESE); // B já tem a vez e está presa no antesDeTocar
  const pedidaEm = agora();
  const c = fila.falar("C");
  assert.equal(await b, false);
  assert.equal(await c, true);
  assert.ok(audio("C").inicio < pedidaEm + SINTESE + PAUSA, "C não esperou o antesDeTocar velho de B");
  liberarCandidato();
});

test("fala presa esperando um toque na tela é substituída pela mais nova", async () => {
  const { fila, audios, audio } = montar({ aguardarGesto: ["A"] });
  const a = fila.falar("A");
  await dormir(SINTESE + 30); // A tem a vez, mas o navegador não deixou o som sair
  const b = fila.falar("B");
  assert.deepEqual(await Promise.all([a, b]), [false, true]);
  assert.deepEqual(audios.map((x) => x.texto), ["B"]);
  assert.ok(audio("B").inicio >= 0);
});

test("reação e a fala seguinte, em 500 ms, saem juntas numa síntese só (sem gravação)", async () => {
  const { fila, sinteses, gravacoes } = montar();
  const reacao = fila.falar("Hm");
  await dormir(500);
  const seguinte = fila.falar("E como você escalaria isso?");
  assert.deepEqual(await Promise.all([reacao, seguinte]), [false, true]);
  assert.deepEqual(sinteses, ["Hm. E como você escalaria isso?"]);
  assert.deepEqual(gravacoes, []);
});

test("reação sozinha: depois de 1,2 s toca a gravação da reação, nunca a síntese", async () => {
  const { fila, sinteses, gravacoes } = montar();
  assert.equal(await fila.falar("Hm."), true);
  assert.deepEqual(sinteses, []);
  assert.equal(gravacoes.length, 1);
  assert.equal(gravacoes[0].url, "/audio/reacoes/hm.mp3");
  assert.ok(gravacoes[0].inicio >= ESPERA_DA_REACAO_MS - FOLGA, "a gravação só entra depois do prazo da reação");
});

test("reação com a gravação que não carrega: descartada em silêncio, sem síntese e sem erro", async () => {
  const { fila, sinteses, gravacoes, erros, estados } = montar({ gravacaoFalha: ["/audio/reacoes/uhum.mp3"] });
  assert.equal(await fila.falar("Uhum."), false);
  assert.deepEqual(sinteses, []);
  assert.deepEqual(gravacoes, []);
  assert.deepEqual(erros, []);
  assert.equal(estados.at(-1)?.estado, "inativa");
});

test("fala que não é reação não espera: sai na hora, sem gravação", async () => {
  const { fila, sinteses, gravacoes } = montar();
  const t0 = Date.now();
  assert.equal(await fila.falar("Como você escalaria isso?"), true);
  assert.ok(Date.now() - t0 < ESPERA_DA_REACAO_MS, "sem espera de reação");
  assert.deepEqual(sinteses, ["Como você escalaria isso?"]);
  assert.deepEqual(gravacoes, []);
});

test("parar enquanto a reação espera a seguinte: a reação some e nada toca depois", async () => {
  const { fila, sinteses, gravacoes } = montar();
  const reacao = fila.falar("Certo.");
  await dormir(300);
  fila.parar();
  assert.equal(await reacao, false);
  await dormir(ESPERA_DA_REACAO_MS + SINTESE);
  assert.deepEqual(sinteses, []);
  assert.deepEqual(gravacoes, []);
});

test("reação numa fila ocupada toca a gravação só depois da fala que está tocando, com a pausa", async () => {
  const { fila, audio, gravacoes } = montar();
  const a = fila.falar("A");
  await dormir(SINTESE + 30); // A já está tocando
  const reacao = fila.falar("Tá");
  assert.equal(await reacao, true);
  await a;
  assert.equal(gravacoes.length, 1);
  assert.ok(gravacoes[0].inicio >= audio("A").fim! + PAUSA - FOLGA, "a gravação espera A terminar e a pausa");
});
