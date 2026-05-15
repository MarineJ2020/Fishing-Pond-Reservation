import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './styles.css';
import Navbar from './components/Navbar';
import SecondaryMobileNav from './components/SecondaryMobileNav';
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
import { doc, onSnapshot } from 'firebase/firestore';
import { db as firestoreDb } from '../lib/firebase';

const AppContent: React.FC = () => {
  const {
    db,
    selectedPond,
    selectedCompetitionId,
    selectedSeats,
    payType,
    receiptData,
    user,
    adminProxyName,
    adminProxyEmail,
    setPond,
    setSelectedCompetitionId,
    toggleSeat,
    setSeats,
    setPayType,
    setReceiptData,
    setAdminProxyName,
    setAdminProxyEmail,
    submitBooking,
    updateDB,
    reloadDB
  } = useBooking();
  const { addToast, setAuthModalOpen, authModalOpen, cmsModalOpen, setCMSModalOpen } = useUI();
  const { currentSection, goToSection, goToBook, goHome, goToLive, goToMyBookings, goToConfirmed } = useNavigation();
  const location = useLocation();
  const { login, register, signInWithGoogle, logout, authReady } = useAuth();

  const [homeScrollTarget, setHomeScrollTarget] = useState<string | null>(null);
  const [pondPickerOpen, setPondPickerOpen] = useState(false);
  const competitionScrollerRef = useRef<HTMLDivElement | null>(null);
  const competitionInteractionRef = useRef({ isDragging: false, startX: 0, startScrollLeft: 0, blockClick: false });
  const competitionSnapTimeoutRef = useRef<number | null>(null);
  const competitionSnapResumeTimeoutRef = useRef<number | null>(null);
  const competitionTouchRef = useRef({ isTouching: false, startX: 0, startScrollLeft: 0 });
  const [isDraggingCompetitions, setIsDraggingCompetitions] = useState(false);
  const [isInteractingCompetitions, setIsInteractingCompetitions] = useState(false);
  const [focusedCompetitionKey, setFocusedCompetitionKey] = useState('');
  const [countdown, setCountdown] = useState({ days: '--', hours: '--', mins: '--', secs: '--', status: 'upcoming' });
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(false);
  const [prizeIdx, setPrizeIdx] = useState(0);
  const [prizePhase, setPrizePhase] = useState<'idle' | 'out' | 'in'>('idle');
  const [prizeSlideDir, setPrizeSlideDir] = useState<'left' | 'right'>('left');
  const [prizeMinH, setPrizeMinH] = useState(0);
  const prizeLastInteractRef = useRef<number>(Date.now());
  const prizeAutoPlayRef = useRef<number | null>(null);
  const prizeTransRef = useRef<number | null>(null);
  const prizeIdxRef = useRef(0);
  const prizePhaseRef = useRef<'idle' | 'out' | 'in'>('idle');
  const prizeMinHRef = useRef(0);
  const prizeWrapRef = useRef<HTMLDivElement | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [pondMapOpen, setPondMapOpen] = useState(false);

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
    const pondSeatCaps = selectedCompetition?.pondSeats || {};
    const occupied = new Set<string>();
    db.bookings.forEach((booking) => {
      const bookingCompetitionId = booking.competitionId || db.comp?.id || '';
      if (bookingCompetitionId !== activeCompetitionId) return;
      if (booking.status !== 'pending' && booking.status !== 'confirmed') return;
      booking.seats.forEach((seatNum) => occupied.add(`${booking.pondId}-${seatNum}`));
    });

    const scopedPonds = db.ponds.map((pond) => {
      const pondKey = pond._docId || pond.id.toString();
      const capRaw = pondSeatCaps[pondKey] ?? pondSeatCaps[pond.id.toString()];
      const cap = typeof capRaw === 'number'
        ? Math.max(0, Math.min(pond.seats.length, Math.floor(capRaw)))
        : pond.seats.length;
      const seatsInCompetition = [...pond.seats]
        .sort((a, b) => a.num - b.num)
        .slice(0, cap)
        .map((seat) => ({
          ...seat,
          status: occupied.has(`${pond.id}-${seat.num}`) ? 'booked' : 'available'
        }));

      return {
        ...pond,
        seats: seatsInCompetition,
      };
    });

    if (!allowedPondIds.length) return scopedPonds;
    return scopedPonds.filter((pond) => {
      const docId = pond._docId || pond.id.toString();
      return allowedPondIds.includes(docId);
    });
  }, [db.bookings, db.comp?.id, db.ponds, selectedCompetition?.activePondIds, selectedCompetition?.id, selectedCompetition?.pondSeats]);

  const availablePegs = useMemo(
    () => competitionScopedPonds.reduce((sum, pond) => sum + pond.seats.filter(s => s.status === 'available').length, 0),
    [competitionScopedPonds]
  );

  // Per-competition available seat counts (for competition cards on homepage)
  const competitionAvailableSeats = useMemo(() => {
    const result = new Map<string, number>();
    competitions.forEach((comp) => {
      const compId = comp.id || '';
      const allowedPondIds: string[] = comp.activePondIds || [];
      const pondSeatCaps: Record<string, number> = comp.pondSeats || {};
      const occupied = new Set<string>();
      db.bookings.forEach((booking) => {
        const bookingCompId = booking.competitionId || db.comp?.id || '';
        if (bookingCompId !== compId) return;
        if (booking.status !== 'pending' && booking.status !== 'confirmed') return;
        booking.seats.forEach((seatNum: number) => occupied.add(`${booking.pondId}-${seatNum}`));
      });
      const scopedPonds = db.ponds.filter((pond) => {
        if (!allowedPondIds.length) return true;
        const docId = pond._docId || pond.id.toString();
        return allowedPondIds.includes(docId);
      });
      const count = scopedPonds.reduce((sum, pond) => {
        const pondKey = pond._docId || pond.id.toString();
        const capRaw = pondSeatCaps[pondKey] ?? pondSeatCaps[pond.id.toString()];
        const cap = typeof capRaw === 'number'
          ? Math.max(0, Math.min(pond.seats.length, Math.floor(capRaw)))
          : pond.seats.length;
        const available = [...pond.seats]
          .sort((a, b) => a.num - b.num)
          .slice(0, cap)
          .filter((seat) => !occupied.has(`${pond.id}-${seat.num}`)).length;
        return sum + available;
      }, 0);
      result.set(compId, count);
    });
    return result;
  }, [competitions, db.bookings, db.comp?.id, db.ponds]);

  const totalPonds = db.ponds.length;
  const confirmedBookings = db.bookings.filter(b => b.status === 'confirmed').length;
  const bookablePonds = useMemo(() => competitionScopedPonds.filter((p) => p.open), [competitionScopedPonds]);
  const activePond = selectedPond
    ? bookablePonds.find((p) => p.id === selectedPond) ?? null
    : null;

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

  const handleSelectCompetitionForBooking = (competitionId?: string) => {
    if (!competitionId) return;
    if (competitionId === selectedCompetitionId) return;
    setSelectedCompetitionId(competitionId);
    setPond(null);
    setSeats([]);
    setReceiptData(null, null);
    addToast('Pertandingan tempahan telah ditukar.', 'info');
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

    let booking = null;
    try {
      booking = await submitBooking(pond);
    } catch (err: any) {
      setBookingError(err?.message || 'Ralat semasa menghantar tempahan. Sila cuba lagi.');
      return;
    }
    if (booking) {
      addToast('Booking submitted! Staff will confirm via email.', 'success');
      goToConfirmed();
    }
  };

  const handleReceiptChange = (file: File) => {
    const MAX_DIM = 1600;
    const QUALITY = 0.82;
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objectUrl);
      const compressed = canvas.toDataURL('image/jpeg', QUALITY);
      const bytes = atob(compressed.split(',')[1]);
      const buf = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
      const compFile = new File([buf], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
      setReceiptData(compressed, compFile);
    };
    img.onerror = () => {
      // Non-image file (e.g. PDF) — fall back to raw read
      URL.revokeObjectURL(objectUrl);
      const reader = new FileReader();
      reader.onload = (e) => setReceiptData(e.target?.result as string, file);
      reader.readAsDataURL(file);
    };
    img.src = objectUrl;
  };

  const handleLogin = async (email: string, pass: string) => {
    const success = await login(email, pass);
    if (success) {
      setAuthModalOpen(false);
      goToMyBookings();
    }
    return success;
  };

  const handleRegister = async (name: string, email: string, phone: string, pass: string) => {
    return await register(name, email, phone, pass);
  };

  const handleGoogleLogin = async () => {
    const success = await signInWithGoogle();
    if (success) {
      setAuthModalOpen(false);
      goToMyBookings();
    }
    return success;
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

  useEffect(() => {
    if (!selectedPond) return;
    const stillAvailable = bookablePonds.some((pond) => pond.id === selectedPond);
    if (!stillAvailable) setPond(null);
  }, [bookablePonds, selectedPond, setPond]);

  // Real-time guard: watch selected seat documents; auto-deselect if another user books one
  const selectedSeatsRef = useRef(selectedSeats);
  useEffect(() => { selectedSeatsRef.current = selectedSeats; }, [selectedSeats]);

  useEffect(() => {
    if (!selectedSeats.length || !selectedPond) return;
    const pond = db.ponds.find(p => p.id === selectedPond);
    if (!pond) return;
    const watchedSeats = selectedSeats
      .map(num => pond.seats.find(s => s.num === num))
      .filter((s): s is NonNullable<typeof s> => !!s?.id);
    if (!watchedSeats.length) return;

    const unsubs = watchedSeats.map(seat =>
      onSnapshot(doc(firestoreDb, 'seats', seat.id!), (snap) => {
        const data = snap.data();
        if (data && data.status !== 'available' && selectedSeatsRef.current.includes(seat.num)) {
          setSeats(selectedSeatsRef.current.filter(n => n !== seat.num));
          addToast(`Tempat #${seat.num} baru sahaja ditempah oleh orang lain`, 'error');
        }
      })
    );
    return () => unsubs.forEach(u => u());
  }, [selectedSeats, selectedPond, db.ponds]);

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

  const switchPrize = (dir: 'prev' | 'next') => {
    prizeLastInteractRef.current = Date.now();
    const len = competitions.length;
    if (len <= 1) return;
    const nextIdx = dir === 'next'
      ? (prizeIdxRef.current + 1) % len
      : (prizeIdxRef.current - 1 + len) % len;
    if (prizeTransRef.current) window.clearTimeout(prizeTransRef.current);
    setPrizeSlideDir(dir === 'next' ? 'left' : 'right');
    setPrizePhase('out'); prizePhaseRef.current = 'out';
    prizeTransRef.current = window.setTimeout(() => {
      prizeIdxRef.current = nextIdx;
      setPrizeIdx(nextIdx);
      setPrizePhase('in'); prizePhaseRef.current = 'in';
      prizeTransRef.current = window.setTimeout(() => {
        setPrizePhase('idle'); prizePhaseRef.current = 'idle';
      }, 420);
    }, 220);
  };

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

  const resumeSnapAfterRelease = (snapDelay = 70, resumeDelay = 320) => {
    scheduleCompetitionSnap(snapDelay);
    if (competitionSnapResumeTimeoutRef.current) {
      window.clearTimeout(competitionSnapResumeTimeoutRef.current);
      competitionSnapResumeTimeoutRef.current = null;
    }
    competitionSnapResumeTimeoutRef.current = window.setTimeout(() => {
      setIsInteractingCompetitions(false);
      competitionSnapResumeTimeoutRef.current = null;
    }, resumeDelay);
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
    if (competitionSnapResumeTimeoutRef.current) {
      window.clearTimeout(competitionSnapResumeTimeoutRef.current);
    }
  }, []);

  // Prize section autoplay — advances every 5s if inactive for 7s
  useEffect(() => {
    if (competitions.length <= 1) return;
    const len = competitions.length;
    prizeAutoPlayRef.current = window.setInterval(() => {
      if (Date.now() - prizeLastInteractRef.current < 7000) return;
      if (prizePhaseRef.current !== 'idle') return;
      const nextIdx = (prizeIdxRef.current + 1) % len;
      if (prizeTransRef.current) window.clearTimeout(prizeTransRef.current);
      setPrizeSlideDir('left');
      setPrizePhase('out'); prizePhaseRef.current = 'out';
      prizeTransRef.current = window.setTimeout(() => {
        prizeIdxRef.current = nextIdx;
        setPrizeIdx(nextIdx);
        setPrizePhase('in'); prizePhaseRef.current = 'in';
        prizeTransRef.current = window.setTimeout(() => {
          setPrizePhase('idle'); prizePhaseRef.current = 'idle';
        }, 420);
      }, 220);
    }, 5000);
    return () => { if (prizeAutoPlayRef.current) window.clearInterval(prizeAutoPlayRef.current); };
  }, [competitions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock prizes section min-height at its high-water mark to prevent layout shifts
  useLayoutEffect(() => {
    const el = prizeWrapRef.current;
    if (!el) return;
    const h = el.scrollHeight;
    if (h > prizeMinHRef.current) {
      prizeMinHRef.current = h;
      setPrizeMinH(h);
    }
  }, [prizeIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const track = competitionScrollerRef.current;
    if (!track) return;
    const handleWheel = (event: WheelEvent) => {
      const canScroll = track.scrollWidth > track.clientWidth;
      if (!canScroll) return;
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      track.scrollBy({ left: event.deltaY, behavior: 'auto' });
      scheduleCompetitionSnap();
    };
    track.addEventListener('wheel', handleWheel, { passive: false });
    return () => track.removeEventListener('wheel', handleWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (competitionSnapResumeTimeoutRef.current) {
      window.clearTimeout(competitionSnapResumeTimeoutRef.current);
      competitionSnapResumeTimeoutRef.current = null;
    }
    setIsDraggingCompetitions(true);
    setIsInteractingCompetitions(true);
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
    resumeSnapAfterRelease(60, 320);
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
    if (competitionSnapResumeTimeoutRef.current) {
      window.clearTimeout(competitionSnapResumeTimeoutRef.current);
      competitionSnapResumeTimeoutRef.current = null;
    }
    setIsInteractingCompetitions(true);
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
    resumeSnapAfterRelease(80, 340);
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
            <a className="btn-outline" onClick={() => handleNavigation('prizes')}>Lihat Hadiah</a>
          </div>
          <div className="hero-stats">
            <div className="hero-stat"><div className="hero-stat-num">{totalPonds}</div><div className="hero-stat-label">Kolam Aktif</div></div>
            <div className="hero-stat"><div className="hero-stat-num">{availablePegs}</div><div className="hero-stat-label">Tempat Peserta</div></div>
            <div className="hero-stat"><div className="hero-stat-num">RM{totalPrizePool > 0 ? (totalPrizePool / 1000).toFixed(0) + 'K' : '50K+'}</div><div className="hero-stat-label">Hadiah Setahun</div></div>
            <div className="hero-stat"><div className="hero-stat-num">{totalRegistered}+</div><div className="hero-stat-label">Ahli Berdaftar</div></div>
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
              className={`comp-scroll-track ${isDraggingCompetitions ? 'is-dragging' : ''} ${isInteractingCompetitions ? 'no-snap' : ''}`}
              ref={competitionScrollerRef}
              onMouseDown={handleCompetitionMouseDown}
              onMouseMove={handleCompetitionMouseMove}
              onMouseUp={stopCompetitionDrag}
              onMouseLeave={stopCompetitionDrag}
              onTouchStart={handleCompetitionTouchStart}
              onTouchMove={handleCompetitionTouchMove}
              onTouchEnd={handleCompetitionTouchEnd}
              onTouchCancel={handleCompetitionTouchEnd}
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
                  <div className="comp-detail"><span className="comp-detail-icon">📍</span> {db.settings?.location || 'Lokasi akan diumumkan'}</div>
                  <div className="comp-detail"><span className="comp-detail-icon">👥</span> {competitionAvailableSeats.get(competition.id ?? '') ?? availablePegs} tempat tersedia</div>
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
                    Tempah
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
          {(() => {
            const pComp = competitions[prizeIdx] ?? competitions[0];
            const prizesData: any[] = pComp?.prizes || [];
            const rows = prizesData.length
              ? prizesData.map((p: any, i: number) => (
                  <tr key={i} className={i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : ''}>
                    <td>#{i + 1}</td>
                    <td>{p.label || `Tempat ${i + 1}`}</td>
                    <td className="prize-amount">{p.prize || (p.amount ? `RM ${p.amount}` : 'RM ???')}</td>
                  </tr>
                ))
              : [
                  <tr key="1" className="rank-1"><td>🥇 #1</td><td>Juara</td><td className="prize-amount">RM ???</td></tr>,
                  <tr key="2" className="rank-2"><td>🥈 #2</td><td>Naib Juara</td><td className="prize-amount">RM ???</td></tr>,
                  <tr key="3" className="rank-3"><td>🥉 #3</td><td>Ketiga</td><td className="prize-amount">RM ???</td></tr>,
                ];
            const table = (
              <table className="prizes-table">
                <thead><tr><th>Tempat</th><th>Kategori</th><th>Hadiah</th></tr></thead>
                <tbody>{rows}</tbody>
              </table>
            );
            if (competitions.length <= 1) return table;
            return (
              <>
                <div className="prize-nav-wrap">
                  <button className="prize-nav-btn" onClick={() => switchPrize('prev')} aria-label="Pertandingan sebelumnya">‹</button>
                  <div
                    ref={prizeWrapRef}
                    className={`prize-table-wrap${prizePhase !== 'idle' ? ` prize-phase-${prizePhase}-${prizeSlideDir}` : ''}`}
                    style={prizeMinH > 0 ? { minHeight: prizeMinH } : undefined}
                  >
                    <div className="prize-comp-label">{pComp?.name}</div>
                    {table}
                  </div>
                  <button className="prize-nav-btn" onClick={() => switchPrize('next')} aria-label="Pertandingan seterusnya">›</button>
                </div>
                <div className="prize-dots">
                  {competitions.map((_, di) => (
                    <button
                      key={di}
                      className={`prize-dot${di === prizeIdx ? ' active' : ''}`}
                      onClick={() => {
                        prizeLastInteractRef.current = Date.now();
                        if (prizeTransRef.current) window.clearTimeout(prizeTransRef.current);
                        const sDir: 'left' | 'right' = di > prizeIdxRef.current ? 'left' : 'right';
                        setPrizeSlideDir(sDir);
                        setPrizePhase('out'); prizePhaseRef.current = 'out';
                        prizeTransRef.current = window.setTimeout(() => {
                          prizeIdxRef.current = di;
                          setPrizeIdx(di);
                          setPrizePhase('in'); prizePhaseRef.current = 'in';
                          prizeTransRef.current = window.setTimeout(() => {
                            setPrizePhase('idle'); prizePhaseRef.current = 'idle';
                          }, 420);
                        }, 220);
                      }}
                      aria-label={`Pertandingan ${di + 1}`}
                    />
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      </section>

      {/* PAYMENT */}
      <section className="payment" id="payment">
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
          <h2 className="section-title" style={{ color: '#fff' }}>{db.settings?.contactTitle || 'Ada Soalan?'}</h2>
          <p className="section-desc" style={{ color: '#8B6A4F' }}>{db.settings?.contactSubtitle || 'Jangan segan untuk hubungi kami. Kami sedia membantu.'}</p>
          <div className="contact-info">
            <div className="contact-item">
              <div className="contact-item-icon">📞</div>
              <h4>Telefon</h4>
              <p>{db.settings?.phone || db.settings?.whatsapp || '+60 1X-XXX XXXX'}</p>
            </div>
            <div className="contact-item">
              <div className="contact-item-icon">💬</div>
              <h4>WhatsApp</h4>
              <p><a href={`https://wa.me/${(db.settings?.whatsapp || db.settings?.phone || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer">{db.settings?.whatsapp || db.settings?.phone || '+60 1X-XXX XXXX'}</a></p>
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
              <a className="btn-outline" href={`https://wa.me/${(db.settings?.whatsapp || db.settings?.phone || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer">WhatsApp Kami</a>
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
        const hasCompetition = Boolean(selectedCompetition?.id);
        const hasPond = Boolean(bookedPond);
        const hasSeats = selectedSeats.length > 0;
        return (
          <div className="booking-layout">
            <div className="booking-main">
              <div className="progress-bar">
                <div className={`progress-step ${!hasCompetition ? 'active' : 'completed'}`}>
                  <div className="step-circle-sm">1</div>
                  <div className="step-info"><div className="step-label">Langkah 1</div><div className="step-name">Pilih Pertandingan</div></div>
                </div>
                <div className={`progress-step ${hasCompetition && !hasPond ? 'active' : hasPond ? 'completed' : ''}`}>
                  <div className="step-circle-sm">2</div>
                  <div className="step-info"><div className="step-label">Langkah 2</div><div className="step-name">Pilih Kolam</div></div>
                </div>
                <div className={`progress-step ${hasPond && !hasSeats ? 'active' : hasSeats ? 'completed' : ''}`}>
                  <div className="step-circle-sm">3</div>
                  <div className="step-info"><div className="step-label">Langkah 3</div><div className="step-name">Pilih Tempat</div></div>
                </div>
                <div className={`progress-step ${hasSeats && !receiptData ? 'active' : receiptData ? 'completed' : ''}`}>
                  <div className="step-circle-sm">4</div>
                  <div className="step-info"><div className="step-label">Langkah 4</div><div className="step-name">Maklumat</div></div>
                </div>
                <div className={`progress-step ${receiptData ? 'active' : ''}`}>
                  <div className="step-circle-sm">5</div>
                  <div className="step-info"><div className="step-label">Langkah 5</div><div className="step-name">Bayaran</div></div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">Pilih Pertandingan</div>
                <div className="panel-subtitle">Pilih pertandingan untuk tempahan ini. Menukar pertandingan akan reset pilihan kolam, peg, dan resit bayaran.</div>
                <div className="pond-tabs">
                  {competitions.map((competition) => (
                    <div
                      key={competition.id || competition.name}
                      className={`pond-tab ${(selectedCompetition?.id || '') === (competition.id || '') ? 'active' : ''}`}
                      onClick={() => handleSelectCompetitionForBooking(competition.id)}
                    >
                      {competition.name}
                    </div>
                  ))}
                </div>
              </div>

              {hasCompetition && (
                <div className="panel booking-stage-enter">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '4px' }}>
                    <div>
                      <div className="panel-title">Pilih Kolam</div>
                      <div className="panel-subtitle">Pilih kolam yang anda inginkan untuk pertandingan ini.</div>
                    </div>
                    {db.settings.pondMapImg && (
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                        onClick={() => setPondMapOpen(true)}
                      >
                        Semak Susunan Kolam
                      </button>
                    )}
                  </div>
                  <BookingSidebar ponds={bookablePonds} selectedPond={selectedPond} onSelectPond={handleSelectPond} />
                </div>
              )}

              {hasPond && bookedPond && (
                <div className="booking-stage-enter">
                  <SeatMap pond={bookedPond} selectedSeats={selectedSeats} onToggleSeat={toggleSeat} useLegacyView={!!db.settings.useLegacyPondView} />
                </div>
              )}

              {hasSeats && bookedPond && (
                <div className="booking-stage-enter">
                  <BookingForm
                    user={user}
                    pond={bookedPond}
                    selectedSeats={selectedSeats}
                    payType={payType}
                    receiptData={receiptData}
                    adminProxyName={adminProxyName}
                    adminProxyEmail={adminProxyEmail}
                    onSetPayType={setPayType}
                    onHandleReceiptChange={handleReceiptChange}
                    onClearReceipt={() => setReceiptData(null, null)}
                    onSubmitBooking={handleSubmitBooking}
                    onOpenAuth={() => setAuthModalOpen(true)}
                    onAdminProxyNameChange={setAdminProxyName}
                    onAdminProxyEmailChange={setAdminProxyEmail}
                  />
                </div>
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
        return <LiveResults comp={selectedCompetition || db.comp} competitions={db.competitions?.length ? db.competitions : [db.comp]} scores={db.scores} ponds={db.ponds} bookings={db.bookings} user={user} />;
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
        return (
          <div style={{ textAlign: 'center', padding: '6rem 2rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎣</div>
            <h2 style={{ marginBottom: '0.5rem' }}>Halaman tidak dijumpai</h2>
            <p style={{ marginBottom: '1.5rem', fontSize: '0.9rem' }}>Halaman yang anda cari tidak wujud.</p>
            <button className="btn btn-primary" onClick={() => goHome()}>Kembali ke Utama</button>
          </div>
        );
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
      {currentSection === 'home' && <SecondaryMobileNav onSectionChange={handleNavigation} />}
      {renderSection()}
      {location.pathname === '/' && (
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
        onGoogleLogin={handleGoogleLogin}
      />
      <CMSModal
        isOpen={cmsModalOpen}
        onClose={() => setCMSModalOpen(false)}
        onGoToBooking={() => { setCMSModalOpen(false); goToBook(); }}
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

      {/* Pond map popup */}
      {pondMapOpen && db.settings.pondMapImg && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem', animation: 'fadeIn 0.18s ease',
          }}
          onClick={() => setPondMapOpen(false)}
        >
          <div
            style={{
              background: 'var(--surface, #1a1a2e)', borderRadius: '1rem',
              maxWidth: '900px', width: '100%',
              boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
              animation: 'slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>🗺 Susunan Kolam</div>
              <button
                onClick={() => setPondMapOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted, #aaa)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
                aria-label="Tutup"
              >
                ×
              </button>
            </div>
            <div style={{ padding: '1.25rem', textAlign: 'center' }}>
              <img
                src={db.settings.pondMapImg}
                alt="Susunan kolam"
                style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain', borderRadius: '8px' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Seat conflict error dialog */}
      {bookingError && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem', animation: 'fadeIn 0.18s ease',
          }}
          onClick={() => setBookingError(null)}
        >
          <div
            style={{
              background: 'var(--surface, #1a1a2e)', borderRadius: '1.25rem',
              padding: '2.5rem 2rem 2rem', maxWidth: 400, width: '100%',
              boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
              textAlign: 'center', animation: 'slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 1.25rem',
              background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.75rem',
            }}>
              🚫
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.6rem', color: 'var(--text, #fff)' }}>
              Tempat Tidak Tersedia
            </div>
            <div style={{ color: 'var(--text-muted, #aaa)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: '1.75rem' }}>
              {bookingError}
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setBookingError(null)}
            >
              Pilih Tempat Lain
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default AppContent;
