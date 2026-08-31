import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import * as chatApi from '../api/chat';
import type { ChatThreadSummary, ChatToolInvocation, LlmProviderInfo } from '../types';

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
  const [tools, setTools] = useState<AvailableTool[] | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatApi
      .listLlmProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
    // The empty state lists this organization's real whitelisted function modules
    // rather than invented example prompts.
    chatApi
      .listChatTools()
      .then((t) => {
        setTools(t);
        setToolCount(t.length);
      })
      .catch(() => setTools([]));

    void loadThreads();
  }, []);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries, sending]);

  async function loadThreads() {
    try {
      setThreadsLoading(true);
      setThreadsError(null);
      const result = await chatApi.listChatThreads();
      setThreads(result);
      const firstThreadId = result[0]?.id ?? null;
      setActiveThreadId(firstThreadId);
      if (firstThreadId) {
        await loadThread(firstThreadId);
      } else {
        setEntries([]);
      }
    } catch {
      setThreadsError('Could not load saved chats.');
    } finally {
      setThreadsLoading(false);
    }
  }

  async function loadThread(threadId: string) {
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
    if (!question || sending) return;

    setError(null);
    setInput('');
    setEntries((prev) => [
      ...prev,
      { id: `pending-user-${Date.now()}`, role: 'user', content: question },
    ]);
    setSending(true);

    try {
      const result = await chatApi.sendChatMessage(question, activeThreadId ?? undefined);
      setToolCount(result.availableToolCount);
      setThreads((prev) => {
        const existing = prev.find((t) => t.id === result.threadId);
        if (existing) {
          return [
            { ...existing, title: result.threadTitle, lastMessageAt: new Date().toISOString() },
            ...prev.filter((t) => t.id !== result.threadId),
          ];
        }
        return [
          {
            id: result.threadId,
            title: result.threadTitle,
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Ask SAP</h1>
          <p>
            Ask in plain language — answers come from your whitelisted SAP function modules
            {toolCount !== null && `, ${toolCount} available`}
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
          <div className="chat-scroll" ref={scrollRef}>
            {loadingThread && <p className="text-muted">Loading chat…</p>}
          {entries.length === 0 && !sending && (
            <div className="chat-empty">
              {tools === null ? (
                <p className="text-muted">Loading available function modules…</p>
              ) : tools.length === 0 ? (
                <p className="text-muted">
                  No function modules are whitelisted yet, so there is nothing to query.
                  Add one under <strong>Function Modules</strong> first.
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
              placeholder="Ask about your SAP data…"
              disabled={sending}
              aria-label="Message"
            />
            <button className="btn btn-primary chat-send" type="submit" disabled={sending || !input.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
