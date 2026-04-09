import React from 'react';
import { useUI } from '../context/UIContext';
const Toast = () => {
    const { toasts } = useUI();
    return (<div className="toast">
      {toasts.map(t => (<div key={t.id} className={`toast-item toast-${t.type}`}>
          <i className={`fa-solid fa-${t.type === 'success' ? 'check-circle' : t.type === 'error' ? 'xmark-circle' : 'info-circle'}`}></i> {t.message}
        </div>))}
    </div>);
};
export default Toast;
