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
import { initialDB } from '../data';

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
  endDate: normalizeTimestamp(data.eventDate) || new Date().toISOString(),
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
    ? data.seatIds.map((ref: any) => seatMap.get(ref.path)).filter(Boolean)
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

  return pondSnapshot.docs.map((pondSnap) => {
    const data = pondSnap.data();
    const totalSeats = data.totalSeats || 30;
    const seatDocs = seatsByPond.get(pondSnap.id) || [];
    return {
      id: Number(pondSnap.id) || parseInt(pondSnap.id, 10) || 0,
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
  const snapshot = competitionId
    ? await getDocs(query(bookingsRef, where('competitionId', '==', doc(db, 'competitions', competitionId))))
    : await getDocs(bookingsRef);

  const ponds = await getPondsWithSeats();
  const pondMap = new Map(ponds.map((pond) => [pond.id.toString(), pond]));

  const seatSnapshot = await getDocs(collection(db, 'seats'));
  const seatMap = new Map<string, number>();
  seatSnapshot.forEach((seatSnap) => {
    const data = seatSnap.data();
    if (data.seatNumber) {
      seatMap.set(seatSnap.ref.path, data.seatNumber);
    }
  });

  return snapshot.docs.map((docSnap) => buildBooking(docSnap, seatMap, pondMap));
};

export const loadAppDB = async (): Promise<DB> => {
  try {
    const [competition, ponds] = await Promise.all([getActiveCompetition(), getPondsWithSeats()]);
    if (!competition || ponds.length === 0) {
      return initialDB;
    }

    const competitionId = competition.id || '';
    const bookings = await getBookings(competitionId);
    const scores = await buildScores(competitionId, bookings);

    return {
      ponds,
      bookings,
      scores,
      comp: competition,
      settings: normalizeSettings({}),
      users: [],
    };
  } catch (error) {
    console.error('Failed to load Firestore DB:', error);
    return initialDB;
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
  await setDoc(bookingRef, {
    status: status.toUpperCase(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
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
  const seats = [];
  for (let i = 1; i <= (pondData as any).totalSeats || 30; i++) {
    seats.push({
      pondId: docRef.id,
      seatNumber: i,
      zone: i <= ((pondData as any).totalSeats || 30) / 2 ? 'A' : 'B',
      price: (pondData as any).pricePerSeat || 100,
      status: 'available',
      createdAt: serverTimestamp(),
    });
  }

  await Promise.all(seats.map(seat => addDoc(seatsRef, seat)));
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
