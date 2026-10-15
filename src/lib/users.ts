import { callFunction } from './callable';
import { UserRole } from '../utils/roles';
export type { UserRole } from '../utils/roles';

export interface UpdateUserRoleResult {
  success: true;
  uid: string;
  previousRole: UserRole;
  role: UserRole;
}

export const updateUserRole = async (uid: string, role: UserRole): Promise<UpdateUserRoleResult> => {
  return callFunction<{ uid: string; role: UserRole }, UpdateUserRoleResult>('updateUserRole', { uid, role });
};

export interface LegacyRoleChange {
  uid: string;
  name: string;
  email: string;
  /** Stored value ('' when the field is missing). */
  from: string;
  to: UserRole;
}

/** Admin-only: accounts whose stored role is missing or non-standard (no writes). */
export const previewLegacyRoles = async (): Promise<LegacyRoleChange[]> => {
  const data = await callFunction<{ dryRun: true }, { total: number; changes: LegacyRoleChange[] }>('backfillUserRoleClaims', { dryRun: true });
  return data.changes || [];
};

/** Admin-only: rewrite every role to its standard value and resync auth claims. */
export const fixLegacyRoles = async (): Promise<{ fixedRoles: number; failed: number }> => {
  return callFunction<Record<string, never>, { fixedRoles: number; failed: number }>('backfillUserRoleClaims', {});
};
