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

// 'direct_fmcall' calls the ABAP fmcall service through the Cloud Connector with a
// backend SAP user. 'cap_facade' posts to a generic CAP service that does the fmcall
// on our behalf, authenticated with XSUAA client credentials.
export type DestinationTransport = 'direct_fmcall' | 'cap_facade';

export interface SapDestination {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  transport: DestinationTransport;
  url: string;
  cloudConnectorLocationId: string | null;
  capExecutePath: string | null;
  capTokenUrl: string | null;
  // The client secret is never returned by the API.
  capClientId: string | null;
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
  // Null for modules behind a CAP facade, which are addressed by fmName alone.
  fmcallUrl: string | null;
  parameters: FunctionModuleParam[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Another whitelist entry that reads so similarly to the one just saved that the
// model has no reliable basis for choosing between them.
export interface OverlapWarning {
  functionModuleId: string;
  name: string;
  fmName: string;
  isEnabled: boolean;
  // Cosine similarity of the two tool descriptions, 0–1.
  score: number;
}

export interface SavedFunctionModule extends FunctionModule {
  overlapWarnings: OverlapWarning[];
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
  // The subset of the whitelist actually offered to the model for this question.
  advertisedToolCount: number;
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
