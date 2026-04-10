import React, { useState } from 'react';
import { User } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (email: string, pass: string) => void;
  onRegister: (name: string, email: string, phone: string, pass: string) => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onLogin, onRegister }) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPass, setRegPass] = useState('');

  const handleLogin = () => {
    onLogin(loginEmail, loginPass);
  };

  const handleRegister = () => {
    onRegister(regName, regEmail, regPhone, regPass);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ maxWidth: '420px' }}>
        <div className="modal-header">
          <div className="modal-title">Selamat Datang ke KKS</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-tabs">
          <div className={`modal-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>Log Masuk</div>
          <div className={`modal-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>Daftar</div>
        </div>
        <div className="modal-body">
          <div className={`form-panel ${tab === 'login' ? 'active' : ''}`}>
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="you@example.com" />
            <label className="form-label">Password</label>
            <input type="password" className="form-input" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
            <button className="form-submit" onClick={handleLogin}>Log Masuk</button>
            <div className="divider">atau</div>
            <div className="modal-switch">Belum ada akaun? <a onClick={() => setTab('register')}>Daftar sekarang</a></div>
          </div>
          <div className={`form-panel ${tab === 'register' ? 'active' : ''}`}>
            <label className="form-label">Nama Penuh</label>
            <input type="text" className="form-input" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Ahmad bin Abdullah" />
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="you@example.com" />
            <label className="form-label">Telefon</label>
            <input type="tel" className="form-input" value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="+60 12-345 6789" />
            <label className="form-label">Password</label>
            <input type="password" className="form-input" value={regPass} onChange={(e) => setRegPass(e.target.value)} placeholder="Cipta kata laluan" />
            <button className="form-submit" onClick={handleRegister}>Daftar Akaun</button>
            <div className="divider">atau</div>
            <div className="modal-switch">Sudah ada akaun? <a onClick={() => setTab('login')}>Log masuk</a></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;