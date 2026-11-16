import assert from "node:assert/strict";
import { test } from "node:test";
import { RITMO_IDE, RITMO_QUADRO } from "../politica";
import { medirOfflineQuadro, medicao140Passou } from "../../../scripts/linha-do-tempo-quadro";
import { medirOfflineIde } from "../../../scripts/simulate";

test("#140: piso e teto do quadro e da IDE coincidem campo a campo", () => {
  for (const campo of ["pisoEntrePerguntasMs", "tetoSemPerguntaMs"] as const) {
    assert.equal(RITMO_QUADRO[campo], RITMO_IDE[campo], `${campo} divergiu entre as salas`);
  }
  assert.equal(RITMO_QUADRO.pisoEntrePerguntasMs, 45_000);
  assert.equal(RITMO_IDE.tetoSemPerguntaMs, 90_000);
});

test("#140: as medições determinísticas das duas salas passam pelos critérios de pronto", () => {
  const quadro = medirOfflineQuadro();
  const ide = medirOfflineIde();
  assert.ok(medicao140Passou(quadro) && medicao140Passou(ide), JSON.stringify({ quadro, ide }));
});
