import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import * as chatApi from '../api/chat';
import type {
  ChatDestination,
  ChatThreadSummary,
  ChatToolInvocation,
  DestinationTransport,
  LlmProviderInfo,
} from '../types';

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ChatToolInvocation[];
  failed?: boolean;
  // True when the assistant replied without calling any SAP tool — surfaced so an
  // ungrounded answer is visibly distinguishable from one backed by live data.
  answeredWithoutSap?: boolean;
}

interface AvailableTool {
  name: string;
  description: string;
  fmName: string;
}

const PROVIDER_LABELS: Record<'anthropic' | 'openai' | 'gemini', string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

const TRANSPORT_LABELS: Record<DestinationTransport, string> = {
  direct_fmcall: 'Direct fmcall',
  cap_facade: 'XSUAA application',
};

const DESTINATION_STORAGE_KEY = 'chatSapDestinationId';

export default function ChatPage() {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [providers, setProviders] = useState<LlmProviderInfo[]>([]);
  const [destinations, setDestinations] = useState<ChatDestination[] | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [tools, setTools] = useState<AvailableTool[] | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatApi
      .listLlmProviders()
      .then(setProviders)
      .catch(() => setProviders([]));

    void loadDestinationsAndThreads();
  }, []);

  useEffect(() => {
    if (!destinationId) {
      setTools([]);
      setToolCount(0);
      return;
    }
    localStorage.setItem(DESTINATION_STORAGE_KEY, destinationId);
    chatApi
      .listChatTools(destinationId)
      .then((t) => {
        setTools(t);
        setToolCount(t.length);
      })
      .catch(() => {
        setTools([]);
        setToolCount(0);
      });
  }, [destinationId]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries, sending]);

  function pickDestinationId(list: ChatDestination[], preferred?: string | null): string {
    if (preferred && list.some((destination) => destination.id === preferred)) {
      return preferred;
    }
    const stored = localStorage.getItem(DESTINATION_STORAGE_KEY);
    if (stored && list.some((destination) => destination.id === stored)) {
      return stored;
    }
    return list[0]?.id ?? '';
  }

  async function loadDestinationsAndThreads() {
    try {
      setThreadsLoading(true);
      setThreadsError(null);
      const [destinationList, threadList] = await Promise.all([
        chatApi.listChatDestinations(),
        chatApi.listChatThreads(),
      ]);
      setDestinations(destinationList);
      setThreads(threadList);
      const firstThreadId = threadList[0]?.id ?? null;
      setDestinationId(pickDestinationId(destinationList, threadList[0]?.sapDestinationId));
      setActiveThreadId(firstThreadId);
      if (firstThreadId) {
        await loadThread(firstThreadId, destinationList);
      } else {
        setEntries([]);
      }
    } catch {
      setDestinations([]);
      setThreadsError('Could not load saved chats.');
    } finally {
      setThreadsLoading(false);
    }
  }

  async function loadThread(threadId: string, destinationList?: ChatDestination[]) {
    try {
      setLoadingThread(true);
      setError(null);
      const thread = await chatApi.getChatThread(threadId);
      setEntries(
        thread.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolInvocations: m.toolInvocations,
          failed: m.failed,
          answeredWithoutSap: m.answeredWithoutSap,
        })),
      );
      setActiveThreadId(thread.id);
      const knownDestinations = destinationList ?? destinations ?? [];
      if (thread.sapDestinationId) {
        setDestinationId(pickDestinationId(knownDestinations, thread.sapDestinationId));
      }
    } catch {
      setError('Could not load that chat.');
    } finally {
      setLoadingThread(false);
    }
  }

  async function createNewChat() {
    try {
      setError(null);
      const thread = await chatApi.createChatThread();
      setThreads((prev) => [thread, ...prev]);
      setActiveThreadId(thread.id);
      setEntries([]);
    } catch {
      setError('Could not create a new chat.');
    }
  }

  async function deleteThread(threadId: string) {
    const ok = window.confirm('Delete this chat permanently?');
    if (!ok) return;
    try {
      setError(null);
      await chatApi.deleteChatThread(threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThreadId === threadId) {
        const next = threads.find((t) => t.id !== threadId) ?? null;
        setActiveThreadId(next?.id ?? null);
        if (next?.id) {
          await loadThread(next.id);
        } else {
          setEntries([]);
        }
      }
    } catch {
      setError('Could not delete chat.');
    }
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || sending || !destinationId) return;

    setError(null);
    setInput('');
    setEntries((prev) => [
      ...prev,
      { id: `pending-user-${Date.now()}`, role: 'user', content: question },
    ]);
    setSending(true);

    try {
      const result = await chatApi.sendChatMessage(
        question,
        destinationId,
        activeThreadId ?? undefined,
      );
      setToolCount(result.availableToolCount);
      setThreads((prev) => {
        const existing = prev.find((t) => t.id === result.threadId);
        if (existing) {
          return [
            {
              ...existing,
              title: result.threadTitle,
              sapDestinationId: destinationId,
              lastMessageAt: new Date().toISOString(),
            },
            ...prev.filter((t) => t.id !== result.threadId),
          ];
        }
        return [
          {
            id: result.threadId,
            title: result.threadTitle,
            sapDestinationId: destinationId,
            lastMessageAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ];
      });
      setActiveThreadId(result.threadId);
      setEntries((prev) => [
        ...prev,
        {
          id: `pending-assistant-${Date.now()}`,
          role: 'assistant',
          content: result.reply || '(no answer returned)',
          toolInvocations: result.toolInvocations,
          answeredWithoutSap: result.toolInvocations.length === 0,
        },
      ]);
    } catch (err: any) {
      const message =
        err.response?.data?.message ?? 'The assistant could not be reached. Please try again.';
      setEntries((prev) => [
        ...prev,
        { id: `pending-error-${Date.now()}`, role: 'assistant', content: message, failed: true },
      ]);
      setError(message);
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  const activeProvider = providers.find((p) => p.active);
  const selectedDestination = destinations?.find((destination) => destination.id === destinationId);
  const canSend = Boolean(destinationId) && !sending && Boolean(input.trim());

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ask SAP</h1>
          <p>
            {selectedDestination?.transport === 'cap_facade'
              ? `Ask in plain language — SAP is queried through ${selectedDestination.name} (XSUAA application). No function-module whitelist is needed.`
              : `Ask in plain language — answers come from your whitelisted SAP function modules${
                  toolCount !== null ? `, ${toolCount} available` : ''
                }${selectedDestination ? ` on ${selectedDestination.name}` : ''}`}
          </p>
        </div>
        {activeProvider && (
          <span className="badge" title="Configured model">
            {PROVIDER_LABELS[activeProvider.name]} · {activeProvider.model}
          </span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="chat-layout">
        <div className="card chat-threads-card">
          <button className="btn btn-primary" type="button" onClick={() => void createNewChat()}>
            New chat
          </button>
          {threadsError && <p className="text-muted">{threadsError}</p>}
          <div className="chat-thread-list">
            {threadsLoading ? (
              <p className="text-muted">Loading chats…</p>
            ) : threads.length === 0 ? (
              <p className="text-muted">No saved chats yet.</p>
            ) : (
              threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`chat-thread-item${activeThreadId === thread.id ? ' chat-thread-item-active' : ''}`}
                >
                  <button
                    type="button"
                    className="chat-thread-open"
                    onClick={() => void loadThread(thread.id)}
                  >
                    {thread.title}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => void deleteThread(thread.id)}
                    title="Delete chat"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card chat-card">
          <div className="chat-toolbar">
            <label htmlFor="chat-destination">SAP destination</label>
            <select
              id="chat-destination"
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
              disabled={sending || destinations === null || destinations.length === 0}
              aria-label="SAP destination"
            >
              {destinations === null ? (
                <option value="">Loading destinations…</option>
              ) : destinations.length === 0 ? (
                <option value="">No SAP destinations configured</option>
              ) : (
                destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name} · {TRANSPORT_LABELS[destination.transport]}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="chat-scroll" ref={scrollRef}>
            {loadingThread && <p className="text-muted">Loading chat…</p>}
          {entries.length === 0 && !sending && (
            <div className="chat-empty">
              {destinations === null || tools === null ? (
                <p className="text-muted">Loading available function modules…</p>
              ) : destinations.length === 0 ? (
                <p className="text-muted">
                  No SAP destinations are configured yet, so there is nothing to query.
                  Add one under <strong>SAP Destinations</strong> first.
                </p>
              ) : selectedDestination?.transport === 'cap_facade' ? (
                <p className="text-muted">
                  This XSUAA application can call SAP function modules by name. No whitelist is
                  needed — ask in plain language and the CAP service will run the matching
                  function module.
                </p>
              ) : tools.length === 0 ? (
                <p className="text-muted">
                  No function modules are whitelisted on this destination yet, so there is
                  nothing to query. Add one under <strong>Function Modules</strong> first.
                </p>
              ) : (
                <>
                  <p className="text-muted">You can ask about:</p>
                  <ul className="chat-tool-list">
                    {tools.map((tool) => (
                      <li key={tool.name}>
                        <span className="mono">{tool.name}</span>
                        <span className="text-muted"> — {tool.description}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {entries.map((entry) => (
            <div key={entry.id} className={`chat-row chat-row-${entry.role}`}>
              <div className={`chat-bubble${entry.failed ? ' chat-bubble-error' : ''}`}>
                {entry.content}
              </div>
              {entry.role === 'assistant' && !entry.failed && entry.answeredWithoutSap && (
                <div className="chat-tools">
                  <div className="chat-tool text-muted">
                    <span className="badge badge-muted">no SAP call</span> answered without
                    querying SAP — not backed by live data
                  </div>
                </div>
              )}
              {entry.toolInvocations && entry.toolInvocations.length > 0 && (
                <div className="chat-tools">
                  {entry.toolInvocations.map((call, j) => (
                    <div key={j} className="chat-tool">
                      <span className={`badge ${call.success ? 'badge-success' : 'badge-muted'}`}>
                        {call.success ? 'called' : 'failed'}
                      </span>{' '}
                      <span className="mono">{call.toolName}</span>
                      {Object.keys(call.arguments).length > 0 && (
                        <span className="text-muted mono">
                          {' '}
                          ({Object.entries(call.arguments)
                            .map(([k, v]) => `${k}=${String(v)}`)
                            .join(', ')})
                        </span>
                      )}
                      <span className="text-muted">
                        {' '}
                        · {call.fmName} · {call.durationMs}ms
                        {!call.success && ` · ${call.message}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div className="chat-row chat-row-assistant">
              <div className="chat-bubble chat-bubble-thinking">Checking SAP…</div>
            </div>
          )}
        </div>

          <form className="chat-composer" onSubmit={onSubmit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                destinationId
                  ? 'Ask about your SAP data…'
                  : 'Select an SAP destination to start asking…'
              }
              disabled={sending || !destinationId}
              aria-label="Message"
            />
            <button className="btn btn-primary chat-send" type="submit" disabled={!canSend}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
