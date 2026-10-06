import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef } from 'react';
import { receiptUploadFolder } from '../utils/receiptStorage';
import { DB, User, Pond, Booking, BookingPondSelection, Settings } from '../types';
import { emptyDB, setDB } from '../data';
import { getAllBookingDocs, getBookingById, getBookingDocsForCompetitions, getBookings, getRefundBookingDocs, loadAppDB, subscribeSettings } from '../lib/firestore';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { createBooking as createBookingApi, holdPegs as holdPegsApi, releaseHold as releaseHoldApi } from '../lib/api';
import { heldPegKeys, holderKeyFor } from '../utils/pegHolds';
import { getTurnstileToken } from '../lib/turnstile';
import { uploadDataUrlToFirebaseStorage } from '../utils/imageStorage';
import { isPdfFile, uploadPdfToFirebaseStorage } from '../utils/pdfStorage';
import { isCompetitionEnded, isBookingOpen, bookingWindowLabel } from '../utils/competition';
import { isBookingManagerRole, isStaffRole } from '../utils/roles';
import { auth } from '../../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

export type BookingSubmitStage = 'upload' | 'save';

interface BookingContextType {
  db: DB;
  /** True until the first Firestore DB load resolves. See dbLoading state below. */
  dbLoading: boolean;
  /** Resolves as soon as the current user's bookings are ready, before slower availability data. */
  bookingsLoading: boolean;
  user: User | null;
  selectedCompetitionId: string | null;
  selectedPond: number | null;
  selectedSeats: number[];
  selectedPondSeats: Record<number, number[]>;
  payType: 'full';
  receiptData: string | null;
  receiptFile: File | null;
  bookingNotes: string;
  bankReference: string;
  contactPhone: string;
  adminProxyName: string;
  adminProxyEmail: string;
  adminProxyPhone: string;

  setPond: (id: number | null) => void;
  setSelectedCompetitionId: (id: string | null) => void;
  toggleSeat: (num: number) => void;
  removeSeat: (pondId: number, num: number) => void;
  setSeats: (seats: number[]) => void;
  setPayType: (type: 'full') => void;
  setReceiptData: (data: string | null, file: File | null) => void;
  setBookingNotes: (notes: string) => void;
  setBankReference: (reference: string) => void;
  setContactPhone: (phone: string) => void;
  setAdminProxyName: (name: string) => void;
  setAdminProxyEmail: (email: string) => void;
  setAdminProxyPhone: (phone: string) => void;
  setUser: (user: User | null) => void;
  submitBooking: (pond: Pond, onStage?: (stage: BookingSubmitStage) => void) => Promise<Booking | null>;
  clearBooking: () => void;
  updateDB: (newDb: DB) => void;
  reloadDB: () => Promise<void>;
  /** Re-read one booking and patch it into db.bookings (cheap CMS refresh after an edit). */
  refreshBooking: (bookingId: string) => Promise<void>;
  calculateTotal: () => number;
  /** This customer's current 10-minute payment hold, if any. */
  pegHold: { competitionId: string; expiresAt: string } | null;
  /** Holds the selected pegs (null when the user can't hold yet: signed out / unverified). Throws if a peg is taken or held. */
  holdSelectedPegs: () => Promise<{ expiresAt: string } | null>;
  releaseHeldPegs: () => void;
  /** Holder key of the signed-in user, so their own holds don't show as taken. */
  myHolderKey: string | null;
  /** Staff: load an older competition's bookings into db.bookings (no-op if already loaded). */
  loadCompetitionBookings: (competitionId: string | null | undefined) => Promise<void>;
  /** Staff: load every booking (dashboard "all competitions", user booking counts). */
  loadAllBookings: () => Promise<void>;
  /** Staff: load cancelled-with-refund bookings from every event (refunds owed). */
  loadRefundBookings: () => Promise<void>;
  /** True while one of the on-demand loads above is running. */
  extraBookingsLoading: boolean;
}

// On-demand staff loads are reused for this long before being re-read.
const EXTRA_BOOKINGS_TTL_MS = 5 * 60 * 1000;

/** `incoming` replaces same-id bookings in `current` and adds the rest. */
const mergeBookings = (current: Booking[], incoming: Booking[]) => {
  if (!incoming.length) return current;
  const byId = new Map(incoming.map((booking) => [booking.id, booking]));
  const merged = current.map((booking) => byId.get(booking.id) ?? booking);
  const present = new Set(current.map((booking) => booking.id));
  return [...merged, ...incoming.filter((booking) => !present.has(booking.id))];
};

const BookingContext = createContext<BookingContextType | undefined>(undefined);

const uploadReceipt = async (receiptData: string, receiptFile: File): Promise<string> => {
  if (isPdfFile(receiptFile)) {
    return uploadPdfToFirebaseStorage(receiptFile, receiptUploadFolder(), receiptFile.name);
  }
  return uploadDataUrlToFirebaseStorage(receiptData, receiptUploadFolder(), receiptFile.name);
};

export const BookingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [db, setDbState] = useState<DB>(emptyDB);
  const [user, setUser] = useState<User | null>(null);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(null);
  const [selectedPond, setSelectedPond] = useState<number | null>(null);
  const [selectedPondSeats, setSelectedPondSeats] = useState<Record<number, number[]>>({});
  const [payType, setPayType] = useState<'full'>('full');
  const [receiptData, setReceiptDataState] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [bookingNotes, setBookingNotes] = useState('');
  const [bankReference, setBankReference] = useState('');
  // Per-booking contact phone the customer keys in each time (self-service).
  const [contactPhone, setContactPhone] = useState('');
  const [adminProxyName, setAdminProxyName] = useState('');
  const [adminProxyEmail, setAdminProxyEmail] = useState('');
  const [adminProxyPhone, setAdminProxyPhone] = useState('');
  const [pegHold, setPegHold] = useState<{ competitionId: string; expiresAt: string } | null>(null);
  const [myHolderKey, setMyHolderKey] = useState<string | null>(null);
  // True until the first Firestore load resolves — db.settings is emptyDB's
  // blank placeholder until then, so callers checking e.g. db.settings.whatsapp
  // right after mount must not treat "still loading" as "genuinely unset".
  const [dbLoading, setDbLoading] = useState(true);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const liveSettings = useRef<Settings | null>(null);
  // Bookings staff loaded on demand (older events). Kept apart so a reload of
  // the recent-events list (reloadDB after every CMS edit) doesn't drop them.
  const extraBookings = useRef(new Map<string, Booking>());
  const extraLoadedAt = useRef(new Map<string, number>());
  const [extraLoads, setExtraLoads] = useState(0);
  const dbRef = useRef(db);
  dbRef.current = db;
  const withExtras = (bookings: Booking[]) => {
    const present = new Set(bookings.map((booking) => booking.id));
    return [...bookings, ...[...extraBookings.current.values()].filter((booking) => !present.has(booking.id))];
  };

  // A live snapshot wins over initial loads/reloads already in flight.
  const applyLoadedDB = useCallback((loaded: DB) => {
    setDbState({ ...loaded, bookings: withExtras(loaded.bookings), settings: liveSettings.current ?? loaded.settings });
  }, []);

  const applyCoreLoadedDB = useCallback((loaded: DB) => {
    setDbState({
      ...loaded,
      bookings: withExtras(loaded.bookings),
      settings: liveSettings.current ?? loaded.settings,
    });
  }, []);

  useEffect(() => subscribeSettings((settings) => {
    liveSettings.current = settings;
    setDbState((current) => ({ ...current, settings }));
  }), []);

  useEffect(() => {
    try { setDB(db); } catch (error) { console.error('Failed to cache booking data:', error); }
  }, [db]);

  useEffect(() => {
    let canceled = false;
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, async () => {
      const current = ++generation;
      extraBookings.current.clear();
      extraLoadedAt.current.clear();
      setDbState((previous) => ({ ...previous, bookings: [], users: [] }));
      setDbLoading(true);
      setBookingsLoading(true);
      const remoteDb = await loadAppDB((coreDb) => {
        if (!canceled && current === generation) {
          applyCoreLoadedDB(coreDb);
          setDbLoading(false);
          setBookingsLoading(false);
        }
      });
      if (!canceled && current === generation) {
        applyLoadedDB(remoteDb);
        setDbLoading(false);
        setBookingsLoading(false);
      }
    });
    return () => { canceled = true; unsubscribe(); };
  }, [applyCoreLoadedDB, applyLoadedDB]);

  useEffect(() => {
    if (!selectedCompetitionId && db.comp?.id) {
      setSelectedCompetitionId(db.comp.id);
    }
  }, [db.comp?.id, selectedCompetitionId]);

  const updateDB = useCallback((newDb: DB) => {
    applyLoadedDB(newDb);
  }, [applyLoadedDB]);

  const refreshBooking = useCallback(async (bookingId: string) => {
    try {
      const fresh = await getBookingById(bookingId, db.competitions);
      // Keep bookings outside the staff's recent-competition scope across reloads.
      const scope = dbRef.current.bookingScope;
      if (fresh && (extraBookings.current.has(bookingId) || (scope && !scope.includes(fresh.competitionId || '')))) extraBookings.current.set(bookingId, fresh);
      if (!fresh) extraBookings.current.delete(bookingId);
      setDbState((current) => {
        const rest = current.bookings.filter((booking) => booking.id !== bookingId);
        if (!fresh) return { ...current, bookings: rest };
        const index = current.bookings.findIndex((booking) => booking.id === bookingId);
        if (index < 0) return { ...current, bookings: [fresh, ...rest] };
        const bookings = [...current.bookings];
        bookings[index] = fresh;
        return { ...current, bookings };
      });
    } catch (err) {
      console.error('refreshBooking failed:', err);
    }
  }, [db.competitions]);

  const reloadDB = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;
      // reloadDB runs right after edits (CMS, receipts), so bypass the CDN-cached pond list.
      const remoteDb = await loadAppDB(undefined, { fresh: true });
      if (auth.currentUser?.uid === uid) applyLoadedDB(remoteDb);
    } catch (err) {
      console.error('reloadDB failed:', err);
    }
  }, [applyLoadedDB]);

  const setPond = useCallback((id: number | null) => {
    setSelectedPond(id);
  }, []);

  const selectedSeats = React.useMemo(
    () => (selectedPond ? selectedPondSeats[selectedPond] || [] : []),
    [selectedPond, selectedPondSeats],
  );

  useEffect(() => {
    let cancelled = false;
    const uid = user?.uid;
    if (!uid) { setMyHolderKey(null); return; }
    holderKeyFor(uid).then((key) => { if (!cancelled) setMyHolderKey(key); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid]);

  const seatTakenMap = React.useMemo(() => {
    const map = new Map<string, boolean>();
    for (const booking of [...db.availability, ...db.bookings]) {
      const competitionId = booking.competitionId || db.comp.id || '';
      if (!competitionId || competitionId !== (selectedCompetitionId || db.comp.id || '')) continue;
      if (booking.status !== 'pending' && booking.status !== 'confirmed') continue;
      const selections = booking.pondSelections?.length
        ? booking.pondSelections
        : [{ pondId: booking.pondId, seats: booking.seats || [] }];
      for (const selection of selections) {
        for (const seatNum of selection.seats) {
          map.set(`${selection.pondId}-${seatNum}`, true);
        }
      }
    }
    heldPegKeys(db.holds, selectedCompetitionId || db.comp.id || '', myHolderKey).forEach((key) => map.set(key, true));
    return map;
  }, [db.availability, db.bookings, db.holds, db.comp.id, selectedCompetitionId, myHolderKey]);

  const toggleSeat = useCallback((num: number) => {
    const pond = db.ponds.find(p => p.id === selectedPond);
    const seat = pond?.seats.find(s => s.num === num);
    if (!seat) return;
    const taken = seatTakenMap.get(`${selectedPond}-${num}`);
    if (taken) return;
    if (!selectedPond) return;
    setSelectedPondSeats(prev => {
      const current = prev[selectedPond] || [];
      const idx = current.indexOf(num);
      const next = idx > -1 ? current.filter(s => s !== num) : [...current, num];
      if (!next.length) {
        const nextState = { ...prev };
        delete nextState[selectedPond];
        return nextState;
      }
      return { ...prev, [selectedPond]: next };
    });
  }, [db.ponds, selectedPond, seatTakenMap]);

  const setSeats = useCallback((seats: number[]) => {
    if (!seats.length) {
      setSelectedPondSeats({});
      return;
    }
    if (!selectedPond) return;
    setSelectedPondSeats((prev) => ({ ...prev, [selectedPond]: seats }));
  }, [selectedPond]);

  const removeSeat = useCallback((pondId: number, num: number) => {
    setSelectedPondSeats((prev) => {
      const next = (prev[pondId] || []).filter((seatNum) => seatNum !== num);
      if (!next.length) {
        const nextState = { ...prev };
        delete nextState[pondId];
        return nextState;
      }
      return { ...prev, [pondId]: next };
    });
  }, []);

  const setReceiptData = useCallback((data: string | null, file: File | null) => {
    setReceiptDataState(data);
    setReceiptFile(file);
  }, []);

  const getCompetitionPricePerPeg = useCallback((pond?: Pond) => {
    const competitionId = selectedCompetitionId || db.comp.id || '';
    const competition = db.competitions.find((c) => c.id === competitionId) || db.comp;
    if (typeof competition?.pricePerPeg === 'number') return Math.max(0, competition.pricePerPeg);
    return pond?.seats?.[0]?.price || 0;
  }, [db.comp, db.competitions, selectedCompetitionId]);

  const calculateTotal = useCallback(() => {
    const seatCount = Object.values(selectedPondSeats).reduce((sum, seats) => sum + seats.length, 0);
    const pond = db.ponds.find(p => p.id === selectedPond) || db.ponds[0];
    const tot = seatCount * getCompetitionPricePerPeg(pond);
    return tot;
  }, [db.ponds, selectedPond, selectedPondSeats, getCompetitionPricePerPeg]);

  const clearBooking = useCallback(() => {
    setSelectedPondSeats({});
    setReceiptDataState(null);
    setReceiptFile(null);
    setBookingNotes('');
    setBankReference('');
    setContactPhone('');
    setAdminProxyName('');
    setAdminProxyEmail('');
    setAdminProxyPhone('');
    setPayType('full');
  }, []);

  const submitBooking = useCallback(async (pond: Pond, onStage?: (stage: BookingSubmitStage) => void): Promise<Booking | null> => {
    const totalSelectedSeats = Object.values(selectedPondSeats).reduce((sum, seats) => sum + seats.length, 0);
    if (!user || !totalSelectedSeats || !receiptData || !receiptFile || !bankReference.trim()) return null;

    // Block bookings for competitions that have already ended ("tamat").
    const targetCompetitionId = selectedCompetitionId || db.comp.id || '';
    const targetCompetition = db.competitions.find((c) => c.id === targetCompetitionId) || db.comp;
    if (isCompetitionEnded(targetCompetition)) {
      throw new Error('Pertandingan ini telah tamat dan tidak menerima tempahan baharu. / This competition has ended and is no longer accepting new bookings.');
    }
    // Safety net mirroring the public UI gating: reject hidden competitions and any
    // booking made outside the configured booking window.
    if (targetCompetition?.status === 'INACTIVE') {
      throw new Error('Pertandingan ini tidak tersedia untuk tempahan. / This competition is not available for booking.');
    }
    if (!isBookingOpen(targetCompetition)) {
      const msg = bookingWindowLabel(targetCompetition) || 'Tempahan untuk pertandingan ini tidak dibuka buat masa ini.';
      throw new Error(`${msg}. / Booking for this competition is not open right now.`);
    }

    const isStaff = isStaffRole(user.role);
    // Gate: email/password users must verify before booking. Google accounts and
    // staff are exempt (Google is pre-verified; staff manage bookings directly).
    if (!isStaff && user.emailVerified === false) return null;

    const isAdminProxy = isBookingManagerRole(user.role) && adminProxyName.trim() !== '';
    const effectiveName = isAdminProxy ? adminProxyName.trim() : user.name;
    const effectiveEmail = isAdminProxy ? adminProxyEmail.trim() : (user.uid || user.email);
    const effectivePhone = isAdminProxy ? adminProxyPhone.trim() : (user.phone || '');
    // Phone the customer keys in for THIS booking. Admin proxy already types it in
    // the proxy form; self-service customers must enter it fresh every booking.
    const perBookingPhone = isAdminProxy ? adminProxyPhone.trim() : contactPhone.trim();
    if (!isAdminProxy && !perBookingPhone) {
      throw new Error('Sila masukkan nombor telefon untuk tempahan ini. / Please enter a phone number for this booking.');
    }
    // Real email address for notifications: proxy form when staff books on behalf of a guest,
    // Firebase auth email for self-service. Stored on the booking so approval flow doesn't need a lookup.
    const notifyEmail = isAdminProxy
      ? adminProxyEmail.trim()
      : (auth.currentUser?.email || user.email || '');
    const pondSelections = Object.entries(selectedPondSeats)
      .map(([pondIdRaw, seats]): BookingPondSelection | null => {
        const selectedPondForGroup = db.ponds.find((candidate) => candidate.id === Number(pondIdRaw));
        if (!selectedPondForGroup || !seats.length) return null;
        return {
          pondId: selectedPondForGroup.id,
          pondName: selectedPondForGroup.name,
          pondCode: selectedPondForGroup.code || '',
          pondDate: selectedPondForGroup.date,
          seats: [...seats],
          seatIds: seats
            .map((num) => selectedPondForGroup.seats.find((seat) => seat.num === num)?.id)
            .filter(Boolean) as string[],
        };
      })
      .filter((selection): selection is BookingPondSelection => Boolean(selection));
    const primarySelection = pondSelections.find((selection) => selection.pondId === pond.id) || pondSelections[0];
    if (!primarySelection) return null;
    const seatIds = pondSelections.flatMap((selection) => selection.seatIds || []);

    const tot = totalSelectedSeats * getCompetitionPricePerPeg(pond);
    const payAmt = tot;

    onStage?.('upload');
    const receiptUrl = await uploadReceipt(receiptData, receiptFile);

    const payload = {
      competitionId: selectedCompetitionId || db.comp.id || '',
      competitionName: db.competitions.find((c) => c.id === (selectedCompetitionId || db.comp.id || ''))?.name || db.comp.name,
      pondId: primarySelection.pondId,
      pondCode: primarySelection.pondCode || '',
      userId: effectiveEmail,
      userEmail: notifyEmail,
      userName: effectiveName,
      userPhone: effectivePhone,
      bookingPhone: perBookingPhone,
      seatIds,
      seatNumbers: primarySelection.seats,
      pondSelections,
      paymentType: 'full',
      amount: payAmt,
      totalAmount: tot,
      receiptUrl,
      bankReference: bankReference.trim(),
      notes: bookingNotes,
      createdByStaff: isStaff,
      ...(isStaff && user.uid ? { createdByUid: user.uid } : {}),
    };

    onStage?.('save');
    // Fetched last: tokens are single-use and expire after 5 minutes.
    const turnstileToken = isStaff ? '' : await getTurnstileToken();
    const result = await createBookingApi(turnstileToken ? { ...payload, turnstileToken } : payload);
    if (!result?.bookingId) return null;

    const booking: Booking = {
      id: result.bookingId,
      bookingRef: result.bookingRef,
      competitionId: selectedCompetitionId || db.comp.id || '',
      competitionName: db.competitions.find((c) => c.id === (selectedCompetitionId || db.comp.id || ''))?.name || db.comp.name,
      userId: effectiveEmail,
      userEmail: notifyEmail,
      userName: effectiveName,
      userPhone: effectivePhone,
      bookingPhone: perBookingPhone,
      pondId: primarySelection.pondId,
      pondName: primarySelection.pondName,
      pondCode: primarySelection.pondCode || '',
      pondDate: primarySelection.pondDate || pond.date,
      seats: [...primarySelection.seats],
      seatIds,
      pondSelections,
      paymentType: 'full',
      amount: result.amount,
      totalAmount: result.totalAmount,
      receiptData: receiptUrl,
      receiptName: receiptFile.name,
      bankReference: bankReference.trim(),
      receipts: [{
        url: receiptUrl,
        amount: result.amount,
        status: isStaff ? 'accepted' : 'pending',
        submittedAt: new Date().toISOString(),
      }],
      paidAmount: isStaff ? result.amount : 0,
      balanceDue: Math.max(0, result.totalAmount - (isStaff ? result.amount : 0)),
      balanceStage: isStaff
        ? (result.totalAmount > result.amount ? 'pending-balance' : 'fully-paid')
        : undefined,
      notes: bookingNotes,
      status: isStaff ? 'confirmed' : 'pending',
      createdAt: new Date().toISOString(),
      createdByStaff: isStaff,
      createdByUid: isStaff ? user.uid : undefined,
    };

    const newDb = { ...db, bookings: [booking, ...db.bookings] };
    updateDB(newDb);
    clearBooking();
    setPegHold(null);
    return booking;
  }, [user, selectedPondSeats, receiptData, receiptFile, bankReference, bookingNotes, contactPhone, adminProxyName, adminProxyEmail, adminProxyPhone, db, updateDB, clearBooking, selectedCompetitionId, getCompetitionPricePerPeg]);

  const loadExtraBookings = useCallback(async (key: string, fetchDocs: () => Promise<QueryDocumentSnapshot<DocumentData>[]>) => {
    if (!isStaffRole(user?.role) || !dbRef.current.bookingScope) return;
    const loadedAt = extraLoadedAt.current.get(key);
    if (loadedAt && Date.now() - loadedAt < EXTRA_BOOKINGS_TTL_MS) return;
    extraLoadedAt.current.set(key, Date.now());
    setExtraLoads((n) => n + 1);
    try {
      const { competitions, ponds } = dbRef.current;
      const loaded = await getBookings(undefined, competitions, { ponds, bookingDocs: await fetchDocs() });
      loaded.forEach((booking) => extraBookings.current.set(booking.id, booking));
      setDbState((current) => ({ ...current, bookings: mergeBookings(current.bookings, loaded) }));
    } catch (err) {
      extraLoadedAt.current.delete(key);
      console.error(`Loading bookings (${key}) failed:`, err);
    } finally {
      setExtraLoads((n) => n - 1);
    }
  }, [user?.role]);

  const loadCompetitionBookings = useCallback(async (competitionId: string | null | undefined) => {
    if (!competitionId || dbRef.current.bookingScope?.includes(competitionId) || extraLoadedAt.current.has('*all')) return;
    await loadExtraBookings(`comp:${competitionId}`, () => getBookingDocsForCompetitions([competitionId]));
  }, [loadExtraBookings]);
  const loadAllBookings = useCallback(() => loadExtraBookings('*all', getAllBookingDocs), [loadExtraBookings]);
  const loadRefundBookings = useCallback(() => loadExtraBookings('*refunds', getRefundBookingDocs), [loadExtraBookings]);

  const holdSelectedPegs = useCallback(async () => {
    const competitionId = selectedCompetitionId || db.comp.id || '';
    const pondSelections = Object.entries(selectedPondSeats)
      .filter(([, seats]) => seats.length)
      .map(([pondId, seats]) => ({ pondId: Number(pondId), seats: [...seats] }));
    const isStaff = isStaffRole(user?.role);
    // Signed-out and unverified customers can't hold yet; checkout still re-checks every peg.
    if (!user || !auth.currentUser || !competitionId || !pondSelections.length || (!isStaff && user.emailVerified === false)) return null;
    const primary = pondSelections.find((selection) => selection.pondId === selectedPond) || pondSelections[0];
    const result = await holdPegsApi({ competitionId, pondId: primary.pondId, pondSelections, createdByStaff: isStaff });
    setPegHold({ competitionId, expiresAt: result.expiresAt });
    return { expiresAt: result.expiresAt };
  }, [db.comp.id, selectedCompetitionId, selectedPond, selectedPondSeats, user]);

  const releaseHeldPegs = useCallback(() => {
    if (!pegHold) return;
    setPegHold(null);
    // Best effort: an unreleased hold simply expires after 10 minutes.
    releaseHoldApi(pegHold.competitionId).catch(() => {});
  }, [pegHold]);

  return (
    <BookingContext.Provider
      value={{
        db,
        dbLoading,
        bookingsLoading,
        user,
        selectedCompetitionId,
        selectedPond,
        selectedSeats,
        selectedPondSeats,
        payType,
        receiptData,
        receiptFile,
        bookingNotes,
        bankReference,
        contactPhone,
        adminProxyName,
        adminProxyEmail,
        adminProxyPhone,
        setPond,
        setSelectedCompetitionId,
        toggleSeat,
        removeSeat,
        setSeats,
        setPayType,
        setReceiptData,
        setBookingNotes,
        setBankReference,
        setContactPhone,
        setAdminProxyName,
        setAdminProxyEmail,
        setAdminProxyPhone,
        setUser,
        submitBooking,
        clearBooking,
        updateDB,
        reloadDB,
        refreshBooking,
        calculateTotal,
        pegHold,
        holdSelectedPegs,
        releaseHeldPegs,
        myHolderKey,
        loadCompetitionBookings,
        loadAllBookings,
        loadRefundBookings,
        extraBookingsLoading: extraLoads > 0,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
};

export const useBooking = () => {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error('useBooking must be used within BookingProvider');
  }
  return context;
};
