import { type EmbeddingProvider, EmbeddingsDisabledError } from "./provider";

export class DisabledProvider implements EmbeddingProvider {
  readonly enabled = false;
  readonly model = "disabled";
  async embed(_texts: string[]): Promise<number[][]> {
    throw new EmbeddingsDisabledError();
  }
}
