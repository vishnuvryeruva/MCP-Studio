import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiEmbeddingProvider } from './providers/openai-embedding.provider';
import { GeminiEmbeddingProvider } from './providers/gemini-embedding.provider';
import type {
  EmbeddingProvider,
  EmbeddingProviderName,
} from './embedding-provider.interface';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly providers: Record<EmbeddingProviderName, EmbeddingProvider>;
  private readonly configuredName: string;

  constructor(
    config: ConfigService,
    openai: OpenAiEmbeddingProvider,
    gemini: GeminiEmbeddingProvider,
  ) {
    this.providers = { openai, gemini };
    this.configuredName = (config.get<string>('llm.embedding.provider') || 'openai').toLowerCase();
  }

  // Unlike the chat provider, a missing embedding key is not fatal: every caller
  // falls back to its pre-embedding behaviour, so the app must still boot.
  isAvailable(): boolean {
    const provider = this.provider();
    return Boolean(provider?.isConfigured());
  }

  // Stored alongside each vector so a provider or model change invalidates the
  // cached vectors instead of silently comparing across incompatible spaces.
  signature(): string | null {
    const provider = this.provider();
    return provider ? `${provider.name}:${provider.model}` : null;
  }

  unavailableReason(): string {
    if (!this.isKnownProvider(this.configuredName)) {
      return `EMBEDDING_PROVIDER "${this.configuredName}" is not supported. Use one of: ${Object.keys(this.providers).join(', ')}.`;
    }
    const key = this.configuredName === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
    return `The "${this.configuredName}" embedding provider has no API key configured. Set ${key} to enable it.`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const provider = this.provider();
    if (!provider?.isConfigured()) {
      throw new Error(this.unavailableReason());
    }
    const startedAt = Date.now();
    const vectors = await provider.embed(texts);
    this.logger.debug(
      `Embedded ${texts.length} text(s) via ${provider.name}/${provider.model} in ${Date.now() - startedAt}ms`,
    );
    return vectors;
  }

  async embedOne(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    if (!vector) {
      throw new Error('Embedding provider returned no vector');
    }
    return vector;
  }

  private provider(): EmbeddingProvider | null {
    return this.isKnownProvider(this.configuredName) ? this.providers[this.configuredName] : null;
  }

  private isKnownProvider(value: string): value is EmbeddingProviderName {
    return Object.hasOwn(this.providers, value);
  }
}
