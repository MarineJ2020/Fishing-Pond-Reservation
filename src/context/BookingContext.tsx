import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { DB, User, Pond, Booking } from '../types';
import { getDB, setDB, initialDB } from '../data';

interface BookingContextType {
  db: DB;
  user: User | null;
  selectedPond: number | null;
  selectedSeats: number[];
  payType: 'full' | 'deposit';
  receiptData: string | null;
  receiptFile: File | null;
  bookingNotes: string;
  
  // Actions
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
  calculateTotal: () => number;
}

const BookingContext = createContext<BookingContextType | undefined>(undefined);

export const BookingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [db, setDbState] = useState<DB>(initialDB);
  const [user, setUser] = useState<User | null>(null);
  const [selectedPond, setSelectedPond] = useState<number | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [payType, setPayType] = useState<'full' | 'deposit'>('full');
  const [receiptData, setReceiptDataState] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [bookingNotes, setBookingNotes] = useState('');

  // Initialize from localStorage
  useEffect(() => {
    const loadedDb = getDB();
    setDbState(loadedDb);
    const sessionUser = localStorage.getItem('cb_session');
    if (sessionUser) {
      try {
        setUser(JSON.parse(sessionUser));
      } catch {}
    }
  }, []);

  const updateDB = useCallback((newDb: DB) => {
    setDbState(newDb);
    setDB(newDb);
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

  const submitBooking = useCallback(async (pond: Pond): Promise<Booking | null> => {
    if (!user || !selectedSeats.length || !receiptData) return null;
    
    const tot = selectedSeats.reduce((a, n) => {
      const s = pond.seats.find(x => x.num === n);
      return a + (s ? s.price : 0);
    }, 0);
    const payAmt = payType === 'deposit' ? Math.ceil(tot * 0.5) : tot;
    
    const booking: Booking = {
      id: 'CB' + Date.now().toString().slice(-7),
      userId: user.email,
      userName: user.name,
      userPhone: user.phone || '',
      pondId: pond.id,
      pondName: pond.name,
      pondDate: pond.date,
      seats: [...selectedSeats],
      paymentType: payType,
      amount: payAmt,
      totalAmount: tot,
      receiptData,
      receiptName: receiptFile?.name || 'receipt',
      notes: bookingNotes,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    // Update pond seats
    selectedSeats.forEach(n => {
      const s = pond.seats.find(x => x.num === n);
      if (s) s.status = 'pending';
    });

    const newDb = { ...db, bookings: [booking, ...db.bookings] };
    updateDB(newDb);
    clearBooking();
    return booking;
  }, [user, selectedSeats, receiptData, payType, db, bookingNotes, receiptFile, updateDB]);

  const clearBooking = useCallback(() => {
    setSelectedSeats([]);
    setReceiptDataState(null);
    setReceiptFile(null);
    setBookingNotes('');
    setPayType('full');
  }, []);

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
        calculateTotal
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