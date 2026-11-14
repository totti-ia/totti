import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { registrarUsoVoz } from "@/lib/voz/uso";
import { getOrCreateSession } from "@/lib/session/store";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
});
const pedido = (corpo: unknown) => new NextRequest("http://localhost/api/falar", { method: "POST", body: JSON.stringify(corpo) });
const alinhamento = { characters: ["o", "i"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] };

test("sem chave responde 501 (a fala fica na legenda)", async () => {
  assert.equal((await POST(pedido({ texto: "oi" }))).status, 501);
});

test("exige texto", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  assert.equal((await POST(pedido({ texto: "  " }))).status, 400);
  assert.equal((await POST(pedido({ texto: "a".repeat(2001) }))).status, 400);
});

test("a voz é sempre a mesma (fixa: nenhuma variável troca) e devolve áudio com alinhamento", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  process.env.ELEVENLABS_VOICE_ID = "voz-x";
  process.env.ELEVENLABS_MODEL_ID = "outro-modelo";
  let url = "";
  let corpo: Record<string, unknown> = {};
  globalThis.fetch = (async (alvo: unknown, init?: RequestInit) => {
    url = String(alvo);
    corpo = JSON.parse(String(init?.body));
    return Response.json({ audio_base64: "AAAA", alignment: alinhamento });
  }) as typeof fetch;
  const resposta = await POST(pedido({ texto: "oi" }));
  assert.match(url, /text-to-speech\/jyRzzBWbHll8EUfOjmhe\/with-timestamps/);
  assert.equal(corpo.model_id, "eleven_flash_v2_5");
  assert.deepEqual(corpo.voice_settings, { stability: 0.75, similarity_boost: 0.85, style: 0, use_speaker_boost: true, speed: 1.1 });
  assert.deepEqual(await resposta.json(), { audio_base64: "AAAA", alinhamento });
  delete process.env.ELEVENLABS_MODEL_ID;
});

test("falha ou resposta estranha do ElevenLabs vira 502", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  globalThis.fetch = (async () => new Response("x", { status: 401 })) as typeof fetch;
  assert.equal((await POST(pedido({ texto: "oi" }))).status, 502);
  globalThis.fetch = (async () => Response.json({ audio_base64: "AAAA", alignment: null })) as typeof fetch;
  assert.equal((await POST(pedido({ texto: "oi" }))).status, 502);
});

test("bloqueia origem externa e não permite cache mesmo sem configuração", async () => {
  const externo = new NextRequest("http://localhost/api/falar", {
    method: "POST", headers: { origin: "https://outro.example" }, body: JSON.stringify({ texto: "oi" }),
  });
  assert.equal((await POST(externo)).status, 403);
  const semChave = await POST(pedido({ texto: "oi" }));
  assert.equal(semChave.headers.get("cache-control"), "no-store");
});

test("registra voz_uso plano no live coding", async () => {
  const sessao = getOrCreateSession(`voz-uso-${Date.now()}`);
  await registrarUsoVoz({ sessao_id: sessao.sessionId, contexto: "coding", fala_id: "fala-1" }, "Olá Totti");
  const evento = sessao.events.at(-1);
  assert.equal(evento?.type, "voz_uso");
  if (evento?.type === "voz_uso") {
    assert.equal(evento.caracteres, 9);
    assert.equal(evento.fala_id, "fala-1");
  }
});

test("rejeita horários incompletos em vez de produzir legenda sem sincronia", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  globalThis.fetch = async () => Response.json({ audio_base64: "AAAA", alignment: { ...alinhamento, character_end_times_seconds: [0.1] } });
  assert.equal((await POST(pedido({ texto: "oi" }))).status, 502);
});

test("repassa texto anterior e seguinte à ElevenLabs e omite os que não vierem", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  const corpos: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_alvo: unknown, init?: RequestInit) => {
    corpos.push(JSON.parse(String(init?.body)));
    return Response.json({ audio_base64: "AAAA", alignment: alinhamento });
  }) as typeof fetch;
  await POST(pedido({ texto: "oi", texto_anterior: "Antes.", texto_seguinte: "  Depois.  " }));
  await POST(pedido({ texto: "oi" }));
  assert.equal(corpos[0].previous_text, "Antes.");
  assert.equal(corpos[0].next_text, "Depois.");
  assert.equal("previous_text" in corpos[1], false);
  assert.equal("next_text" in corpos[1], false);
});

test("texto vizinho acima de 1000 caracteres ou de tipo errado é 400", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  globalThis.fetch = (async () => Response.json({ audio_base64: "AAAA", alignment: alinhamento })) as typeof fetch;
  assert.equal((await POST(pedido({ texto: "oi", texto_anterior: "a".repeat(1001) }))).status, 400);
  assert.equal((await POST(pedido({ texto: "oi", texto_seguinte: 7 }))).status, 400);
});

test("velocidade válida vira speed; sem ela, 1,1; fora de 0,7 a 1,2 é 400", async () => {
  process.env.ELEVENLABS_API_KEY = "k";
  const velocidades: unknown[] = [];
  globalThis.fetch = (async (_alvo: unknown, init?: RequestInit) => {
    velocidades.push((JSON.parse(String(init?.body)) as { voice_settings: { speed: unknown } }).voice_settings.speed);
    return Response.json({ audio_base64: "AAAA", alignment: alinhamento });
  }) as typeof fetch;
  await POST(pedido({ texto: "oi", velocidade: 1 }));
  await POST(pedido({ texto: "oi" }));
  assert.deepEqual(velocidades, [1, 1.1]);
  for (const invalida of [0.69, 1.21, "1", null]) {
    assert.equal((await POST(pedido({ texto: "oi", velocidade: invalida }))).status, 400);
  }
  assert.deepEqual(velocidades, [1, 1.1]);
});
