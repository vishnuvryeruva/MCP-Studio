import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import * as adminApi from '../api/admin';
import type { Permission, Role } from '../types';

const PERMISSION_LABELS: Record<Permission, string> = {
  manage_roles: 'Manage roles',
  manage_users: 'Manage users',
  manage_sap_destinations: 'Manage SAP destinations',
  manage_function_modules: 'Manage function modules',
};

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        adminApi.listRoles(),
        adminApi.listPermissions(),
      ]);
      setRoles(rolesRes);
      setPermissions(permsRes);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setEditingId(null);
    setName('');
    setDescription('');
    setSelectedPermissions([]);
    setShowForm(false);
  }

  function startEdit(role: Role) {
    setEditingId(role.id);
    setName(role.name);
    setDescription(role.description ?? '');
    setSelectedPermissions(role.permissions);
    setShowForm(true);
  }

  function togglePermission(permission: Permission) {
    setSelectedPermissions((prev) =>
      prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission],
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (editingId) {
        await adminApi.updateRole(editingId, {
          name,
          description,
          permissions: selectedPermissions,
        });
      } else {
        await adminApi.createRole({ name, description, permissions: selectedPermissions });
      }
      resetForm();
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to save role');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this role? Users assigned to it must be reassigned first.')) return;
    setError(null);
    try {
      await adminApi.deleteRole(id);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to delete role');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Roles</h1>
          <p>Define custom permission sets to assign to sub-users</p>
        </div>
        {!showForm && (
          <button className="btn" onClick={() => setShowForm(true)}>
            New role
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showForm && (
        <div className="card">
          <h2>{editingId ? 'Edit role' : 'New role'}</h2>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="roleName">Name</label>
              <input id="roleName" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="roleDescription">Description</label>
              <input
                id="roleDescription"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Permissions</label>
              <div className="checkbox-grid">
                {permissions.map((p) => (
                  <label className="checkbox-row" key={p}>
                    <input
                      type="checkbox"
                      checked={selectedPermissions.includes(p)}
                      onChange={() => togglePermission(p)}
                    />
                    {PERMISSION_LABELS[p] ?? p}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {editingId ? 'Save changes' : 'Create role'}
              </button>
              <button className="btn" type="button" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h2>All roles</h2>
        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : roles.length === 0 ? (
          <p className="empty-state">No custom roles yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Permissions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>{role.name}</td>
                  <td className="text-muted">{role.description || '—'}</td>
                  <td>
                    {role.permissions.map((p) => (
                      <span className="badge" key={p}>
                        {PERMISSION_LABELS[p] ?? p}
                      </span>
                    ))}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => startEdit(role)}>
                        Edit
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => onDelete(role.id)}>
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
