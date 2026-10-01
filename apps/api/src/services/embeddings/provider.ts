export const EMBEDDING_DIMENSIONS = 1536;
/** Conservative character cap per input (≈ 8k tokens for English text). */
export const MAX_EMBEDDING_INPUT_CHARS = 24_000;

export interface EmbeddingProvider {
  /** false → semantic features are off; callers fall back to full-text/tag overlap. */
  readonly enabled: boolean;
  readonly model: string;
  /** One vector (length 1536) per input, same order. Rejects when disabled or the upstream fails. */
  embed(texts: string[]): Promise<number[][]>;
}

export class EmbeddingsDisabledError extends Error {
  constructor() {
    super("Embeddings are disabled (EMBEDDING_API_KEY is not set)");
    this.name = "EmbeddingsDisabledError";
  }
}

export function truncateForEmbedding(text: string, max = MAX_EMBEDDING_INPUT_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}
