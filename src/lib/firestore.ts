import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { DB, Pond, Seat, Booking, Score, Competition, Settings } from '../types';
import { emptyDB } from '../data';

const normalizeTimestamp = (value: any) => {
  if (!value) return null;
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  return new Date(value).toISOString();
};

const normalizeSeats = (
  pondId: string,
  totalSeats: number,
  seatDocs: Array<{ id: string; seatNumber: number; row?: string; zone?: string; price?: number }> 
): Seat[] => {
  if (seatDocs.length > 0) {
    return seatDocs
      .map((seat) => ({
        id: seat.id,
        num: seat.seatNumber,
        zone: seat.zone || (seat.seatNumber <= totalSeats / 2 ? 'A' : 'B'),
        price: seat.price ?? 100,
        status: 'available' as const,
      }))
      .sort((a, b) => a.num - b.num);
  }

  return Array.from({ length: totalSeats }, (_, index) => ({
    num: index + 1,
    zone: index < totalSeats / 2 ? 'A' : 'B',
    price: 100,
    status: 'available' as const,
  }));
};

const normalizeCompetition = (data: any): Competition => ({
  id: data.id,
  name: data.name || 'Fishing Competition',
  description: data.description || '',
  startDate: normalizeTimestamp(data.eventDate) || new Date().toISOString(),
  endDate: normalizeTimestamp(data.endDate) || normalizeTimestamp(data.eventDate) || new Date().toISOString(),
  topN: data.topN || 20,
  prizes: data.prizes || [],
});

const normalizeSettings = (data: any): Settings => ({
  qrBank: data.qrBank || 'DuitNow / Bank Transfer',
  qrName: data.qrName || 'CastBook Sdn Bhd',
  qrAccNo: data.qrAccNo || '3841-2038-491',
  qrImg: data.qrImg || '',
  heroLogo: data.heroLogo || '',
  whatsapp: data.whatsapp || 'https://wa.me/60123456789',
  location: data.location || 'Alor Setar, Kedah',
  openingHours: data.openingHours || {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    timeStart: '06:00',
    timeEnd: '18:00',
  },
  grandOpening: data.grandOpening || { date: new Date().toISOString().slice(0, 10), time: '08:00' },
});

const buildBooking = (docSnap: any, seatMap: Map<string, number>, pondMap: Map<string, Pond>): Booking => {
  const data = docSnap.data();
  const seatNumbers = Array.isArray(data.seatNumbers)
    ? data.seatNumbers
    : Array.isArray(data.seatIds)
    ? data.seatIds
        .map((ref: any) => {
          if (typeof ref === 'string') return seatMap.get(ref);
          if (ref?.path) return seatMap.get(ref.path);
          if (ref?.id) return seatMap.get(ref.id);
          return undefined;
        })
        .filter(Boolean)
    : [];

  const pondIdRef = data.pondId?.id ?? data.pondId;
  const pond = pondMap.get(pondIdRef?.toString() || '') ?? undefined;

  return {
    id: docSnap.id,
    userId: data.userId?.id ? data.userId.id : data.userId || '',
    userName: data.userName || data.guestName || 'Guest',
    userPhone: data.userPhone || data.phone || '',
    pondId: pond?.id ?? 0,
    pondName: pond?.name || 'Unknown',
    pondDate: pond?.date || normalizeTimestamp(data.eventDate) || new Date().toISOString(),
    seats: seatNumbers,
    paymentType: data.paymentType || 'full',
    amount: data.amount || 0,
    totalAmount: data.totalAmount || data.amount || 0,
    receiptData: data.receiptUrl || '',
    receiptName: data.receiptName || 'receipt',
    notes: data.staffNotes || data.notes || '',
    status: (data.status || 'PENDING_APPROVAL').toLowerCase() as 'pending' | 'confirmed' | 'rejected',
    createdAt: normalizeTimestamp(data.createdAt) || new Date().toISOString(),
  };
};

const buildScores = async (competitionId: string, bookings: Booking[]) => {
  const resultsRef = collection(db, 'eventResults');
  const q = query(resultsRef, where('competitionId', '==', doc(db, 'competitions', competitionId)));
  const snapshot = await getDocs(q);
  const scores: Record<number, Score> = {};

  snapshot.forEach((resultSnap) => {
    const data = resultSnap.data();
    const booking = bookings.find((booking) => booking.id === data.bookingId?.id || booking.id === data.bookingId);
    const peg = booking?.seats?.[0] || 0;
    if (!peg) return;
    scores[peg] = {
      weight: data.totalWeight || 0,
      fishCount: data.fishCount || 0,
      anglerName: booking?.userName || 'Angler',
      pondId: booking?.pondId || 0,
    };
  });

  return scores;
};

export const getActiveCompetition = async (): Promise<Competition | null> => {
  const competitionsRef = collection(db, 'competitions');
  const snapshot = await getDocs(competitionsRef);
  const comps = snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((data) => data.status !== 'DRAFT')
    .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
  if (!comps.length) return null;
  return normalizeCompetition(comps[0]);
};

export const getOrCreateDefaultCompetition = async (): Promise<Competition> => {
  const comp = await getActiveCompetition();
  if (comp) return comp;
  
  // Create default competition if none exists
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const competitionsRef = collection(db, 'competitions');
  const docRef = await addDoc(competitionsRef, {
    name: 'Fishing Competition 2026',
    eventDate: tomorrow.toISOString(),
    endDate: tomorrow.toISOString(),
    topN: 20,
    prizes: [{rank: 1, label: 'Champion', prize: 'RM 5,000'}],
    status: 'ACTIVE',
    createdAt: serverTimestamp(),
  });
  
  const newComp: Competition = {
    id: docRef.id,
    name: 'Fishing Competition 2026',
    startDate: tomorrow.toISOString(),
    endDate: tomorrow.toISOString(),
    topN: 20,
    prizes: [{rank: 1, label: 'Champion', prize: 'RM 5,000'}],
  };
  return newComp;
};

export const getPondsWithSeats = async (): Promise<Pond[]> => {
  const pondsRef = collection(db, 'ponds');
  const seatsRef = collection(db, 'seats');
  const [pondSnapshot, seatSnapshot] = await Promise.all([getDocs(pondsRef), getDocs(seatsRef)]);

  const seatsByPond = new Map<string, Array<any>>();
  seatSnapshot.forEach((seatSnap) => {
    const seatData = seatSnap.data();
    const pondId = seatData.pondId?.id || seatData.pondId;
    if (!pondId) return;
    const existing = seatsByPond.get(pondId.toString()) || [];
    existing.push({ id: seatSnap.id, ...seatData });
    seatsByPond.set(pondId.toString(), existing);
  });

  return pondSnapshot.docs.map((pondSnap, index) => {
    const data = pondSnap.data();
    const totalSeats = data.totalSeats || 30;
    const seatDocs = seatsByPond.get(pondSnap.id) || [];
    const numId = Number(pondSnap.id);
    return {
      id: Number.isFinite(numId) ? numId : (index + 1),
      _docId: pondSnap.id,
      name: data.name || `Pond ${pondSnap.id}`,
      desc: data.description || '',
      date: normalizeTimestamp(data.eventDate) || new Date().toISOString(),
      open: data.open !== false,
      seats: normalizeSeats(pondSnap.id, totalSeats, seatDocs),
    };
  });
};

export const getBookings = async (competitionId?: string): Promise<Booking[]> => {
  const bookingsRef = collection(db, 'bookings');
  const snapshot = await getDocs(bookingsRef);

  const ponds = await getPondsWithSeats();
  const pondMap = new Map<string, Pond>();
  ponds.forEach((pond) => {
    pondMap.set(pond.id.toString(), pond);
    if (pond._docId) pondMap.set(pond._docId, pond);
  });

  const seatSnapshot = await getDocs(collection(db, 'seats'));
  const seatMap = new Map<string, number>();
  seatSnapshot.forEach((seatSnap) => {
    const data = seatSnap.data();
    if (data.seatNumber) {
      seatMap.set(seatSnap.id, data.seatNumber);
      seatMap.set(seatSnap.ref.path, data.seatNumber);
    }
  });

  return snapshot.docs
    .filter((docSnap) => {
      if (!competitionId) return true;
      const data = docSnap.data();
      const bookingCompetitionId = data.competitionId?.id || data.competitionId || '';
      return bookingCompetitionId === competitionId;
    })
    .map((docSnap) => buildBooking(docSnap, seatMap, pondMap));
};

export const loadAppDB = async (): Promise<DB> => {
  try {
    const [competition, ponds, settings] = await Promise.all([
      getOrCreateDefaultCompetition(),
      getPondsWithSeats(),
      getSettings(),
    ]);

    // Fetch all bookings (not just for one competition)
    const bookings = await getBookings();

    // Mark seats as booked/pending based on actual bookings
    const bookedSeatMap = new Map<string, string>(); // `${pondId}-${seatNum}` -> status
    for (const b of bookings) {
      const seatStatus = b.status === 'confirmed' ? 'booked' : b.status === 'pending' ? 'pending' : null;
      if (!seatStatus) continue;
      for (const num of b.seats) {
        bookedSeatMap.set(`${b.pondId}-${num}`, seatStatus);
      }
    }

    const pondsWithBookingStatus = ponds.map(p => ({
      ...p,
      seats: p.seats.map(s => {
        const key = `${p.id}-${s.num}`;
        const status = bookedSeatMap.get(key);
        return status ? { ...s, status: status as 'booked' | 'pending' | 'available' } : s;
      }),
    }));

    const scores = competition && competition.id ? await buildScores(competition.id, bookings) : {};

    return {
      ponds: pondsWithBookingStatus,
      bookings,
      scores,
      comp: competition,
      settings,
      users: [],
    };
  } catch (error) {
    console.error('Failed to load Firestore DB:', error);
    return emptyDB;
  }
};

export const createUserProfile = async (uid: string, data: { email: string; name: string; phone?: string; role?: string }) => {
  await setDoc(doc(db, 'users', uid), {
    ...data,
    role: data.role || 'CLIENT',
    createdAt: serverTimestamp(),
  });
};

export const createBookingDocument = async (data: any) => {
  const bookingsRef = collection(db, 'bookings');
  return await addDoc(bookingsRef, {
    ...data,
    paymentStatus: 'PENDING',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

// Admin functions for CMS operations
export const updatePond = async (pondId: string, updates: Partial<Pond>) => {
  const pondRef = doc(db, 'ponds', pondId.toString());
  await setDoc(pondRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const updateBookingStatus = async (bookingId: string, status: 'pending' | 'confirmed' | 'rejected') => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const bookingSnap = await getDoc(bookingRef);
  await setDoc(bookingRef, {
    status: status.toUpperCase(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  if (!bookingSnap.exists()) return;
  const bookingData = bookingSnap.data() as any;
  const seatIds: string[] = Array.isArray(bookingData.seatIds)
    ? bookingData.seatIds
        .map((seat: any) => (typeof seat === 'string' ? seat : seat?.id || null))
        .filter(Boolean)
    : [];

  if (!seatIds.length && Array.isArray(bookingData.seatNumbers)) {
    const rawPondId = bookingData.pondId;
    const pondDocId = typeof rawPondId === 'string' ? rawPondId : rawPondId?.id;
    if (pondDocId) {
      const seatSnap = await getDocs(query(collection(db, 'seats'), where('pondId', '==', pondDocId)));
      const seatNumberSet = new Set<number>(bookingData.seatNumbers);
      seatSnap.forEach((docSnap) => {
        const seatData = docSnap.data();
        if (seatNumberSet.has(seatData.seatNumber)) {
          seatIds.push(docSnap.id);
        }
      });
    }
  }

  if (!seatIds.length) return;

  const nextSeatStatus = status === 'confirmed' ? 'booked' : status === 'pending' ? 'pending' : 'available';
  await Promise.all(
    seatIds.map((seatId) =>
      setDoc(doc(db, 'seats', seatId), { status: nextSeatStatus, updatedAt: serverTimestamp() }, { merge: true })
    )
  );
};

export const updateSeatStatus = async (seatId: string, status: 'available' | 'pending' | 'booked') => {
  const seatRef = doc(db, 'seats', seatId);
  await setDoc(seatRef, {
    status,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const updateCompetition = async (competitionId: string, updates: Partial<Competition>) => {
  const compRef = doc(db, 'competitions', competitionId);
  await setDoc(compRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const updateSettings = async (updates: Partial<Settings>) => {
  const settingsRef = doc(db, 'settings', 'global');
  await setDoc(settingsRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const getSettings = async (): Promise<Settings> => {
  try {
    const settingsRef = doc(db, 'settings', 'global');
    const settingsSnap = await getDoc(settingsRef);
    if (settingsSnap.exists()) {
      return normalizeSettings(settingsSnap.data());
    }
  } catch (error) {
    console.error('Failed to get settings:', error);
  }
  return normalizeSettings({});
};

export const createPond = async (pondData: Omit<Pond, 'id' | 'seats'>) => {
  const pondsRef = collection(db, 'ponds');
  const docRef = await addDoc(pondsRef, {
    ...pondData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Create seats for the pond
  const seatsRef = collection(db, 'seats');
  const totalSeats = (pondData as any).totalSeats || 30;
  const pricePerSeat = (pondData as any).pricePerSeat || 100;
  const seatPromises = [];
  for (let i = 1; i <= totalSeats; i++) {
    seatPromises.push(addDoc(seatsRef, {
      pondId: docRef.id,
      seatNumber: i,
      zone: i <= totalSeats / 2 ? 'A' : 'B',
      price: pricePerSeat,
      status: 'available',
      createdAt: serverTimestamp(),
    }));
  }

  await Promise.all(seatPromises);
  return docRef.id;
};

export const deletePond = async (pondId: string) => {
  // Delete seats first
  const seatsRef = collection(db, 'seats');
  const seatsQuery = query(seatsRef, where('pondId', '==', pondId));
  const seatsSnapshot = await getDocs(seatsQuery);
  await Promise.all(seatsSnapshot.docs.map(seatDoc => deleteDoc(seatDoc.ref)));

  // Delete pond
  const pondRef = doc(db, 'ponds', pondId);
  await deleteDoc(pondRef);
};
