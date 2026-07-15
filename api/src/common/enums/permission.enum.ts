export enum Permission {
  MANAGE_ROLES = 'manage_roles',
  MANAGE_USERS = 'manage_users',
  MANAGE_SAP_DESTINATIONS = 'manage_sap_destinations',
  MANAGE_FUNCTION_MODULES = 'manage_function_modules',
}

export const ALL_PERMISSIONS: Permission[] = Object.values(Permission);
