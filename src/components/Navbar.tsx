import React, { useState } from 'react';
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
  const [navOpen, setNavOpen] = useState(false);

  const navItems = [
    { label: 'Home', section: 'home' },
    { label: 'Tentang', section: 'about' },
    { label: 'Kolam', section: 'kolam' },
    { label: 'Event', section: 'event' },
    { label: 'Lokasi', section: 'lokasi' }
  ];

  const handleNavClick = (section: string) => {
    onSectionChange(section);
    setNavOpen(false);
  };

  const handleAction = (action: () => void) => {
    action();
    setNavOpen(false);
  };

  return (
    <nav>
      <div className="nav-logo-wrap" onClick={() => handleNavClick('home')}>
        <div className="logo-icon">🎣</div>
        <div className="nav-brand">Kolam Keli Sayang <span>KKS — Alor Setar, Kedah</span></div>
      </div>

      <div className="nav-links">
        {navItems.map(item => (
          <a
            key={item.section}
            data-s={item.section}
            className={currentSection === item.section ? 'active' : ''}
            onClick={() => handleNavClick(item.section)}
          >
            {item.label}
          </a>
        ))}
      </div>

      <div className={`nav-dropdown ${navOpen ? 'active' : ''}`}>
        <div className="nav-dropdown-divider"></div>
        <div className="nav-dropdown-actions">
          <button className="nav-cta" onClick={() => handleAction(() => onSectionChange('book'))}>
            📍 Tempah Slot
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => handleAction(() => onSectionChange('live'))}>
            🔴 Live
          </button>
          {user ? (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => handleAction(() => onSectionChange('mybookings'))}>
                📋 My Bookings
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => handleAction(onLogout)}>
                🚪 Logout
              </button>
            </>
          ) : (
            <button id="btn-login" className="btn btn-primary btn-sm" onClick={() => handleAction(onOpenAuth)}>
              🔐 Login
            </button>
          )}
          <button className="btn staff-badge btn-sm" onClick={() => handleAction(onOpenCMS)} title="Staff Control Panel">
            🛡️ Staff
          </button>
        </div>
      </div>

      <button 
        className="nav-hamburger" 
        onClick={() => setNavOpen(!navOpen)} 
        title={navOpen ? 'Tutup Menu' : 'Buka Menu'}
        aria-label="Toggle navigation"
      >
        {navOpen ? '✕' : '☰'}
      </button>
    </nav>
  );
};

export default Navbar;