import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import * as adminApi from '../api/admin';
import type { Role, User } from '../types';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([adminApi.listUsers(), adminApi.listRoles()]);
      setUsers(usersRes);
      setRoles(rolesRes);
      if (rolesRes.length > 0) setRoleId((prev) => prev || rolesRes[0].id);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setName('');
    setEmail('');
    setPassword('');
    setShowForm(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await adminApi.createUser({ name, email, password, roleId });
      resetForm();
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  }

  async function onToggleActive(user: User) {
    setError(null);
    try {
      await adminApi.updateUser(user.id, { isActive: !user.isActive });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to update user');
    }
  }

  async function onRoleChange(user: User, newRoleId: string) {
    setError(null);
    try {
      await adminApi.updateUser(user.id, { roleId: newRoleId });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to update user');
    }
  }

  async function onDelete(user: User) {
    if (!confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    setError(null);
    try {
      await adminApi.deleteUser(user.id);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to delete user');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p>Invite teammates and assign them a role</p>
        </div>
        {!showForm && roles.length > 0 && (
          <button className="btn" onClick={() => setShowForm(true)}>
            New user
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {roles.length === 0 && !loading && (
        <div className="card">
          <p className="empty-state">Create a role first before inviting users.</p>
        </div>
      )}

      {showForm && (
        <div className="card">
          <h2>New user</h2>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="userName">Name</label>
              <input id="userName" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="userEmail">Email</label>
              <input
                id="userEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="userPassword">Temporary password</label>
              <input
                id="userPassword"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="userRole">Role</label>
              <select id="userRole" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                Create user
              </button>
              <button className="btn" type="button" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h2>All users</h2>
        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : users.length === 0 ? (
          <p className="empty-state">No users yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td className="mono">{user.email}</td>
                  <td>
                    {user.isOwner ? (
                      <span className="badge badge-success">Owner</span>
                    ) : (
                      <select
                        value={user.roleId ?? ''}
                        onChange={(e) => onRoleChange(user, e.target.value)}
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${user.isActive ? 'badge-success' : 'badge-muted'}`}>
                      {user.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    {!user.isOwner && (
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => onToggleActive(user)}>
                          {user.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => onDelete(user)}>
                          Delete
                        </button>
                      </div>
                    )}
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
