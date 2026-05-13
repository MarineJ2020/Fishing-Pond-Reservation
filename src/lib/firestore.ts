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
import { DB, Pond, Seat, Booking, Score, Competition, Settings, ScoreEntry } from '../types';
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
  seatDocs: Array<{ id: string; seatNumber: number; row?: string; zone?: string; price?: number }>,
  seatLayout?: Array<{ num: number; px: number; py: number; active: boolean }>
): Seat[] => {
  const layoutMap = new Map<number, { px: number; py: number; active: boolean }>(
    (seatLayout ?? []).map(sl => [sl.num, { px: sl.px, py: sl.py, active: sl.active }])
  );

  if (seatDocs.length > 0) {
    return seatDocs
      .map((seat) => {
        const layout = layoutMap.get(seat.seatNumber);
        return {
          id: seat.id,
          num: seat.seatNumber,
          zone: seat.zone || (seat.seatNumber <= totalSeats / 2 ? 'A' : 'B'),
          price: seat.price ?? 100,
          status: 'available' as const,
          ...(layout ? { px: layout.px, py: layout.py, active: layout.active } : {}),
        };
      })
      .sort((a, b) => a.num - b.num);
  }

  return Array.from({ length: totalSeats }, (_, index) => {
    const num = index + 1;
    const layout = layoutMap.get(num);
    return {
      num,
      zone: index < totalSeats / 2 ? 'A' : 'B',
      price: 100,
      status: 'available' as const,
      ...(layout ? { px: layout.px, py: layout.py, active: layout.active } : {}),
    };
  });
};

const normalizeCompetition = (data: any): Competition => ({
  id: data.id,
  name: data.name || 'Fishing Competition',
  description: data.description || '',
  startDate: normalizeTimestamp(data.eventDate) || new Date().toISOString(),
  endDate: normalizeTimestamp(data.endDate) || normalizeTimestamp(data.eventDate) || new Date().toISOString(),
  topN: data.topN || 20,
  prizes: data.prizes || [],
  activePondIds: Array.isArray(data.activePondIds) ? data.activePondIds.map((id: any) => id?.toString?.() || '').filter(Boolean) : [],
  pondSeats: data.pondSeats && typeof data.pondSeats === 'object' ? data.pondSeats : undefined,
});

const normalizeSettings = (data: any): Settings => ({
  qrBank: data.qrBank || 'DuitNow / Bank Transfer',
  qrName: data.qrName || 'CastBook Sdn Bhd',
  qrAccNo: data.qrAccNo || '3841-2038-491',
  qrImg: data.qrImg || '',
  heroLogo: data.heroLogo || '',
  phone: data.phone || '',
  whatsapp: data.whatsapp || 'https://wa.me/60123456789',
  email: data.email || 'info@kks.com',
  location: data.location || 'Alor Setar, Kedah',
  openingHours: data.openingHours || {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    timeStart: '06:00',
    timeEnd: '18:00',
  },
  grandOpening: data.grandOpening || { date: new Date().toISOString().slice(0, 10), time: '08:00' },
  contactTitle: data.contactTitle || 'Ada Soalan?',
  contactSubtitle: data.contactSubtitle || 'Jangan segan untuk hubungi kami. Kami sedia membantu.',
  useLegacyPondView: data.useLegacyPondView === true,
});

const buildBooking = (
  docSnap: any,
  seatMap: Map<string, number>,
  pondMap: Map<string, Pond>,
  competitionMap: Map<string, Competition>
): Booking => {
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
  const competitionIdRef = data.competitionId?.id ?? data.competitionId ?? '';
  const competition = competitionMap.get(competitionIdRef?.toString() || '');

  return {
    id: docSnap.id,
    competitionId: competitionIdRef?.toString() || undefined,
    competitionName: competition?.name || data.competitionName || 'Pertandingan',
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
    status: (() => {
      const s = (data.status || 'PENDING_APPROVAL').toLowerCase();
      return (s === 'pending_approval' ? 'pending' : s) as 'pending' | 'confirmed' | 'rejected';
    })(),
    createdAt: normalizeTimestamp(data.createdAt) || new Date().toISOString(),
    bookingRef: data.bookingRef || undefined,
    createdByStaff: data.createdByStaff === true,
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

export const getCompetitions = async (): Promise<Competition[]> => {
  const competitionsRef = collection(db, 'competitions');
  const snapshot = await getDocs(competitionsRef);
  return snapshot.docs
    .map((docSnap) => normalizeCompetition({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
};

export const createCompetition = async (data: Partial<Competition>) => {
  const competitionsRef = collection(db, 'competitions');
  const docRef = await addDoc(competitionsRef, {
    name: data.name || 'Pertandingan Baru',
    eventDate: data.startDate || new Date().toISOString(),
    endDate: data.endDate || data.startDate || new Date().toISOString(),
    topN: data.topN || 20,
    prizes: data.prizes || [],
    activePondIds: data.activePondIds || [],
    pondSeats: data.pondSeats || {},
    status: 'ACTIVE',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
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
      maxSeats: data.totalSeats || undefined,
      seats: normalizeSeats(pondSnap.id, totalSeats, seatDocs, data.seatLayout),
      shape: Array.isArray(data.shape) && data.shape.length > 0 ? data.shape : undefined,
    };
  });
};

export const getBookings = async (competitionId?: string, competitions: Competition[] = []): Promise<Booking[]> => {
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

  const competitionMap = new Map<string, Competition>();
  competitions.forEach((competition) => {
    if (competition.id) competitionMap.set(competition.id, competition);
  });

  return snapshot.docs
    .filter((docSnap) => {
      if (!competitionId) return true;
      const data = docSnap.data();
      const bookingCompetitionId = (data.competitionId?.id || data.competitionId || '').toString();
      return bookingCompetitionId === competitionId;
    })
    .map((docSnap) => buildBooking(docSnap, seatMap, pondMap, competitionMap));
};

export const loadAppDB = async (): Promise<DB> => {
  try {
    const [competition, competitions, ponds, settings] = await Promise.all([
      getOrCreateDefaultCompetition(),
      getCompetitions(),
      getPondsWithSeats(),
      getSettings(),
    ]);

    // Fetch all bookings (not just for one competition)
    const bookings = await getBookings(undefined, competitions);

    const scores = competition && competition.id ? await buildScores(competition.id, bookings) : {};

    return {
      ponds,
      bookings,
      scores,
      comp: competition,
      competitions: competitions.length ? competitions : [competition],
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
    status: 'PENDING_APPROVAL',
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
  const payload: any = {
    updatedAt: serverTimestamp(),
  };
  if (typeof updates.name !== 'undefined') payload.name = updates.name;
  if (typeof updates.startDate !== 'undefined') payload.eventDate = updates.startDate;
  if (typeof updates.endDate !== 'undefined') payload.endDate = updates.endDate;
  if (typeof updates.topN !== 'undefined') payload.topN = updates.topN;
  if (typeof updates.prizes !== 'undefined') payload.prizes = updates.prizes;
  if (typeof updates.activePondIds !== 'undefined') payload.activePondIds = updates.activePondIds;
  if (typeof updates.pondSeats !== 'undefined') payload.pondSeats = updates.pondSeats;
  await setDoc(compRef, payload, { merge: true });
};

export const syncPondSeats = async (pondId: string, targetCount: number, pricePerSeat: number) => {
  const seatsRef = collection(db, 'seats');
  const seatsQuery = query(seatsRef, where('pondId', '==', pondId));
  const seatsSnapshot = await getDocs(seatsQuery);
  const existingSeats = seatsSnapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
    .sort((a, b) => (a.seatNumber || 0) - (b.seatNumber || 0));

  const safeTarget = Math.max(0, Math.floor(targetCount));
  const safePrice = Math.max(0, Number(pricePerSeat || 0));
  const currentCount = existingSeats.length;

  if (currentCount < safeTarget) {
    const addPromises: Promise<any>[] = [];
    for (let i = currentCount + 1; i <= safeTarget; i += 1) {
      addPromises.push(addDoc(seatsRef, {
        pondId,
        seatNumber: i,
        zone: i <= safeTarget / 2 ? 'A' : 'B',
        price: safePrice,
        status: 'available',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
    }
    await Promise.all(addPromises);
  }

  if (currentCount > safeTarget) {
    const removeSeats = existingSeats.slice(safeTarget);
    await Promise.all(removeSeats.map((seat) => deleteDoc(doc(db, 'seats', seat.id))));
  }

  const keepSeats = existingSeats.slice(0, Math.min(currentCount, safeTarget));
  if (keepSeats.length) {
    await Promise.all(keepSeats.map((seat) => setDoc(doc(db, 'seats', seat.id), {
      price: safePrice,
      updatedAt: serverTimestamp(),
    }, { merge: true })));
  }
};

export const deleteCompetition = async (competitionId: string) => {
  const compRef = doc(db, 'competitions', competitionId);
  await deleteDoc(compRef);
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

export const getScoresForCompetition = async (competitionId: string): Promise<ScoreEntry[]> => {
  const resultsRef = collection(db, 'eventResults');
  const [snapStr, snapRef] = await Promise.all([
    getDocs(query(resultsRef, where('competitionId', '==', competitionId))),
    getDocs(query(resultsRef, where('competitionId', '==', doc(db, 'competitions', competitionId)))),
  ]);
  const seenIds = new Set<string>();
  const entries: ScoreEntry[] = [];
  [...snapStr.docs, ...snapRef.docs].forEach((d) => {
    if (seenIds.has(d.id)) return;
    seenIds.add(d.id);
    const data = d.data();
    const rawBookingId = data.bookingId;
    const bookingId = rawBookingId && typeof rawBookingId === 'object'
      ? rawBookingId?.id
      : rawBookingId || undefined;
    entries.push({
      id: d.id,
      competitionId,
      bookingId,
      anglerName: data.anglerName || '',
      pondId: typeof data.pondId === 'number' ? data.pondId : 0,
      pondName: data.pondName || '',
      seatNum: data.seatNum || data.seatNumber || 0,
      weight: parseFloat(data.weight ?? data.totalWeight ?? 0),
    });
  });
  return entries;
};

export const saveScoreEntry = async (entry: Omit<ScoreEntry, 'id'>): Promise<string> => {
  const resultsRef = collection(db, 'eventResults');
  if (entry.bookingId) {
    const q = query(
      resultsRef,
      where('competitionId', '==', entry.competitionId),
      where('bookingId', '==', entry.bookingId),
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const existingId = snap.docs[0].id;
      await setDoc(doc(db, 'eventResults', existingId), {
        anglerName: entry.anglerName,
        pondId: entry.pondId,
        pondName: entry.pondName,
        seatNum: entry.seatNum,
        weight: entry.weight,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      return existingId;
    }
  }
  const docRef = await addDoc(resultsRef, {
    competitionId: entry.competitionId,
    bookingId: entry.bookingId || null,
    anglerName: entry.anglerName,
    pondId: entry.pondId,
    pondName: entry.pondName,
    seatNum: entry.seatNum,
    weight: entry.weight,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
};

export const deleteScoreEntry = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'eventResults', id));
};
