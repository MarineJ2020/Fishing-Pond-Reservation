import React from 'react';
const Navbar = ({ user, currentSection, onSectionChange, onOpenAuth, onOpenCMS, onLogout }) => {
    const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
    const navItems = [
        { label: 'Home', section: 'home' },
        { label: 'Tentang', section: 'about' },
        { label: 'Kolam', section: 'kolam' },
        { label: 'Event', section: 'event' },
        { label: 'Lokasi', section: 'lokasi' }
    ];
    return (<nav>
      <div className="nav-logo-wrap" onClick={() => onSectionChange('home')}>
        <div className="logo-icon">🎣</div>
        <div className="nav-brand">Kolam Keli Sayang <span>KKS — Alor Setar, Kedah</span></div>
      </div>
      <div className="nav-links" id="nav-links">
        {navItems.map(item => (<a key={item.section} data-s={item.section} className={currentSection === item.section ? 'active' : ''} onClick={() => { onSectionChange(item.section); setMobileMenuOpen(false); }}>
            {item.label}
          </a>))}
      </div>
      <button className="nav-hamburger" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
        <i className={`fa-solid fa-${mobileMenuOpen ? 'xmark' : 'bars'}`}></i>
      </button>
      <div className={`nav-actions ${mobileMenuOpen ? 'active' : ''}`}>
        <button className="nav-cta" onClick={() => { onSectionChange('book'); setMobileMenuOpen(false); }}>Tempah Slot</button>
        <button className="btn btn-outline btn-sm" onClick={() => { onSectionChange('live'); setMobileMenuOpen(false); }}>Live</button>
        {user ? (<>
            <button className="btn btn-outline btn-sm" onClick={() => { onSectionChange('mybookings'); setMobileMenuOpen(false); }}>My Bookings</button>
            <button className="btn btn-outline btn-sm" onClick={() => { onLogout(); setMobileMenuOpen(false); }}>Logout</button>
          </>) : (<button id="btn-login" className="btn btn-primary btn-sm" onClick={() => { onOpenAuth(); setMobileMenuOpen(false); }}>Login</button>)}
        <button className="btn staff-badge btn-sm" onClick={() => { onOpenCMS(); setMobileMenuOpen(false); }}>
          <i className="fa-solid fa-shield-halved" style={{ fontSize: '11px' }}></i> Staff
        </button>
      </div>
    </nav>);
};
export default Navbar;
