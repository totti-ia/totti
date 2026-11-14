// Fila de reenvio da IDE (#130): o run que não chegava ao servidor sumia da linha do tempo e o relatório dizia "não
// rodou o código".
import assert from "node:assert/strict";
import { test } from "node:test";
import { esperarFila, FilaDeEventos } from "../filaDeEventos";

class Recusado extends Error {}

test("reenvia até o servidor confirmar, com a resposta do envio que deu certo", async () => {
  let tentativas = 0;
  const confirmados: [string, string, number][] = [];
  const falhas: boolean[] = [];
  const fila = new FilaDeEventos<string, string>({
    enviar: async (e) => {
      tentativas++;
      if (tentativas < 3) throw new Error("rede caiu");
      return `ok:${e}`;
    },
    aoConfirmar: (e, r, n) => confirmados.push([e, r, n]),
    aoFalhar: (_e, _err, definitivo) => falhas.push(definitivo),
    dormir: async () => {},
  });
  await fila.enfileirar("run");
  assert.deepEqual(confirmados, [["run", "ok:run", 3]]);
  assert.deepEqual(falhas, [false, false]);
  assert.equal(fila.pendentes, 0);
});

test("erro definitivo (o servidor recusou) não se repete", async () => {
  let tentativas = 0;
  const fila = new FilaDeEventos<string, string>({
    enviar: async () => {
      tentativas++;
      throw new Recusado("400");
    },
    definitivo: (err) => err instanceof Recusado,
    dormir: async () => {},
  });
  await fila.enfileirar("run");
  assert.equal(tentativas, 1);
});

test("vazia espera todos, inclusive os que entram enquanto espera; o teto devolve false", async () => {
  const soltar: (() => void)[] = [];
  const fila = new FilaDeEventos<string, void>({
    enviar: () => new Promise<void>((resolver) => soltar.push(resolver)),
    dormir: async () => {},
  });
  void fila.enfileirar("snapshot");
  void fila.enfileirar("run");
  assert.equal(fila.pendentes, 2);
  assert.equal(await esperarFila(fila, 20), false, "nada confirmou ainda: o teto chega antes");
  const esperando = esperarFila(fila, 1000);
  soltar[0]();
  void fila.enfileirar("session_ended");
  await new Promise((r) => setTimeout(r, 0));
  soltar[1]();
  await new Promise((r) => setTimeout(r, 0));
  soltar[2]();
  assert.equal(await esperando, true);
  assert.equal(fila.pendentes, 0);
});

test("parar encerra os reenvios", async () => {
  let tentativas = 0;
  const fila = new FilaDeEventos<string, void>({
    enviar: async () => {
      tentativas++;
      throw new Error("fora do ar");
    },
    dormir: async () => {
      fila.parar();
    },
  });
  await fila.enfileirar("run");
  assert.equal(tentativas, 1);
});

test("retomar depois de parar volta a enviar (StrictMode desmonta e monta de novo na entrada)", async () => {
  const enviados: string[] = [];
  const fila = new FilaDeEventos<string, void>({ enviar: async (e) => { enviados.push(e); } });
  fila.parar();
  await fila.enfileirar("parado");
  fila.retomar();
  await fila.enfileirar("run");
  assert.deepEqual(enviados, ["run"]);
});
