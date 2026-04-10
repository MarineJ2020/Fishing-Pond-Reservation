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
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { label: 'Tentang Kami', section: 'about' },
    { label: 'Pertandingan', section: 'competitions' },
    { label: 'Kolam', section: 'kolam' },
    { label: 'Hadiah', section: 'prizes' },
    { label: 'Hubungi', section: 'contact' },
  ];

  const handleNavClick = (section: string) => {
    onSectionChange(section);
    setMenuOpen(false);
  };

  const handleAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return (
    <>
      <nav>
        <div className="nav-logo" onClick={() => handleNavClick('home')}>
          KKS <span>Fishing</span>
        </div>

        <ul className="nav-links">
          {navItems.map(item => (
            <li key={item.section}>
              <a onClick={() => handleNavClick(item.section)}>{item.label}</a>
            </li>
          ))}
          <li>
            <a className="nav-btn" onClick={() => handleAction(() => onSectionChange('book'))}>Tempah Sekarang</a>
          </li>
        </ul>

        <div className="nav-hamburger" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">
          <span></span><span></span><span></span>
        </div>
      </nav>

      <div className={`mobile-menu ${menuOpen ? 'open' : ''}`}>
        <a onClick={() => handleAction(() => onSectionChange('live'))}>🔴 Live Results</a>
        {user ? (
          <>
            <a onClick={() => handleAction(() => onSectionChange('mybookings'))}>📋 My Bookings</a>
            <a onClick={() => handleAction(onLogout)}>🚪 Logout</a>
            {user.role === 'ADMIN' && (
              <a onClick={() => handleAction(onOpenCMS)}>🛡️ Staff CMS</a>
            )}
          </>
        ) : (
          <a onClick={() => handleAction(onOpenAuth)}>🔐 Login / Daftar</a>
        )}
      </div>
    </>
  );
};

export default Navbar;