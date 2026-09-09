import React, { useEffect, useRef, useState } from 'react';
import { Settings, User } from '../types';
import { asset } from '../config/landingAssets';

interface NavbarProps {
  user: User | null;
  authReady: boolean;
  currentSection: string;
  onSectionChange: (section: string) => void;
  onOpenAuth: () => void;
  onOpenCMS: () => void;
  onLogout: () => void;
  /** Number of the user's bookings with an outstanding balance (drives the red dot). */
  outstandingCount?: number;
  settings?: Settings;
}

const sectionHref = (section: string): string => {
  if (section === 'home') return '/';
  if (section === 'lokasi') return '/#lokasi';
  if (section === 'live') return '/live';
  if (section === 'book') return '/book';
  if (section === 'mybookings') return '/my-bookings';
  if (section === 'profile') return '/profile';
  if (section === 'cms') return '/cms';
  return `/${section}`;
};

const Navbar: React.FC<NavbarProps> = ({ user, authReady, onSectionChange, onOpenAuth, onOpenCMS, onLogout, outstandingCount = 0, settings }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const handleNav = (event: React.MouseEvent<HTMLAnchorElement>, section: string) => {
    setMenuOpen(false);
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSectionChange(section);
  };

  const handleAction = (fn: () => void) => {
    fn();
    setMenuOpen(false);
  };

  return (
    <header className="kks-header">
      <div className="kks-nav-container">
        <a className="kks-nav-logo" href={sectionHref('home')} onClick={(event) => handleNav(event, 'home')} aria-label="Kolam Keli Sayang">
          <img src={asset('logo', settings)} alt="Kolam Keli Sayang" />
        </a>

        <nav className="kks-nav-links" aria-label="Navigasi utama">
          <a href={sectionHref('lokasi')} onClick={(event) => handleNav(event, 'lokasi')}>Lokasi</a>
          <a href={sectionHref('live')} onClick={(event) => handleNav(event, 'live')}>Keputusan Pertandingan</a>
          <a href={sectionHref('book')} onClick={(event) => handleNav(event, 'book')}>Tempah Sekarang</a>
        </nav>

        <div className="kks-nav-actions">
          {!authReady ? (
            <span className="kks-nav-greet" aria-hidden="true">&nbsp;</span>
          ) : user ? (
            <span className="kks-nav-greet">Hi, {user.name.split(' ')[0]}</span>
          ) : (
            <a className="btn btn-navy" onClick={onOpenAuth}>Log Masuk / Daftar</a>
          )}
          <button
            className={`kks-hamburger${menuOpen ? ' is-open' : ''}`}
            onClick={() => setMenuOpen(o => !o)}
            aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={menuOpen}
            style={{ position: 'relative' }}
          >
            <span></span><span></span><span></span>
            {!menuOpen && user && outstandingCount > 0 && (
              <span
                aria-label={`${outstandingCount} tempahan menunggu baki`}
                style={{ position: 'absolute', top: '-3px', right: '-3px', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--red)', border: '2px solid #fff' }}
              />
            )}
          </button>
        </div>
      </div>

      <div ref={menuRef} className={`kks-menu-drop${menuOpen ? ' open' : ''}`}>
        <a href={sectionHref('home')} onClick={(event) => handleNav(event, 'home')}><i className="fa-solid fa-house"></i> Utama</a>
        <a href={sectionHref('lokasi')} onClick={(event) => handleNav(event, 'lokasi')}><i className="fa-solid fa-location-dot"></i> Lokasi</a>
        <a href={sectionHref('live')} onClick={(event) => handleNav(event, 'live')}><i className="fa-solid fa-bolt"></i> Keputusan / Live</a>
        <a href={sectionHref('book')} onClick={(event) => handleNav(event, 'book')}><i className="fa-solid fa-ticket"></i> Tempah Sekarang</a>
        <hr />
        {!authReady ? null : user ? (
          <>
            <a href={sectionHref('mybookings')} onClick={(event) => handleNav(event, 'mybookings')}>
              <i className="fa-solid fa-clipboard-list"></i> Tempahan Saya
              {outstandingCount > 0 && (
                <span style={{ marginLeft: '8px', background: 'var(--red)', color: '#fff', fontSize: '11px', fontWeight: 700, borderRadius: '999px', padding: '1px 8px' }}>
                  {outstandingCount} baki
                </span>
              )}
            </a>
            <a href={sectionHref('profile')} onClick={(event) => handleNav(event, 'profile')}><i className="fa-solid fa-user"></i> Profil Saya</a>
            {(user.role === 'ADMIN' || user.role === 'STAFF') && (
              <a href={sectionHref('cms')} onClick={(event) => {
                setMenuOpen(false);
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onOpenCMS();
              }}><i className="fa-solid fa-shield-halved"></i> Staff CMS</a>
            )}
            <a onClick={() => handleAction(onLogout)}><i className="fa-solid fa-right-from-bracket"></i> Log Keluar</a>
          </>
        ) : (
          <a onClick={() => handleAction(onOpenAuth)}><i className="fa-solid fa-right-to-bracket"></i> Log Masuk / Daftar</a>
        )}
      </div>
    </header>
  );
};

export default Navbar;
