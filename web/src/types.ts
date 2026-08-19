export type Permission =
  | 'manage_roles'
  | 'manage_users'
  | 'manage_sap_destinations'
  | 'manage_function_modules';

export interface Role {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  isOwner: boolean;
  roleId: string | null;
  isActive: boolean;
  role: Role | null;
  createdAt: string;
  updatedAt: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  isOwner: boolean;
  organizationId: string;
  isActive: boolean;
  llmProvider: 'anthropic' | 'openai' | 'gemini';
  role: { id: string; name: string; permissions: Permission[] } | null;
  permissions: Permission[];
}

export interface SapDestination {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  url: string;
  cloudConnectorLocationId: string | null;
  isActive: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FunctionModuleParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  description?: string;
}

export interface FunctionModule {
  id: string;
  organizationId: string;
  sapDestinationId: string;
  name: string;
  description: string;
  fmName: string;
  fmcallUrl: string;
  parameters: FunctionModuleParam[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredService {
  id: string;
  title: string;
  description: string;
  servicePath: string;
  metadataPath: string;
  technicalName: string;
  version: string;
}

export interface DiscoveryResult {
  services: DiscoveredService[];
  catalogPath: string | null;
  message: string;
}

export interface ChatToolInvocation {
  toolName: string;
  fmName: string;
  arguments: Record<string, unknown>;
  success: boolean;
  statusCode: number | null;
  durationMs: number;
  message: string;
}

export interface ChatTurnResult {
  reply: string;
  provider: string;
  model: string;
  toolInvocations: ChatToolInvocation[];
  availableToolCount: number;
}

export interface LlmProviderInfo {
  name: 'anthropic' | 'openai' | 'gemini';
  model: string;
  configured: boolean;
  active: boolean;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: string;
  user: {
    id: string;
    name: string;
    email: string;
    isOwner: boolean;
    organizationId: string;
    llmProvider: 'anthropic' | 'openai' | 'gemini';
    role: { id: string; name: string; permissions: Permission[] } | null;
  };
}
