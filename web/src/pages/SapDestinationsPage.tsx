import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import * as adminApi from '../api/admin';
import type { SapDestination } from '../types';

interface TestState {
  status: 'testing' | 'done';
  success?: boolean;
  statusCode?: number | null;
  durationMs?: number;
  message?: string;
}

export default function SapDestinationsPage() {
  const [destinations, setDestinations] = useState<SapDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [sapUser, setSapUser] = useState('');
  const [sapPassword, setSapPassword] = useState('');

  const [testPaths, setTestPaths] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, TestState>>({});

  async function load() {
    setLoading(true);
    try {
      setDestinations(await adminApi.listSapDestinations());
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to load SAP destinations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setName('');
    setDescription('');
    setUrl('');
    setSapUser('');
    setSapPassword('');
    setShowForm(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await adminApi.createSapDestination({ name, description, url, sapUser, sapPassword });
      resetForm();
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to create SAP destination');
    } finally {
      setSubmitting(false);
    }
  }

  async function onToggleActive(destination: SapDestination) {
    setError(null);
    try {
      await adminApi.updateSapDestination(destination.id, { isActive: !destination.isActive });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to update destination');
    }
  }

  async function onTestConnection(destination: SapDestination) {
    setTestResults((prev) => ({ ...prev, [destination.id]: { status: 'testing' } }));
    try {
      const result = await adminApi.testSapDestinationConnection(
        destination.id,
        testPaths[destination.id] || undefined,
      );
      setTestResults((prev) => ({ ...prev, [destination.id]: { status: 'done', ...result } }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [destination.id]: {
          status: 'done',
          success: false,
          message: err.response?.data?.message ?? 'Test request failed',
        },
      }));
    }
  }

  async function onDelete(destination: SapDestination) {
    if (!confirm(`Delete destination "${destination.name}"? Any whitelisted FMs using it will break.`))
      return;
    setError(null);
    try {
      await adminApi.deleteSapDestination(destination.id);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to delete destination');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>SAP Destinations</h1>
          <p>Connect a BTP destination for your SAP system. Credentials are encrypted at rest.</p>
        </div>
        {!showForm && (
          <button className="btn" onClick={() => setShowForm(true)}>
            New destination
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showForm && (
        <div className="card">
          <h2>New SAP destination</h2>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="destName">Destination name</label>
              <input
                id="destName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. S4H_PROD"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="destDescription">Description</label>
              <input
                id="destDescription"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="destUrl">Base URL</label>
              <input
                id="destUrl"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-sap-system.example.com"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="sapUser">SAP_USER</label>
              <input id="sapUser" value={sapUser} onChange={(e) => setSapUser(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="sapPassword">SAP_PWD</label>
              <input
                id="sapPassword"
                type="password"
                value={sapPassword}
                onChange={(e) => setSapPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                Save destination
              </button>
              <button className="btn" type="button" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h2>All destinations</h2>
        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : destinations.length === 0 ? (
          <p className="empty-state">No SAP destinations connected yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {destinations.map((d) => {
                const test = testResults[d.id];
                return (
                  <tr key={d.id}>
                    <td>
                      {d.name}
                      {d.description && <div className="text-muted">{d.description}</div>}
                    </td>
                    <td className="mono">{d.url}</td>
                    <td>
                      <span className={`badge ${d.isActive ? 'badge-success' : 'badge-muted'}`}>
                        {d.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions" style={{ marginBottom: 6 }}>
                        <input
                          className="mono"
                          style={{ width: 160 }}
                          placeholder="optional fmcall path"
                          value={testPaths[d.id] ?? ''}
                          onChange={(e) =>
                            setTestPaths((prev) => ({ ...prev, [d.id]: e.target.value }))
                          }
                        />
                        <button
                          className="btn btn-sm"
                          onClick={() => onTestConnection(d)}
                          disabled={test?.status === 'testing'}
                        >
                          {test?.status === 'testing' ? 'Testing…' : 'Test connection'}
                        </button>
                        <button className="btn btn-sm" onClick={() => onToggleActive(d)}>
                          {d.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => onDelete(d)}>
                          Delete
                        </button>
                      </div>
                      {test?.status === 'done' && (
                        <div className="text-muted">
                          <span className={`badge ${test.success ? 'badge-success' : 'badge-muted'}`}>
                            {test.success ? 'Success' : 'Failed'}
                          </span>{' '}
                          {test.message}
                          {test.statusCode != null && ` (HTTP ${test.statusCode})`}
                          {test.durationMs != null && ` · ${test.durationMs}ms`}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
