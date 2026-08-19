import { useEffect, useMemo, useState } from 'react';
import * as usersApi from '../api/users';
import * as chatApi from '../api/chat';
import type { LlmProviderInfo } from '../types';

const LABELS: Record<'anthropic' | 'openai' | 'gemini', string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

export default function LlmProviderPage() {
  const [providers, setProviders] = useState<LlmProviderInfo[]>([]);
  const [selected, setSelected] = useState<'anthropic' | 'openai' | 'gemini' | null>(null);
  const [initial, setInitial] = useState<'anthropic' | 'openai' | 'gemini' | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([usersApi.fetchMyLlmProvider(), chatApi.listLlmProviders()])
      .then(([current, allProviders]) => {
        setSelected(current.llmProvider);
        setInitial(current.llmProvider);
        setProviders(allProviders);
      })
      .catch(() => setError('Could not load provider settings. Please refresh and try again.'))
      .finally(() => setLoading(false));
  }, []);

  const canSave = useMemo(() => {
    if (!selected || selected === initial || saving) return false;
    const provider = providers.find((p) => p.name === selected);
    return Boolean(provider?.configured);
  }, [selected, initial, saving, providers]);

  async function onSave() {
    if (!selected || !canSave) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await usersApi.updateMyLlmProvider(selected);
      setInitial(updated.llmProvider);
      setSuccess('Provider saved. New chat messages will use this model.');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Could not save provider. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>LLM Provider</h1>
          <p>Select which model provider your account uses for chat responses.</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="card">
        <h2>Choose one provider</h2>
        {loading ? (
          <p className="text-muted">Loading providers…</p>
        ) : (
          <div className="provider-grid">
            {providers.map((provider) => {
              const id = `llm-${provider.name}`;
              const isSelected = selected === provider.name;
              return (
                <label
                  key={provider.name}
                  htmlFor={id}
                  className={`provider-option${isSelected ? ' provider-option-selected' : ''}${
                    provider.configured ? '' : ' provider-option-disabled'
                  }`}
                >
                  <div className="provider-option-top">
                    <input
                      id={id}
                      type="radio"
                      name="llmProvider"
                      value={provider.name}
                      checked={isSelected}
                      disabled={!provider.configured || saving}
                      onChange={() => setSelected(provider.name)}
                    />
                    <strong>{LABELS[provider.name]}</strong>
                    {!provider.configured && <span className="badge badge-muted">not configured</span>}
                  </div>
                  <div className="text-muted mono">{provider.model}</div>
                </label>
              );
            })}
          </div>
        )}

        <div className="form-actions">
          <button className="btn btn-primary provider-save-btn" onClick={onSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save provider'}
          </button>
        </div>
      </div>
    </>
  );
}
