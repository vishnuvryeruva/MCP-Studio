import { apiClient } from './client';
import type { ChatTurnResult, LlmProviderInfo } from '../types';

export const listLlmProviders = () =>
  apiClient.get<LlmProviderInfo[]>('/chat/providers').then((r) => r.data);

export const listChatTools = () =>
  apiClient
    .get<{ name: string; description: string; fmName: string }[]>('/chat/tools')
    .then((r) => r.data);

export const sendChatMessage = (
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
) => apiClient.post<ChatTurnResult>('/chat/message', { message, history }).then((r) => r.data);
