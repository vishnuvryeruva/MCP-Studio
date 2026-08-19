import { Permission } from '../enums/permission.enum';
import type { LlmProviderName } from '../../llm/llm-provider.interface';

export interface JwtPayload {
  sub: string;
  organizationId: string;
  isOwner: boolean;
  permissions: Permission[];
}

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  isOwner: boolean;
  permissions: Permission[];
  llmProvider: LlmProviderName;
}
