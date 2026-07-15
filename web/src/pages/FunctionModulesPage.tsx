import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import * as adminApi from '../api/admin';
import type { FunctionModule, FunctionModuleParam, SapDestination } from '../types';

const EMPTY_PARAM: FunctionModuleParam = { name: '', type: 'string', required: true, description: '' };

export default function FunctionModulesPage() {
  const [functionModules, setFunctionModules] = useState<FunctionModule[]>([]);
  const [destinations, setDestinations] = useState<SapDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [sapDestinationId, setSapDestinationId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fmName, setFmName] = useState('');
  const [fmcallUrl, setFmcallUrl] = useState('');
  const [parameters, setParameters] = useState<FunctionModuleParam[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [fmsRes, destRes] = await Promise.all([
        adminApi.listFunctionModules(),
        adminApi.listSapDestinations(),
      ]);
      setFunctionModules(fmsRes);
      setDestinations(destRes);
      if (destRes.length > 0) setSapDestinationId((prev) => prev || destRes[0].id);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to load function modules');
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
    setFmName('');
    setFmcallUrl('');
    setParameters([]);
    setShowForm(false);
  }

  function addParam() {
    setParameters((prev) => [...prev, { ...EMPTY_PARAM }]);
  }

  function updateParam(index: number, patch: Partial<FunctionModuleParam>) {
    setParameters((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function removeParam(index: number) {
    setParameters((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await adminApi.createFunctionModule({
        sapDestinationId,
        name,
        description,
        fmName,
        fmcallUrl,
        parameters,
      });
      resetForm();
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to create function module');
    } finally {
      setSubmitting(false);
    }
  }

  async function onToggleEnabled(fm: FunctionModule) {
    setError(null);
    try {
      await adminApi.updateFunctionModule(fm.id, { isEnabled: !fm.isEnabled });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to update function module');
    }
  }

  async function onDelete(fm: FunctionModule) {
    if (!confirm(`Remove "${fm.name}" from the whitelist?`)) return;
    setError(null);
    try {
      await adminApi.deleteFunctionModule(fm.id);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to delete function module');
    }
  }

  function destinationName(id: string) {
    return destinations.find((d) => d.id === id)?.name ?? '—';
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Function Modules</h1>
          <p>Whitelist fmcall URLs to expose them as tools to the chatbot</p>
        </div>
        {!showForm && destinations.length > 0 && (
          <button className="btn" onClick={() => setShowForm(true)}>
            New function module
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {destinations.length === 0 && !loading && (
        <div className="card">
          <p className="empty-state">Connect a SAP destination first before whitelisting an FM.</p>
        </div>
      )}

      {showForm && (
        <div className="card">
          <h2>New function module</h2>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="fmDest">SAP destination</label>
              <select
                id="fmDest"
                value={sapDestinationId}
                onChange={(e) => setSapDestinationId(e.target.value)}
              >
                {destinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fmToolName">Tool name (shown to Claude)</label>
              <input
                id="fmToolName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="get_sales_last_month"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="fmToolDescription">Tool description (shown to Claude)</label>
              <textarea
                id="fmToolDescription"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Fetch sales figures for a customer for the previous calendar month"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="fmName">SAP function module name</label>
              <input
                id="fmName"
                className="mono"
                value={fmName}
                onChange={(e) => setFmName(e.target.value)}
                placeholder="BAPI_SALESORDER_GETLIST"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="fmcallUrl">fmcall URL / path</label>
              <input
                id="fmcallUrl"
                className="mono"
                value={fmcallUrl}
                onChange={(e) => setFmcallUrl(e.target.value)}
                placeholder="/sap/bc/fmcall/BAPI_SALESORDER_GETLIST"
                required
              />
            </div>
            <div className="field">
              <label>Parameters</label>
              {parameters.map((param, i) => (
                <div className="param-row" key={i}>
                  <input
                    placeholder="name"
                    value={param.name}
                    onChange={(e) => updateParam(i, { name: e.target.value })}
                    required
                  />
                  <select
                    value={param.type}
                    onChange={(e) => updateParam(i, { type: e.target.value as FunctionModuleParam['type'] })}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="date">date</option>
                  </select>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={param.required}
                      onChange={(e) => updateParam(i, { required: e.target.checked })}
                    />
                    required
                  </label>
                  <input
                    placeholder="description"
                    value={param.description}
                    onChange={(e) => updateParam(i, { description: e.target.value })}
                  />
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => removeParam(i)}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-sm" onClick={addParam}>
                Add parameter
              </button>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                Save function module
              </button>
              <button className="btn" type="button" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h2>Whitelisted function modules</h2>
        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : functionModules.length === 0 ? (
          <p className="empty-state">No function modules whitelisted yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>SAP FM</th>
                <th>Destination</th>
                <th>Parameters</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {functionModules.map((fm) => (
                <tr key={fm.id}>
                  <td>
                    <div>{fm.name}</div>
                    <div className="text-muted">{fm.description}</div>
                  </td>
                  <td className="mono">{fm.fmName}</td>
                  <td>{destinationName(fm.sapDestinationId)}</td>
                  <td>
                    {fm.parameters.length === 0
                      ? '—'
                      : fm.parameters.map((p) => (
                          <span className="badge" key={p.name}>
                            {p.name}
                            {p.required ? '*' : ''}
                          </span>
                        ))}
                  </td>
                  <td>
                    <span className={`badge ${fm.isEnabled ? 'badge-success' : 'badge-muted'}`}>
                      {fm.isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => onToggleEnabled(fm)}>
                        {fm.isEnabled ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => onDelete(fm)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
