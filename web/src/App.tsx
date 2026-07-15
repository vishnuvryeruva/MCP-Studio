import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { RequirePermission } from './routes/RequirePermission';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardLayout from './pages/DashboardLayout';
import DashboardHome from './pages/DashboardHome';
import RolesPage from './pages/RolesPage';
import UsersPage from './pages/UsersPage';
import SapDestinationsPage from './pages/SapDestinationsPage';
import FunctionModulesPage from './pages/FunctionModulesPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<DashboardHome />} />
              <Route
                path="/roles"
                element={
                  <RequirePermission permission="manage_roles">
                    <RolesPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/users"
                element={
                  <RequirePermission permission="manage_users">
                    <UsersPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/sap-destinations"
                element={
                  <RequirePermission permission="manage_sap_destinations">
                    <SapDestinationsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/function-modules"
                element={
                  <RequirePermission permission="manage_function_modules">
                    <FunctionModulesPage />
                  </RequirePermission>
                }
              />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
