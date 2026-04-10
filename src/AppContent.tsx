import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    selectedCompetitionId,
    selectedSeats,
    payType,
    receiptData,
    user,
    setPond,
    setSelectedCompetitionId,
    toggleSeat,
    setSeats,
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
  const [pondPickerOpen, setPondPickerOpen] = useState(false);
  const competitionScrollerRef = useRef<HTMLDivElement | null>(null);
  const competitionInteractionRef = useRef({ isDragging: false, startX: 0, startScrollLeft: 0, blockClick: false });
  const competitionSnapTimeoutRef = useRef<number | null>(null);
  const competitionTouchRef = useRef({ isTouching: false, startX: 0, startScrollLeft: 0 });
  const [isDraggingCompetitions, setIsDraggingCompetitions] = useState(false);
  const [focusedCompetitionKey, setFocusedCompetitionKey] = useState('');
  const [countdown, setCountdown] = useState({ days: '--', hours: '--', mins: '--', secs: '--', status: 'upcoming' });
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(false);

  const competitions = useMemo(() => {
    if (db.competitions?.length) return db.competitions;
    return db.comp?.name ? [db.comp] : [];
  }, [db.comp, db.competitions]);

  const selectedCompetition = useMemo(() => {
    const selected = competitions.find((competition) => competition.id === selectedCompetitionId);
    return selected || competitions[0] || db.comp;
  }, [competitions, db.comp, selectedCompetitionId]);

  const competitionScopedPonds = useMemo(() => {
    const activeCompetitionId = selectedCompetition?.id || db.comp?.id || '';
    const allowedPondIds = selectedCompetition?.activePondIds || [];
    const occupied = new Set<string>();
    db.bookings.forEach((booking) => {
      const bookingCompetitionId = booking.competitionId || db.comp?.id || '';
      if (bookingCompetitionId !== activeCompetitionId) return;
      if (booking.status !== 'pending' && booking.status !== 'confirmed') return;
      booking.seats.forEach((seatNum) => occupied.add(`${booking.pondId}-${seatNum}`));
    });

    const scopedPonds = db.ponds.map((pond) => ({
      ...pond,
      seats: pond.seats.map((seat) => ({
        ...seat,
        status: occupied.has(`${pond.id}-${seat.num}`) ? 'booked' : 'available'
      }))
    }));

    if (!allowedPondIds.length) return scopedPonds;
    return scopedPonds.filter((pond) => {
      const docId = pond._docId || pond.id.toString();
      return allowedPondIds.includes(docId);
    });
  }, [db.bookings, db.comp?.id, db.ponds, selectedCompetition?.activePondIds, selectedCompetition?.id]);

  const availablePegs = useMemo(
    () => competitionScopedPonds.reduce((sum, pond) => sum + pond.seats.filter(s => s.status === 'available').length, 0),
    [competitionScopedPonds]
  );

  const totalPonds = db.ponds.length;
  const confirmedBookings = db.bookings.filter(b => b.status === 'confirmed').length;
  const bookablePonds = useMemo(() => competitionScopedPonds.filter((p) => p.open), [competitionScopedPonds]);
  const activePond = selectedPond
    ? bookablePonds.find((p) => p.id === selectedPond) ?? null
    : bookablePonds[0] || null;

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const start = new Date(selectedCompetition?.startDate || db.comp.startDate);
      const end = new Date(selectedCompetition?.endDate || db.comp.endDate);
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
  }, [db.comp.endDate, db.comp.startDate, selectedCompetition?.endDate, selectedCompetition?.startDate]);

  useEffect(() => {
    if (currentSection === 'home' && homeScrollTarget) {
      document.getElementById(homeScrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setHomeScrollTarget(null);
    }
  }, [currentSection, homeScrollTarget]);

  const handleSelectPond = (id: number) => {
    if (!selectedCompetition?.id) {
      addToast('Sila pilih pertandingan dahulu.', 'error');
      document.getElementById('competitions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const pond = bookablePonds.find((p) => p.id === id);
    if (!pond || !pond.open) {
      addToast('This pond is currently closed for booking.', 'error');
      return;
    }
    setPond(id);
    setPondPickerOpen(false);
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
    if (!selectedCompetition?.id) {
      addToast('Sila pilih pertandingan terlebih dahulu.', 'error');
      return;
    }

    const pond = bookablePonds.find(p => p.id === selectedPond);
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
    const homeAnchors = ['about', 'competitions', 'prizes', 'contact', 'how', 'tempah'];
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
      if (!selectedCompetition?.id) {
        goHome();
        setHomeScrollTarget('competitions');
        return;
      }
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

  const totalRegistered = db.bookings.length;
  const totalPrizePool = selectedCompetition?.prizes?.reduce((sum: number, prize: any) => {
    const raw = (prize?.prize || prize?.amount || '').toString();
    const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0) || 0;

  const selectCompetition = (competitionId?: string) => {
    if (!competitionId) return;
    setSelectedCompetitionId(competitionId);
    setPond(null);
    setSeats([]);
  };

  const getCompetitionKey = (competition: { id?: string; name?: string }) => competition.id || competition.name || '';

  const updateFocusedCompetition = () => {
    const track = competitionScrollerRef.current;
    if (!track || track.scrollWidth <= track.clientWidth) return null;
    const cards = Array.from(track.querySelectorAll('.comp-card-scroll')) as HTMLElement[];
    if (!cards.length) return null;

    const viewportCenter = track.scrollLeft + track.clientWidth / 2;
    let nearest: HTMLElement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = Math.abs(cardCenter - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = card;
      }
    });

    if (!nearest) return null;
    const nextFocused = nearest.dataset.competitionKey || '';
    if (nextFocused && nextFocused !== focusedCompetitionKey) {
      setFocusedCompetitionKey(nextFocused);
    }
    return nearest;
  };

  const snapCompetitionToCenter = () => {
    const track = competitionScrollerRef.current;
    if (!track || track.scrollWidth <= track.clientWidth) return;
    const nearest = updateFocusedCompetition();
    if (!nearest) return;
    const targetLeft = nearest.offsetLeft + nearest.offsetWidth / 2 - track.clientWidth / 2;
    track.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  };

  const scheduleCompetitionSnap = (delay = 140) => {
    if (competitionSnapTimeoutRef.current) {
      window.clearTimeout(competitionSnapTimeoutRef.current);
    }
    competitionSnapTimeoutRef.current = window.setTimeout(() => {
      snapCompetitionToCenter();
      competitionSnapTimeoutRef.current = null;
    }, delay);
  };

  useEffect(() => {
    if (!competitions.length) return;
    scheduleCompetitionSnap(40);
  }, [competitions.length]);

  useEffect(() => {
    updateFocusedCompetition();
  }, [selectedCompetition?.id]);

  useEffect(() => () => {
    if (competitionSnapTimeoutRef.current) {
      window.clearTimeout(competitionSnapTimeoutRef.current);
    }
  }, []);

  const handleCompetitionWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const track = competitionScrollerRef.current;
    if (!track) return;
    const canScroll = track.scrollWidth > track.clientWidth;
    if (!canScroll) return;

    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    event.preventDefault();
    track.scrollBy({ left: event.deltaY, behavior: 'auto' });
    scheduleCompetitionSnap();
  };

  const handleCompetitionMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!competitionScrollerRef.current) return;
    competitionInteractionRef.current = {
      isDragging: true,
      startX: event.clientX,
      startScrollLeft: competitionScrollerRef.current.scrollLeft,
      blockClick: false,
    };
    if (competitionSnapTimeoutRef.current) {
      window.clearTimeout(competitionSnapTimeoutRef.current);
      competitionSnapTimeoutRef.current = null;
    }
    setIsDraggingCompetitions(true);
  };

  const handleCompetitionMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!competitionInteractionRef.current.isDragging || !competitionScrollerRef.current) return;
    const delta = event.clientX - competitionInteractionRef.current.startX;
    if (Math.abs(delta) > 8) {
      competitionInteractionRef.current.blockClick = true;
    }
    competitionScrollerRef.current.scrollLeft = competitionInteractionRef.current.startScrollLeft - delta * 1.15;
  };

  const stopCompetitionDrag = () => {
    if (!competitionInteractionRef.current.isDragging) return;
    competitionInteractionRef.current.isDragging = false;
    setIsDraggingCompetitions(false);
    scheduleCompetitionSnap(60);
  };

  const handleCompetitionTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!competitionScrollerRef.current) return;
    const touchX = event.touches[0]?.clientX;
    if (touchX === undefined) return;
    competitionTouchRef.current = {
      isTouching: true,
      startX: touchX,
      startScrollLeft: competitionScrollerRef.current.scrollLeft,
    };
    if (competitionSnapTimeoutRef.current) {
      window.clearTimeout(competitionSnapTimeoutRef.current);
      competitionSnapTimeoutRef.current = null;
    }
  };

  const handleCompetitionTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!competitionTouchRef.current.isTouching || !competitionScrollerRef.current) return;
    const touchX = event.touches[0]?.clientX;
    if (touchX === undefined) return;
    const delta = touchX - competitionTouchRef.current.startX;
    competitionScrollerRef.current.scrollLeft = competitionTouchRef.current.startScrollLeft - delta;
  };

  const handleCompetitionTouchEnd = () => {
    if (!competitionTouchRef.current.isTouching) return;
    competitionTouchRef.current.isTouching = false;
    scheduleCompetitionSnap(80);
  };

  const handleCompetitionClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!competitionInteractionRef.current.blockClick) return;
    event.preventDefault();
    event.stopPropagation();
    competitionInteractionRef.current.blockClick = false;
  };

  const handleCompetitionScroll = () => {
    updateFocusedCompetition();
  };

  const renderHome = () => (
    <div className="home-shell">
      {/* HERO */}
      <section className="hero" id="home">
        <div className="hero-inner">
          <div className="hero-badge">🎣 Port Pancing #1 Kedah</div>
          <h1>Kolam Keli /<br /><span>Sayang</span></h1>
          <p className="hero-subtitle">Kolam pancing keli terbesar di Kedah — 14 kolam, suasana sawah asli, pertandingan setiap bulan.</p>
          <div className="hero-buttons">
            <button className="btn btn-primary btn-lg" onClick={() => handleNavigation('competitions')}>Pilih Pertandingan</button>
            <a className="btn-outline" onClick={() => handleNavigation('competitions')}>Lihat Pertandingan</a>
          </div>
          <div className="hero-stats">
            <div className="hero-stat"><div className="hero-stat-num">{totalPonds}</div><div className="hero-stat-label">Kolam Aktif</div></div>
            <div className="hero-stat"><div className="hero-stat-num">{availablePegs}</div><div className="hero-stat-label">Tempat Peserta</div></div>
            <div className="hero-stat"><div className="hero-stat-num">RM{totalPrizePool > 0 ? (totalPrizePool / 1000).toFixed(0) + 'K' : '50K+'}</div><div className="hero-stat-label">Hadiah Setahun</div></div>
            <div className="hero-stat"><div className="hero-stat-num">{totalRegistered || '200'}+</div><div className="hero-stat-label">Ahli Berdaftar</div></div>
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section className="about" id="about">
        <div className="container">
          <div className="section-label">Tentang KKS</div>
          <h2 className="section-title">Kolam Pancing<br />Terbaik Kedah</h2>
          <p className="section-desc">Terletak di kawasan sawah padi Alor Setar, KKS menawarkan pengalaman memancing yang unik dengan suasana kampung asli.</p>
          <div className="about-grid">
            <div>
              <div className="about-features">
                <div className="about-feature">
                  <div className="feature-icon">🐟</div>
                  <div className="feature-text"><h4>Ikan Keli Berkualiti</h4><p>Keli segar dipelihara dengan baik dalam kolam bersih dan terurus.</p></div>
                </div>
                <div className="about-feature">
                  <div className="feature-icon">🏆</div>
                  <div className="feature-text"><h4>Hadiah Lumayan</h4><p>Pertandingan bulanan dengan hadiah wang tunai yang menarik.</p></div>
                </div>
                <div className="about-feature">
                  <div className="feature-icon">📱</div>
                  <div className="feature-text"><h4>Tempahan Online Mudah</h4><p>Tempah dalam 2 minit — pilih kolam, bayar, terus dapat slip.</p></div>
                </div>
                <div className="about-feature">
                  <div className="feature-icon">📍</div>
                  <div className="feature-text"><h4>Lokasi Strategik</h4><p>Mudah diakses dari Alor Setar, parking luas dan percuma.</p></div>
                </div>
              </div>
            </div>
            <div className="about-visual">
              <div className="about-visual-text">KKS</div>
              <div className="about-tag">🎣 Est. 2020</div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPETITIONS */}
      <section className="competitions" id="competitions">
        <div className="container">
          <div className="section-label">Pertandingan</div>
          <h2 className="section-title">Sertai &amp;<br />Menang Besar</h2>
          <p className="section-desc">Pertandingan pancing keli setiap bulan dengan hadiah wang tunai. Terbuka untuk semua peringkat.</p>
          <div className="comp-carousel-shell">
            <div
              className={`comp-scroll-track ${isDraggingCompetitions ? 'is-dragging' : ''}`}
              ref={competitionScrollerRef}
              onWheel={handleCompetitionWheel}
              onMouseDown={handleCompetitionMouseDown}
              onMouseMove={handleCompetitionMouseMove}
              onMouseUp={stopCompetitionDrag}
              onMouseLeave={stopCompetitionDrag}
              onTouchStart={handleCompetitionTouchStart}
              onTouchMove={handleCompetitionTouchMove}
              onTouchEnd={handleCompetitionTouchEnd}
              onScroll={handleCompetitionScroll}
              onClickCapture={handleCompetitionClickCapture}
              role="region"
              aria-label="Carousel pertandingan"
            >
            {competitions.map((competition) => {
              const isSelectedCompetition = competition.id === selectedCompetition?.id;
              const competitionKey = getCompetitionKey(competition);
              const isFocused = competitionKey === focusedCompetitionKey;
              const compPrize = competition.prizes?.[0] as any;
              const compPrizeText = compPrize?.prize || compPrize?.amount || 'Hadiah Menarik';
              const compDate = competition.startDate ? new Date(competition.startDate) : null;
              const compDateText = compDate && !Number.isNaN(compDate.getTime())
                ? compDate.toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                : 'Tarikh akan diumumkan';
              return (
              <div key={competitionKey} data-competition-key={competitionKey} className={`comp-card comp-card-scroll ${isFocused ? 'is-focused' : ''}`} style={{ outline: isSelectedCompetition ? '2px solid var(--gold)' : undefined }}>
                <div className="comp-header">
                  <h3>{competition.name}</h3>
                  <span className="comp-status status-open">{countdown.status === 'live' ? '🔴 Live' : countdown.status === 'ended' ? 'Selesai' : 'Pendaftaran Dibuka'}</span>
                </div>
                <div className="comp-body">
                  <div className="comp-detail"><span className="comp-detail-icon">📅</span> {compDateText}</div>
                  <div className="comp-detail"><span className="comp-detail-icon">📍</span> Kolam Keli Sayang, Alor Setar</div>
                  <div className="comp-detail"><span className="comp-detail-icon">👥</span> {availablePegs} tempat tersedia</div>
                  <div className="comp-prize"><span>Hadiah: </span>{compPrizeText}</div>
                </div>
                <div className="comp-footer">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      selectCompetition(competition.id);
                      setPondPickerOpen(true);
                    }}
                  >
                    {isSelectedCompetition ? 'Tukar Kolam' : 'Pilih Pertandingan'}
                  </button>
                </div>
              </div>
            )})}
            </div>
          </div>
        </div>
      </section>

      {pondPickerOpen && (
        <div className="modal-overlay open" onClick={() => setPondPickerOpen(false)}>
          <div className="modal" style={{ maxWidth: '920px', width: '95%', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Pilih Kolam Untuk {selectedCompetition?.name || 'Pertandingan'}</div>
              <button className="modal-close" onClick={() => setPondPickerOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="ponds-grid">
                {competitionScopedPonds.map((pond, idx) => {
                  const availCount = pond.seats.filter((seat) => seat.status === 'available').length;
                  const letterIdx = String.fromCharCode(65 + idx);
                  const isClosed = !pond.open;
                  const isFull = availCount === 0;
                  const statusLabel = isClosed ? 'Ditutup' : isFull ? 'Penuh' : `${availCount} tempat kosong`;
                  return (
                    <div
                      key={pond._docId || pond.id}
                      className="pond-card"
                      onClick={() => !isClosed && !isFull && handleSelectPond(pond.id)}
                      style={{ cursor: isClosed || isFull ? 'default' : 'pointer', opacity: isClosed ? 0.65 : 1 }}
                    >
                      <div className="pond-num">{letterIdx}</div>
                      <div className="pond-name">{pond.name}</div>
                      <div className="pond-seats">{pond.seats.length} tempat duduk · RM{pond.seats[0]?.price || 0}/peg</div>
                      <div className="pond-badge">{statusLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HOW IT WORKS */}
      <section className="how" id="how">
        <div className="container">
          <div className="section-label">Cara Tempah</div>
          <h2 className="section-title">4 Langkah<br />Mudah</h2>
          <p className="section-desc">Proses tempahan yang simple dan cepat — kurang dari 2 minit siap.</p>
          <div className="steps">
            <div className="step">
              <div className="step-num">01</div>
              <div className="step-icon">📋</div>
              <h3>Pilih Pertandingan</h3>
              <p>Tengok senarai pertandingan yang available dan pilih yang berkenan.</p>
            </div>
            <div className="step">
              <div className="step-num">02</div>
              <div className="step-icon">🎯</div>
              <h3>Pilih Kolam &amp; Tempat</h3>
              <p>Pilih kolam dan nombor tempat duduk yang anda suka.</p>
            </div>
            <div className="step">
              <div className="step-num">03</div>
              <div className="step-icon">💳</div>
              <h3>Buat Bayaran</h3>
              <p>Bayar melalui transfer bank atau deposit 50%. Upload resit.</p>
            </div>
            <div className="step">
              <div className="step-num">04</div>
              <div className="step-icon">✅</div>
              <h3>Dapat Pengesahan</h3>
              <p>Staff akan sahkan tempahan. Anda akan terima notifikasi.</p>
            </div>
          </div>
        </div>
      </section>

      {/* PRIZES */}
      <section className="prizes" id="prizes">
        <div className="container">
          <div className="section-label">Ganjaran</div>
          <h2 className="section-title">Hadiah &amp;<br />Ganjaran</h2>
          <p className="section-desc">Hadiah wang tunai untuk pemenang setiap pertandingan.</p>
          <table className="prizes-table">
            <thead>
              <tr><th>Tempat</th><th>Kategori</th><th>Hadiah</th></tr>
            </thead>
            <tbody>
              {selectedCompetition?.prizes?.length ? selectedCompetition.prizes.map((p: any, i: number) => (
                <tr key={i} className={i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : ''}>
                  <td>#{i + 1}</td>
                  <td>{p.label || `Tempat ${i + 1}`}</td>
                  <td className="prize-amount">{p.prize || (p.amount ? `RM ${p.amount}` : 'RM ???')}</td>
                </tr>
              )) : (
                <>
                  <tr className="rank-1"><td>🥇 #1</td><td>Juara</td><td className="prize-amount">RM ??? </td></tr>
                  <tr className="rank-2"><td>🥈 #2</td><td>Naib Juara</td><td className="prize-amount">RM ???</td></tr>
                  <tr className="rank-3"><td>🥉 #3</td><td>Ketiga</td><td className="prize-amount">RM ???</td></tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* PAYMENT */}
      <section className="payment">
        <div className="container">
          <div className="section-label">Bayaran</div>
          <h2 className="section-title">Cara<br />Pembayaran</h2>
          <p className="section-desc">Pilih kaedah bayaran yang sesuai. Semua transaksi selamat dan dilindungi.</p>
          <div className="payment-cards">
            <div className="payment-card payment-highlight">
              <div className="payment-icon">📱</div>
              <h3>QR Transfer</h3>
              <p>Scan QR code dan buat pembayaran terus dari aplikasi bank anda.</p>
            </div>
            <div className="payment-card">
              <div className="payment-icon">💵</div>
              <h3>Tunai</h3>
              <p>Bayar secara tunai di kaunter pada hari pertandingan.</p>
            </div>
            <div className="payment-card">
              <div className="payment-icon">💳</div>
              <h3>Deposit 50%</h3>
              <p>Bayar separuh untuk mengesahkan tempahan. Baki pada hari event.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section className="contact" id="contact">
        <div className="container">
          <div className="section-label" style={{ color: 'var(--gold)' }}>Hubungi Kami</div>
          <h2 className="section-title" style={{ color: '#fff' }}>Ada Soalan?</h2>
          <p className="section-desc" style={{ color: '#8B6A4F' }}>Jangan segan untuk hubungi kami. Kami sedia membantu.</p>
          <div className="contact-info">
            <div className="contact-item">
              <div className="contact-item-icon">📞</div>
              <h4>Telefon</h4>
              <p>{db.settings?.whatsapp || '+60 1X-XXX XXXX'}</p>
            </div>
            <div className="contact-item">
              <div className="contact-item-icon">💬</div>
              <h4>WhatsApp</h4>
              <p><a href={`https://wa.me/${(db.settings?.whatsapp || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer">{db.settings?.whatsapp || '+60 1X-XXX XXXX'}</a></p>
            </div>
            <div className="contact-item">
              <div className="contact-item-icon">📧</div>
              <h4>Emel</h4>
              <p>{db.settings?.email || 'info@kks.com'}</p>
            </div>
            <div className="contact-item">
              <div className="contact-item-icon">📍</div>
              <h4>Alamat</h4>
              <p>{db.settings?.location || 'Alor Setar, Kedah'}</p>
            </div>
          </div>
          <div className="cta-block">
            <p>Jom sertai komuniti pemancing KKS!</p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={() => handleNavigation('competitions')}>Pilih Pertandingan</button>
              <a className="btn-outline" href={`https://wa.me/${(db.settings?.whatsapp || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer">WhatsApp Kami</a>
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
        if (!selectedCompetition?.id) {
          return (
            <div className="booking-layout">
              <div className="booking-main">
                <div className="panel" style={{ textAlign: 'center', padding: '2rem' }}>
                  <div className="panel-title">Pilih Pertandingan Dahulu</div>
                  <div className="panel-subtitle">Sebelum memilih kolam dan tempat, sila pilih satu pertandingan dari halaman utama.</div>
                  <button className="btn btn-primary mt-4" onClick={() => { goHome(); setHomeScrollTarget('competitions'); }}>Pergi Ke Pertandingan</button>
                </div>
              </div>
            </div>
          );
        }
        const bookedPond = activePond;
        return (
          <div className="booking-layout">
            <div className="booking-main">
              <div className="progress-bar">
                <div className={`progress-step ${!selectedPond ? 'active' : 'completed'}`} onClick={() => {}}>
                  <div className="step-circle-sm">1</div>
                  <div className="step-info"><div className="step-label">Langkah 1</div><div className="step-name">Pilih Kolam</div></div>
                </div>
                <div className={`progress-step ${selectedPond && !selectedSeats.length ? 'active' : selectedSeats.length ? 'completed' : ''}`}>
                  <div className="step-circle-sm">2</div>
                  <div className="step-info"><div className="step-label">Langkah 2</div><div className="step-name">Pilih Tempat</div></div>
                </div>
                <div className={`progress-step ${selectedSeats.length && !receiptData ? 'active' : receiptData ? 'completed' : ''}`}>
                  <div className="step-circle-sm">3</div>
                  <div className="step-info"><div className="step-label">Langkah 3</div><div className="step-name">Maklumat</div></div>
                </div>
                <div className={`progress-step ${receiptData ? 'active' : ''}`}>
                  <div className="step-circle-sm">4</div>
                  <div className="step-info"><div className="step-label">Langkah 4</div><div className="step-name">Bayaran</div></div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">Pilih Kolam & Tempat Duduk</div>
                <div className="panel-subtitle">Pilih kolam yang anda inginkan, kemudian pilih tempat duduk yang tersedia.</div>
                <BookingSidebar ponds={bookablePonds} selectedPond={selectedPond} onSelectPond={handleSelectPond} />
              </div>

              {bookedPond && (
                <SeatMap pond={bookedPond} selectedSeats={selectedSeats} onToggleSeat={toggleSeat} />
              )}

              {selectedSeats.length > 0 && (
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
              )}
            </div>

            <div className="summary-card">
              <div className="summary-title">Ringkasan Tempahan</div>
              {selectedCompetition?.name && <div className="timer-chip">🏆 {selectedCompetition.name}</div>}
              <div className="divider"></div>
              <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <strong style={{ color: 'var(--text)' }}>Kolam:</strong> {bookedPond?.name || 'Belum dipilih'}
              </div>
              <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <strong style={{ color: 'var(--text)' }}>Pegs:</strong>{' '}
                {selectedSeats.length ? (
                  <span className="selected-pills" style={{ display: 'inline-flex' }}>
                    {selectedSeats.map(s => <span key={s} className="seat-pill">{s}</span>)}
                  </span>
                ) : 'Belum dipilih'}
              </div>
              <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <strong style={{ color: 'var(--text)' }}>Bayaran:</strong> {payType === 'deposit' ? '50% Deposit' : 'Penuh'}
              </div>
              <div className="divider"></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '.85rem' }}>Jumlah</span>
                <span style={{ fontFamily: 'var(--font-heading)', fontSize: '1.5rem', color: 'var(--gold)' }}>
                  RM {bookedPond && selectedSeats.length
                    ? (selectedSeats.reduce((sum, seatNum) => {
                        const seat = bookedPond.seats.find(s => s.num === seatNum);
                        return sum + (seat?.price || 0);
                      }, 0) * (payType === 'deposit' ? 0.5 : 1)).toFixed(0)
                    : '0'}
                </span>
              </div>
            </div>
          </div>
        );
      }
      case 'live':
        return <LiveResults comp={selectedCompetition || db.comp} scores={db.scores} ponds={competitionScopedPonds} bookings={db.bookings.filter((booking) => (booking.competitionId || db.comp.id) === (selectedCompetition?.id || db.comp.id))} user={user} />;
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px', marginBottom: '28px' }}>
              <div>
                <div style={{ fontFamily: 'var(--fd)', fontSize: '28px', fontWeight: 800, letterSpacing: '.5px', marginBottom: '4px' }}>My Bookings</div>
                <div style={{ color: 'var(--muted)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--green-bright)' }}></span>
                  {user.name} · {user.email}
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => goToBook()} style={{ borderRadius: '12px' }}>
                <i className="fa-solid fa-plus"></i> New Booking
              </button>
            </div>
            {userBookings.length ? userBookings.map(b => (
              <div key={b.id} className="card booking-row" onClick={() => { setSelectedBooking(b); setBookingDetailsOpen(true); }}>
                <div>
                  <div className="booking-id">{b.id}</div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>{fmt(b.createdAt)}</div>
                </div>
                <div>
                  <div className="booking-pond">{b.pondName}</div>
                  <div style={{ fontSize: '11px', color: 'var(--gold)', marginTop: '2px', fontWeight: 600 }}>{b.competitionName || selectedCompetition?.name || db.comp.name}</div>
                  <div className="booking-meta">
                    <span>📍 Pegs: {b.seats.join(', ')}</span>
                    <span>💰 RM {b.amount}</span>
                    <span>{b.paymentType === 'deposit' ? '💳 Deposit' : '💳 Full'}</span>
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
                  Competition: {lastBooking.competitionName || selectedCompetition?.name || db.comp.name}<br />
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
      {currentSection === 'home' && (
        <footer>
          <div className="footer-logo">KKS Fishing</div>
          <div className="footer-copy">&copy; {new Date().getFullYear()} Kolam Keli Sayang. Semua hak terpelihara.</div>
        </footer>
      )}
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
        competitions={db.competitions}
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
