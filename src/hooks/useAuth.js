import { useCallback, useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db as firestoreDb } from '../../lib/firebase';
import { useBooking } from '../context/BookingContext';
import { useUI } from '../context/UIContext';
const mapFirebaseUser = async (firebaseUser) => {
    if (!firebaseUser || !firebaseUser.email)
        return null;
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
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    useEffect(() => {
        let isMounted = true;
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (isMounted) {
                const user = await mapFirebaseUser(firebaseUser);
                setUser(user);
                setIsAuthLoading(false);
                if (!firebaseUser) {
                    localStorage.removeItem('cb_session');
                }
            }
        });
        return () => { isMounted = false; unsubscribe(); };
    }, [setUser]);
    const login = useCallback(async (email, pass) => {
        if (!email || !pass) {
            addToast('Enter email and password', 'error');
            return false;
        }
        try {
            await signInWithEmailAndPassword(auth, email, pass);
            addToast('Logged in successfully', 'success');
            return true;
        }
        catch (error) {
            console.error(error);
            addToast('Login failed. Check your email and password.', 'error');
            return false;
        }
    }, [addToast]);
    const register = useCallback(async (name, email, phone, pass) => {
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
            addToast(`Welcome, ${name}!`, 'success');
            return true;
        }
        catch (error) {
            console.error(error);
            addToast('Registration failed. Please try again.', 'error');
            return false;
        }
    }, [addToast]);
    const logout = useCallback(async () => {
        try {
            await signOut(auth);
            setUser(null);
            addToast('Logged out', 'info');
        }
        catch (error) {
            console.error(error);
            addToast('Unable to log out.', 'error');
        }
    }, [setUser, addToast]);
    return { login, register, logout, isAuthLoading };
};
