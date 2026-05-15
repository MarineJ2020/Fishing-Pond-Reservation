import React, { useState } from 'react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (email: string, pass: string) => Promise<boolean>;
  onRegister: (name: string, email: string, phone: string, pass: string) => Promise<boolean>;
  onGoogleLogin: () => Promise<boolean>;
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    <path fill="none" d="M0 0h48v48H0z"/>
  </svg>
);

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onLogin, onRegister, onGoogleLogin }) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPass, setRegPass] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    await onLogin(loginEmail, loginPass);
    setLoading(false);
  };

  const handleRegister = async () => {
    setLoading(true);
    const success = await onRegister(regName, regEmail, regPhone, regPass);
    setLoading(false);
    if (success) {
      setVerificationEmail(regEmail);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    await onGoogleLogin();
    setLoading(false);
  };

  const handleClose = () => {
    setVerificationEmail('');
    onClose();
  };

  if (!isOpen) return null;

  if (verificationEmail) {
    return (
      <div className="modal-overlay open">
        <div className="modal" style={{ maxWidth: '420px' }}>
          <div className="modal-header">
            <div className="modal-title">Semak Email Anda</div>
            <button className="modal-close" onClick={handleClose}>×</button>
          </div>
          <div className="modal-body" style={{ textAlign: 'center', padding: '32px 24px' }}>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>✉️</div>
            <p style={{ marginBottom: '8px' }}>Email pengesahan telah dihantar ke:</p>
            <strong style={{ wordBreak: 'break-all' }}>{verificationEmail}</strong>
            <p style={{ marginTop: '16px', color: '#888', fontSize: '14px', lineHeight: '1.5' }}>
              Sila semak inbox (dan folder spam) anda dan klik pautan pengesahan untuk mengaktifkan akaun anda.
            </p>
            <button className="form-submit" style={{ marginTop: '24px' }} onClick={handleClose}>
              Tutup
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ maxWidth: '420px' }}>
        <div className="modal-header">
          <div className="modal-title">Selamat Datang ke KKS</div>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>
        <div className="modal-tabs">
          <div className={`modal-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>Log Masuk</div>
          <div className={`modal-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>Daftar</div>
        </div>
        <div className="modal-body">
          <div className={`form-panel ${tab === 'login' ? 'active' : ''}`}>
            <button className="btn-google" onClick={handleGoogleLogin} disabled={loading}>
              <GoogleIcon />
              Teruskan dengan Google
            </button>
            <div className="divider"><hr /><span>atau</span><hr /></div>
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="you@example.com" />
            <label className="form-label">Password</label>
            <input type="password" className="form-input" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
            <button className="form-submit" onClick={handleLogin} disabled={loading}>Log Masuk</button>
            <div className="modal-switch">Belum ada akaun? <a onClick={() => setTab('register')}>Daftar sekarang</a></div>
          </div>
          <div className={`form-panel ${tab === 'register' ? 'active' : ''}`}>
            <button className="btn-google" onClick={handleGoogleLogin} disabled={loading}>
              <GoogleIcon />
              Daftar dengan Google
            </button>
            <div className="divider">atau</div>
            <label className="form-label">Nama Penuh</label>
            <input type="text" className="form-input" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Ahmad bin Abdullah" />
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="you@example.com" />
            <label className="form-label">Telefon</label>
            <input type="tel" className="form-input" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="+60 12-345 6789" />
            <label className="form-label">Password</label>
            <input type="password" className="form-input" value={regPass} onChange={(e) => setRegPass(e.target.value)} placeholder="Cipta kata laluan" />
            <button className="form-submit" onClick={handleRegister} disabled={loading}>Daftar Akaun</button>
            <div className="modal-switch">Sudah ada akaun? <a onClick={() => setTab('login')}>Log masuk</a></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
