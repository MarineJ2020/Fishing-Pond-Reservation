import { useCallback, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import app, { auth, db as firestoreDb, googleProvider } from '../../lib/firebase';
import { useBooking } from '../context/BookingContext';
import { useUI } from '../context/UIContext';
import { queueWelcomeEmail } from '../lib/email';
import { User } from '../types';

// Our verification email is sent via the Zoho-backed Trigger Email extension,
// not Firebase's built-in sender. A callable Cloud Function generates the
// verification link (Admin SDK) and queues a branded mail doc.
const callRequestEmailVerification = async (): Promise<void> => {
  const fns = getFunctions(app);
  await httpsCallable(fns, 'requestEmailVerification')();
};

const mapFirebaseUser = async (firebaseUser: FirebaseUser | null): Promise<User | null> => {
  if (!firebaseUser || !firebaseUser.email) return null;

  const profileRef = doc(firestoreDb, 'users', firebaseUser.uid);
  const profileSnap = await getDoc(profileRef);
  const profileData = profileSnap.exists() ? profileSnap.data() : null;

  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    emailVerified: firebaseUser.emailVerified,
    name: profileData?.name || firebaseUser.displayName || firebaseUser.email.split('@')[0],
    phone: profileData?.phone || '',
    role: profileData?.role || 'CLIENT',
  };
};

export const useAuth = () => {
  const { setUser } = useBooking();
  const { addToast } = useUI();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const user = await mapFirebaseUser(firebaseUser);
      setUser(user);
      if (!firebaseUser) {
        localStorage.removeItem('cb_session');
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, [setUser]);

  const login = useCallback(async (email: string, pass: string) => {
    if (!email || !pass) {
      addToast('Enter email and password', 'error');
      return false;
    }

    try {
      await signInWithEmailAndPassword(auth, email, pass);
      addToast('Logged in successfully', 'success');
      return true;
    } catch (error) {
      console.error(error);
      addToast('Login failed. Check your email and password.', 'error');
      return false;
    }
  }, [addToast]);

  const register = useCallback(async (name: string, email: string, phone: string, pass: string) => {
    if (!name || !email || !pass) {
      addToast('Fill all required fields', 'error');
      return false;
    }

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, pass);
      const user = credential.user;
      await setDoc(doc(firestoreDb, 'users', user.uid), {
        email,
        name,
        phone,
        role: 'CLIENT',
        createdAt: new Date(),
      });
      try {
        await callRequestEmailVerification();
      } catch (verErr) {
        // The account is created regardless; only the email send failed.
        console.error('Failed to send verification email:', verErr);
        addToast('Akaun dibuat, tetapi email pengesahan gagal dihantar. Cuba "Hantar semula".', 'info');
        return true;
      }
      addToast(`Akaun dibuat! Semak email anda untuk pengesahan.`, 'success');
      return true;
    } catch (error) {
      console.error(error);
      addToast('Registration failed. Please try again.', 'error');
      return false;
    }
  }, [addToast]);

  const signInWithGoogle = useCallback(async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const userDocRef = doc(firestoreDb, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          email: user.email,
          name: user.displayName || '',
          phone: '',
          role: 'CLIENT',
          createdAt: new Date(),
        });
        // First-time Google sign-up — send a branded welcome email via Zoho.
        if (user.email) {
          await queueWelcomeEmail({
            to: user.email,
            name: user.displayName || user.email.split('@')[0],
          });
        }
      }
      addToast('Log masuk berjaya!', 'success');
      return true;
    } catch (error) {
      console.error(error);
      addToast('Google sign-in failed. Please try again.', 'error');
      return false;
    }
  }, [addToast]);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      setUser(null);
      addToast('Logged out', 'info');
    } catch (error) {
      console.error(error);
      addToast('Unable to log out.', 'error');
    }
  }, [setUser, addToast]);

  const resendVerification = useCallback(async () => {
    if (!auth.currentUser) {
      addToast('Sila log masuk dahulu.', 'error');
      return false;
    }
    try {
      await callRequestEmailVerification();
      addToast('Email pengesahan telah dihantar semula. Semak inbox anda.', 'success');
      return true;
    } catch (error) {
      console.error(error);
      addToast('Gagal menghantar email pengesahan. Cuba sebentar lagi.', 'error');
      return false;
    }
  }, [addToast]);

  // After the user clicks the verification link in their email, the current
  // session's token still says unverified until refreshed. Reload and re-map.
  const refreshUser = useCallback(async () => {
    if (!auth.currentUser) return false;
    try {
      await auth.currentUser.reload();
      const refreshed = await mapFirebaseUser(auth.currentUser);
      setUser(refreshed);
      if (refreshed?.emailVerified) {
        addToast('Email anda telah disahkan!', 'success');
        return true;
      }
      addToast('Email belum disahkan. Sila klik pautan dalam email anda.', 'info');
      return false;
    } catch (error) {
      console.error(error);
      addToast('Gagal menyemak status pengesahan.', 'error');
      return false;
    }
  }, [setUser, addToast]);

  return { login, register, signInWithGoogle, logout, resendVerification, refreshUser, authReady };
};