// Provider-neutral shapes. Each provider adapter translates these to/from its own
// SDK so the chat orchestration never depends on a specific vendor's wire format.

export type LlmProviderName = 'anthropic' | 'openai' | 'gemini';

export interface LlmToolParameterSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string }>;
  required: string[];
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: LlmToolParameterSchema;
}

export interface LlmToolCall {
  // Correlates a tool result back to the call. Providers that don't supply an id
  // (Gemini) get a synthetic one from the adapter.
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export type LlmStopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: LlmStopReason;
}

export interface LlmCompletionRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  // False when the provider's API key isn't configured, so the factory can fail
  // with a clear message instead of a vendor SDK error.
  isConfigured(): boolean;
  complete(request: LlmCompletionRequest): Promise<LlmResponse>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
