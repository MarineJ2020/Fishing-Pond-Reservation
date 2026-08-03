import { useCallback, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import app, { auth, db as firestoreDb, googleProvider } from '../../lib/firebase';
import { useBooking } from '../context/BookingContext';
import { useUI } from '../context/UIContext';
import { requestWelcomeEmail } from '../lib/email';
import { trackEvent } from '../utils/analytics';
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
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        localStorage.removeItem('cb_session');
        setUser(null);
        setAuthReady(true);
        return;
      }
      // Show basic identity immediately instead of blocking authReady on the
      // Firestore profile getDoc — role defaults to 'CLIENT' (fail-safe: an
      // ADMIN/STAFF-only UI just appears a beat later once the real role loads).
      if (firebaseUser.email) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          emailVerified: firebaseUser.emailVerified,
          name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
          phone: '',
          role: 'CLIENT',
        });
      }
      setAuthReady(true);
      mapFirebaseUser(firebaseUser).then((full) => {
        if (full) setUser(full);
      });
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
      trackEvent('login', { method: 'password' });
      addToast('Logged in successfully', 'success');
      return true;
    } catch (error) {
      console.error(error);
      addToast('Login failed. Check your email and password.', 'error');
      return false;
    }
  }, [addToast]);

  const resetPassword = useCallback(async (email: string) => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      addToast('Masukkan email berdaftar anda dahulu.', 'error');
      return false;
    }
    try {
      const methods = await fetchSignInMethodsForEmail(auth, normalizedEmail);
      if (methods.includes('google.com') && !methods.includes('password')) {
        return 'google' as const;
      }
      await sendPasswordResetEmail(auth, normalizedEmail);
      addToast('Pautan reset kata laluan telah dihantar. Sila semak email anda.', 'success');
      return 'sent' as const;
    } catch (error) {
      console.error(error);
      // Keep the response neutral so the login form does not reveal whether an
      // email address is registered.
      addToast('Jika email itu berdaftar, pautan reset akan dihantar sebentar lagi.', 'info');
      return 'neutral' as const;
    }
  }, [addToast]);

  const register = useCallback(async (name: string, email: string, phone: string, pass: string) => {
    if (!name || !email || !phone || !pass) {
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
        trackEvent('sign_up', { method: 'password' });
        return true;
      }
      addToast(`Akaun dibuat! Semak email anda untuk pengesahan.`, 'success');
      trackEvent('sign_up', { method: 'password' });
      return true;
    } catch (error) {
      console.error(error);
      addToast('Registration failed. Please try again.', 'error');
      return false;
    }
  }, [addToast]);

  // Returns needsPhone=true on a brand-new Google account — Google never
  // collects a phone number, so the caller should immediately prompt for one
  // (see CompleteProfileModal) to keep "phone required at signup" true for
  // both signup paths without touching this account-creation write.
  const signInWithGoogle = useCallback(async (): Promise<{ success: boolean; needsPhone?: boolean }> => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const userDocRef = doc(firestoreDb, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);
      let needsPhone = false;
      if (!userDoc.exists()) {
        await setDoc(userDocRef, {
          email: user.email,
          name: user.displayName || '',
          phone: '',
          role: 'CLIENT',
          createdAt: new Date(),
        });
        needsPhone = true;
        // First-time Google sign-up — send a branded welcome email via Zoho.
        if (user.email) {
          try {
            await requestWelcomeEmail();
          } catch (emailError) {
            console.error('Failed to request welcome email:', emailError);
            addToast('Akaun dibuat, tetapi email alu-aluan belum dapat dijadualkan.', 'info');
          }
        }
      }
      trackEvent(needsPhone ? 'sign_up' : 'login', { method: 'google' });
      addToast('Log masuk berjaya!', 'success');
      return { success: true, needsPhone };
    } catch (error) {
      console.error(error);
      addToast('Google sign-in failed. Please try again.', 'error');
      return { success: false };
    }
  }, [addToast]);

  const updateUserProfile = useCallback(async (name: string, phone: string) => {
    if (!auth.currentUser) {
      addToast('Sila log masuk dahulu.', 'error');
      return false;
    }
    if (!name.trim() || !phone.trim()) {
      addToast('Nama dan nombor telefon diperlukan.', 'error');
      return false;
    }
    try {
      await setDoc(doc(firestoreDb, 'users', auth.currentUser.uid), {
        name: name.trim(),
        phone: phone.trim(),
        updatedAt: new Date(),
      }, { merge: true });
      const refreshed = await mapFirebaseUser(auth.currentUser);
      setUser(refreshed);
      addToast('Profil dikemaskini.', 'success');
      return true;
    } catch (error) {
      console.error(error);
      addToast('Gagal mengemaskini profil.', 'error');
      return false;
    }
  }, [setUser, addToast]);

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

  return { login, resetPassword, register, signInWithGoogle, logout, resendVerification, refreshUser, updateUserProfile, authReady };
};
