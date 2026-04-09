import React, { createContext, useContext, useState, useCallback } from 'react';
const UIContext = createContext(undefined);
export const UIProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const [authModalOpen, setAuthModalOpen] = useState(false);
    const [cmsModalOpen, setCMSModalOpen] = useState(false);
    const addToast = useCallback((message, type = 'info') => {
        const id = Date.now();
        const toast = { id, message, type };
        setToasts(prev => [...prev, toast]);
        setTimeout(() => removeToast(id), 3800);
    }, []);
    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);
    return (<UIContext.Provider value={{
            toasts,
            authModalOpen,
            cmsModalOpen,
            addToast,
            removeToast,
            setAuthModalOpen,
            setCMSModalOpen
        }}>
      {children}
    </UIContext.Provider>);
};
export const useUI = () => {
    const context = useContext(UIContext);
    if (!context) {
        throw new Error('useUI must be used within UIProvider');
    }
    return context;
};
