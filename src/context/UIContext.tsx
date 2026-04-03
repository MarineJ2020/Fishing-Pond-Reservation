import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { Toast } from '../types';

interface UIContextType {
  toasts: Toast[];
  authModalOpen: boolean;
  cmsModalOpen: boolean;
  
  // Actions
  addToast: (message: string, type: 'success' | 'error' | 'info') => void;
  removeToast: (id: number) => void;
  setAuthModalOpen: (open: boolean) => void;
  setCMSModalOpen: (open: boolean) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [cmsModalOpen, setCMSModalOpen] = useState(false);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    const toast: Toast = { id, message, type };
    setToasts(prev => [...prev, toast]);
    setTimeout(() => removeToast(id), 3800);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <UIContext.Provider
      value={{
        toasts,
        authModalOpen,
        cmsModalOpen,
        addToast,
        removeToast,
        setAuthModalOpen,
        setCMSModalOpen
      }}
    >
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUI must be used within UIProvider');
  }
  return context;
};