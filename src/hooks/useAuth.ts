import { useCallback, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendEmailVerification,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db as firestoreDb, googleProvider } from '../../lib/firebase';
import { useBooking } from '../context/BookingContext';
import { useUI } from '../context/UIContext';
import { User } from '../types';

const mapFirebaseUser = async (firebaseUser: FirebaseUser | null): Promise<User | null> => {
  if (!firebaseUser || !firebaseUser.email) return null;

  const profileRef = doc(firestoreDb, 'users', firebaseUser.uid);
  const profileSnap = await getDoc(profileRef);
  const profileData = profileSnap.exists() ? profileSnap.data() : null;

  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
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
      await sendEmailVerification(user);
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

  return { login, register, signInWithGoogle, logout, authReady };
};