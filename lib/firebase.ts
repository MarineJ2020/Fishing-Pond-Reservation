import { initializeApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  EmailAuthProvider,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import {
  getStorage,
  connectStorageEmulator,
} from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const googleProvider = new GoogleAuthProvider();
export const emailProvider = new EmailAuthProvider();

// Optional: Connect to emulators in development only when explicitly configured
const useEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';
if (useEmulator && typeof window !== 'undefined') {
  const isAuthEmulatorConnected = () => {
    try {
      return auth.emulatorConfig !== null;
    } catch {
      return false;
    }
  };

  const isFirestoreEmulatorConnected = () => {
    try {
      return (db as any)._host?.emulator !== undefined;
    } catch {
      return false;
    }
  };

  if (!isAuthEmulatorConnected()) {
    try {
      connectAuthEmulator(auth, 'http://localhost:9099', {
        disableWarnings: true,
      });
    } catch (error) {
      console.warn('Unable to connect Auth emulator:', error);
    }
  }

  if (!isFirestoreEmulatorConnected()) {
    try {
      connectFirestoreEmulator(db, 'localhost', 8080);
    } catch (error) {
      console.warn('Unable to connect Firestore emulator:', error);
    }
  }

  try {
    connectStorageEmulator(storage, 'localhost', 9199);
  } catch (error) {
    console.warn('Unable to connect Storage emulator:', error);
  }
}

export default app;
