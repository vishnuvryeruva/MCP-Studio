import { Permission } from '../enums/permission.enum';

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
}
