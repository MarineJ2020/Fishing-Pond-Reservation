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
    { label: 'Tentang', section: 'about' },
    { label: 'Kolam', section: 'kolam' },
    { label: 'Event', section: 'event' },
    { label: 'Lokasi', section: 'lokasi' }
  ];

  return (
    <nav>
      <div className="nav-logo-wrap" onClick={() => onSectionChange('home')}>
        <div className="logo-icon">🎣</div>
        <div className="nav-brand">Kolam Keli Sayang <span>KKS — Alor Setar, Kedah</span></div>
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
        <button className="nav-cta" onClick={() => onSectionChange('book')}>Tempah Slot</button>
        <button className="btn btn-outline btn-sm" onClick={() => onSectionChange('live')}>Live</button>
        {user ? (
          <>
            <button className="btn btn-outline btn-sm" onClick={() => onSectionChange('mybookings')}>My Bookings</button>
            <button className="btn btn-outline btn-sm" onClick={onLogout}>Logout</button>
          </>
        ) : (
          <button id="btn-login" className="btn btn-primary btn-sm" onClick={onOpenAuth}>Login</button>
        )}
        <button className="btn staff-badge btn-sm" onClick={onOpenCMS}>
          <i className="fa-solid fa-shield-halved" style={{ fontSize: '11px' }}></i> Staff
        </button>
      </div>
    </nav>
  );
};

export default Navbar;