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
      <div className="modal" style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <div className="modal-title">Welcome to CastBook</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="auth-tabs">
            <div className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>Login</div>
            <div className={`auth-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>Register</div>
          </div>
          {tab === 'login' ? (
            <div id="auth-login">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
              <button className="btn btn-primary w-full btn-lg mt-3" onClick={handleLogin}>Login</button>
              <div style={{ fontSize: '11px', color: 'var(--muted)', textAlign: 'center', marginTop: '10px' }}>
                Demo: any email + any password
              </div>
            </div>
          ) : (
            <div id="auth-register">
              <label className="form-label">Full Name</label>
              <input
                type="text"
                className="form-input"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Ahmad bin Abdullah"
              />
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <label className="form-label">Phone</label>
              <input
                type="tel"
                className="form-input"
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value)}
                placeholder="+60 12-345 6789"
              />
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={regPass}
                onChange={(e) => setRegPass(e.target.value)}
                placeholder="Create password"
              />
              <button className="btn btn-primary w-full btn-lg mt-3" onClick={handleRegister}>Create Account</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthModal;