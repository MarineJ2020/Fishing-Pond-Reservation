import React from 'react';
import { User } from '../types';

interface NavbarProps {
  user: User | null;
  currentSection: string;
  onSectionChange: (section: string) => void;
  onOpenAuth: () => void;
  onOpenCMS: () => void;
  onLogout: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ user, currentSection, onSectionChange, onOpenAuth, onOpenCMS, onLogout }) => {
  const navItems = [
    { label: 'Home', section: 'home' },
    { label: 'Book a Peg', section: 'book' },
    ...(user ? [{ label: 'My Bookings', section: 'mybookings' }] : []),
    { label: '🔴 Live', section: 'live' }
  ];

  return (
    <nav>
      <div className="nav-brand" onClick={() => onSectionChange('home')}>
        <div className="logo-icon">🎣</div>
        <span className="logo-text">CastBook</span>
      </div>
      <div className="nav-links" id="nav-links">
        {navItems.map(item => (
          <a
            key={item.section}
            data-s={item.section}
            className={currentSection === item.section ? 'active' : ''}
            onClick={() => onSectionChange(item.section)}
          >
            {item.label}
          </a>
        ))}
      </div>
      <div className="nav-actions">
        <button className="btn live-pulse btn-sm" onClick={() => onSectionChange('live')}>
          <span className="live-dot"></span> LIVE
        </button>
        <button className="btn staff-badge btn-sm" onClick={onOpenCMS}>
          <i className="fa-solid fa-shield-halved" style={{ fontSize: '11px' }}></i> Staff
        </button>
        {user ? (
          <div id="user-chip" className="user-chip">
            <div className="user-avatar">{user.name.charAt(0).toUpperCase()}</div>
            <span style={{ fontSize: '12px', fontWeight: 600 }}>{user.name}</span>
            <span style={{ color: 'var(--muted)', fontSize: '11px', marginLeft: '4px', cursor: 'pointer' }} onClick={onLogout} title="Logout">
              <i className="fa-solid fa-right-from-bracket"></i>
            </span>
          </div>
        ) : (
          <button id="btn-login" className="btn btn-primary btn-sm" onClick={onOpenAuth}>Login</button>
        )}
      </div>
    </nav>
  );
};

export default Navbar;