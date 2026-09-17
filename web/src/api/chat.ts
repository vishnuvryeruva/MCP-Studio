import { apiClient } from './client';
import type {
  ChatDestination,
  ChatThreadDetail,
  ChatThreadSummary,
  ChatTurnResult,
  LlmProviderInfo,
} from '../types';

export const listLlmProviders = () =>
  apiClient.get<LlmProviderInfo[]>('/chat/providers').then((r) => r.data);

export const listChatDestinations = () =>
  apiClient.get<ChatDestination[]>('/chat/destinations').then((r) => r.data);

export const listChatTools = (sapDestinationId: string) =>
  apiClient
    .get<{ name: string; description: string; fmName: string }[]>('/chat/tools', {
      params: { sapDestinationId },
    })
    .then((r) => r.data);

export const listChatThreads = () =>
  apiClient.get<ChatThreadSummary[]>('/chat/threads').then((r) => r.data);

export const getChatThread = (threadId: string) =>
  apiClient.get<ChatThreadDetail>(`/chat/threads/${threadId}`).then((r) => r.data);

export const createChatThread = () =>
  apiClient.post<ChatThreadSummary>('/chat/threads').then((r) => r.data);

export const deleteChatThread = (threadId: string) =>
  apiClient.delete(`/chat/threads/${threadId}`);

export const sendChatMessage = (message: string, sapDestinationId: string, threadId?: string) =>
  apiClient
    .post<ChatTurnResult>('/chat/message', { message, sapDestinationId, threadId })
    .then((r) => r.data);
