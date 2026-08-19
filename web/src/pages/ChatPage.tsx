import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import * as chatApi from '../api/chat';
import type { ChatToolInvocation, LlmProviderInfo } from '../types';

interface ChatEntry {
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
  }, []);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries, sending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || sending) return;

    setError(null);
    setInput('');
    const priorHistory = entries
      .filter((e) => !e.failed)
      .map((e) => ({ role: e.role, content: e.content }));
    setEntries((prev) => [...prev, { role: 'user', content: question }]);
    setSending(true);

    try {
      const result = await chatApi.sendChatMessage(question, priorHistory);
      setToolCount(result.availableToolCount);
      setEntries((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.reply || '(no answer returned)',
          toolInvocations: result.toolInvocations,
          answeredWithoutSap: result.toolInvocations.length === 0,
        },
      ]);
    } catch (err: any) {
      const message =
        err.response?.data?.message ?? 'The assistant could not be reached. Please try again.';
      setEntries((prev) => [...prev, { role: 'assistant', content: message, failed: true }]);
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

      <div className="card chat-card">
        <div className="chat-scroll" ref={scrollRef}>
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

          {entries.map((entry, i) => (
            <div key={i} className={`chat-row chat-row-${entry.role}`}>
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
    </>
  );
}
