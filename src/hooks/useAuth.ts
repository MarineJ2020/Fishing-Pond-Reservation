import { useCallback } from 'react';
import { useBooking } from '../context/BookingContext';
import { useUI } from '../context/UIContext';
import { User } from '../types';

export const useAuth = () => {
  const { user, setUser, db, updateDB } = useBooking();
  const { addToast } = useUI();

  const login = useCallback((email: string, pass: string) => {
    if (!email || !pass) {
      addToast('Enter email and password', 'error');
      return false;
    }
    let foundUser = db.users.find(u => u.email === email && u.pass === pass);
    if (!foundUser) {
      foundUser = { email, name: email.split('@')[0], phone: '', pass };
      updateDB({ ...db, users: [...db.users, foundUser] });
    }
    setUser(foundUser);
    localStorage.setItem('cb_session', JSON.stringify(foundUser));
    addToast(`Welcome back, ${foundUser.name}!`, 'success');
    return true;
  }, [db, updateDB, setUser, addToast]);

  const register = useCallback((name: string, email: string, phone: string, pass: string) => {
    if (!name || !email || !pass) {
      addToast('Fill all required fields', 'error');
      return false;
    }
    if (db.users.find(u => u.email === email)) {
      addToast('Email already registered', 'error');
      return false;
    }
    const newUser: User = { email, name, phone, pass };
    updateDB({ ...db, users: [...db.users, newUser] });
    setUser(newUser);
    localStorage.setItem('cb_session', JSON.stringify(newUser));
    addToast(`Welcome, ${name}!`, 'success');
    return true;
  }, [db, updateDB, setUser, addToast]);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('cb_session');
    addToast('Logged out', 'info');
  }, [setUser, addToast]);

  return { user, login, register, logout, isAuthenticated: !!user };
};