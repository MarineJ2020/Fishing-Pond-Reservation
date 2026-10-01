import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../../lib/firebase';
import { UserRole } from '../utils/roles';
export type { UserRole } from '../utils/roles';

export interface UpdateUserRoleResult {
  success: true;
  uid: string;
  previousRole: UserRole;
  role: UserRole;
}

const functions = getFunctions(app);

export const updateUserRole = async (uid: string, role: UserRole): Promise<UpdateUserRoleResult> => {
  const callable = httpsCallable<{ uid: string; role: UserRole }, UpdateUserRoleResult>(functions, 'updateUserRole');
  const result = await callable({ uid, role });
  return result.data;
};
