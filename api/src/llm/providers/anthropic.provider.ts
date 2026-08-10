import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmCompletionRequest,
  LlmProvider,
  LlmProviderName,
  LlmResponse,
  LlmStopReason,
  LlmToolCall,
  LlmMessage,
} from '../llm-provider.interface';

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name: LlmProviderName = 'anthropic';
  readonly model: string;

  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly apiKey: string;
  private readonly baseURL?: string;
  private readonly maxTokens: number;
  private readonly effort: string;
  private client?: Anthropic;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('llm.anthropic.apiKey') ?? '';
    this.model = config.get<string>('llm.anthropic.model') || 'claude-opus-5';
    this.baseURL = config.get<string>('llm.anthropic.baseUrl') || undefined;
    this.maxTokens = config.get<number>('llm.maxTokens') ?? 16000;
    this.effort = config.get<string>('llm.effort') || 'medium';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.apiKey,
        ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      });
    }
    return this.client;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmResponse> {
    const response = await this.getClient().messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: request.system,
      // Thinking is left on (the Opus 5 default): disabling it can make the model
      // emit tool calls as plain text that never execute. Cost is tuned via effort.
      output_config: { effort: this.effort as 'low' | 'medium' | 'high' },
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as Anthropic.Tool.InputSchema,
      })),
      messages: this.toAnthropicMessages(request.messages),
    });

    if (response.stop_reason === 'refusal') {
      this.logger.warn(
        `Anthropic declined the request (category: ${response.stop_details?.category ?? 'unknown'})`,
      );
    }

    let text = '';
    const toolCalls: LlmToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return { text, toolCalls, stopReason: this.mapStopReason(response.stop_reason) };
  }

  private mapStopReason(reason: string | null): LlmStopReason {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'end';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      case 'refusal':
        return 'refusal';
      default:
        return 'other';
    }
  }

  // Tool results must all arrive in a SINGLE user message — splitting them across
  // messages trains the model to stop making parallel tool calls.
  private toAnthropicMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    let pendingResults: Anthropic.ToolResultBlockParam[] = [];

    const flushResults = () => {
      if (pendingResults.length > 0) {
        out.push({ role: 'user', content: pendingResults });
        pendingResults = [];
      }
    };

    for (const message of messages) {
      if (message.role === 'tool') {
        pendingResults.push({
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: message.content,
          ...(message.isError ? { is_error: true } : {}),
        });
        continue;
      }

      flushResults();

      if (message.role === 'user') {
        out.push({ role: 'user', content: message.content });
        continue;
      }

      const blocks: Anthropic.ContentBlockParam[] = [];
      if (message.content.trim()) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      // An assistant turn must not be empty; fall back to a placeholder.
      out.push({ role: 'assistant', content: blocks.length > 0 ? blocks : '(no content)' });
    }

    flushResults();
    return out;
  }
}
