"use client";

import Editor, { loader } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useRef } from "react";
import { mesmoTrecho, type MudancaDoEditor } from "@/components/ide/contadorDeEscrita";

// Monaco servido de /public (copiado por scripts/copy-vendor.mjs): funciona sem internet.
loader.config({ paths: { vs: "/monaco/vs" } });

type Monaco = typeof import("monaco-editor");

type Props = {
  value: string;
  language: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  /**
   * Colagem: texto colado, a linha onde começou e de onde veio (#123): "editor" quando é o que ele mesmo copiou ou
   * recortou aqui dentro (código mudando de lugar), "fora" quando não.
   */
  onPaste: (text: string, startLine: number, origem: "editor" | "fora") => void;
  /** Cada leva de mudanças digitadas ou apagadas (jeito de escrever, #123); `colando` = a leva é de uma colagem. */
  onEscrever?: (mudancas: MudancaDoEditor[], colando: boolean) => void;
  onReady: (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => void;
};

/** Monaco; a linguagem vem por prop (python, cpp ou c). `glyphMargin` fica ligado para os ícones do agente. */
export default function CodeEditor({ value, language, readOnly, onChange, onPaste, onEscrever, onReady }: Props) {
  /** O último trecho que ele copiou ou recortou dentro do editor (só em memória, nunca enviado). */
  const copiadoRef = useRef<string | null>(null);
  /** Entre o `paste` do navegador e o onDidPaste do Monaco: as mudanças dessa janela são da colagem. */
  const colandoRef = useRef(false);
  const onEscreverRef = useRef(onEscrever);
  onEscreverRef.current = onEscrever;

  return (
    <Editor
      height="100%"
      language={language}
      theme="converge-dark"
      beforeMount={(monaco) => {
        const css = getComputedStyle(document.documentElement);
        const superficie = css.getPropertyValue("--superficie").trim();
        // Duas tintas, zero cor: o código é pérola em pesos diferentes; a sintaxe se diz por tom, não por matiz.
        monaco.editor.defineTheme("converge-dark", {
          base: "vs-dark",
          inherit: true,
          rules: [
            { token: "", foreground: "C9C2B6" },
            { token: "comment", foreground: "F5F0E866", fontStyle: "italic" },
            { token: "keyword", foreground: "F5F0E8" },
            { token: "string", foreground: "D9D1C4" },
            { token: "number", foreground: "E9E2D6" },
            { token: "type", foreground: "EDE8E0" },
            { token: "delimiter", foreground: "F5F0E88C" },
          ],
          colors: {
            "editor.background": superficie,
            "editor.foreground": "#C9C2B6",
            "editorGutter.background": superficie,
            "editor.lineHighlightBackground": superficie,
            "editorLineNumber.foreground": "#F5F0E84D",
            "editorLineNumber.activeForeground": "#F5F0E8",
          },
        });
      }}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={(editor, monaco) => {
        // Copiar sem seleção copia a linha inteira (emptySelectionClipboard, ligado por padrão no Monaco).
        const guardarCopia = () => {
          const model = editor.getModel();
          const selecoes = editor.getSelections();
          if (!model || !selecoes?.length) return;
          copiadoRef.current = selecoes
            .map((s) => (s.isEmpty() ? `${model.getLineContent(s.startLineNumber)}\n` : model.getValueInRange(s)))
            .join("\n");
        };
        const dom = editor.getDomNode();
        const marcarColagem = () => {
          colandoRef.current = true;
        };
        dom?.addEventListener("copy", guardarCopia, true);
        dom?.addEventListener("cut", guardarCopia, true);
        dom?.addEventListener("paste", marcarColagem, true);
        editor.onDidDispose(() => {
          dom?.removeEventListener("copy", guardarCopia, true);
          dom?.removeEventListener("cut", guardarCopia, true);
          dom?.removeEventListener("paste", marcarColagem, true);
        });
        editor.onDidChangeModelContent((e) => {
          // Desfazer/refazer e troca do conteúdo inteiro (linguagem, starter) não são escrita.
          if (e.isFlush || e.isUndoing || e.isRedoing) return;
          onEscreverRef.current?.(
            e.changes.map((c) => ({ linha: c.range.startLineNumber, apagou: c.rangeLength, texto: c.text })),
            colandoRef.current,
          );
        });
        editor.onDidPaste((e) => {
          colandoRef.current = false;
          const text = editor.getModel()?.getValueInRange(e.range) ?? "";
          const copiado = copiadoRef.current;
          onPaste(text, e.range.startLineNumber, copiado !== null && mesmoTrecho(text, copiado) ? "editor" : "fora");
        });
        onReady(editor, monaco as unknown as Monaco);
      }}
      loading={<span className="label-pequena p-6">Carregando editor…</span>}
      options={{
        readOnly,
        glyphMargin: true,
        fontSize: 14,
        lineHeight: 24,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 24, bottom: 24 },
        renderLineHighlight: "none",
        overviewRulerLanes: 0,
        automaticLayout: true,
        tabSize: 4,
        wordWrap: "on",
        scrollbar: { horizontal: "hidden", useShadows: false },
      }}
    />
  );
}
