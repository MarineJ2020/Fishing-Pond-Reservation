import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './styles.css';
import './styles.v4.css';
import './styles.v5.css';
import { compressImageToDataUrl } from './utils/imageStorage';
import Navbar from './components/Navbar';
import SecondaryMobileNav from './components/SecondaryMobileNav';
import SeatMap from './components/SeatMap';
import BookingForm from './components/BookingForm';
import BookingChoiceModal from './components/BookingChoiceModal';
import DocPreviewModal from './components/DocPreviewModal';
import LiveResults from './components/LiveResults';
import AuthModal from './components/AuthModal';
import CMSModal from './components/CMSModal';
import BookingDetailsModal from './components/BookingDetailsModal';
import CompleteProfileModal from './components/CompleteProfileModal';
import BookingDetailContent from './components/BookingDetailContent';
import ProfileContent from './components/ProfileContent';
import Toast from './components/Toast';
import Footer from './components/Footer';
import CustomLandingHtml from './components/CustomLandingHtml';
import { useBooking } from './context/BookingContext';
import { useUI } from './context/UIContext';
import { useNavigation } from './hooks/useNavigation';
import { useAuth } from './hooks/useAuth';
import { useCountdown } from './hooks/useCountdown';
import { useSEO } from './hooks/useSEO';
import { fmt, formatDate } from './utils';
import { formatSeat, pondDisplayName } from './utils/seatLabel';
import { countOutstanding, outstandingBalance } from './utils/booking';
import { trackEvent } from './utils/analytics';
import { isCompetitionEnded, isBookingOpen, bookingWindowLabel, getBookingWindowState } from './utils/competition';
import { normalizePdfUrl } from './utils/pdfStorage';
import { Booking } from './types';
import { asset } from './config/landingAssets';

/**
 * Renders a CMS-edited headline where `*word(s)*` becomes the accent-colored
 * <span> the design already uses (e.g. 'Bukan *Kolam* Biasa' → Bukan <span>Kolam</span> Biasa).
 */
const renderHeadline = (text: string): React.ReactNode => {
  const parts = text.split(/\*(.+?)\*/g);
  return parts.map((part, i) => (i % 2 === 1 ? <span key={i}>{part}</span> : part));
};

const bookingPancangList = (booking: Booking): string => {
  const selections = booking.pondSelections?.length
    ? booking.pondSelections
    : [{ pondCode: booking.pondCode, seats: booking.seats }];
  return selections.flatMap((selection) => selection.seats.map(
    (seatNum) => formatSeat(selection.pondCode, seatNum),
  )).join(', ');
};

const bookingStatusLabel = (status: Booking['status']): string => {
  if (status === 'confirmed') return 'Disahkan';
  if (status === 'rejected') return 'Dibatalkan';
  return 'Menunggu Semakan';
};

const AppContent: React.FC = () => {
  const {
    db,
    dbLoading,
    selectedPond,
    selectedCompetitionId,
    selectedSeats,
    selectedPondSeats,
    payType,
    receiptData,
    user,
    adminProxyName,
    adminProxyEmail,
    adminProxyPhone,
    bankReference,
    setPond,
    setSelectedCompetitionId,
    toggleSeat,
    removeSeat,
    setSeats,
    setPayType,
    setReceiptData,
    setContactPhone,
    setAdminProxyName,
    setAdminProxyEmail,
    setAdminProxyPhone,
    setBankReference,
    submitBooking,
    updateDB,
    reloadDB
  } = useBooking();
  const { addToast, setAuthModalOpen, authModalOpen } = useUI();
  const { currentSection, bookingDetailId, goToSection, goToBook, goHome, goToLive, goToMyBookings, goToProfile, goToConfirmed, goToBookingDetail, goToCMS } = useNavigation();
  const location = useLocation();
  const { login, resetPassword, register, signInWithGoogle, logout, resendVerification, refreshUser, updateUserProfile, authReady } = useAuth();
  const [completeProfileOpen, setCompleteProfileOpen] = useState(false);
  useSEO(currentSection, db.settings);

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
  const [nowTick, setNowTick] = useState(Date.now());
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
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [pondMapOpen, setPondMapOpen] = useState(false);
  const [seatModalOpen, setSeatModalOpen] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [rulesPdfPreview, setRulesPdfPreview] = useState<string | null>(null);
  const [bookingPhase, setBookingPhase] = useState<'seats' | 'details'>('seats');
  const [myBookingsSort, setMyBookingsSort] = useState<'latest' | 'oldest'>('latest');
  // Set directly from submitBooking()'s return value — db.bookings[0] isn't
  // guaranteed to be the just-created booking (Firestore listener ordering).
  const [lastSubmittedBooking, setLastSubmittedBooking] = useState<Booking | null>(null);

  const competitions = useMemo(() => {
    if (db.competitions?.length) return db.competitions;
    return db.comp?.name ? [db.comp] : [];
  }, [db.comp, db.competitions]);

  // Competitions shown on the public booking page. Ended ("tamat") events and
  // INACTIVE (hidden) competitions are excluded entirely. Competitions whose booking
  // window has not opened yet (or has closed) stay listed so we can message them.
  const bookableCompetitions = useMemo(
    () => competitions.filter((c) => c.status !== 'INACTIVE' && !isCompetitionEnded(c, nowTick)),
    [competitions, nowTick],
  );

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
      const selections = booking.pondSelections?.length
        ? booking.pondSelections
        : [{ pondId: booking.pondId, seats: booking.seats }];
      selections.forEach((selection) => {
        selection.seats.forEach((seatNum) => occupied.add(`${selection.pondId}-${seatNum}`));
      });
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
          status: occupied.has(`${pond.id}-${seat.num}`) ? ('booked' as const) : ('available' as const)
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
        const selections = booking.pondSelections?.length
          ? booking.pondSelections
          : [{ pondId: booking.pondId, seats: booking.seats }];
        selections.forEach((selection) => {
          selection.seats.forEach((seatNum: number) => occupied.add(`${selection.pondId}-${seatNum}`));
        });
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

  // Featured event derivation for the new homepage Competition section.
  const sortedUpcomingComps = useMemo(() => {
    return [...competitions]
      .filter((c) => c.status !== 'INACTIVE' && !!c.startDate)
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  }, [competitions]);
  const featuredCompetition = useMemo(() => {
    const now = nowTick;
    const upcoming = sortedUpcomingComps.find((c) => {
      const end = new Date(c.endDate || c.startDate).getTime();
      return end >= now;
    });
    return upcoming || null;
  }, [sortedUpcomingComps, nowTick]);
  const secondCompetition = useMemo(() => {
    if (!featuredCompetition) return null;
    const idx = sortedUpcomingComps.findIndex(
      (c) => (featuredCompetition.id ? c.id === featuredCompetition.id : c.name === featuredCompetition.name),
    );
    return idx >= 0 ? sortedUpcomingComps[idx + 1] || null : null;
  }, [sortedUpcomingComps, featuredCompetition]);
  const featuredCountdown = useCountdown(
    featuredCompetition?.startDate || null,
    featuredCompetition?.endDate || null,
  );
  const activePond = selectedPond
    ? bookablePonds.find((p) => p.id === selectedPond) ?? null
    : null;
  const selectedPancangs = useMemo(() => Object.entries(selectedPondSeats).flatMap(([pondIdRaw, seats]) => {
    const pond = db.ponds.find((candidate) => candidate.id === Number(pondIdRaw));
    if (!pond) return [];
    return seats.map((seatNum) => ({
      pondId: pond.id,
      seatNum,
      label: formatSeat(pond.code, seatNum),
      pondName: pondDisplayName(pond),
    }));
  }), [db.ponds, selectedPondSeats]);
  const selectedSeatCount = selectedPancangs.length;
  const selectedSeatLabels = selectedPancangs.map((selection) => selection.label);
  const selectedSeatNumbers = selectedPancangs.map((selection) => selection.seatNum);
  const selectedPancangGroups = useMemo(() => {
    const groups = new Map<number, {
      pondId: number;
      pondName: string;
      selections: typeof selectedPancangs;
    }>();

    selectedPancangs.forEach((selection) => {
      const group = groups.get(selection.pondId);
      if (group) {
        group.selections.push(selection);
      } else {
        groups.set(selection.pondId, {
          pondId: selection.pondId,
          pondName: selection.pondName,
          selections: [selection],
        });
      }
    });

    return Array.from(groups.values()).map((group) => ({
      ...group,
      selections: [...group.selections].sort((a, b) => a.seatNum - b.seatNum),
    }));
  }, [selectedPancangs]);

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      setNowTick(now.getTime());
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

  // Booking entry CTAs open the Website/WhatsApp choice popup. Only skip it
  // once the DB has actually loaded and confirmed there's no WhatsApp number
  // configured — while still loading, db.settings is emptyDB's blank
  // placeholder, so bailing out on that would silently skip the popup on a
  // fast first click after page load.
  const openBookingChoice = (proceed: () => void) => {
    if (!dbLoading && !db.settings.whatsapp) { proceed(); return; }
    setChoiceOpen(true);
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
    if (bookingSubmitting) return;
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    const isStaff = user.role === 'ADMIN' || user.role === 'STAFF';
    if (!isStaff && user.emailVerified === false) {
      addToast('Sila sahkan email anda dahulu sebelum menempah.', 'error');
      return;
    }
    if (!selectedSeatCount) {
      addToast('Select at least one peg', 'error');
      return;
    }
    if (!receiptData) {
      addToast('Upload your payment receipt', 'error');
      return;
    }
    if (!bankReference.trim()) {
      addToast('Sila masukkan No. Rujukan Bank.', 'error');
      return;
    }
    if (!selectedPond) return;
    if (!selectedCompetition?.id) {
      addToast('Sila pilih pertandingan terlebih dahulu.', 'error');
      return;
    }

    const pond = bookablePonds.find(p => p.id === selectedPond);
    if (!pond) return;

    let booking: Booking | null = null;
    setBookingSubmitting(true);
    try {
      booking = await submitBooking(pond);
    } catch (err: any) {
      setBookingError(err?.message || 'Ralat semasa menghantar tempahan. Sila cuba lagi.');
      setBookingSubmitting(false);
      return;
    }
    setBookingSubmitting(false);
    if (booking) {
      setLastSubmittedBooking(booking);
      trackEvent('purchase', {
        transaction_id: booking.bookingRef || booking.id,
        value: booking.amount,
        currency: 'MYR',
        items: [{ item_name: booking.pondName, item_category: booking.competitionName }],
      });
      addToast('Booking submitted! Staff will confirm via email.', 'success');
      goToConfirmed();
    }
  };

  const handleReceiptChange = (file: File) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const MAX_PDF = 10 * 1024 * 1024; // 10 MB
    const MAX_IMG = 15 * 1024 * 1024; // 15 MB (raw; images are compressed after)
    if (isPdf && file.size > MAX_PDF) {
      addToast('Fail PDF terlalu besar. Maksimum 10MB. / PDF too large (max 10MB).', 'error');
      return;
    }
    if (!isPdf && file.size > MAX_IMG) {
      addToast('Fail imej terlalu besar. Maksimum 15MB. / Image too large (max 15MB).', 'error');
      return;
    }
    // PDFs are stored raw; images go through the shared compressor (tuned for
    // small payloads) so all receipt images share one compression setting.
    if (isPdf) {
      const reader = new FileReader();
      reader.onload = (e) => setReceiptData(e.target?.result as string, file);
      reader.readAsDataURL(file);
      return;
    }
    compressImageToDataUrl(file)
      .then((compressed) => {
        // Derive mime/extension from the compressed data URL (WebP when supported,
        // JPEG fallback) so the preview File isn't mislabeled.
        const mime = /^data:([^;,]+)[;,]/.exec(compressed)?.[1] || 'image/jpeg';
        const ext = mime === 'image/webp' ? '.webp' : mime === 'image/png' ? '.png' : '.jpg';
        const bytes = atob(compressed.split(',')[1]);
        const buf = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
        const compFile = new File([buf], file.name.replace(/\.[^.]+$/, ext), { type: mime });
        setReceiptData(compressed, compFile);
      })
      .catch(() => {
        const reader = new FileReader();
        reader.onload = (e) => setReceiptData(e.target?.result as string, file);
        reader.readAsDataURL(file);
      });
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
    const { success, needsPhone } = await signInWithGoogle();
    if (success) {
      setAuthModalOpen(false);
      if (needsPhone) {
        setCompleteProfileOpen(true);
      } else {
        goToMyBookings();
      }
    }
    return success;
  };

  const handleCompleteProfile = async (phone: string) => {
    const ok = await updateUserProfile(user?.name || '', phone);
    if (ok) {
      setCompleteProfileOpen(false);
      goToMyBookings();
    }
  };

  const handleLogout = () => {
    logout();
    goHome();
  };

  const userBookings = user ? db.bookings.filter(
    (booking) => booking.userId === user.uid || booking.userId === user.email || booking.createdByUid === user.uid,
  ) : [];
  const outstandingCount = countOutstanding(userBookings);
  const sortedUserBookings = [...userBookings].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return myBookingsSort === 'latest' ? -diff : diff;
  });
  const bookingCompetitionFor = (booking: Booking) => {
    const bookingCompetitionId = booking.competitionId || db.comp.id || '';
    return db.competitions.find(c => c.id === bookingCompetitionId)
      || db.competitions.find(c => booking.competitionName && c.name === booking.competitionName)
      || (db.comp.id === bookingCompetitionId ? db.comp : null);
  };
  const bookingCompetitionDateLabel = (booking: Booking): string => {
    const competition = bookingCompetitionFor(booking);
    if (!competition) return '';
    const start = formatDate(competition.startDate, { time: true });
    const end = formatDate(competition.endDate, { time: true });
    if (start && end) return `${start} - ${end}`;
    return start || end;
  };

  const openRulesPdf = () => {
    const pdfUrl = normalizePdfUrl(db.settings.rulesPdfUrl || '');
    if (!pdfUrl) {
      addToast('Syarat & peraturan belum dimuat naik oleh admin.', 'info');
      return;
    }
    setRulesPdfPreview(pdfUrl);
  };

  const handleNavigation = (section: string) => {
    const homeAnchors = ['about', 'competitions', 'how', 'rules', 'lokasi'];
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
      openBookingChoice(() => goToBook());
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
    if (section === 'profile') {
      if (user) {
        goToProfile();
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

  // Lock body scroll while the seat-map popup is open.
  useEffect(() => {
    if (!seatModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [seatModalOpen]);

  // On the booking page, never leave an ended competition selected — pick the
  // first bookable one so the pond/seat steps render by default.
  useEffect(() => {
    if (currentSection !== 'book' || !bookableCompetitions.length) return;
    const selectedIsBookable = bookableCompetitions.some(
      (c) => (c.id || '') === (selectedCompetition?.id || ''),
    );
    if (!selectedIsBookable) {
      setSelectedCompetitionId(bookableCompetitions[0].id || null);
    }
  }, [currentSection, bookableCompetitions, selectedCompetition?.id, setSelectedCompetitionId]);

  // Note: seat availability is derived per-competition from bookings
  // (`competitionScopedPonds`), not from the global seat document `status` — the
  // same physical ponds are reused across competitions with independent bookings.
  // A seat held/booked in one competition must not appear taken in another, so we
  // intentionally do NOT watch the global seat-doc status here. Integrity at
  // submission is enforced by the competition-scoped clash check in
  // createBookingDocument (and the server booking endpoint).

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

  const renderHome = () => {
    const settings = db.settings;
    const heroKicker = settings.heroKicker || 'Tempat Di Mana';
    const heroTitleRaw = settings.heroTitle || 'Juara Dilahirkan';
    const heroTitleParts = heroTitleRaw.match(/\S+/g) || [];
    const heroTitleLast = heroTitleParts.length > 1 ? heroTitleParts[heroTitleParts.length - 1] : '';
    const heroTitleFirst = heroTitleLast
      ? heroTitleRaw.slice(0, heroTitleRaw.lastIndexOf(heroTitleLast)).trimEnd()
      : heroTitleRaw;
    const heroSubtitle = settings.heroSubtitle || 'Kolam Keli Sayang - Port Terbaik di Kedah';
    const heroStats = settings.heroStats?.length
      ? settings.heroStats
      : [
          { value: String(totalPonds), label: 'Lubuk Mega' },
          { value: String(availablePegs), label: 'Peserta / Kocah' },
          { value: 'Weekly Strike', label: 'Pertandingan' },
        ];
    const introCopy = settings.introCopy
      || 'Kolam Keli Sayang dibuka untuk pertandingan sahaja — bukan aktiviti memancing harian. Terletak di Kubang Rotan, Alor Setar, dikelilingi hamparan sawah padi yang menghijau, kami menawarkan pengalaman bertanding yang adil, teratur, dan penuh semangat.';
    const rules = settings.rules?.length ? settings.rules : [];
    const wazeHref = settings.wazeUrl || (settings.location ? `https://waze.com/ul?q=${encodeURIComponent(settings.location)}` : '#');
    const gmapsHref = settings.googleMapsUrl || (settings.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.location)}` : '#');
    const mapEmbedSrc = settings.mapEmbedUrl
      || (settings.location ? `https://www.google.com/maps?q=${encodeURIComponent(settings.location)}&output=embed` : '');

    const formatEventDate = (iso?: string) => formatDate(iso, { weekday: true }) || 'Tarikh akan diumumkan';
    const formatEventClock = (iso?: string) => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      const h = d.getHours();
      const m = d.getMinutes();
      const h12 = ((h + 11) % 12) + 1;
      return `${h12}.${m.toString().padStart(2, '0')}${h < 12 ? 'AM' : 'PM'}`;
    };
    const formatEventTime = (start?: string, end?: string) => {
      const startLabel = formatEventClock(start);
      const endLabel = formatEventClock(end);
      return end && endLabel !== '—' ? `${startLabel} - ${endLabel}` : startLabel;
    };
    const formatBookingOpenDate = (iso?: string) => {
      const dateLabel = formatDate(iso, { weekday: true });
      const timeLabel = formatEventClock(iso);
      return dateLabel && timeLabel !== '—' ? `${dateLabel} · ${timeLabel}` : '';
    };
    const padCD = (n: number) => n.toString().padStart(2, '0');

    const featuredName = featuredCompetition?.name || 'Ikuti perkembangan untuk acara akan datang';
    const featuredDate = featuredCompetition ? formatEventDate(featuredCompetition.startDate) : '—';
    const featuredTime = featuredCompetition ? formatEventTime(featuredCompetition.startDate, featuredCompetition.endDate) : '—';
    const featuredPondsCount = featuredCompetition ? (featuredCompetition.activePondIds?.length || totalPonds || 0) : '—';
    const samplePrice = featuredCompetition?.pricePerPeg ?? db.ponds[0]?.seats[0]?.price;
    const featuredFee = featuredCompetition ? (samplePrice ? `RM${samplePrice} / Joran` : 'Hubungi kami') : '—';
    const featuredPrize = (featuredCompetition?.prizes?.[0] as any);
    const featuredPrizeText = featuredCompetition
      ? (featuredPrize?.prize || (featuredPrize?.amount ? `RM${featuredPrize.amount}` : 'Cabutan bertuah & hadiah lumayan'))
      : '—';
    const isCountdownReady = !!featuredCompetition && featuredCountdown.status !== 'idle';
    const showLive = featuredCountdown.status === 'live';
    const showEnded = featuredCountdown.status === 'ended';
    const featuredWindow = getBookingWindowState(featuredCompetition, nowTick);
    const featuredBookingOpen = !!featuredCompetition && !isCompetitionEnded(featuredCompetition, nowTick) && isBookingOpen(featuredCompetition, nowTick);
    const featuredBookingNotice = bookingWindowLabel(featuredCompetition, nowTick);
    const secondBookingOpenLabel = secondCompetition ? formatBookingOpenDate(secondCompetition.bookingOpenAt) : '';

    return (
    <div className="home-shell">
      {/* HERO */}
      <section className="kks-hero" id="home" style={{ backgroundImage: `linear-gradient(90deg, rgba(5,18,30,.94) 0%, rgba(8,22,37,.76) 34%, rgba(8,22,37,.18) 72%), url('${asset('heroBg', settings)}')` }}>
        {settings.landingSections.hero.mode === 'html' ? (
          <CustomLandingHtml section="hero" html={settings.landingSections.hero.html} containerClassName="kks-container kks-hero-content" />
        ) : (
          <div className="kks-container kks-hero-content">
            <div className="kks-hero-kicker">{heroKicker}</div>
            <h1 className="kks-hero-title kks-preserve-lines">
              {heroTitleFirst}{heroTitleLast && <span>{heroTitleLast}</span>}
            </h1>
            <p className="kks-hero-sub kks-preserve-lines">{heroSubtitle}</p>
            <div className="kks-hero-stats">
              {heroStats.map((s, i) => (
                <div key={i} className="kks-hero-stat">
                  <strong>{dbLoading ? <span className="kks-hero-stat-skeleton" aria-hidden="true" /> : s.value}</strong>
                  <small>{s.label}</small>
                </div>
              ))}
            </div>
            <button className="btn btn-red btn-hero" onClick={() => openBookingChoice(() => goToBook())}>{settings.heroCtaLabel}</button>
          </div>
        )}
      </section>

      {/* INTRO */}
      <section className="kks-section kks-intro" id="about" style={{ backgroundImage: `linear-gradient(180deg, rgba(255,255,255,.78), rgba(255,255,255,.84)), url('${asset('pondBg', settings)}')` }}>
        {settings.landingSections.about.mode === 'html' ? (
          <CustomLandingHtml section="about" html={settings.landingSections.about.html} />
        ) : <div className="kks-container">
          <div className="kks-eyebrow">{settings.aboutEyebrow}</div>
          <h2 className="kks-headline kks-preserve-lines">{renderHeadline(settings.aboutTitle || '')}</h2>
          <p className="kks-intro-copy kks-preserve-lines">{introCopy}</p>
          <div className="kks-features">
            {(settings.features || []).map((f, i) => (
              <article key={i} className="kks-feature">
                <div className="kks-feature-icon"><i className={f.icon}></i></div>
                <h3 className="kks-preserve-lines">{f.title}</h3>
                <p className="kks-preserve-lines">{f.body}</p>
              </article>
            ))}
          </div>
          <div className="kks-intro-cta">
            <button className="btn btn-navy" onClick={() => goToBook()}>{settings.aboutCtaLabel}</button>
          </div>
        </div>}
      </section>

      {/* COMPETITION */}
      <section className="kks-section kks-competition" id="competitions" style={{ backgroundImage: `radial-gradient(circle at top left, rgba(22,183,220,.18), transparent 32%), radial-gradient(circle at bottom right, rgba(231,25,45,.18), transparent 34%), linear-gradient(135deg, rgba(6,24,40,.96), rgba(10,37,60,.94)), url('${asset('pondBg', settings)}')` }}>
        {settings.landingSections.competitions.mode === 'html' ? (
          <CustomLandingHtml section="competitions" html={settings.landingSections.competitions.html} />
        ) : <div className="kks-container">
          <div className="kks-section-head">
            <div className="kks-eyebrow">{settings.competitionsEyebrow}</div>
            <h2 className="kks-headline kks-preserve-lines">{renderHeadline(settings.competitionsTitle || '')}</h2>
          </div>

          {(
            <>
              <div className="kks-countdown">
                <div className="kks-countdown-label">
                  {showLive ? 'Live Now!' : showEnded ? 'Pertandingan Tamat' : 'Battle Starts In:'}
                </div>
                <div className="kks-time">
                  {isCountdownReady && !showEnded ? (
                    <>
                      <div><strong>{padCD(featuredCountdown.days)}</strong><small>Hari</small></div>
                      <div><strong>{padCD(featuredCountdown.hours)}</strong><small>Jam</small></div>
                      <div><strong>{padCD(featuredCountdown.minutes)}</strong><small>Minit</small></div>
                      <div><strong>{padCD(featuredCountdown.seconds)}</strong><small>Saat</small></div>
                    </>
                  ) : (
                    <div className="kks-countdown-empty">Pendaftaran akan dibuka tidak lama lagi</div>
                  )}
                </div>
              </div>

              <div className="kks-event-showcase">
                <article className="kks-event-main">
                  <div className="kks-event-top">
                    <div className="kks-event-title">
                      <div className="kks-eyebrow">Acara Pilihan</div>
                      <h3>{featuredName}</h3>
                      {featuredBookingOpen && <p className="kks-ticket-hot">🔥 TIKET LARIS TERJUAL! 🔥</p>}
                    </div>
                    <span className={`kks-badge${showLive ? ' is-live' : ''}`}>
                      {showEnded ? 'Tamat' : featuredWindow === 'before' ? 'Coming soon' : showLive ? '🔴 Live' : featuredBookingOpen ? 'Pendaftaran Dibuka' : featuredWindow === 'after' ? 'Tempahan Ditutup' : 'Akan Datang'}
                    </span>
                  </div>
                  <div className="kks-event-body">
                    {featuredBookingNotice && <p className="kks-booking-notice">{featuredBookingNotice}</p>}
                    <div className={`kks-event-grid${featuredCompetition ? '' : ' is-disabled'}`}>
                      <div className="kks-event-metric"><small>Tarikh</small><strong>{featuredDate}</strong></div>
                      <div className="kks-event-metric"><small>Masa</small><strong>{featuredTime}</strong></div>
                      <div className="kks-event-metric"><small>Kolam Dibuka</small><strong>{featuredPondsCount}</strong></div>
                    </div>
                    <div className={`kks-event-prize${featuredCompetition ? '' : ' is-disabled'}`}>
                      <div><small>Yuran</small><strong>{featuredFee}</strong></div>
                      <div><small>Hadiah</small><strong>{featuredPrizeText}</strong></div>
                    </div>
                    <div className="kks-event-actions">
                      <button
                        className="btn btn-navy"
                        disabled={!featuredBookingOpen}
                        onClick={() => openBookingChoice(() => {
                          if (featuredCompetition?.id) selectCompetition(featuredCompetition.id);
                          setPondPickerOpen(true);
                        })}
                      >
                        Tempah Pancang
                      </button>
                      <button className="btn btn-light" type="button" disabled={!featuredCompetition} onClick={() => handleNavigation('rules')}>Syarat Acara</button>
                    </div>
                  </div>
                </article>

                <aside className="kks-event-side">
                  <article className="kks-mini-card kks-mini-featured">
                    <h4 className="kks-preserve-lines">{settings.weeklyCardTitle}</h4>
                    <p className="kks-preserve-lines">{settings.weeklyCardBody}</p>
                    <div className="kks-mini-meta"><span>{settings.weeklyCardTag1}</span><span>{settings.weeklyCardTag2}</span></div>
                  </article>
                  <article className="kks-mini-card">
                    <h4>{secondCompetition?.name || 'Next Battle'}</h4>
                    <p>
                      {secondCompetition
                        ? `${formatEventDate(secondCompetition.startDate)} · ${formatEventTime(secondCompetition.startDate, secondCompetition.endDate)}`
                        : 'Paparan ringkas event akan datang supaya peserta boleh banding tarikh, yuran dan kapasiti sebelum tempah.'}
                    </p>
                    {secondBookingOpenLabel && (
                      <p className="kks-mini-booking-open">Tempahan Dibuka: {secondBookingOpenLabel}</p>
                    )}
                    <div className="kks-mini-meta">
                      <span>{(secondCompetition?.activePondIds?.length || totalPonds || 12) + ' Kolam Mega'}</span>
                      <span>{(secondCompetition?.id ? competitionAvailableSeats.get(secondCompetition.id) : null) ?? availablePegs} Pancang</span>
                    </div>
                  </article>
                </aside>
              </div>
            </>
          )}
        </div>}
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
                      <div className="pond-name">{pondDisplayName(pond)}</div>
                      <div className="pond-seats">{pond.seats.length} tempat duduk · RM{(selectedCompetition?.pricePerPeg ?? pond.seats[0]?.price ?? 0)}/pancang</div>
                      <div className="pond-badge">{statusLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BOOKING STEPS */}
      <section className="kks-section kks-booking-section" id="how" style={{ backgroundImage: `linear-gradient(90deg, rgba(255,255,255,.96) 0%, rgba(255,255,255,.9) 48%, rgba(255,255,255,.72) 100%), url('${asset('bookingBg', settings)}')` }}>
        {settings.landingSections.steps.mode === 'html' ? (
          <CustomLandingHtml section="steps" html={settings.landingSections.steps.html} />
        ) : <div className="kks-container">
          <div className="kks-steps-top">
            <div className="kks-steps-copy">
              <div className="kks-eyebrow">{settings.stepsEyebrow}</div>
              <h2 className="kks-headline kks-preserve-lines">{renderHeadline(settings.stepsTitle || '')}</h2>
              <p className="kks-preserve-lines">{settings.stepsSubtitle}</p>
            </div>
            <button className="btn btn-navy" onClick={() => openBookingChoice(() => goToBook())}>{settings.stepsCtaLabel}</button>
          </div>
          <div className="kks-steps">
            {(settings.steps || []).map((s, i) => (
              <article key={i} className="kks-step" data-step={String(i + 1).padStart(2, '0')}>
                <div className="kks-step-icon"><i className={s.icon}></i></div>
                <h3 className="kks-preserve-lines">{s.title}</h3>
                <p className="kks-preserve-lines">{s.body}</p>
              </article>
            ))}
          </div>
        </div>}
      </section>

      {/* RULES */}
      <section className="kks-section kks-rules" id="rules">
        {settings.landingSections.rules.mode === 'html' ? (
          <CustomLandingHtml section="rules" html={settings.landingSections.rules.html} />
        ) : <div className="kks-container kks-rules-grid">
          <div>
            <div className="kks-eyebrow">{settings.rulesEyebrow}</div>
            <h2 className="kks-headline kks-preserve-lines">{renderHeadline(settings.rulesTitle || '')}</h2>
            <button className="btn btn-navy" onClick={openRulesPdf}>{settings.rulesCtaLabel}</button>
          </div>
          <div className="kks-rule-list">
            {rules.map((r, i) => (
              <article key={i} className="kks-rule">
                <div className="kks-rule-num">{(i + 1).toString().padStart(2, '0')}</div>
                <div>
                  <h3 className="kks-preserve-lines">{r.title}</h3>
                  <p className="kks-preserve-lines">{r.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>}
      </section>

      {/* LOKASI */}
      <section className="kks-section kks-lokasi" id="lokasi">
        {settings.landingSections.location.mode === 'html' ? (
          <CustomLandingHtml section="location" html={settings.landingSections.location.html} />
        ) : <div className="kks-container kks-location-grid">
          <div>
            <div className="kks-eyebrow">{settings.lokasiEyebrow}</div>
            <h2 className="kks-headline kks-preserve-lines">{renderHeadline(settings.lokasiTitle || '')}</h2>
            <div className="kks-quick-links">
              <a className="btn btn-red" href={wazeHref} target="_blank" rel="noopener noreferrer"><i className="fa-brands fa-waze"></i> Waze</a>
              <a className="btn btn-navy" href={gmapsHref} target="_blank" rel="noopener noreferrer"><i className="fa-solid fa-location-dot"></i> Google Map</a>
            </div>
            <div className="kks-contact-box">
              <strong className="kks-contact-name">{settings.contactName}</strong>
              <div className="kks-contact-item">
                <i className="fa-solid fa-location-dot"></i>
                <div className="kks-preserve-lines"><strong>Alamat</strong>{settings.location || 'Kubang Rotan, Alor Setar, Kedah.'}</div>
              </div>
              <div className="kks-contact-item">
                <i className="fa-solid fa-envelope"></i>
                <div><strong>Email</strong>{settings.email || 'hello@kolamkelisayang.com.my'}</div>
              </div>
              <div className="kks-contact-item">
                <i className="fa-solid fa-phone"></i>
                <div><strong>Telefon</strong>{settings.phone || settings.whatsapp || '017-438 6854'}</div>
              </div>
            </div>
          </div>
          <div className="kks-map">
            {mapEmbedSrc ? (
              <iframe
                title="Lokasi Kolam Keli Sayang"
                src={mapEmbedSrc}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            ) : (
              <div className="kks-map-fallback">
                <span className="kks-map-pin"></span>
                <div className="kks-map-empty">Lokasi peta belum dikonfigur. Sila tetapkan alamat dalam CMS &gt; Settings.</div>
              </div>
            )}
          </div>
        </div>}
      </section>

    </div>
    );
  };

  const renderSection = () => {
    switch (currentSection) {
      case 'home':
        return renderHome();
      case 'book': {
        const bookedPond = activePond;
        const competitionEnded = isCompetitionEnded(selectedCompetition, nowTick);
        // Booking window: outside [bookingOpenAt, bookingCloseAt] the booking flow is
        // blocked with a message (sale not started / closed). No window set = always open.
        const bookingOpen = isBookingOpen(selectedCompetition, nowTick);
        const bookingClosedMsg = bookingWindowLabel(selectedCompetition, nowTick);
        const hasCompetition = Boolean(selectedCompetition?.id) && !competitionEnded && bookingOpen;
        const hasPond = Boolean(bookedPond);
        const hasSeats = selectedSeatCount > 0;
        const currentPricePerPeg = Math.max(0, selectedCompetition?.pricePerPeg ?? bookedPond?.seats?.[0]?.price ?? 0);
        const subtotal = selectedSeatCount * currentPricePerPeg;
        const payableNow = payType === 'deposit' ? Math.ceil(subtotal * 0.5) : subtotal;
        const balanceDue = subtotal - payableNow;
        const samplePrice = db.ponds[0]?.seats[0]?.price || 0;
        // The details phase is only meaningful once seats are picked; if seats get
        // reset (e.g. pond/competition change) we fall back to the seat phase.
        const detailsPhase = bookingPhase === 'details' && hasSeats && hasCompetition;
        const goToDetails = () => {
          if (!selectedSeatCount) return;
          setBookingPhase('details');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        const goToSeats = () => setBookingPhase('seats');
        const stepClass = (state: 'done' | 'active' | '') => `progress-step${state === 'active' ? ' active' : state === 'done' ? ' done' : ''}`;
        const step1 = hasCompetition ? 'done' : 'active';
        const step2 = !hasCompetition ? '' : hasPond ? 'done' : 'active';
        const step3 = !hasPond ? '' : hasSeats ? 'done' : 'active';
        const step4 = detailsPhase ? 'active' : '';

        // Which action button should gently pulse to hint the next step. The form
        // (details) phase manages its own hint inside BookingForm. When no bookable
        // competition is active (none picked, or the picked one is ended/closed) the
        // competition choices pulse so the user knows to pick a valid one first.
        const nextHint: 'competition' | 'pond' | 'seat' | 'continue' | null =
          detailsPhase ? null
          : !hasCompetition ? 'competition'
          : !hasPond ? 'pond'
          : !hasSeats ? 'seat'
          : 'continue';
        const hintCls = (target: typeof nextHint) => (nextHint === target ? ' bk-hint' : '');

        return (
          <div className="bk-page">
            <section className="bk-shell">
              <div className="bk-progress" aria-label="Kemajuan tempahan">
                <div className={stepClass(step1 as any)}><span>1</span>Pilih Pertandingan</div>
                <div className={stepClass(step2 as any)}><span>2</span>Pilih Kolam</div>
                <div className={stepClass(step3 as any)}><span>3</span>Pilih Tempat</div>
                <div className={stepClass(step4 as any)}><span>4</span>Maklumat &amp; Bayaran</div>
              </div>

              <div className="bk-grid">
                <div className="bk-stack">
                  {!detailsPhase ? (
                    <>
                      {/* Step 1 — Pilih Pertandingan */}
                      <section className="bk-panel">
                        <div className="bk-panel-head">
                          <div className="bk-eyebrow">Langkah 01</div>
                          <h2>Pilih Pertandingan</h2>
                          <p>Menukar pertandingan akan reset pilihan kolam, pancang, dan resit bayaran.</p>
                        </div>
                        <div className="bk-panel-body">
                          <div className="bk-choice-grid">
                            {bookableCompetitions.length === 0 && (
                              <div style={{ color: 'var(--muted)', fontSize: '14px', padding: '8px 2px' }}>
                                Tiada pertandingan dibuka untuk tempahan buat masa ini.
                              </div>
                            )}
                            {bookableCompetitions.map((competition) => {
                              const active = (selectedCompetition?.id || '') === (competition.id || '');
                              const pondsCount = competition.activePondIds?.length || totalPonds;
                              const competitionPrice = competition.pricePerPeg ?? samplePrice;
                              const cardWindow = getBookingWindowState(competition, nowTick);
                              const cardLabel = cardWindow === 'before'
                                ? (bookingWindowLabel(competition, nowTick) || 'Akan dibuka')
                                : cardWindow === 'after' ? 'Tempahan Ditutup' : 'Pendaftaran Dibuka';
                              return (
                                <button
                                  key={competition.id || competition.name}
                                  type="button"
                                  className={`bk-choice ${active ? 'active' : ''}${hintCls('competition')}`}
                                  onClick={() => handleSelectCompetitionForBooking(competition.id)}
                                >
                                  <small>{cardLabel}</small>
                                  <strong>{competition.name}</strong>
                                  <div className="bk-choice-meta">
                                    {(competitionPrice || 0) > 0 && <span>RM{competitionPrice}</span>}
                                    <span>{pondsCount} Kolam</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </section>

                      {selectedCompetition?.id && competitionEnded && (
                        <section className="bk-panel booking-stage-enter" style={{ textAlign: 'center' }}>
                          <div className="bk-panel-body">
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🏁</div>
                            <h2 style={{ fontFamily: 'var(--font-heading)', fontStyle: 'italic', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Pertandingan Telah Tamat</h2>
                            <p style={{ color: 'var(--muted)', maxWidth: '460px', margin: '0 auto', fontSize: '.9rem', lineHeight: 1.6 }}>
                              Pertandingan ini telah tamat dan tidak lagi menerima tempahan baharu. Sila pilih pertandingan lain yang masih aktif.
                              <br /><br />
                              <em>This competition has ended and is no longer accepting new bookings. Please choose another active competition.</em>
                            </p>
                          </div>
                        </section>
                      )}

                      {selectedCompetition?.id && !competitionEnded && !bookingOpen && (
                        <section className="bk-panel booking-stage-enter" style={{ textAlign: 'center' }}>
                          <div className="bk-panel-body">
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🕒</div>
                            <h2 style={{ fontFamily: 'var(--font-heading)', fontStyle: 'italic', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                              {getBookingWindowState(selectedCompetition) === 'before' ? 'Tempahan Belum Dibuka' : 'Tempahan Telah Ditutup'}
                            </h2>
                            <p style={{ color: 'var(--muted)', maxWidth: '460px', margin: '0 auto', fontSize: '.9rem', lineHeight: 1.6 }}>
                              {bookingClosedMsg || 'Tempahan untuk pertandingan ini tidak dibuka buat masa ini.'}
                              <br /><br />
                              <em>Tempahan untuk pertandingan ini belum dibuka. Sila pilih pertandingan lain.</em>
                            </p>
                          </div>
                        </section>
                      )}

                      {hasCompetition && (
                        <>
                          {/* Step 2 — Pilih Kolam */}
                          <section className="bk-panel booking-stage-enter">
                            <div className="bk-panel-head bk-panel-head-row">
                              <div>
                                <div className="bk-eyebrow">Langkah 02</div>
                                <h2>Pilih Kolam</h2>
                                <p>Setiap kolam ada susunan tempat duduk tersendiri.</p>
                              </div>
                              <div className="bk-head-actions">
                                {db.settings.pondMapImg && (
                                  <button className="btn btn-light btn-sm" type="button" onClick={() => setPondMapOpen(true)}>
                                    <i className="fa-solid fa-image"></i> Peta Kolam
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="bk-panel-body">
                              <div className="bk-pond-grid">
                                {competitionScopedPonds.map((pond) => {
                                  const avail = pond.seats.filter((s) => s.status === 'available').length;
                                  const closed = !pond.open;
                                  const full = avail === 0;
                                  const disabled = closed || full;
                                  const active = selectedPond === pond.id;
                                  return (
                                    <button
                                      key={pond._docId || pond.id}
                                      type="button"
                                      className={`bk-pond ${active ? 'active' : ''}${!active ? hintCls('pond') : ''}`}
                                      disabled={disabled}
                                      onClick={() => { if (!disabled) { setPond(pond.id); setSeatModalOpen(true); } }}
                                    >
                                      <strong>{pondDisplayName(pond)}</strong>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </section>

                          {/* Step 3 — Pilih Tempat */}
                          <section className="bk-panel booking-stage-enter">
                            <div className="bk-panel-head">
                              <div>
                                <div className="bk-eyebrow">Langkah 03</div>
                                <h2>Pilih Tempat</h2>
                                <p>Peta pancang dibuka dalam popup supaya page kekal ringkas.</p>
                              </div>
                            </div>
                            <div className="bk-panel-body">
                              <div className="bk-seatprev">
                                <div className="bk-seatprev-main">
                                  <div className="bk-seat-icon"><i className="fa-solid fa-chair"></i></div>
                                  <div>
                                    <h3>{hasSeats ? `${selectedSeatCount} pancang dipilih` : 'Belum pilih pancang'}</h3>
                                    <p>{hasSeats
                                      ? `Pancang boleh dipilih daripada kolam yang berbeza. Jumlah yuran RM${subtotal}.`
                                      : hasPond ? 'Klik "Buka Peta Pancang" untuk pilih satu atau lebih tempat.' : 'Pilih kolam dahulu untuk membuka peta pancang.'}</p>
                                    {hasSeats && (
                                      <div className="bk-selected-pancangs" aria-label="Pancang dipilih">
                                        {selectedPancangs.map((selection) => (
                                          <button key={`${selection.pondId}-${selection.seatNum}`} type="button" onClick={() => removeSeat(selection.pondId, selection.seatNum)}>
                                            {selection.label}<span aria-hidden="true">×</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    <div className="bk-tags">
                                      <span className="bk-tag"><i className="fa-solid fa-water"></i> {bookedPond ? pondDisplayName(bookedPond) : 'Belum pilih kolam'}</span>
                                      <span className="bk-tag sel"><i className="fa-solid fa-ticket"></i> {hasSeats ? `${selectedSeatCount} pancang` : 'Tiada pancang'}</span>
                                    </div>
                                  </div>
                                </div>
                                <button className={`btn btn-red${hintCls('seat')}`} type="button" disabled={!hasPond} onClick={() => setSeatModalOpen(true)}>
                                  <i className="fa-solid fa-chair"></i> Buka Peta Pancang
                                </button>
                              </div>
                            </div>
                          </section>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="bk-back-row">
                        <button className="btn btn-light btn-sm" type="button" onClick={goToSeats}>
                          <i className="fa-solid fa-arrow-left"></i> Kembali Pilih Tempat
                        </button>
                      </div>
                      <div className="booking-stage-enter">
                        <BookingForm
                          user={user}
                          pond={bookedPond}
                          selectedSeats={selectedSeatNumbers}
                          selectedSeatLabels={selectedSeatLabels}
                          pricePerPeg={currentPricePerPeg}
                          isSubmitting={bookingSubmitting}
                          payType={payType}
                          receiptData={receiptData}
                          bankReference={bankReference}
                          settings={db.settings}
                          adminProxyName={adminProxyName}
                          adminProxyEmail={adminProxyEmail}
                          adminProxyPhone={adminProxyPhone}
                          onContactPhoneChange={setContactPhone}
                          onSetPayType={setPayType}
                          onHandleReceiptChange={handleReceiptChange}
                          onClearReceipt={() => setReceiptData(null, null)}
                          onBankReferenceChange={setBankReference}
                          onSubmitBooking={handleSubmitBooking}
                          onOpenAuth={() => setAuthModalOpen(true)}
                          onAdminProxyNameChange={setAdminProxyName}
                          onAdminProxyEmailChange={setAdminProxyEmail}
                          onAdminProxyPhoneChange={setAdminProxyPhone}
                          onResendVerification={resendVerification}
                          onRefreshVerification={refreshUser}
                          onOpenRulesPdf={openRulesPdf}
                          onGoToProfile={goToProfile}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Summary cart */}
                <aside className="bk-summary" aria-label="Ringkasan tempahan">
                  <div className="bk-summary-head">
                    <small>Ringkasan Tempahan</small>
                  </div>
                  <div className="bk-summary-body">
                    <div className="bk-summary-line"><span>Pertandingan</span><strong>{hasCompetition ? selectedCompetition?.name : 'Belum dipilih'}</strong></div>
                    <div className="bk-summary-line"><span>Kolam</span><strong>{selectedPancangs.length ? Array.from(new Set(selectedPancangs.map((selection) => selection.pondName))).join(', ') : (bookedPond ? pondDisplayName(bookedPond) : 'Belum dipilih')}</strong></div>
                    <div className="bk-summary-line"><span>Pancang</span><strong>{selectedSeatLabels.length ? selectedSeatLabels.join(', ') : 'Belum dipilih'}</strong></div>
                    <div className="bk-summary-line"><span>Bilangan</span><strong>{selectedSeatCount} pancang</strong></div>
                    <div className="bk-summary-line"><span>Bayaran</span><strong>{payType === 'deposit' ? 'Deposit 50%' : 'Penuh'}</strong></div>
                    {payType === 'deposit' && hasSeats && (
                      <div className="bk-summary-line"><span>Baki Bayaran</span><strong>RM{balanceDue}</strong></div>
                    )}
                    <div className="bk-summary-total">
                      <span>{payType === 'deposit' ? 'Bayar Sekarang' : 'Jumlah'}</span>
                      <strong>RM{payableNow}</strong>
                    </div>
                    {payType === 'deposit' && hasSeats && (
                      <div className="bk-summary-note">Baki perlu dibayar sepenuhnya sehari sebelum tarikh pertandingan untuk mengelakkan tempahan dibatalkan dan deposit tidak dipulangkan.</div>
                    )}
                  </div>
                  <div className="bk-summary-actions">
                    {!detailsPhase ? (
                      <button className={`btn btn-red w-full${hintCls('continue')}`} type="button" disabled={!hasSeats} onClick={goToDetails}>
                        <i className="fa-solid fa-arrow-right"></i> Teruskan
                      </button>
                    ) : (
                      <button className="btn btn-light w-full" type="button" onClick={goToSeats}>
                        <i className="fa-solid fa-chair"></i> Tukar Pancang
                      </button>
                    )}
                    {hasPond && !detailsPhase && (
                      <button className={`btn btn-light w-full${!hasSeats ? hintCls('seat') : ''}`} type="button" onClick={() => setSeatModalOpen(true)}>
                        <i className="fa-solid fa-chair"></i> {hasSeats ? 'Tukar Pancang' : 'Buka Peta Pancang'}
                      </button>
                    )}
                  </div>
                </aside>
              </div>
            </section>

            {/* Mobile sticky continue bar */}
            {!detailsPhase && hasSeats && (
              <div className="bk-mobile-continue">
                <div>
                  <small>Pancang Dipilih</small>
                  <strong>{selectedSeatCount} pancang · RM{payableNow}</strong>
                </div>
                <button className={`btn btn-red${hintCls('continue')}`} type="button" onClick={goToDetails}>
                  <i className="fa-solid fa-arrow-right"></i> Teruskan
                </button>
              </div>
            )}

            {/* Seat-map popup (reuses the existing SeatMap component) */}
            {seatModalOpen && bookedPond && (
              <div className="bk-seat-modal" onClick={() => setSeatModalOpen(false)}>
                <div className="bk-seat-dialog" onClick={(e) => e.stopPropagation()}>
                  <div className="bk-seat-modal-head">
                    <div>
                      <div className="bk-eyebrow">Pilihan Pancang</div>
                    </div>
                    <button className="bk-icon-btn" type="button" onClick={() => setSeatModalOpen(false)} aria-label="Tutup popup">
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                  {competitionScopedPonds.length > 1 && (
                    <div className="bk-seat-modal-pond-grid">
                      <div className="bk-pond-grid">
                        {competitionScopedPonds.map((pond) => {
                          const avail = pond.seats.filter((s) => s.status === 'available').length;
                          const closed = !pond.open;
                          const full = avail === 0;
                          const disabled = closed || full;
                          const active = bookedPond.id === pond.id;
                          return (
                            <button
                              key={pond._docId || pond.id}
                              type="button"
                              className={`bk-pond ${active ? 'active' : ''}`}
                              disabled={disabled}
                              onClick={() => { if (!disabled) setPond(pond.id); }}
                            >
                              <strong>{pondDisplayName(pond)}</strong>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="bk-seat-modal-body">
                    <SeatMap pond={bookedPond} selectedSeats={selectedSeats} onToggleSeat={toggleSeat} useLegacyView={true} />
                  </div>
                  <div className="bk-seat-modal-foot">
                    <div className="bk-current-selection">
                      <div className="bk-current-selection-head">
                        <small>Pilihan Semasa</small>
                        <span className="bk-current-selection-count" aria-label={`${selectedSeatCount} pancang dipilih`}>
                          {selectedSeatCount} pancang
                        </span>
                      </div>
                      {selectedPancangGroups.length ? (
                        <div className="bk-selected-pond-groups">
                          {selectedPancangGroups.map((group) => (
                            <div className="bk-selected-pond-group" key={group.pondId}>
                              <strong>{group.pondName}</strong>
                              <div className="bk-selected-pancangs" aria-label={`Pancang dipilih di ${group.pondName}`}>
                                {group.selections.map((selection) => (
                                  <button key={`${selection.pondId}-${selection.seatNum}`} type="button" onClick={() => removeSeat(selection.pondId, selection.seatNum)} aria-label={`Nyahpilih ${selection.label}`}>
                                    {selection.label}<span aria-hidden="true">×</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : <strong className="bk-current-selection-empty">Belum pilih pancang</strong>}
                    </div>
                    <button className={`btn btn-red${hasSeats ? ' bk-hint' : ''}`} type="button" disabled={!hasSeats} onClick={() => setSeatModalOpen(false)}>
                      <i className="fa-solid fa-check"></i> Sahkan Pancang
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

        {bookingSubmitting && (
          <div className="modal-overlay open" style={{ zIndex: 950 }}>
            <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Menghantar Tempahan</div>
              </div>
              <div className="modal-body" style={{ textAlign: 'center', paddingTop: 20, paddingBottom: 22 }}>
                <div style={{ fontSize: '2rem', marginBottom: 10 }}>⏳</div>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: 6 }}>Sila tunggu sebentar...</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Kami sedang menyimpan tempahan dan memuat naik resit anda.</div>
              </div>
            </div>
          </div>
        )}
      }
      case 'live':
        return <LiveResults decimalPlaces={db.settings.ocrDecimalPlaces} comp={selectedCompetition || db.comp} competitions={db.competitions?.length ? db.competitions : [db.comp]} scores={db.scores} ponds={db.ponds} bookings={db.bookings} user={user} />;
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
                <div className="empty-text">Sila log masuk untuk melihat tempahan anda.</div>
                <button className="btn btn-primary" style={{ marginTop: '12px' }} onClick={() => setAuthModalOpen(true)}>Log Masuk</button>
              </div>
            </div>
          );
        }
        return (
          <div className="bookings-page">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px', marginBottom: '28px' }}>
              <div>
                <div style={{ fontFamily: 'var(--fd)', fontSize: '28px', fontWeight: 800, letterSpacing: '.5px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  Tempahan Saya
                  {outstandingCount > 0 && (
                    <span
                      title={`${outstandingCount} tempahan menunggu pembayaran baki`}
                      style={{ background: 'var(--red)', color: '#fff', fontSize: '12px', fontWeight: 700, borderRadius: '999px', padding: '2px 9px', lineHeight: 1.6 }}
                    >
                      {outstandingCount} baki
                    </span>
                  )}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--green-bright)' }}></span>
                  {user.name} · {user.email}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {userBookings.length > 1 && (
                  <select
                    className="form-input"
                    style={{ width: 'auto' }}
                    value={myBookingsSort}
                    onChange={(e) => setMyBookingsSort(e.target.value as 'latest' | 'oldest')}
                    aria-label="Susun tempahan"
                  >
                    <option value="latest">Terkini Dahulu</option>
                    <option value="oldest">Terlama Dahulu</option>
                  </select>
                )}
                <button className="btn btn-primary" onClick={() => goToBook()} style={{ borderRadius: '12px' }}>
                  <i className="fa-solid fa-plus"></i> TEMPAHAN BARU
                </button>
              </div>
            </div>
            {sortedUserBookings.length ? sortedUserBookings.map(b => {
              // Derived, not b.balanceDue: the server only stamps balanceDue once
              // staff act on a receipt, so a pending booking would render "Baki RM".
              const balanceDue = outstandingBalance(b);
              const isBookingCompetitionEnded = isCompetitionEnded(bookingCompetitionFor(b));
              const competitionDateLabel = bookingCompetitionDateLabel(b);
              return (
              <div key={b.id} className="card booking-row" onClick={() => goToBookingDetail(b.id)}>
                <div>
                  <div className="booking-id" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {balanceDue > 0 && (
                      <span
                        title="Baki belum dibayar"
                        style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--red)', flex: '0 0 auto' }}
                      />
                    )}
                    {b.bookingRef || b.id}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>{fmt(b.createdAt)}</div>
                </div>
                <div>
                  <div className="booking-pond">{b.competitionName || selectedCompetition?.name || db.comp.name}</div>
                  {competitionDateLabel && (
                    <div className="booking-competition-dates">{competitionDateLabel}</div>
                  )}
                  <div className="booking-customer-info">
                    <strong>{b.userName}</strong>
                    <span>{b.bookingPhone || b.userPhone || '-'}</span>
                    {b.userEmail && <span>{b.userEmail}</span>}
                  </div>
                  <div className="booking-meta">
                    <span>📍 Pancang: {bookingPancangList(b)}</span>
                    <span>💰 Jumlah: RM {b.totalAmount ?? b.amount}</span>
                    <span>{b.paymentType === 'deposit' ? '💳 Deposit' : '💳 Bayaran Penuh'}</span>
                    {balanceDue > 0 && (
                      <span style={{ color: 'var(--red)', fontWeight: 700 }}>⚠ Baki RM {balanceDue}</span>
                    )}
                  </div>
                </div>
                <div className="booking-status-list">
                  <span className={`status-badge st-${b.status}`}>
                    <i className={`fa-solid fa-${b.status === 'pending' ? 'clock' : b.status === 'confirmed' ? 'check-circle' : 'xmark-circle'}`}></i>{' '}
                    {bookingStatusLabel(b.status)}
                  </span>
                  {isBookingCompetitionEnded && (
                    <span className="competition-ended-label">
                      PERTANDINGAN TAMAT
                    </span>
                  )}
                </div>
              </div>
              );
            }) : (
              <div className="empty-state">
                <span className="empty-icon">🎣</span>
                <div className="empty-text">
                  No bookings yet. <a onClick={() => goToBook()} style={{ color: 'var(--accent)', cursor: 'pointer' }}>Book a peg</a> to get started.
                </div>
              </div>
            )}
          </div>
        );
      case 'profile':
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
                <div className="empty-text">Sila log masuk untuk melihat profil anda.</div>
                <button className="btn btn-primary" style={{ marginTop: '12px' }} onClick={() => setAuthModalOpen(true)}>Log Masuk</button>
              </div>
            </div>
          );
        }
        return <ProfileContent user={user} onSave={updateUserProfile} />;
      case 'confirmed': {
        const lastBooking = lastSubmittedBooking || db.bookings[0];
        return (
          <div className="confirm-page">
            <div className="confirm-icon">🎣</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '6px' }}>TEMPAHAN TELAH DIHANTAR</div>
            <div className="confirm-id">{lastBooking?.bookingRef || lastBooking?.id || 'CB1234567'}</div>
            <div className="confirm-detail">
              {lastBooking ? (
                <>
                  Pertandingan: {lastBooking.competitionName || selectedCompetition?.name || db.comp.name}<br />
                  Pancang: {bookingPancangList(lastBooking)}<br />
                  Jumlah Bayaran: RM {lastBooking.amount} ({lastBooking.paymentType === 'deposit' ? 'Deposit' : 'Bayaran Penuh'})<br />
                  <br />
                  Tempahan telah dihantar dan kini sedang menunggu kelulusan. Sebarang pertanyaan, sila hubungi kami di +6017-9735002.
                </>
              ) : (
                <>
                  Pertandingan: -<br />
                  Pancang: -<br />
                  Jumlah Bayaran: RM 0 (Bayaran Penuh)<br />
                  <br />
                  Tempahan telah dihantar dan kini sedang menunggu kelulusan. Sebarang pertanyaan, sila hubungi kami di +6017-9735002.
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '28px', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => goToMyBookings()}>SEMAK TEMPAHAN SAYA</button>
              <button className="btn btn-ghost" onClick={() => goHome()}>KEMBALI KE HALAMAN UTAMA</button>
            </div>
          </div>
        );
      }
      case 'bookingDetail': {
        const booking = bookingDetailId
          ? db.bookings.find((b) => b.id === bookingDetailId) || null
          : null;
        if (!booking) {
          return (
            <div style={{ textAlign: 'center', padding: '6rem 2rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎣</div>
              <h2 style={{ marginBottom: '0.5rem' }}>Tempahan tidak dijumpai</h2>
              <p style={{ marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Tempahan dengan ID <code>{bookingDetailId}</code> tidak wujud, atau anda tiada akses.
              </p>
              <button className="btn btn-primary" onClick={() => goToMyBookings()}>Lihat Tempahan Saya</button>
            </div>
          );
        }
        // Privacy: only owner (or staff/admin) can view a booking's full details.
        const canView = !!user && (
          user.role === 'STAFF' || user.role === 'ADMIN'
          || booking.userId === user.uid
          || booking.userId === user.email
          || booking.createdByUid === user.uid
        );
        if (!canView) {
          return (
            <div style={{ textAlign: 'center', padding: '6rem 2rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
              <h2 style={{ marginBottom: '0.5rem' }}>Akses dihadkan</h2>
              <p style={{ marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Sila log masuk dengan akaun pemilik tempahan ini.
              </p>
              <button className="btn btn-primary" onClick={() => setAuthModalOpen(true)}>Log Masuk</button>
            </div>
          );
        }
        return (
          <div style={{ maxWidth: '720px', margin: '0 auto', padding: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => goToMyBookings()}>
                <i className="fa-solid fa-arrow-left"></i> Tempahan Saya
              </button>
            </div>
            <div className="card" style={{ marginBottom: '24px' }}>
              <div style={{ padding: '20px 28px 0', borderBottom: '1px solid var(--line)' }}>
                <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '32px', margin: 0, color: 'var(--navy)' }}>
                  Butiran Tempahan
                </h1>
              </div>
              <BookingDetailContent
                booking={booking}
                competitionEnded={isCompetitionEnded(bookingCompetitionFor(booking))}
                competitionDateLabel={bookingCompetitionDateLabel(booking)}
                inPage
                onReceiptSubmitted={reloadDB}
              />
            </div>
          </div>
        );
      }
      case 'cms': {
        // Client-side guard: signed-out users get a sign-in prompt; the CMSModal
        // itself renders an "Akses Terhad" screen for signed-in non-staff. Real
        // enforcement is server-side (Firestore rules require an admin role).
        if (!user) {
          return (
            <div style={{ textAlign: 'center', padding: '6rem 2rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
              <h2 style={{ marginBottom: '0.5rem' }}>Akses dihadkan</h2>
              <p style={{ marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Sila log masuk dengan akaun kakitangan untuk mengakses CMS.
              </p>
              <button className="btn btn-primary" onClick={() => setAuthModalOpen(true)}>Log Masuk</button>
            </div>
          );
        }
        return (
          <CMSModal
            isOpen
            onClose={() => goHome()}
            onGoToBooking={() => goToBook()}
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
        authReady={authReady}
        currentSection={currentSection}
        onSectionChange={handleNavigation}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenCMS={() => goToCMS()}
        onLogout={handleLogout}
        outstandingCount={outstandingCount}
        settings={db.settings}
      />
      {currentSection === 'home' && <SecondaryMobileNav onSectionChange={handleNavigation} />}
      {renderSection()}
      {location.pathname === '/' && (
        <Footer settings={db.settings} onNavigate={handleNavigation} />
      )}
      <CompleteProfileModal isOpen={completeProfileOpen} onSubmit={handleCompleteProfile} />
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onLogin={handleLogin}
        onResetPassword={resetPassword}
        onRegister={handleRegister}
        onGoogleLogin={handleGoogleLogin}
        onResendVerification={resendVerification}
      />
      <BookingDetailsModal
        isOpen={bookingDetailsOpen}
        booking={selectedBooking}
        competitionEnded={selectedBooking ? isCompetitionEnded(bookingCompetitionFor(selectedBooking)) : false}
        competitionDateLabel={selectedBooking ? bookingCompetitionDateLabel(selectedBooking) : ''}
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

      {/* Syarat & Peraturan PDF — in-app popup instead of a new tab */}
      <DocPreviewModal url={rulesPdfPreview} title="Syarat & Peraturan" onClose={() => setRulesPdfPreview(null)} />

      {/* Booking entry choice — Website vs WhatsApp (V5) */}
      <BookingChoiceModal
        open={choiceOpen}
        onClose={() => setChoiceOpen(false)}
        onWebsite={() => goToBook()}
        whatsapp={db.settings.whatsapp}
        message="Hi KKS, saya berminat untuk menempah slot pertandingan."
      />

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
