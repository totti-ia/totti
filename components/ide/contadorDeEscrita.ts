// Jeito de escrever (#123): contadores do editor, sem guardar tecla nenhuma. O editor alimenta cada mudança do
// Monaco e o snapshot leva o acumulado desde o anterior (`escrita`). Só registra: não dispara nada.

/** Pausa a partir da qual um trecho digitado conta como outro. */
export const PAUSA_DO_TRECHO_MS = 2_000;
/**
 * Maior inserção que ainda conta como digitação: uma tecla com autoindentação ("\n" + recuo) ou par automático.
 * Acima disso é sugestão do editor, arrastar ou troca do conteúdo, que não são digitação.
 */
const MAX_CHARS_DE_UMA_TECLA = 24;

/** Uma mudança do Monaco, só com o que o contador usa (IModelContentChange). */
export interface MudancaDoEditor {
  /** Linha (1-based) onde a mudança começa. */
  linha: number;
  /** Caracteres substituídos ou apagados. */
  apagou: number;
  /** Texto que entrou. */
  texto: string;
}

export interface Escrita {
  digitados: number;
  apagados: number;
  maiorTrechoSemPausa: number;
  voltouParaCima: boolean;
}

export class ContadorDeEscrita {
  private digitados = 0;
  private apagados = 0;
  private maiorTrecho = 0;
  private voltou = false;
  /** Trecho digitado agora (continua entre snapshots: o corte do snapshot não é pausa). */
  private trecho = 0;
  private ultimaTeclaEm = -Infinity;
  /** Linha onde terminou a última mudança; null antes da primeira. */
  private ultimaLinha: number | null = null;

  /**
   * Uma leva de mudanças do editor. `colando`: a leva é de uma colagem (conta só o que apagou, não o que entrou).
   * Desfazer, refazer e troca do conteúdo inteiro não chegam aqui.
   */
  registrar(mudancas: readonly MudancaDoEditor[], agora: number, colando = false): void {
    for (const m of mudancas) {
      if (this.ultimaLinha !== null && m.linha < this.ultimaLinha) this.voltou = true;
      this.ultimaLinha = m.linha + (m.texto.match(/\n/g)?.length ?? 0);
      if (m.apagou > 0) {
        this.apagados += m.apagou;
        this.trecho = 0;
      }
      if (colando || !m.texto || m.texto.length > MAX_CHARS_DE_UMA_TECLA) continue;
      this.digitados += m.texto.length;
      if (agora - this.ultimaTeclaEm >= PAUSA_DO_TRECHO_MS) this.trecho = 0;
      this.trecho += m.texto.length;
      this.ultimaTeclaEm = agora;
      if (this.trecho > this.maiorTrecho) this.maiorTrecho = this.trecho;
    }
  }

  /** O acumulado desde o último snapshot, e zera; null se nada mudou. */
  esvaziar(): Escrita | null {
    if (!this.digitados && !this.apagados && !this.voltou) return null;
    const escrita: Escrita = {
      digitados: this.digitados,
      apagados: this.apagados,
      maiorTrechoSemPausa: this.maiorTrecho,
      voltouParaCima: this.voltou,
    };
    this.digitados = 0;
    this.apagados = 0;
    this.voltou = false;
    // O trecho em curso segue valendo para o próximo snapshot.
    this.maiorTrecho = this.trecho;
    return escrita;
  }
}

/** Normaliza para comparar colagem com o que foi copiado no editor: fins de linha e espaço nas pontas. */
export function mesmoTrecho(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\r\n?/g, "\n").trim();
  return n(a).length > 0 && n(a) === n(b);
}
