import { apiClient } from './client';

export type UserLlmProvider = 'anthropic' | 'openai' | 'gemini';

export function fetchMyLlmProvider() {
  return apiClient.get<{ llmProvider: UserLlmProvider }>('/users/me/llm-provider').then((r) => r.data);
}

export function updateMyLlmProvider(llmProvider: UserLlmProvider) {
  return apiClient
    .patch<{ llmProvider: UserLlmProvider }>('/users/me/llm-provider', { llmProvider })
    .then((r) => r.data);
}
