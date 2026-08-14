import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function DashboardLayout() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-accent">MyGo</span> FM Bridge
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/chat">Ask SAP</NavLink>
          {hasPermission('manage_sap_destinations') && (
            <NavLink to="/sap-destinations">SAP Destinations</NavLink>
          )}
          {hasPermission('manage_function_modules') && (
            <NavLink to="/function-modules">Function Modules</NavLink>
          )}
          {hasPermission('manage_roles') && <NavLink to="/roles">Roles</NavLink>}
          {hasPermission('manage_users') && <NavLink to="/users">Users</NavLink>}
        </nav>
        {user && (
          <div className="sidebar-user">
            <div className="name">{user.name}</div>
            <div className="email">{user.email}</div>
            <button className="btn btn-sm" onClick={onLogout}>
              Log out
            </button>
          </div>
        )}
      </aside>
      <div className="main-content">
        <Outlet />
      </div>
    </div>
  );
}
