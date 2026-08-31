import { apiClient } from './client';
import type { ChatThreadDetail, ChatThreadSummary, ChatTurnResult, LlmProviderInfo } from '../types';

export const listLlmProviders = () =>
  apiClient.get<LlmProviderInfo[]>('/chat/providers').then((r) => r.data);

export const listChatTools = () =>
  apiClient
    .get<{ name: string; description: string; fmName: string }[]>('/chat/tools')
    .then((r) => r.data);

export const listChatThreads = () =>
  apiClient.get<ChatThreadSummary[]>('/chat/threads').then((r) => r.data);

export const getChatThread = (threadId: string) =>
  apiClient.get<ChatThreadDetail>(`/chat/threads/${threadId}`).then((r) => r.data);

export const createChatThread = () =>
  apiClient.post<ChatThreadSummary>('/chat/threads').then((r) => r.data);

export const deleteChatThread = (threadId: string) =>
  apiClient.delete(`/chat/threads/${threadId}`);

export const sendChatMessage = (
  message: string,
  threadId?: string,
) => apiClient.post<ChatTurnResult>('/chat/message', { message, threadId }).then((r) => r.data);
