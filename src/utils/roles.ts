import { User } from '../types';

export type UserRole = NonNullable<User['role']>;

export const ROLE_LABELS: Record<UserRole, string> = {
  CLIENT: 'Pengguna',
  STAFF: 'Staf',
  COUNTER_STAFF: 'Staf Kaunter',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super Admin',
};

export const isAdminRole = (role?: User['role']) => role === 'ADMIN' || role === 'SUPER_ADMIN';

export const isSuperAdminRole = (role?: User['role']) => role === 'SUPER_ADMIN';

export const isStaffRole = (role?: User['role']) =>
  role === 'STAFF' || role === 'COUNTER_STAFF' || isAdminRole(role);

export const isBookingManagerRole = (role?: User['role']) =>
  role === 'COUNTER_STAFF' || isAdminRole(role);

export const canEditRole = (actorRole: User['role'] | undefined, target: User, actorUid?: string) => {
  if (!isAdminRole(actorRole) || !target.uid || target.uid === actorUid) return false;
  if (target.role === 'SUPER_ADMIN') return false;
  if (target.role === 'ADMIN' && !isSuperAdminRole(actorRole)) return false;
  return true;
};
