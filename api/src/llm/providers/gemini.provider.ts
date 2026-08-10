import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import type { FunctionDeclaration, Schema } from '@google/genai';
import type {
  LlmCompletionRequest,
  LlmMessage,
  LlmProvider,
  LlmProviderName,
  LlmResponse,
  LlmStopReason,
  LlmToolCall,
  LlmToolDefinition,
} from '../llm-provider.interface';

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name: LlmProviderName = 'gemini';
  readonly model: string;

  private readonly logger = new Logger(GeminiProvider.name);
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private client?: GoogleGenAI;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('llm.gemini.apiKey') ?? '';
    this.model = config.get<string>('llm.gemini.model') || 'gemini-2.5-pro';
    this.maxTokens = config.get<number>('llm.maxTokens') ?? 16000;
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

  async complete(request: LlmCompletionRequest): Promise<LlmResponse> {
    const response = await this.getClient().models.generateContent({
      model: this.model,
      contents: this.toGeminiContents(request.messages),
      config: {
        systemInstruction: request.system,
        maxOutputTokens: this.maxTokens,
        ...(request.tools.length > 0
          ? { tools: [{ functionDeclarations: request.tools.map((t) => this.toDeclaration(t)) }] }
          : {}),
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    let text = '';
    const toolCalls: LlmToolCall[] = [];
    parts.forEach((part, index) => {
      if (typeof part.text === 'string') {
        text += part.text;
      }
      if (part.functionCall?.name) {
        toolCalls.push({
          // Gemini doesn't return call ids; synthesize a stable one for correlation.
          id: part.functionCall.id ?? `${part.functionCall.name}-${index}`,
          name: part.functionCall.name,
          arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    });

    const finishReason = response.candidates?.[0]?.finishReason ?? null;
    if (finishReason === 'SAFETY') {
      this.logger.warn('Gemini blocked the response for safety reasons');
    }

    return {
      text,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : this.mapStopReason(finishReason),
    };
  }

  private mapStopReason(reason: string | null): LlmStopReason {
    switch (reason) {
      case 'STOP':
        return 'end';
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'SAFETY':
      case 'PROHIBITED_CONTENT':
      case 'BLOCKLIST':
        return 'refusal';
      default:
        return 'other';
    }
  }

  // Gemini declares parameters with its own OpenAPI-style Type enum rather than
  // raw JSON Schema strings.
  private toDeclaration(tool: LlmToolDefinition): FunctionDeclaration {
    const properties: Record<string, Schema> = {};
    for (const [key, value] of Object.entries(tool.parameters.properties)) {
      properties[key] = { type: this.toGeminiType(value.type), description: value.description };
    }
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: Type.OBJECT,
        properties,
        required: tool.parameters.required,
      },
    };
  }

  private toGeminiType(type: string): Type {
    switch (type) {
      case 'string':
      case 'date':
        return Type.STRING;
      case 'number':
        return Type.NUMBER;
      case 'integer':
        return Type.INTEGER;
      case 'boolean':
        return Type.BOOLEAN;
      case 'array':
        return Type.ARRAY;
      case 'object':
        return Type.OBJECT;
      default:
        return Type.STRING;
    }
  }

  private toGeminiContents(messages: LlmMessage[]) {
    return messages.map((message) => {
      if (message.role === 'user') {
        return { role: 'user', parts: [{ text: message.content }] };
      }
      if (message.role === 'tool') {
        // Gemini correlates results by function name, not by call id.
        return {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: message.name,
                response: { result: message.content, ...(message.isError ? { error: true } : {}) },
              },
            },
          ],
        };
      }
      const parts: Record<string, unknown>[] = [];
      if (message.content.trim()) {
        parts.push({ text: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.arguments } });
      }
      return { role: 'model', parts: parts.length > 0 ? parts : [{ text: '(no content)' }] };
    });
  }
}
