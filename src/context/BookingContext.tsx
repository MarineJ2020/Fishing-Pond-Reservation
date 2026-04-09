import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { DB, User, Pond, Booking } from '../types';
import { emptyDB, setDB } from '../data';
import { loadAppDB } from '../lib/firestore';
import { createBooking as createBookingApi } from '../lib/api';

interface BookingContextType {
  db: DB;
  user: User | null;
  selectedPond: number | null;
  selectedSeats: number[];
  payType: 'full' | 'deposit';
  receiptData: string | null;
  receiptFile: File | null;
  bookingNotes: string;
  
  setPond: (id: number | null) => void;
  toggleSeat: (num: number) => void;
  setSeats: (seats: number[]) => void;
  setPayType: (type: 'full' | 'deposit') => void;
  setReceiptData: (data: string | null, file: File | null) => void;
  setBookingNotes: (notes: string) => void;
  setUser: (user: User | null) => void;
  submitBooking: (pond: Pond) => Promise<Booking | null>;
  clearBooking: () => void;
  updateDB: (newDb: DB) => void;
  reloadDB: () => Promise<void>;
  calculateTotal: () => number;
}

const BookingContext = createContext<BookingContextType | undefined>(undefined);

// Cloudinary upload helper
const uploadToCloudinary = async (receiptData: string, fileName: string): Promise<string> => {
  const formData = new FormData();
  // Convert base64 to blob for Cloudinary
  const base64Data = receiptData.split(',')[1]; // Remove data:image/jpeg;base64,
  const blob = new Blob([Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))], { type: 'image/jpeg' });
  formData.append('file', blob);
  formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', 'fishing-pond-receipts');

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  );

  if (!response.ok) {
    throw new Error('Failed to upload receipt to Cloudinary');
  }

  const result = await response.json();
  return result.secure_url;
};

export const BookingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [db, setDbState] = useState<DB>(emptyDB);
  const [user, setUser] = useState<User | null>(null);
  const [selectedPond, setSelectedPond] = useState<number | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [payType, setPayType] = useState<'full' | 'deposit'>('full');
  const [receiptData, setReceiptDataState] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [bookingNotes, setBookingNotes] = useState('');

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

  const toggleSeat = useCallback((num: number) => {
    const pond = db.ponds.find(p => p.id === selectedPond);
    const seat = pond?.seats.find(s => s.num === num);
    if (!seat || seat.status === 'booked') return;
    setSelectedSeats(prev => {
      const idx = prev.indexOf(num);
      return idx > -1 ? prev.filter(s => s !== num) : [...prev, num];
    });
  }, [db.ponds, selectedPond]);

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
    setPayType('full');
  }, []);

  const submitBooking = useCallback(async (pond: Pond): Promise<Booking | null> => {
    if (!user || !selectedSeats.length || !receiptData || !receiptFile) return null;

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
      competitionId: db.comp.id || '',
      pondId: pond.id,
      userId: user.uid || user.email,
      userName: user.name,
      userPhone: user.phone || '',
      seatIds,
      seatNumbers: selectedSeats,
      paymentType: payType,
      amount: payAmt,
      totalAmount: tot,
      receiptUrl,
      notes: bookingNotes,
      createdByStaff: false,
    };

    const result = await createBookingApi(payload);
    if (!result?.bookingId) return null;

    const booking: Booking = {
      id: result.bookingId,
      bookingRef: result.bookingRef,
      userId: user.uid || user.email,
      userName: user.name,
      userPhone: user.phone || '',
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
      createdByStaff: false,
    };

    const updatedPonds = db.ponds.map((p) => {
      if (p.id !== pond.id) return p;
      return {
        ...p,
        seats: p.seats.map((seat) => ({
          ...seat,
          status: selectedSeats.includes(seat.num) ? 'pending' : seat.status,
        })),
      };
    });

    const newDb = { ...db, bookings: [booking, ...db.bookings], ponds: updatedPonds };
    updateDB(newDb);
    clearBooking();
    return booking;
  }, [user, selectedSeats, receiptData, receiptFile, payType, bookingNotes, db, updateDB, clearBooking]);

  return (
    <BookingContext.Provider
      value={{
        db,
        user,
        selectedPond,
        selectedSeats,
        payType,
        receiptData,
        receiptFile,
        bookingNotes,
        setPond,
        toggleSeat,
        setSeats,
        setPayType,
        setReceiptData,
        setBookingNotes,
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
