import { apiClient } from './client';
import type {
  DestinationTransport,
  DiscoveryResult,
  FunctionModule,
  FunctionModuleParam,
  Permission,
  Role,
  SapDestination,
  SavedFunctionModule,
  User,
} from '../types';

// Roles
export const listRoles = () => apiClient.get<Role[]>('/admin/roles').then((r) => r.data);
export const listPermissions = () =>
  apiClient.get<Permission[]>('/admin/roles/permissions').then((r) => r.data);
export const createRole = (payload: {
  name: string;
  description?: string;
  permissions: Permission[];
}) => apiClient.post<Role>('/admin/roles', payload).then((r) => r.data);
export const updateRole = (
  id: string,
  payload: Partial<{ name: string; description: string; permissions: Permission[] }>,
) => apiClient.patch<Role>(`/admin/roles/${id}`, payload).then((r) => r.data);
export const deleteRole = (id: string) => apiClient.delete(`/admin/roles/${id}`);

// Users
export const listUsers = () => apiClient.get<User[]>('/admin/users').then((r) => r.data);
export const createUser = (payload: {
  name: string;
  email: string;
  password: string;
  roleId: string;
}) => apiClient.post<User>('/admin/users', payload).then((r) => r.data);
export const updateUser = (
  id: string,
  payload: Partial<{ name: string; roleId: string; isActive: boolean }>,
) => apiClient.patch<User>(`/admin/users/${id}`, payload).then((r) => r.data);
export const deleteUser = (id: string) => apiClient.delete(`/admin/users/${id}`);

// SAP Destinations
export const listSapDestinations = () =>
  apiClient.get<SapDestination[]>('/admin/sap-destinations').then((r) => r.data);
// sapUser/sapPassword apply to 'direct_fmcall'; the cap* fields to 'cap_facade'.
// The server rejects a destination that is missing what its transport needs.
export const createSapDestination = (payload: {
  name: string;
  description?: string;
  transport?: DestinationTransport;
  url: string;
  cloudConnectorLocationId?: string;
  sapUser?: string;
  sapPassword?: string;
  capExecutePath?: string;
  capTokenUrl?: string;
  capClientId?: string;
  capClientSecret?: string;
}) => apiClient.post<SapDestination>('/admin/sap-destinations', payload).then((r) => r.data);
export const updateSapDestination = (
  id: string,
  payload: Partial<{
    name: string;
    description: string;
    transport: DestinationTransport;
    url: string;
    cloudConnectorLocationId: string;
    sapUser: string;
    sapPassword: string;
    capExecutePath: string;
    capTokenUrl: string;
    capClientId: string;
    capClientSecret: string;
    isActive: boolean;
  }>,
) => apiClient.patch<SapDestination>(`/admin/sap-destinations/${id}`, payload).then((r) => r.data);
export const deleteSapDestination = (id: string) =>
  apiClient.delete(`/admin/sap-destinations/${id}`);
export const testSapDestinationConnection = (id: string, path?: string) =>
  apiClient
    .post<{ success: boolean; statusCode: number | null; durationMs: number; message: string }>(
      `/admin/sap-destinations/${id}/test-connection`,
      { path },
    )
    .then((r) => r.data);

// Function Modules (whitelisted fmcall URLs / MCP tools)
export const listFunctionModules = () =>
  apiClient.get<FunctionModule[]>('/admin/function-modules').then((r) => r.data);
export const createFunctionModule = (payload: {
  sapDestinationId: string;
  name: string;
  description: string;
  fmName: string;
  // Omitted for CAP-backed destinations, which address the FM by name.
  fmcallUrl?: string;
  parameters: FunctionModuleParam[];
  isEnabled?: boolean;
}) => apiClient.post<SavedFunctionModule>('/admin/function-modules', payload).then((r) => r.data);
export const updateFunctionModule = (
  id: string,
  payload: Partial<{
    sapDestinationId: string;
    name: string;
    description: string;
    fmName: string;
    fmcallUrl: string;
    parameters: FunctionModuleParam[];
    isEnabled: boolean;
  }>,
) =>
  apiClient
    .patch<SavedFunctionModule>(`/admin/function-modules/${id}`, payload)
    .then((r) => r.data);
export const deleteFunctionModule = (id: string) =>
  apiClient.delete(`/admin/function-modules/${id}`);
export const discoverServices = (sapDestinationId: string) =>
  apiClient
    .get<DiscoveryResult>('/admin/function-modules/discover', { params: { sapDestinationId } })
    .then((r) => r.data);
