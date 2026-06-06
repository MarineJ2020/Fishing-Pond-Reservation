import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { DB, User, Pond, Booking } from '../types';
import { emptyDB, setDB } from '../data';
import { loadAppDB } from '../lib/firestore';
import { createBooking as createBookingApi } from '../lib/api';
import { queueBookingReceivedEmail } from '../lib/email';
import { uploadDataUrlToCloudinary } from '../utils/cloudinary';
import { isCompetitionEnded } from '../utils/competition';
import { auth } from '../../lib/firebase';

interface BookingContextType {
  db: DB;
  user: User | null;
  selectedCompetitionId: string | null;
  selectedPond: number | null;
  selectedSeats: number[];
  payType: 'full' | 'deposit';
  receiptData: string | null;
  receiptFile: File | null;
  bookingNotes: string;
  adminProxyName: string;
  adminProxyEmail: string;
  
  setPond: (id: number | null) => void;
  setSelectedCompetitionId: (id: string | null) => void;
  toggleSeat: (num: number) => void;
  setSeats: (seats: number[]) => void;
  setPayType: (type: 'full' | 'deposit') => void;
  setReceiptData: (data: string | null, file: File | null) => void;
  setBookingNotes: (notes: string) => void;
  setAdminProxyName: (name: string) => void;
  setAdminProxyEmail: (email: string) => void;
  setUser: (user: User | null) => void;
  submitBooking: (pond: Pond) => Promise<Booking | null>;
  clearBooking: () => void;
  updateDB: (newDb: DB) => void;
  reloadDB: () => Promise<void>;
  calculateTotal: () => number;
}

const BookingContext = createContext<BookingContextType | undefined>(undefined);

const uploadToCloudinary = (receiptData: string, _fileName: string): Promise<string> =>
  uploadDataUrlToCloudinary(receiptData, 'fishing-pond-receipts');

export const BookingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [db, setDbState] = useState<DB>(emptyDB);
  const [user, setUser] = useState<User | null>(null);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(null);
  const [selectedPond, setSelectedPond] = useState<number | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [payType, setPayType] = useState<'full' | 'deposit'>('full');
  const [receiptData, setReceiptDataState] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [bookingNotes, setBookingNotes] = useState('');
  const [adminProxyName, setAdminProxyName] = useState('');
  const [adminProxyEmail, setAdminProxyEmail] = useState('');

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      const remoteDb = await loadAppDB();
      if (!canceled) {
        setDbState(remoteDb);
        setDB(remoteDb);
      }
    };
    load().catch(() => {});
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    if (!selectedCompetitionId && db.comp?.id) {
      setSelectedCompetitionId(db.comp.id);
    }
  }, [db.comp?.id, selectedCompetitionId]);

  const updateDB = useCallback((newDb: DB) => {
    setDbState(newDb);
    setDB(newDb);
  }, []);

  const reloadDB = useCallback(async () => {
    try {
      const remoteDb = await loadAppDB();
      setDbState(remoteDb);
      setDB(remoteDb);
    } catch (err) {
      console.error('reloadDB failed:', err);
    }
  }, []);

  const setPond = useCallback((id: number | null) => {
    setSelectedPond(id);
    setSelectedSeats([]);
  }, []);

  const seatTakenMap = React.useMemo(() => {
    const map = new Map<string, boolean>();
    for (const booking of db.bookings) {
      const competitionId = booking.competitionId || db.comp.id || '';
      if (!competitionId || competitionId !== (selectedCompetitionId || db.comp.id || '')) continue;
      if (booking.status !== 'pending' && booking.status !== 'confirmed') continue;
      for (const seatNum of booking.seats || []) {
        map.set(`${booking.pondId}-${seatNum}`, true);
      }
    }
    return map;
  }, [db.bookings, db.comp.id, selectedCompetitionId]);

  const toggleSeat = useCallback((num: number) => {
    const pond = db.ponds.find(p => p.id === selectedPond);
    const seat = pond?.seats.find(s => s.num === num);
    if (!seat) return;
    const taken = seatTakenMap.get(`${selectedPond}-${num}`);
    if (taken) return;
    setSelectedSeats(prev => {
      const idx = prev.indexOf(num);
      return idx > -1 ? prev.filter(s => s !== num) : [...prev, num];
    });
  }, [db.ponds, selectedPond, seatTakenMap]);

  const setSeats = useCallback((seats: number[]) => {
    setSelectedSeats(seats);
  }, []);

  const setReceiptData = useCallback((data: string | null, file: File | null) => {
    setReceiptDataState(data);
    setReceiptFile(file);
  }, []);

  const calculateTotal = useCallback(() => {
    if (!selectedPond) return 0;
    const pond = db.ponds.find(p => p.id === selectedPond);
    if (!pond) return 0;
    const tot = selectedSeats.reduce((a, n) => {
      const s = pond.seats.find(x => x.num === n);
      return a + (s ? s.price : 0);
    }, 0);
    return payType === 'deposit' ? Math.ceil(tot * 0.5) : tot;
  }, [db.ponds, selectedPond, selectedSeats, payType]);

  const clearBooking = useCallback(() => {
    setSelectedSeats([]);
    setReceiptDataState(null);
    setReceiptFile(null);
    setBookingNotes('');
    setAdminProxyName('');
    setAdminProxyEmail('');
    setPayType('full');
  }, []);

  const submitBooking = useCallback(async (pond: Pond): Promise<Booking | null> => {
    if (!user || !selectedSeats.length || !receiptData || !receiptFile) return null;

    // Block bookings for competitions that have already ended ("tamat").
    const targetCompetitionId = selectedCompetitionId || db.comp.id || '';
    const targetCompetition = db.competitions.find((c) => c.id === targetCompetitionId) || db.comp;
    if (isCompetitionEnded(targetCompetition)) {
      throw new Error('Pertandingan ini telah tamat dan tidak menerima tempahan baharu. / This competition has ended and is no longer accepting new bookings.');
    }

    const isStaff = user.role === 'ADMIN' || user.role === 'STAFF';
    // Gate: email/password users must verify before booking. Google accounts and
    // staff are exempt (Google is pre-verified; staff manage bookings directly).
    if (!isStaff && user.emailVerified === false) return null;

    const isAdminProxy = isStaff && adminProxyName.trim() !== '';
    const effectiveName = isAdminProxy ? adminProxyName.trim() : user.name;
    const effectiveEmail = isAdminProxy ? adminProxyEmail.trim() : (user.uid || user.email);
    const effectivePhone = isAdminProxy ? '' : (user.phone || '');
    // Real email address for notifications: proxy form when staff books on behalf of a guest,
    // Firebase auth email for self-service. Stored on the booking so approval flow doesn't need a lookup.
    const notifyEmail = isAdminProxy
      ? adminProxyEmail.trim()
      : (auth.currentUser?.email || user.email || '');
    const seatIds = selectedSeats
      .map((num) => pond.seats.find((s) => s.num === num)?.id)
      .filter(Boolean) as string[];

    const tot = selectedSeats.reduce((a, n) => {
      const s = pond.seats.find(x => x.num === n);
      return a + (s ? s.price : 0);
    }, 0);
    const payAmt = payType === 'deposit' ? Math.ceil(tot * 0.5) : tot;

    const bookingRef = `BKG-${Date.now().toString().slice(-5)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

    // Upload receipt to Cloudinary instead of Firebase Storage
    const receiptUrl = await uploadToCloudinary(receiptData, receiptFile.name);

    const payload = {
      competitionId: selectedCompetitionId || db.comp.id || '',
      competitionName: db.competitions.find((c) => c.id === (selectedCompetitionId || db.comp.id || ''))?.name || db.comp.name,
      pondId: pond.id,
      userId: effectiveEmail,
      userEmail: notifyEmail,
      userName: effectiveName,
      userPhone: effectivePhone,
      seatIds,
      seatNumbers: selectedSeats,
      paymentType: payType,
      amount: payAmt,
      totalAmount: tot,
      receiptUrl,
      bookingRef,
      notes: bookingNotes,
      createdByStaff: isAdminProxy,
    };

    const result = await createBookingApi(payload);
    if (!result?.bookingId) return null;

    if (notifyEmail) {
      await queueBookingReceivedEmail({
        to: notifyEmail,
        bookingRef: result.bookingRef || bookingRef,
        amount: payAmt,
        pondName: pond.name,
        pondDate: pond.date,
        seats: selectedSeats,
      });
    }

    const booking: Booking = {
      id: result.bookingId,
      bookingRef: result.bookingRef,
      competitionId: selectedCompetitionId || db.comp.id || '',
      competitionName: db.competitions.find((c) => c.id === (selectedCompetitionId || db.comp.id || ''))?.name || db.comp.name,
      userId: effectiveEmail,
      userEmail: notifyEmail,
      userName: effectiveName,
      userPhone: effectivePhone,
      pondId: pond.id,
      pondName: pond.name,
      pondDate: pond.date,
      seats: [...selectedSeats],
      seatIds,
      paymentType: payType,
      amount: payAmt,
      totalAmount: tot,
      receiptData: receiptUrl,
      receiptName: receiptFile.name,
      notes: bookingNotes,
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdByStaff: isAdminProxy,
    };

    const newDb = { ...db, bookings: [booking, ...db.bookings] };
    updateDB(newDb);
    clearBooking();
    return booking;
  }, [user, selectedSeats, receiptData, receiptFile, payType, bookingNotes, adminProxyName, adminProxyEmail, db, updateDB, clearBooking, selectedCompetitionId]);

  return (
    <BookingContext.Provider
      value={{
        db,
        user,
        selectedCompetitionId,
        selectedPond,
        selectedSeats,
        payType,
        receiptData,
        receiptFile,
        bookingNotes,
        adminProxyName,
        adminProxyEmail,
        setPond,
        setSelectedCompetitionId,
        toggleSeat,
        setSeats,
        setPayType,
        setReceiptData,
        setBookingNotes,
        setAdminProxyName,
        setAdminProxyEmail,
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
