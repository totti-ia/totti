// Contrato de armazenamento das sessões. Pequeno de propósito: uma implementação em Postgres/Supabase
// (JSONB para o estado, tabela de eventos, bucket para as imagens) pode substituir a de memória
// sem mexer nas rotas. Tudo é assíncrono por isso.
import type { EstadoSessao } from "../sessao/estado";
import type { Scorecard } from "../scorecard";

export type SessaoArmazenada = {
  id: string;
  avaliacaoId: string;
  candidatoId: string;
  criadaEm: number;
  estado: EstadoSessao;
  /** Quantas chamadas a /analisar a sessão já fez (limite de abuso). */
  analises: number;
};

export type EventoEntrada = { horario: string; tipo: string; dados: unknown };
export type EventoArmazenado = EventoEntrada & { recebidoEm: number };

export type ImagemArmazenada = { bytes: Uint8Array; horario: string; final?: boolean };

/** Erro de limite (sessão cheia de imagens etc.). A rota traduz para 429. */
export class ErroLimite extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroLimite";
  }
}

export interface RepositorioSessoes {
  criar(dados: { avaliacaoId: string; candidatoId: string; estado: EstadoSessao }): Promise<SessaoArmazenada>;
  obter(id: string): Promise<SessaoArmazenada | null>;
  salvarEstado(id: string, estado: EstadoSessao): Promise<void>;
  /** Soma 1 ao contador de análises e devolve o novo valor (0 se a sessão não existe). */
  contarAnalise(id: string): Promise<number>;
  /** Guarda os eventos que ainda não existem (idempotente) e devolve só os NOVOS, na ordem recebida. */
  anexarEventos(id: string, eventos: EventoEntrada[]): Promise<EventoArmazenado[]>;
  listarEventos(id: string): Promise<EventoArmazenado[]>;
  /** Devolve o número da imagem (1, 2, 3...). Pode lançar ErroLimite. */
  salvarImagem(id: string, imagem: ImagemArmazenada, opcoes?: { final?: boolean }): Promise<number>;
  obterImagem(id: string, numero: number): Promise<ImagemArmazenada | null>;
  /** Número e horário das imagens da sessão (sem os bytes). */
  listarImagens(id: string): Promise<{ numero: number; horario: string }[]>;
  /** Guarda o scorecard (um por sessão; a rota garante a idempotência). */
  salvarScorecard(id: string, scorecard: Scorecard): Promise<void>;
  obterScorecard(id: string): Promise<Scorecard | null>;
}
