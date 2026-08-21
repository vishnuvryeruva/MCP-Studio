import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  EmbeddingProvider,
  EmbeddingProviderName,
} from '../embedding-provider.interface';

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name: EmbeddingProviderName = 'openai';
  readonly model: string;

  private readonly apiKey: string;
  private readonly baseURL?: string;
  private client?: OpenAI;

  constructor(config: ConfigService) {
    // Reuses the chat key: one OpenAI account covers both surfaces.
    this.apiKey = config.get<string>('llm.openai.apiKey') ?? '';
    this.baseURL = config.get<string>('llm.openai.baseUrl') || undefined;
    this.model = config.get<string>('llm.embedding.openaiModel') || 'text-embedding-3-small';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      });
    }
    return this.client;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.getClient().embeddings.create({
      model: this.model,
      input: texts,
    });
    // The API doesn't guarantee response order, but every item carries its
    // input index — sort by it so vectors line up with the texts we sent.
    return [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}
