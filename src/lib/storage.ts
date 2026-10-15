import app from '../../lib/firebase';

// Firebase Storage (~60 KB min) is only needed when staff or customers upload a
// file, so it is loaded on first use instead of shipping in the main bundle.
let cached: Promise<typeof import('firebase/storage') & { storage: import('firebase/storage').FirebaseStorage }> | null = null;

export const loadStorage = () => {
  cached ??= import('firebase/storage').then((mod) => {
    const storage = mod.getStorage(app);
    if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
      try {
        mod.connectStorageEmulator(storage, 'localhost', 9199);
      } catch (error) {
        console.warn('Unable to connect Storage emulator:', error);
      }
    }
    return { ...mod, storage };
  });
  return cached;
};
