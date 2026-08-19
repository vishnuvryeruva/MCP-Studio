import { IsIn } from 'class-validator';
import type { LlmProviderName } from '../../llm/llm-provider.interface';

export class UpdateLlmProviderDto {
  @IsIn(['anthropic', 'openai', 'gemini'])
  llmProvider: LlmProviderName;
}
