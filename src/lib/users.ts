import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { FUNCTIONS_REGION } from '../../lib/firebase';
import { UserRole } from '../utils/roles';
export type { UserRole } from '../utils/roles';

export interface UpdateUserRoleResult {
  success: true;
  uid: string;
  previousRole: UserRole;
  role: UserRole;
}

const functions = getFunctions(app, FUNCTIONS_REGION);

export const updateUserRole = async (uid: string, role: UserRole): Promise<UpdateUserRoleResult> => {
  const callable = httpsCallable<{ uid: string; role: UserRole }, UpdateUserRoleResult>(functions, 'updateUserRole');
  const result = await callable({ uid, role });
  return result.data;
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
  const callable = httpsCallable<{ dryRun: true }, { total: number; changes: LegacyRoleChange[] }>(functions, 'backfillUserRoleClaims');
  return (await callable({ dryRun: true })).data.changes || [];
};

/** Admin-only: rewrite every role to its standard value and resync auth claims. */
export const fixLegacyRoles = async (): Promise<{ fixedRoles: number; failed: number }> => {
  const callable = httpsCallable<Record<string, never>, { fixedRoles: number; failed: number }>(functions, 'backfillUserRoleClaims');
  return (await callable({})).data;
};
