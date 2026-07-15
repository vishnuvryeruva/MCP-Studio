import { useAuth } from '../context/AuthContext';

export default function DashboardHome() {
  const { user } = useAuth();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <p>Signed in as {user?.isOwner ? 'organization owner' : user?.role?.name ?? 'user'}</p>
        </div>
      </div>
      <div className="card">
        <h2>Getting started</h2>
        <p className="text-muted">
          Connect your SAP system under <strong>SAP Destinations</strong>, then whitelist the
          fmcall URLs you want exposed as tools under <strong>Function Modules</strong>. Use{' '}
          <strong>Roles</strong> and <strong>Users</strong> to give teammates scoped access.
        </p>
      </div>
    </>
  );
}
