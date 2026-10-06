import React from 'react';
import { useUI } from '../context/UIContext';

// Errors render as a solid banner at the top of the screen and stay until
// closed; success/info keep the small corner pop-up that fades out.
const Toast: React.FC = () => {
  const { toasts, removeToast } = useUI();
  const errors = toasts.filter(t => t.type === 'error');
  const others = toasts.filter(t => t.type !== 'error');

  return (
    <>
      {errors.length > 0 && (
        <div className="toast-errors" role="alert" aria-live="assertive">
          {errors.map(t => (
            <div key={t.id} className="toast-error-banner">
              <i className="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
              <span>{t.message}</span>
              <button type="button" onClick={() => removeToast(t.id)} aria-label="Tutup / Close">
                <i className="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="toast" aria-live="polite">
        {others.map(t => (
          <div key={t.id} className={`toast-item toast-${t.type}`}>
            <i className={`fa-solid fa-${t.type === 'success' ? 'check-circle' : 'info-circle'}`}></i> {t.message}
          </div>
        ))}
      </div>
    </>
  );
};

export default Toast;
