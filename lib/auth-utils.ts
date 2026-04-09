import { adminAuth, adminDb } from './firebase-admin';
import { hash, compare } from 'bcryptjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

/**
 * Verify ID token from cookies/headers and return decoded token
 */
export async function verifyIdToken(token: string) {
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

/**
 * Get user from request (from Authorization header or cookies)
 */
export async function getUserFromRequest(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');

  if (!token) {
    return null;
  }

  return verifyIdToken(token);
}

/**
 * Get current user from cookies (for Server Components)
 */
export async function getCurrentUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('idToken')?.value;

    if (!token) {
      return null;
    }

    return verifyIdToken(token);
  } catch (error) {
    console.error('Failed to get current user:', error);
    return null;
  }
}

/**
 * Require authentication - throw error if user not found
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

/**
 * Get user document from Firestore
 */
export async function getUserDoc(uid: string) {
  try {
    const doc = await adminDb.collection('users').doc(uid).get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error('Failed to get user doc:', error);
    return null;
  }
}

/**
 * Require staff role
 */
export async function requireStaff() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const userDoc = await getUserDoc(user.uid);
  const role = userDoc?.role || user.custom_claims?.role;

  if (role !== 'STAFF' && role !== 'ADMIN') {
    throw new Error('Forbidden: Staff access required');
  }

  return user;
}

/**
 * Require admin role
 */
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const userDoc = await getUserDoc(user.uid);
  const role = userDoc?.role || user.custom_claims?.role;

  if (role !== 'ADMIN') {
    throw new Error('Forbidden: Admin access required');
  }

  return user;
}

/**
 * Hash password with bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = 10;
  return hash(password, salt);
}

/**
 * Verify password with bcrypt
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return compare(password, hashedPassword);
}

/**
 * Set custom claims on user (requires Admin SDK)
 */
export async function setUserRole(uid: string, role: 'CLIENT' | 'STAFF' | 'ADMIN') {
  try {
    await adminAuth.setCustomUserClaims(uid, { role });
    return true;
  } catch (error) {
    console.error('Failed to set user role:', error);
    return false;
  }
}

/**
 * Create user document in Firestore
 */
export async function createUserDoc(
  uid: string,
  data: {
    email: string;
    name: string;
    role: 'CLIENT' | 'STAFF' | 'ADMIN';
    image?: string;
  }
) {
  try {
    await adminDb.collection('users').doc(uid).set({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return true;
  } catch (error) {
    console.error('Failed to create user doc:', error);
    return false;
  }
}
