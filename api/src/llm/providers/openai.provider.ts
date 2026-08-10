import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  LlmCompletionRequest,
  LlmMessage,
  LlmProvider,
  LlmProviderName,
  LlmResponse,
  LlmStopReason,
  LlmToolCall,
} from '../llm-provider.interface';

@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly name: LlmProviderName = 'openai';
  readonly model: string;

  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly apiKey: string;
  private readonly baseURL?: string;
  private readonly maxTokens: number;
  private client?: OpenAI;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('llm.openai.apiKey') ?? '';
    this.model = config.get<string>('llm.openai.model') || 'gpt-4o';
    this.baseURL = config.get<string>('llm.openai.baseUrl') || undefined;
    this.maxTokens = config.get<number>('llm.maxTokens') ?? 16000;
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

  async complete(request: LlmCompletionRequest): Promise<LlmResponse> {
    const response = await this.getClient().chat.completions.create({
      model: this.model,
      max_completion_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: request.system },
        ...this.toOpenAiMessages(request.messages),
      ],
      tools: request.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as unknown as Record<string, unknown>,
        },
      })),
    });

    const choice = response.choices[0];
    const toolCalls: LlmToolCall[] = [];
    for (const call of choice?.message?.tool_calls ?? []) {
      if (call.type !== 'function') continue;
      toolCalls.push({
        id: call.id,
        name: call.function.name,
        arguments: this.parseArguments(call.function.arguments, call.function.name),
      });
    }

    return {
      text: choice?.message?.content ?? '',
      toolCalls,
      stopReason: this.mapStopReason(choice?.finish_reason ?? null),
    };
  }

  // OpenAI returns tool arguments as a JSON *string*; malformed JSON must not crash
  // the turn — surface it as empty args and let the tool report the error.
  private parseArguments(raw: string, toolName: string): Record<string, unknown> {
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      this.logger.warn(`Could not parse tool arguments for "${toolName}": ${raw.slice(0, 200)}`);
      return {};
    }
  }

  private mapStopReason(reason: string | null): LlmStopReason {
    switch (reason) {
      case 'stop':
        return 'end';
      case 'tool_calls':
      case 'function_call':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      case 'content_filter':
        return 'refusal';
      default:
        return 'other';
    }
  }

  private toOpenAiMessages(
    messages: LlmMessage[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return messages.map((message) => {
      if (message.role === 'user') {
        return { role: 'user' as const, content: message.content };
      }
      if (message.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      }
      const toolCalls = message.toolCalls ?? [];
      return {
        role: 'assistant' as const,
        content: message.content || null,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      };
    });
  }
}
