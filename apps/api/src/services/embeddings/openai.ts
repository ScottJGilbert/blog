import { z } from "zod";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider, truncateForEmbedding } from "./provider";

const ResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().optional(), embedding: z.array(z.number()) })),
});

export interface OpenAICompatibleOptions {
  /** Base URL (`https://api.openai.com/v1`) or full `/embeddings` URL. */
  url: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  /** Inputs per HTTP request (default 64). */
  batchSize?: number;
  timeoutMs?: number;
  retries?: number;
}

/** Any server speaking the OpenAI `POST /v1/embeddings` protocol (OpenAI, Azure-compatible gateways, Ollama, vLLM, …). */
export class OpenAICompatibleProvider implements EmbeddingProvider {
  readonly enabled = true;
  readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly o: OpenAICompatibleOptions) {
    this.model = o.model;
    const base = o.url.replace(/\/+$/, "");
    this.endpoint = base.endsWith("/embeddings") ? base : `${base}/embeddings`;
    this.fetchImpl = o.fetch ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    const size = this.o.batchSize ?? 64;
    for (let i = 0; i < texts.length; i += size) {
      const batch = texts.slice(i, i + size).map((t) => truncateForEmbedding(t) || " ");
      out.push(...(await this.request(batch)));
    }
    return out;
  }

  private async request(input: string[]): Promise<number[][]> {
    const retries = this.o.retries ?? 2;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
      try {
        const res = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
          // `dimensions` is only understood by text-embedding-3-*; other models are fixed-size.
          body: JSON.stringify({
            model: this.model,
            input,
            ...(/^text-embedding-3/.test(this.model) ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
          }),
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`Embedding API responded ${res.status}`);
          continue;
        }
        if (!res.ok) throw new Error(`Embedding API responded ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        const parsed = ResponseSchema.parse(await res.json());
        const sorted = [...parsed.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (sorted.length !== input.length) throw new Error(`Embedding API returned ${sorted.length} vectors for ${input.length} inputs`);
        for (const d of sorted) {
          if (d.embedding.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(`Embedding model "${this.model}" returned ${d.embedding.length} dimensions; ${EMBEDDING_DIMENSIONS} required`);
          }
        }
        return sorted.map((d) => d.embedding);
      } catch (err) {
        lastErr = err;
        const name = (err as { name?: string }).name;
        const retryable = name === "TimeoutError" || name === "TypeError"; // network / timeout
        if (!retryable) throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Embedding request failed");
  }
}
