import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { initialDB, setDB } from '../data';
import { loadAppDB } from '../lib/firestore';
import { createBooking as createBookingApi } from '../lib/api';
import { updateSeatStatus } from '../lib/firestore';
const BookingContext = createContext(undefined);
// Cloudinary upload helper
const uploadToCloudinary = async (receiptData, fileName) => {
    const formData = new FormData();
    // Convert base64 to blob for Cloudinary
    const base64Data = receiptData.split(',')[1]; // Remove data:image/jpeg;base64,
    const blob = new Blob([Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))], { type: 'image/jpeg' });
    formData.append('file', blob);
    formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', 'fishing-pond-receipts');
    const response = await fetch(`https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
    if (!response.ok) {
        throw new Error('Failed to upload receipt to Cloudinary');
    }
    const result = await response.json();
    return result.secure_url;
};
export const BookingProvider = ({ children }) => {
    const [db, setDbState] = useState(initialDB);
    const [user, setUser] = useState(null);
    const [selectedPond, setSelectedPond] = useState(null);
    const [selectedSeats, setSelectedSeats] = useState([]);
    const [payType, setPayType] = useState('full');
    const [receiptData, setReceiptDataState] = useState(null);
    const [receiptFile, setReceiptFile] = useState(null);
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
        load().catch(() => { });
        return () => { canceled = true; };
    }, []);
    const updateDB = useCallback((newDb) => {
        setDbState(newDb);
        setDB(newDb);
    }, []);

    const reloadDB = useCallback(async () => {
        try {
            const remoteDb = await loadAppDB();
            setDbState(remoteDb);
            setDB(remoteDb);
        } catch (error) {
            console.error('Failed to reload DB:', error);
        }
    }, []);
    const setPond = useCallback((id) => {
        setSelectedPond(id);
        setSelectedSeats([]);
    }, []);
    const toggleSeat = useCallback((num) => {
        const pond = db.ponds.find(p => p.id === selectedPond);
        const seat = pond?.seats.find(s => s.num === num);
        if (!seat || seat.status === 'booked')
            return;
        setSelectedSeats(prev => {
            const idx = prev.indexOf(num);
            return idx > -1 ? prev.filter(s => s !== num) : [...prev, num];
        });
    }, [db.ponds, selectedPond]);
    const setSeats = useCallback((seats) => {
        setSelectedSeats(seats);
    }, []);
    const setReceiptData = useCallback((data, file) => {
        setReceiptDataState(data);
        setReceiptFile(file);
    }, []);
    const calculateTotal = useCallback(() => {
        if (!selectedPond)
            return 0;
        const pond = db.ponds.find(p => p.id === selectedPond);
        if (!pond)
            return 0;
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
    const submitBooking = useCallback(async (pond) => {
        if (!user || !selectedSeats.length || !receiptData || !receiptFile)
            return null;
        const seatIds = selectedSeats
            .map((num) => pond.seats.find((s) => s.num === num)?.id)
            .filter(Boolean);
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
            seatIds,
            seatNumbers: selectedSeats,
            paymentType: payType,
            amount: payAmt,
            totalAmount: tot,
            receiptUrl,
            notes: bookingNotes,
            userId: user.email,
            userName: user.name,
            userPhone: user.phone || '',
            createdByStaff: false,
        };
        const result = await createBookingApi(payload);
        if (!result?.bookingId)
            return null;
        const booking = {
            id: result.bookingId,
            bookingRef: result.bookingRef,
            userId: user.email,
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

        // Update seat statuses in Firestore
        const seatUpdatePromises = selectedSeats.map(seatNum => {
            const seat = pond.seats.find(s => s.num === seatNum);
            if (seat && seat.id) {
                return updateSeatStatus(seat.id, 'pending');
            }
            return Promise.resolve();
        });
        await Promise.all(seatUpdatePromises);

        const updatedPonds = db.ponds.map((p) => {
            if (p.id !== pond.id)
                return p;
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

        // Reload from Firestore to ensure consistency
        setTimeout(() => reloadDB(), 1000);

        return booking;
    }, [user, selectedSeats, receiptData, receiptFile, payType, bookingNotes, db, updateDB, clearBooking]);
    return (<BookingContext.Provider value={{
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
        }}>
      {children}
    </BookingContext.Provider>);
};
export const useBooking = () => {
    const context = useContext(BookingContext);
    if (!context) {
        throw new Error('useBooking must be used within BookingProvider');
    }
    return context;
};
