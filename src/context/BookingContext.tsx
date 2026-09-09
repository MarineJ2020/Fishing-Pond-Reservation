import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef } from 'react';
import { receiptUploadFolder } from '../utils/receiptStorage';
import { DB, User, Pond, Booking, BookingPondSelection, Settings } from '../types';
import { emptyDB, setDB } from '../data';
import { loadAppDB, subscribeSettings } from '../lib/firestore';
import { createBooking as createBookingApi } from '../lib/api';
import { uploadDataUrlToFirebaseStorage } from '../utils/imageStorage';
import { isPdfFile, uploadPdfToFirebaseStorage } from '../utils/pdfStorage';
import { isCompetitionEnded, isBookingOpen, bookingWindowLabel } from '../utils/competition';
import { auth } from '../../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

interface BookingContextType {
  db: DB;
  /** True until the first Firestore DB load resolves. See dbLoading state below. */
  dbLoading: boolean;
  user: User | null;
  selectedCompetitionId: string | null;
  selectedPond: number | null;
  selectedSeats: number[];
  selectedPondSeats: Record<number, number[]>;
  payType: 'full' | 'deposit';
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
  setPayType: (type: 'full' | 'deposit') => void;
  setReceiptData: (data: string | null, file: File | null) => void;
  setBookingNotes: (notes: string) => void;
  setBankReference: (reference: string) => void;
  setContactPhone: (phone: string) => void;
  setAdminProxyName: (name: string) => void;
  setAdminProxyEmail: (email: string) => void;
  setAdminProxyPhone: (phone: string) => void;
  setUser: (user: User | null) => void;
  submitBooking: (pond: Pond) => Promise<Booking | null>;
  clearBooking: () => void;
  updateDB: (newDb: DB) => void;
  reloadDB: () => Promise<void>;
  calculateTotal: () => number;
}

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
  const [payType, setPayType] = useState<'full' | 'deposit'>('full');
  const [receiptData, setReceiptDataState] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [bookingNotes, setBookingNotes] = useState('');
  const [bankReference, setBankReference] = useState('');
  // Per-booking contact phone the customer keys in each time (self-service).
  const [contactPhone, setContactPhone] = useState('');
  const [adminProxyName, setAdminProxyName] = useState('');
  const [adminProxyEmail, setAdminProxyEmail] = useState('');
  const [adminProxyPhone, setAdminProxyPhone] = useState('');
  // True until the first Firestore load resolves — db.settings is emptyDB's
  // blank placeholder until then, so callers checking e.g. db.settings.whatsapp
  // right after mount must not treat "still loading" as "genuinely unset".
  const [dbLoading, setDbLoading] = useState(true);
  const liveSettings = useRef<Settings | null>(null);

  // A live snapshot wins over initial loads/reloads already in flight.
  const applyLoadedDB = useCallback((loaded: DB) => {
    setDbState({ ...loaded, settings: liveSettings.current ?? loaded.settings });
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
      setDbState((previous) => ({ ...previous, bookings: [], users: [] }));
      setDbLoading(true);
      const remoteDb = await loadAppDB();
      if (!canceled && current === generation) {
        applyLoadedDB(remoteDb);
        setDbLoading(false);
      }
    });
    return () => { canceled = true; unsubscribe(); };
  }, [applyLoadedDB]);

  useEffect(() => {
    if (!selectedCompetitionId && db.comp?.id) {
      setSelectedCompetitionId(db.comp.id);
    }
  }, [db.comp?.id, selectedCompetitionId]);

  const updateDB = useCallback((newDb: DB) => {
    applyLoadedDB(newDb);
  }, [applyLoadedDB]);

  const reloadDB = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;
      const remoteDb = await loadAppDB();
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
    return map;
  }, [db.availability, db.bookings, db.comp.id, selectedCompetitionId]);

  const toggleSeat = useCallback((num: number) => {
    if (db.availabilityError) return;
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
  }, [db.availabilityError, db.ponds, selectedPond, seatTakenMap]);

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
    return payType === 'deposit' ? Math.ceil(tot * 0.5) : tot;
  }, [db.ponds, selectedPond, selectedPondSeats, payType, getCompetitionPricePerPeg]);

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

  const submitBooking = useCallback(async (pond: Pond): Promise<Booking | null> => {
    if (db.availabilityError) throw new Error('Ketersediaan No Pancang tidak dapat dimuatkan. Sila muat semula halaman.');
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

    const isStaff = user.role === 'ADMIN' || user.role === 'STAFF';
    // Gate: email/password users must verify before booking. Google accounts and
    // staff are exempt (Google is pre-verified; staff manage bookings directly).
    if (!isStaff && user.emailVerified === false) return null;

    const isAdminProxy = user.role === 'ADMIN' && adminProxyName.trim() !== '';
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
    const payAmt = payType === 'deposit' ? Math.ceil(tot * 0.5) : tot;

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
      paymentType: payType,
      amount: payAmt,
      totalAmount: tot,
      receiptUrl,
      bankReference: bankReference.trim(),
      notes: bookingNotes,
      createdByStaff: isStaff,
      ...(isStaff && user.uid ? { createdByUid: user.uid } : {}),
    };

    const result = await createBookingApi(payload);
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
      paymentType: payType,
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
    return booking;
  }, [user, selectedPondSeats, receiptData, receiptFile, bankReference, payType, bookingNotes, contactPhone, adminProxyName, adminProxyEmail, adminProxyPhone, db, updateDB, clearBooking, selectedCompetitionId, getCompetitionPricePerPeg]);

  return (
    <BookingContext.Provider
      value={{
        db,
        dbLoading,
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
        calculateTotal,
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
