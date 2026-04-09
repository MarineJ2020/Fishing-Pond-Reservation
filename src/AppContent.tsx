import React, { useEffect, useMemo, useState } from 'react';
import './styles.css';
import Navbar from './components/Navbar';
import BookingSidebar from './components/BookingSidebar';
import SeatMap from './components/SeatMap';
import BookingForm from './components/BookingForm';
import LiveResults from './components/LiveResults';
import AuthModal from './components/AuthModal';
import CMSModal from './components/CMSModal';
import BookingDetailsModal from './components/BookingDetailsModal';
import Toast from './components/Toast';
import { useBooking } from './context/BookingContext';
import { useUI } from './context/UIContext';
import { useNavigation } from './hooks/useNavigation';
import { useAuth } from './hooks/useAuth';
import { fmt } from './utils';
import { Booking } from './types';

const AppContent: React.FC = () => {
  const {
    db,
    selectedPond,
    selectedSeats,
    payType,
    receiptData,
    user,
    setPond,
    toggleSeat,
    setPayType,
    setReceiptData,
    submitBooking,
    updateDB,
    reloadDB
  } = useBooking();
  const { addToast, setAuthModalOpen, authModalOpen, cmsModalOpen, setCMSModalOpen } = useUI();
  const { currentSection, goToSection, goToBook, goHome, goToLive, goToMyBookings, goToConfirmed } = useNavigation();
  const { login, register, logout, authReady } = useAuth();

  const [homeScrollTarget, setHomeScrollTarget] = useState<string | null>(null);
  const [countdown, setCountdown] = useState({ days: '--', hours: '--', mins: '--', secs: '--', status: 'upcoming' });
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(false);

  const availablePegs = useMemo(
    () => db.ponds.reduce((sum, pond) => sum + pond.seats.filter(s => s.status === 'available').length, 0),
    [db.ponds]
  );

  const totalPonds = db.ponds.length;
  const confirmedBookings = db.bookings.filter(b => b.status === 'confirmed').length;
  const activePond = selectedPond ? db.ponds.find(p => p.id === selectedPond) ?? null : db.ponds[0] || null;

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const start = new Date(db.comp.startDate);
      const end = new Date(db.comp.endDate);
      const distance = start.getTime() - now.getTime();
      if (distance <= 0 && now < end) {
        setCountdown({ days: '00', hours: '00', mins: '00', secs: '00', status: 'live' });
        return;
      }
      if (distance <= 0) {
        setCountdown({ days: '00', hours: '00', mins: '00', secs: '00', status: 'ended' });
        return;
      }
      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor((distance / (1000 * 60 * 60)) % 24);
      const mins = Math.floor((distance / (1000 * 60)) % 60);
      const secs = Math.floor((distance / 1000) % 60);
      setCountdown({
        days: String(days).padStart(2, '0'),
        hours: String(hours).padStart(2, '0'),
        mins: String(mins).padStart(2, '0'),
        secs: String(secs).padStart(2, '0'),
        status: 'upcoming'
      });
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [db.comp.startDate, db.comp.endDate]);

  useEffect(() => {
    if (currentSection === 'home' && homeScrollTarget) {
      document.getElementById(homeScrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setHomeScrollTarget(null);
    }
  }, [currentSection, homeScrollTarget]);

  const handleSelectPond = (id: number) => {
    setPond(id);
    goToBook();
  };

  const handleSubmitBooking = async () => {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    if (!selectedSeats.length) {
      addToast('Select at least one peg', 'error');
      return;
    }
    if (!receiptData) {
      addToast('Upload your payment receipt', 'error');
      return;
    }
    if (!selectedPond) return;

    const pond = db.ponds.find(p => p.id === selectedPond);
    if (!pond) return;

    const booking = await submitBooking(pond);
    if (booking) {
      addToast('Booking submitted! Staff will confirm via email.', 'success');
      goToConfirmed();
    }
  };

  const handleReceiptChange = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setReceiptData(e.target?.result as string, file);
    };
    reader.readAsDataURL(file);
  };

  const handleLogin = async (email: string, pass: string) => {
    if (await login(email, pass)) {
      setAuthModalOpen(false);
      goToMyBookings();
    }
  };

  const handleRegister = async (name: string, email: string, phone: string, pass: string) => {
    if (await register(name, email, phone, pass)) {
      setAuthModalOpen(false);
      goToMyBookings();
    }
  };

  const handleLogout = () => {
    logout();
    goHome();
  };

  const userBookings = user ? db.bookings.filter(b => b.userId === user.uid || b.userId === user.email) : [];

  const handleNavigation = (section: string) => {
    const homeAnchors = ['about', 'kolam', 'event', 'lokasi', 'tempah'];
    if (homeAnchors.includes(section)) {
      if (currentSection !== 'home') {
        setHomeScrollTarget(section);
        goHome();
      } else {
        document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    if (section === 'home') {
      goHome();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (section === 'book') {
      goToBook();
      return;
    }
    if (section === 'live') {
      goToLive();
      return;
    }
    if (section === 'mybookings') {
      if (user) {
        goToMyBookings();
      } else {
        setAuthModalOpen(true);
      }
      return;
    }
    goToSection(section);
  };

  const eventDate = new Date(db.comp.startDate).toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' });

  const renderHome = () => (
    <div className="home-shell">
      <section className="hero" id="home">
        <div className="hero-logo">KKS</div>
        <div className="hero-eyebrow">Port Pancing Terbaik Kedah — Di Tengah Sawah</div>
        <h1 className="hero-title">
          Kolam Keli<br />
          <span className="accent">Sayang</span>
          <span className="kks">(KKS)</span>
        </h1>
        <p className="hero-sub">14 Kolam Besar • 65 × 480 Kaki • Alor Setar, Kedah</p>
        <div className="hero-rule"></div>
        <div className="hero-event-box">
          <div className="event-box-lbl">🎯 Grand Opening Casting Day — {eventDate}</div>
          <div className="cd-row">
            <div className="cd-u"><span className="cd-n">{countdown.days}</span><span className="cd-l">Hari</span></div>
            <span className="cd-sep">:</span>
            <div className="cd-u"><span className="cd-n">{countdown.hours}</span><span className="cd-l">Jam</span></div>
            <span className="cd-sep">:</span>
            <div className="cd-u"><span className="cd-n">{countdown.mins}</span><span className="cd-l">Minit</span></div>
            <span className="cd-sep">:</span>
            <div className="cd-u"><span className="cd-n">{countdown.secs}</span><span className="cd-l">Saat</span></div>
          </div>
        </div>
        <div className="hero-btns">
          <button className="btn-primary" onClick={() => db.settings?.whatsapp && (db.settings.whatsapp.startsWith('https://') ? window.open(db.settings.whatsapp, '_blank') : window.open(`https://wa.me/${db.settings.whatsapp}`, '_blank'))}>Tempah Slot Sekarang</button>
          <button className="btn-outline" onClick={() => handleNavigation('lokasi')}>Tengok Lokasi</button>
        </div>
      </section>

      <section className="about-section" id="about">
        <div className="container">
          <div className="section-label">Tentang Kami</div>
          <h2 className="section-title">Di Tengah Sawah,<br />Port Tiada Tandingan</h2>
          <div className="section-rule"></div>
          <div className="about-grid">
            <div className="about-visual">
              <div className="logo-rings"></div>
              <div className="logo-rings"></div>
              <div className="logo-rings"></div>
              <div className="about-logo-img">KKS</div>
            </div>
            <div>
              <p className="about-text">Terletak di kawasan sawah padi Alor Setar, Kedah, <strong style={{ color: '#fff' }}>Kolam Keli Sayang (KKS)</strong> menawarkan 14 kolam bersaiz besar (65 × 480 kaki) — dikelilingi hamparan padi yang hijau dan menenangkan jiwa.</p>
              <p className="about-text">Sama ada nak healing sorang-sorang, bawa family, atau test skill dalam pertandingan — sini memang port padu. Hembus angin sawah, bunyi kodok malam, suasana yang tak ternilai.</p>
              <ul className="check-list">
                <li>Kawasan luas dikelilingi sawah padi yang tenang</li>
                <li>14 kolam bersaiz besar, dijaga rapi</li>
                <li>Sesuai untuk event &amp; pertandingan bertaraf</li>
                <li>Parking luas, jalan masuk mudah</li>
                <li>Suasana kampung asli, jauh dari kesibukan</li>
              </ul>
              <div className="stat-strip">
                <div className="stat-b"><div className="stat-n">{db.ponds.length}</div><div className="stat-l">Kolam</div></div>
                <div className="stat-b"><div className="stat-n">480</div><div className="stat-l">Kaki Panjang</div></div>
                <div className="stat-b"><div className="stat-n">65</div><div className="stat-l">Kaki Lebar</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="features-section">
        <div className="container">
          <div className="section-label">Kenapa Pilih KKS</div>
          <h2 className="section-title">Semua Ada<br />Di Sini</h2>
          <div className="section-rule"></div>
          <div className="features-grid">
            <div className="feat-card">
              <div className="feat-icon">🎣</div>
              <div className="feat-title">14 Kolam Besar</div>
              <div className="feat-desc">Saiz 65 × 480 kaki, cukup luas untuk ramai pancing serentak tanpa sesak.</div>
            </div>
            <div className="feat-card">
              <div className="feat-icon">🌾</div>
              <div className="feat-title">Di Tengah Sawah</div>
              <div className="feat-desc">Dikelilingi ladang padi Kedah — suasana tenang yang tak boleh dibeli.</div>
            </div>
            <div className="feat-card">
              <div className="feat-icon">🏆</div>
              <div className="feat-title">Event &amp; Pertandingan</div>
              <div className="feat-desc">Setup sempurna untuk pertandingan pancing bertaraf tinggi seluruh Kedah.</div>
            </div>
            <div className="feat-card">
              <div className="feat-icon">🚗</div>
              <div className="feat-title">Parking Luas</div>
              <div className="feat-desc">Ruang parking besar, selesa untuk kenderaan persendirian mahupun van.</div>
            </div>
            <div className="feat-card">
              <div className="feat-icon">📱</div>
              <div className="feat-title">Tempah Online</div>
              <div className="feat-desc">Tempah slot dalam masa kurang 2 minit, slip confirm terus ke WhatsApp.</div>
            </div>
            <div className="feat-card">
              <div className="feat-icon">🍜</div>
              <div className="feat-title">Gerai Makan</div>
              <div className="feat-desc">Pilihan makanan &amp; minuman tersedia sepanjang hari untuk pengunjung.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="event-section" id="event">
        <div className="container">
          <div className="section-label">Jangan Terlepas</div>
          <h2 className="section-title">Event<br />Akan Datang</h2>
          <div className="section-rule"></div>
          <div className="event-card">
            <div className="event-info">
              <span className="event-badge">📢 Pendaftaran Dibuka</span>
              <div className="event-name">{db.comp.name}</div>
              <div className="event-date">📅 {eventDate} • Kolam Keli Sayang, Alor Setar</div>
              <p className="event-desc">Event besar pertama KKS! Bertanding di tepi sawah dengan suasana Kedah yang asli. Hadiah menarik menanti. Tempat terhad — siapa cepat dia dapat.</p>
              <button className="btn-primary" onClick={() => handleSelectPond(db.ponds[0]?.id ?? 1)}>Daftar Sekarang</button>
            </div>
            <div className="event-right">
              <div className="etl">Masa Berbaki</div>
              <div className="e-timer">
                <div className="et"><span className="et-n">{countdown.days}</span><span className="et-l">Hari</span></div>
                <div className="et"><span className="et-n">{countdown.hours}</span><span className="et-l">Jam</span></div>
                <div className="et"><span className="et-n">{countdown.mins}</span><span className="et-l">Minit</span></div>
              </div>
              <div className="prize-box">
                <div className="prize-lbl">Hadiah</div>
                <div className="prize-val">Hadiah Menarik Menanti!</div>
                <div className="prize-sub">Tempat Terhad</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="steps-section" id="tempah">
        <div className="container" style={{ textAlign: 'center' }}>
          <div className="section-label">Mudah Saja</div>
          <h2 className="section-title">3 Langkah Tempahan</h2>
          <div className="section-rule" style={{ margin: '1rem auto 0' }}></div>
          <p style={{ color: '#777', marginTop: '1rem', fontSize: '0.9rem' }}>Tak sampai 2 minit siap.</p>
          <div className="steps-row">
            <div className="step">
              <div className="step-circle s1">1</div>
              <div className="step-title">Pilih Tarikh &amp; Masa</div>
              <div className="step-desc">Pilih bila nak datang — weekday ke hujung minggu, semua boleh.</div>
            </div>
            <div className="step">
              <div className="step-circle s2">2</div>
              <div className="step-title">Pilih Kolam</div>
              <div className="step-desc">Tengok availability kolam pilihan anda dan terus pilih yang sesuai.</div>
            </div>
            <div className="step">
              <div className="step-circle s3">3</div>
              <div className="step-title">Bayar &amp; Confirm</div>
              <div className="step-desc">Bayar dengan selamat, slip tempahan terus dihantar ke WhatsApp anda.</div>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: '3rem' }}>
            <button className="btn-primary" onClick={() => goToBook()}>Mula Tempahan Sekarang</button>
          </div>
        </div>
      </section>

      <section className="ponds-section" id="kolam">
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.5rem' }}>
          <div>
            <div className="section-label">Pilih Tempat Anda</div>
            <h2 className="section-title" style={{ color: '#fff' }}>Kolam Tersedia</h2>
            <div className="section-rule" style={{ background: 'var(--gold)' }}></div>
          </div>
          <div className="legend">
            <div className="leg"><span className="leg-dot" style={{ background: 'var(--green-bright)' }}></span>Available</div>
            <div className="leg"><span className="leg-dot" style={{ background: 'var(--gold)' }}></span>Limited</div>
            <div className="leg"><span className="leg-dot" style={{ background: '#444' }}></span>Fully Booked</div>
          </div>
        </div>
        <div className="ponds-grid">
          {db.ponds.map((pond) => {
            const availCount = pond.seats.filter(s => s.status === 'available').length;
            const statusLabel = availCount === 0 ? 'Fully Booked' : availCount < pond.seats.length * 0.3 ? 'Limited' : 'Available';
            const statusClass = availCount === 0 ? 'fu' : availCount < pond.seats.length * 0.3 ? 'li' : 'av';
            return (
              <div key={pond._docId || pond.id} className={`pond-card ${availCount === 0 ? 'full' : availCount < pond.seats.length * 0.3 ? 'limited' : 'available'}`}>
                <div className="pond-num">{pond.id}</div>
                <div className="pond-size-lbl">{pond.date}</div>
                <span className={`pond-badge ${statusClass}`}>{statusLabel}</span>
                <div className="pond-name">{pond.name}</div>
                <div className="pond-desc">{pond.desc}</div>
                <div className="pond-meta">
                  <span className="pond-avail"><span>{availCount}</span> available</span>
                  <span className="pond-price">RM {pond.seats[0]?.price}</span>
                </div>
                <button className={`pond-btn ${availCount === 0 ? 'disabled' : ''}`} disabled={availCount === 0} onClick={() => handleSelectPond(pond.id)}>
                  {availCount === 0 ? 'Full' : 'Book Now'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="map-section" id="lokasi">
        <div className="container">
          <div className="section-label">Pelan Tapak</div>
          <h2 className="section-title">Lokasi &amp; Susun Atur Kolam</h2>
          <div className="section-rule"></div>

          {/* Google Maps Embed */}
          <div className="map-container" style={{ marginBottom: '2rem' }}>
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3966.3239255093207!2d100.3092829!3d6.135637!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x31a3b8b8b8b8b8b9%3A0x1234567890abcdef!2sKolam%20Keli%20Sayang!5e0!3m2!1sms!2smy!4v1234567890000"
              width="100%"
              height="400"
              style={{ border: 0, borderRadius: '12px' }}
              allowFullScreen={true}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Location Map"
            ></iframe>
          </div>

          <p style={{ color: '#666', marginTop: '0.75rem', fontSize: '0.9rem' }}>
            📍 {db.settings?.location || 'Alor Setar, Kedah'} — Kolam KKS dikelilingi sawah padi Kedah
          </p>
          <div className="map-wrap">
            <div className="map-legend-strip">
              <div className="map-leg"><div className="map-leg-box" style={{ background: '#4a7fa5' }}></div>Kolam Ikan</div>
              <div className="map-leg"><div className="map-leg-box" style={{ background: '#5aaa35' }}></div>Sawah Padi</div>
              <div className="map-leg"><div className="map-leg-box" style={{ background: '#8b7355' }}></div>Jalan Masuk</div>
              <div className="map-leg"><div className="map-leg-box" style={{ background: '#c8a84b' }}></div>Pagar Keselamatan</div>
              <div className="map-coords">📍 {db.settings?.location || 'Alor Setar, Kedah'}</div>
            </div>
            <div className="map-card">
              <div className="map-grid">
                {db.ponds.filter(pond => pond.open).map(pond => (
                  <div key={pond._docId || pond.id} className="map-pond">
                    <div className="map-pond-title">{pond.name}</div>
                    <div className="map-pond-sub">{pond.date}</div>
                    <div className="map-pond-meta">{pond.seats.filter(s => s.status === 'available').length} available pegs</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '1rem', textAlign: 'center' }}>* Pelan tapak berdasarkan susun atur seminar — susun atur sebenar boleh berubah sedikit semasa operasi.</p>
        </div>
      </section>

      <section className="cta-section" id="cta">
        <div className="container">
          <div className="cta-logo">KKS</div>
          <div className="section-label" style={{ color: 'var(--gold-light)' }}>Jom Pancing!</div>
          <h2 className="section-title" style={{ color: '#fff' }}>Jangan Tunggu Lama</h2>
          <p className="cta-sub">Slot cepat penuh terutamanya hujung minggu. Tempah sekarang sebelum terlepas peluang pancing di sawah.</p>
          <div className="cta-btns">
            <button className="btn-primary" onClick={() => handleSelectPond(db.ponds[0]?.id ?? 1)}>Tempah Sekarang</button>
            <button className="btn-outline" onClick={() => handleNavigation('about')}>Hubungi Kami</button>
          </div>
          <div className="info-strip">
            <div className="info-item">
              <div className="info-lbl">WhatsApp</div>
              <div className="info-val">+60 1X-XXX XXXX</div>
            </div>
            <div className="info-item">
              <div className="info-lbl">Lokasi</div>
              <div className="info-val">Alor Setar, Kedah</div>
            </div>
            <div className="info-item">
              <div className="info-lbl">Waktu Buka</div>
              <div className="info-val">Isnin–Ahad 7am–7pm</div>
            </div>
          </div>
        </div>
      </section>

    </div>
  );

  const renderSection = () => {
    switch (currentSection) {
      case 'home':
        return renderHome();
      case 'book': {
        const bookedPond = activePond;
        return (
          <div className="booking-layout">
            <BookingSidebar ponds={db.ponds} selectedPond={selectedPond} onSelectPond={handleSelectPond} />
            <SeatMap pond={bookedPond} selectedSeats={selectedSeats} onToggleSeat={toggleSeat} />
            <BookingForm
              user={user}
              pond={bookedPond}
              selectedSeats={selectedSeats}
              payType={payType}
              receiptData={receiptData}
              onSetPayType={setPayType}
              onHandleReceiptChange={handleReceiptChange}
              onClearReceipt={() => setReceiptData(null, null)}
              onSubmitBooking={handleSubmitBooking}
              onOpenAuth={() => setAuthModalOpen(true)}
            />
          </div>
        );
      }
      case 'live':
        return <LiveResults comp={db.comp} scores={db.scores} ponds={db.ponds} bookings={db.bookings} user={user} />;
      case 'mybookings':
        if (!authReady) {
          return (
            <div className="bookings-page">
              <div className="empty-state">
                <span className="empty-icon">⏳</span>
                <div className="empty-text">Checking your session...</div>
              </div>
            </div>
          );
        }
        if (!user) {
          return (
            <div className="bookings-page">
              <div className="empty-state">
                <span className="empty-icon">🔐</span>
                <div className="empty-text">Please login to view your bookings.</div>
                <button className="btn btn-primary" style={{ marginTop: '12px' }} onClick={() => setAuthModalOpen(true)}>Login</button>
              </div>
            </div>
          );
        }
        return (
          <div className="bookings-page">
            <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <div className="section-title" style={{ fontSize: '30px' }}>My Bookings</div>
                <div style={{ color: 'var(--muted)', fontSize: '12px' }}>{user.name} ({user.email})</div>
              </div>
              <button className="btn btn-primary" onClick={() => goToBook()}>
                <i className="fa-solid fa-plus"></i> New Booking
              </button>
            </div>
            {userBookings.length ? userBookings.map(b => (
              <div key={b.id} className="card booking-row" onClick={() => { setSelectedBooking(b); setBookingDetailsOpen(true); }} style={{ cursor: 'pointer' }}>
                <div>
                  <div className="booking-id">{b.id}</div>
                  <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>{fmt(b.createdAt)}</div>
                </div>
                <div>
                  <div className="booking-pond">{b.pondName}</div>
                  <div className="booking-meta">
                    📍 Pegs: {b.seats.join(', ')} &nbsp;|&nbsp; 💰 RM {b.amount} &nbsp;|&nbsp; {b.paymentType === 'deposit' ? 'Deposit' : 'Full'}
                  </div>
                </div>
                <div>
                  <span className={`status-badge st-${b.status}`}>
                    <i className={`fa-solid fa-${b.status === 'pending' ? 'clock' : b.status === 'confirmed' ? 'check-circle' : 'xmark-circle'}`}></i>{' '}
                    {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                  </span>
                </div>
              </div>
            )) : (
              <div className="empty-state">
                <span className="empty-icon">🎣</span>
                <div className="empty-text">
                  No bookings yet. <a onClick={() => goToBook()} style={{ color: 'var(--accent)', cursor: 'pointer' }}>Book a peg</a> to get started.
                </div>
              </div>
            )}
          </div>
        );
      case 'confirmed': {
        const lastBooking = db.bookings[0];
        return (
          <div className="confirm-page">
            <div className="confirm-icon">🎣</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>BOOKING SUBMITTED</div>
            <div className="confirm-id">{lastBooking?.id || 'CB1234567'}</div>
            <div className="confirm-detail">
              {lastBooking ? (
                <>
                  <strong>{lastBooking.pondName}</strong><br />
                  Pegs: {lastBooking.seats.join(', ')}<br />
                  Amount: RM {lastBooking.amount} ({lastBooking.paymentType === 'deposit' ? '50% deposit' : 'full payment'})<br />
                  <br />
                  Booking is <strong>pending verification</strong>.<br />
                  Staff will confirm via email to <strong>{lastBooking.userId}</strong>.
                </>
              ) : (
                <>
                  <strong>Pond Name</strong><br />
                  Pegs: 1, 2<br />
                  Amount: RM 100 (full payment)<br />
                  <br />
                  Booking is <strong>pending verification</strong>.<br />
                  Staff will confirm via email.
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '28px', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => goToMyBookings()}>View My Bookings</button>
              <button className="btn btn-ghost" onClick={() => goHome()}>Back to Home</button>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <>
      <Navbar
        user={user}
        currentSection={currentSection}
        onSectionChange={handleNavigation}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenCMS={() => setCMSModalOpen(true)}
        onLogout={handleLogout}
      />
      <div key="section-home" className={`section ${currentSection === 'home' ? 'active' : ''}`} id="section-home">
        {currentSection === 'home' && renderSection()}
      </div>
      <div key="section-book" className={`section ${currentSection === 'book' ? 'active' : ''}`} id="section-book">
        {currentSection === 'book' && renderSection()}
      </div>
      <div key="section-live" className={`section ${currentSection === 'live' ? 'active' : ''}`} id="section-live">
        {currentSection === 'live' && renderSection()}
      </div>
      <div key="section-mybookings" className={`section ${currentSection === 'mybookings' ? 'active' : ''}`} id="section-mybookings">
        {currentSection === 'mybookings' && renderSection()}
      </div>
      <div key="section-confirmed" className={`section ${currentSection === 'confirmed' ? 'active' : ''}`} id="section-confirmed">
        {currentSection === 'confirmed' && renderSection()}
      </div>
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
      <CMSModal
        isOpen={cmsModalOpen}
        onClose={() => setCMSModalOpen(false)}
        user={user}
        ponds={db.ponds}
        comp={db.comp}
        settings={db.settings}
        bookings={db.bookings}
        onUpdateData={({ ponds: updatedPonds, comp: updatedComp }) => {
          if (updatedPonds || updatedComp) {
            addToast('Settings updated successfully!', 'success');
          }
        }}
        reloadDB={reloadDB}
      />
      <BookingDetailsModal
        isOpen={bookingDetailsOpen}
        booking={selectedBooking}
        onClose={() => { setBookingDetailsOpen(false); setSelectedBooking(null); }}
      />
      <Toast />
    </>
  );
};

export default AppContent;
