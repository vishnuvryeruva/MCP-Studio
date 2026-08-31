import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type {
  EmbeddingProvider,
  EmbeddingProviderName,
} from '../embedding-provider.interface';

@Injectable()
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name: EmbeddingProviderName = 'gemini';
  readonly model: string;

  private readonly apiKey: string;
  private client?: GoogleGenAI;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('llm.gemini.apiKey') ?? '';
    this.model = config.get<string>('llm.embedding.geminiModel') || 'gemini-embedding-001';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.getClient().models.embedContent({
      model: this.model,
      contents: texts,
    });
    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Gemini returned ${embeddings.length} embeddings for ${texts.length} inputs`,
      );
    }
    return embeddings.map((embedding, index) => {
      const values = embedding.values;
      if (!values || values.length === 0) {
        throw new Error(`Gemini returned an empty embedding at index ${index}`);
      }
      return values;
    });
  }
}
