// Embeddings are a separate capability from chat completion: Anthropic has no
// embeddings API, so an org running Anthropic for chat still needs OpenAI or
// Gemini here. Keeping the interfaces apart lets the two be configured
// independently instead of forcing one vendor for both.

export type EmbeddingProviderName = 'openai' | 'gemini';

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  isConfigured(): boolean;
  // Batched on purpose: re-embedding a whole whitelist is one call, not N.
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
