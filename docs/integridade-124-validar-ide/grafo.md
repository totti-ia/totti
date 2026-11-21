# Alcance de `validar-conversa-ide`

Inspeção estática em 21/11/2026, antes da medição; saída 0. O bundler gera somente o metafile em memória (`write: false`); não importa nem executa o código do validador e não chama LLM.

```text
node docs/integridade-124-validar-ide/grafo.mjs 0f4efec ff7558c scripts/validar-conversa-ide.ts
scripts/validar-conversa-ide.ts: 79 módulos; alterados pelo PR no grafo: lib/contracts.ts
```

Ferramenta [grafo.mjs](grafo.mjs), copiada sem mudança da utilizada na medição da #123. SHA-256 dos bytes locais: `f5eb4039968151d8f6160060a8c76191c9da1c09d8e329aa04b008b610c9b3ee`.

SHA-256 local de `scripts/validar-conversa-ide.ts`: `95f736ba9c5c890f2677ffd2cd3b3c8ca3cb5f9788ce3b877064a49cbcbc0063`. Antes da medição, registrar também o hash em cada checkout e confirmar igualdade.

Comparação de código: `0f4efec3d6546569f8e68942fd72052b64271bc5...ff7558c865a35f646c80b089d6ff2e448438e342`. A ferramenta considera os arquivos alterados entre esses commits e os imports alcançáveis da entrada. `lib/contracts.ts` contém campos opcionais; o script não simula esses campos nas falas.

O grafo não cobre o callback de início da voz, fim natural do áudio, interrupção, persistência pelo navegador ou relatório. Não sustenta uma atribuição de variações nesses tempos aos callbacks ausentes do instrumento.
