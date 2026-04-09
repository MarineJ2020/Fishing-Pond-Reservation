import React from 'react';
const Hero = ({ ponds, bookings, onSectionChange }) => {
    const totalSeats = ponds.reduce((a, p) => a + p.seats.length, 0);
    const availSeats = ponds.reduce((a, p) => a + p.seats.filter(s => s.status === 'available').length, 0);
    const confirmedBookings = bookings.filter(b => b.status === 'confirmed').length;
    const scoredAnglers = Object.keys({}).length; // Placeholder, will be updated
    return (<div className="hero">
      <div className="hero-bg"></div>
      <div className="hero-water">
        <div className="wave"></div>
        <div className="wave wave2"></div>
      </div>
      <div className="about-visual pond-visual" style={{ position: 'absolute', right: '5%', top: '50%', transform: 'translateY(-50%)', opacity: 0.3 }}>
        <div className="logo-rings"></div>
        <div className="logo-rings"></div>
        <div className="logo-rings"></div>
        <div className="about-logo-img">KKS</div>
        <div className="fish fish-1">🐟</div>
        <div className="fish fish-2">🐠</div>
        <div className="fish fish-3">🐟</div>
      </div>
      <div className="hero-content">
        <div className="hero-eyebrow">🎣 Annual Fishing Competition 2026</div>
        <div className="hero-title">
          BOOK YOUR<br />
          <span>FISHING PEG</span>
        </div>
        <div className="hero-sub">
          Secure your spot at Malaysia's premier fishing competition. Choose your pond, pick your peg, and join the tournament.
        </div>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => onSectionChange('book')}>
            <i className="fa-solid fa-fish"></i> Book a Peg
          </button>
          <button className="btn btn-ghost btn-lg" onClick={() => onSectionChange('live')}>
            <i className="fa-solid fa-trophy"></i> Live Results
          </button>
        </div>
        <div className="hero-stats">
          <div>
            <div className="hero-stat-num">{ponds.length}</div>
            <div className="hero-stat-label">Fishing Ponds</div>
          </div>
          <div>
            <div className="hero-stat-num">{availSeats}</div>
            <div className="hero-stat-label">Pegs Available</div>
          </div>
          <div>
            <div className="hero-stat-num">{confirmedBookings}</div>
            <div className="hero-stat-label">Confirmed Bookings</div>
          </div>
          <div>
            <div className="hero-stat-num">{scoredAnglers}</div>
            <div className="hero-stat-label">Anglers Scored</div>
          </div>
        </div>
      </div>
    </div>);
};
export default Hero;
