import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import * as adminApi from '../api/admin';
import { FieldHint } from '../components/FieldHint';
import { Modal } from '../components/Modal';
import type { DestinationTransport, SapDestination } from '../types';

interface TestState {
  status: 'testing' | 'done';
  success?: boolean;
  statusCode?: number | null;
  durationMs?: number;
  message?: string;
}

const TRANSPORT_LABELS: Record<DestinationTransport, string> = {
  direct_fmcall: 'Direct fmcall',
  cap_facade: 'CAP facade',
};

const DEFAULT_CAP_EXECUTE_PATH = '/integration/execute';

export default function SapDestinationsPage() {
  const [destinations, setDestinations] = useState<SapDestination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [transport, setTransport] = useState<DestinationTransport>('direct_fmcall');
  const [url, setUrl] = useState('');
  const [cloudConnectorLocationId, setCloudConnectorLocationId] = useState('');
  const [sapUser, setSapUser] = useState('');
  const [sapPassword, setSapPassword] = useState('');
  const [capExecutePath, setCapExecutePath] = useState('');
  const [capTokenUrl, setCapTokenUrl] = useState('');
  const [capClientId, setCapClientId] = useState('');
  const [capClientSecret, setCapClientSecret] = useState('');

  const isCap = transport === 'cap_facade';

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
    setTransport('direct_fmcall');
    setUrl('');
    setCloudConnectorLocationId('');
    setSapUser('');
    setSapPassword('');
    setCapExecutePath('');
    setCapTokenUrl('');
    setCapClientId('');
    setCapClientSecret('');
    setEditingId(null);
    setShowForm(false);
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(destination: SapDestination) {
    setName(destination.name);
    setDescription(destination.description ?? '');
    setTransport(destination.transport);
    setUrl(destination.url);
    setCloudConnectorLocationId(destination.cloudConnectorLocationId ?? '');
    setCapExecutePath(destination.capExecutePath ?? '');
    setCapTokenUrl(destination.capTokenUrl ?? '');
    setCapClientId(destination.capClientId ?? '');
    // Secrets are never returned, so these stay blank and mean "keep what's stored".
    setSapUser('');
    setSapPassword('');
    setCapClientSecret('');
    setEditingId(destination.id);
    setShowForm(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Only the fields the chosen transport uses are sent; the server nulls out the
      // other set so a destination never carries two ways of authenticating.
      const shared = {
        name,
        description,
        transport,
        url,
        ...(isCap
          ? {
              capExecutePath: capExecutePath.trim() || DEFAULT_CAP_EXECUTE_PATH,
              capTokenUrl: capTokenUrl.trim(),
              capClientId: capClientId.trim(),
            }
          : { cloudConnectorLocationId: cloudConnectorLocationId || undefined }),
      };

      if (editingId) {
        const payload: Parameters<typeof adminApi.updateSapDestination>[1] = { ...shared };
        const secrets = {
          sapUser: sapUser.trim(),
          sapPassword: sapPassword.trim(),
          capClientSecret: capClientSecret.trim(),
        };
        // Blank means "keep the stored value", so empty secrets are never sent.
        if (!isCap && secrets.sapUser) payload.sapUser = secrets.sapUser;
        if (!isCap && secrets.sapPassword) payload.sapPassword = secrets.sapPassword;
        if (isCap && secrets.capClientSecret) payload.capClientSecret = secrets.capClientSecret;
        await adminApi.updateSapDestination(editingId, payload);
      } else {
        await adminApi.createSapDestination({
          ...shared,
          ...(isCap ? { capClientSecret } : { sapUser, sapPassword }),
        });
      }
      resetForm();
      await load();
    } catch (err: any) {
      setError(
        err.response?.data?.message ??
          (editingId ? 'Failed to update SAP destination' : 'Failed to create SAP destination'),
      );
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
          <button className="btn" onClick={openCreate}>
            New destination
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showForm && (
        <Modal title={editingId ? 'Edit SAP destination' : 'New SAP destination'} onClose={resetForm}>
          <form onSubmit={onSubmit}>
            <div className="field">
              <div className="field-label-row">
                <label htmlFor="destName">Destination name</label>
                <FieldHint>
                  Any label you choose — it&apos;s only used inside this app to identify the
                  connection. It does <strong>not</strong> have to match a destination name in SAP
                  BTP.
                </FieldHint>
              </div>
              <input
                id="destName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. S4H_PROD"
                required
              />
            </div>
            <div className="field">
              <div className="field-label-row">
                <label htmlFor="destDescription">Description</label>
                <FieldHint>Optional note for your own reference. Nothing to look up.</FieldHint>
              </div>
              <input
                id="destDescription"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="field-label-row">
                <label htmlFor="destTransport">How to reach SAP</label>
                <FieldHint>
                  <strong>Direct fmcall</strong> — this app calls the ABAP fmcall service itself,
                  tunnelling through the BTP Connectivity service and Cloud Connector with a backend
                  SAP user. Fewest moving parts, but this app owns the proxy and redirect handling.
                  <br />
                  <strong>CAP facade</strong> — this app posts to a deployed CAP service that runs
                  the function module for you. Authentication is XSUAA client credentials, and the
                  Cloud Connector hop belongs to that service, so proxy tokens and redirects stop
                  being our problem.
                  <span className="hint-path">
                    Both can be used side by side — this is set per destination.
                  </span>
                </FieldHint>
              </div>
              <select
                id="destTransport"
                value={transport}
                onChange={(e) => setTransport(e.target.value as DestinationTransport)}
              >
                <option value="direct_fmcall">Direct fmcall (Cloud Connector + SAP user)</option>
                <option value="cap_facade">CAP facade (XSUAA client credentials)</option>
              </select>
            </div>
            <div className="field">
              <div className="field-label-row">
                <label htmlFor="destUrl">Base URL</label>
                {isCap ? (
                  <FieldHint>
                    The route of the deployed CAP application, <strong>without</strong> any path —
                    e.g. <code>https://your-org-generic-fm.cfapps.us10-001.hana.ondemand.com</code>.
                    <br />
                    This is a public HTTPS route, not an SAP host: the CAP service is what reaches
                    SAP.
                    <span className="hint-path">
                      BTP Cockpit → Cloud Foundry → Spaces → your space → Applications → the CAP app
                      → its route
                    </span>
                  </FieldHint>
                ) : (
                  <FieldHint>
                    The address of your SAP system, <strong>without</strong> any API path.
                    <br />
                    <strong>On-premise (via Cloud Connector):</strong> use the internal host/IP and
                    port exactly as listed under <em>Exposed Back-End Systems</em> — e.g.{' '}
                    <code>http://192.168.171.43:8000</code>. A private IP is expected here; it works
                    because traffic is tunneled through the Cloud Connector.
                    <br />
                    <strong>Internet-reachable SAP:</strong> use its public HTTPS URL.
                    <span className="hint-path">
                      BTP Cockpit → Connectivity → Cloud Connectors → your connector → Cloud To
                      On-Premise
                    </span>
                  </FieldHint>
                )}
              </div>
              <input
                id="destUrl"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  isCap
                    ? 'https://your-cap-app.cfapps.us10-001.hana.ondemand.com'
                    : 'https://your-sap-system.example.com'
                }
                required
              />
            </div>
            {isCap && (
              <>
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="capExecutePath">Execute action path</label>
                    <FieldHint>
                      The CAP action that runs a function module by name. Leave blank to use{' '}
                      <code>{DEFAULT_CAP_EXECUTE_PATH}</code>.
                      <span className="hint-path">
                        Check the service&apos;s <code>$metadata</code> if you are unsure.
                      </span>
                    </FieldHint>
                  </div>
                  <input
                    id="capExecutePath"
                    className="mono"
                    value={capExecutePath}
                    onChange={(e) => setCapExecutePath(e.target.value)}
                    placeholder={DEFAULT_CAP_EXECUTE_PATH}
                  />
                </div>
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="capTokenUrl">XSUAA token URL</label>
                    <FieldHint>
                      The OAuth token endpoint of the CAP app&apos;s XSUAA instance — it ends in{' '}
                      <code>/oauth/token</code>.
                      <span className="hint-path">
                        BTP Cockpit → Instances and Subscriptions → the CAP app&apos;s XSUAA
                        instance → Service Keys → <code>url</code> + <code>/oauth/token</code>
                      </span>
                    </FieldHint>
                  </div>
                  <input
                    id="capTokenUrl"
                    className="mono"
                    value={capTokenUrl}
                    onChange={(e) => setCapTokenUrl(e.target.value)}
                    placeholder="https://your-subaccount.authentication.us10.hana.ondemand.com/oauth/token"
                    required
                  />
                </div>
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="capClientId">XSUAA client ID</label>
                    <FieldHint>
                      The <code>clientid</code> from the same service key — a value like{' '}
                      <code>sb-generic-fm-cap-...</code>. This is not a secret.
                    </FieldHint>
                  </div>
                  <input
                    id="capClientId"
                    className="mono"
                    value={capClientId}
                    onChange={(e) => setCapClientId(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="capClientSecret">XSUAA client secret</label>
                    <FieldHint>
                      The <code>clientsecret</code> from the same service key. Stored encrypted
                      (AES-256-GCM) and never shown again after saving.
                      {editingId && <> Leave blank to keep the current secret.</>}
                    </FieldHint>
                  </div>
                  <input
                    id="capClientSecret"
                    type="password"
                    value={capClientSecret}
                    onChange={(e) => setCapClientSecret(e.target.value)}
                    placeholder={editingId ? 'Leave blank to keep the current secret' : undefined}
                    required={!editingId}
                  />
                </div>
              </>
            )}
            {!isCap && (
              <>
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="destLocationId">Cloud Connector Location ID</label>
                    <FieldHint>
                      <strong>Required only for on-premise systems</strong> reached through a Cloud
                      Connector — leave blank for internet-reachable SAP systems.
                      <br />
                      This is the connector&apos;s <em>Location ID</em> (e.g.{' '}
                      <code>MYGO-BTP-BAS</code>) — <strong>not</strong> the long &ldquo;Connector
                      ID&rdquo; hex string shown on the connector&apos;s overview page.
                      <br />
                      Tip: if a destination already exists in BTP for this system, its{' '}
                      <code>CloudConnectorLocationId</code> property shows the exact value.
                      <span className="hint-path">
                        BTP Cockpit → Connectivity → Destinations → open any on-premise destination
                        → Additional Properties
                      </span>
                    </FieldHint>
                  </div>
                  <input
                    id="destLocationId"
                    className="mono"
                    value={cloudConnectorLocationId}
                    onChange={(e) => setCloudConnectorLocationId(e.target.value)}
                    placeholder="e.g. MYGO-BTP-BAS — leave blank for internet-reachable systems"
                  />
                </div>
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="sapUser">SAP_USER</label>
                    <FieldHint>
                      A user that exists <strong>in the SAP backend system itself</strong> (created
                      in transaction <code>SU01</code>) — usually a short technical name like{' '}
                      <code>RFC_USER</code>.
                      <br />
                      <strong>This is not your SAP BTP login.</strong> Your BTP cockpit
                      email/password will be rejected with HTTP 401 — BTP and the ABAP backend are
                      separate user stores.
                      <br />
                      Ask your SAP Basis team for a dedicated service/communication user rather than
                      using a personal login.
                      <span className="hint-path">
                        To verify it works: BTP Cockpit → Connectivity → Destinations → Check
                        Connection
                      </span>
                    </FieldHint>
                  </div>
                  <input
                    id="sapUser"
                    value={sapUser}
                    onChange={(e) => setSapUser(e.target.value)}
                    placeholder={editingId ? 'Leave blank to keep the current user' : undefined}
                    required={!editingId}
                  />
                </div>
                <div className="field">
                  <div className="field-label-row">
                    <label htmlFor="sapPassword">SAP_PWD</label>
                    <FieldHint>
                      The backend password for the SAP_USER above. Stored encrypted (AES-256-GCM)
                      and never shown again after saving.
                      {editingId && <> Leave blank to keep the current password.</>}
                    </FieldHint>
                  </div>
                  <input
                    id="sapPassword"
                    type="password"
                    value={sapPassword}
                    onChange={(e) => setSapPassword(e.target.value)}
                    placeholder={editingId ? 'Leave blank to keep the current password' : undefined}
                    required={!editingId}
                  />
                </div>
              </>
            )}
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {editingId ? 'Save changes' : 'Save destination'}
              </button>
              <button className="btn" type="button" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
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
                <th>Reached via</th>
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
                    <td>
                      <span className="badge">{TRANSPORT_LABELS[d.transport]}</span>
                      {d.transport === 'cap_facade' && d.capExecutePath && (
                        <div className="text-muted mono">{d.capExecutePath}</div>
                      )}
                    </td>
                    <td className="mono">{d.url}</td>
                    <td>
                      <span className={`badge ${d.isActive ? 'badge-success' : 'badge-muted'}`}>
                        {d.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions" style={{ marginBottom: 6 }}>
                        {d.transport === 'cap_facade' ? (
                          <FieldHint>
                            Testing a CAP destination fetches an XSUAA token and then reads the
                            service&apos;s <code>$metadata</code> — it does not run a function
                            module against SAP. Leave this blank to use the metadata path derived
                            from the execute action, or enter another path to GET instead.
                            <span className="hint-path">
                              A failure here names which half broke: the token request or the CAP
                              service.
                            </span>
                          </FieldHint>
                        ) : (
                          <FieldHint>
                            Optional path appended to the Base URL when testing. Leave blank to hit
                            the root — note many SAP systems return <strong>404</strong> at the root
                            even when the connection is fine, so testing a real path is more
                            meaningful. Example:{' '}
                            <code>/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/</code>
                            <span className="hint-path">
                              A 404 still proves the tunnel works; 401 means the credentials were
                              rejected.
                            </span>
                          </FieldHint>
                        )}
                        <input
                          className="mono"
                          style={{ width: 160 }}
                          placeholder={
                            d.transport === 'cap_facade' ? 'optional CAP path' : 'optional fmcall path'
                          }
                          value={testPaths[d.id] ?? ''}
                          onChange={(e) =>
                            setTestPaths((prev) => ({ ...prev, [d.id]: e.target.value }))
                          }
                        />
                        <button className="btn btn-sm" onClick={() => openEdit(d)}>
                          Edit
                        </button>
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
