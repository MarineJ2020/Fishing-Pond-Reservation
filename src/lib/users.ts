import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../../lib/firebase';
import { User } from '../types';

export type UserRole = NonNullable<User['role']>;

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
