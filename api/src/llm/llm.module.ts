import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { EmbeddingService } from './embedding.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiEmbeddingProvider } from './providers/openai-embedding.provider';
import { GeminiEmbeddingProvider } from './providers/gemini-embedding.provider';

@Module({
  providers: [
    LlmService,
    EmbeddingService,
    AnthropicProvider,
    OpenAiProvider,
    GeminiProvider,
    OpenAiEmbeddingProvider,
    GeminiEmbeddingProvider,
  ],
  exports: [LlmService, EmbeddingService],
})
export class LlmModule {}
