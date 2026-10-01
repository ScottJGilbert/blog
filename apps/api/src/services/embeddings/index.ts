import type { Config } from "../../config";
import { DisabledProvider } from "./disabled";
import { OpenAICompatibleProvider } from "./openai";
import type { EmbeddingProvider } from "./provider";

export * from "./provider";
export { DisabledProvider } from "./disabled";
export { OpenAICompatibleProvider } from "./openai";

export function createEmbeddingProvider(config: Config, fetchImpl: typeof fetch = fetch): EmbeddingProvider {
  if (!config.embedding.apiKey) return new DisabledProvider();
  return new OpenAICompatibleProvider({ url: config.embedding.url, apiKey: config.embedding.apiKey, model: config.embedding.model, fetch: fetchImpl });
}
