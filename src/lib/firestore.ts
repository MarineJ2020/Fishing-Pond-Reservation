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
  writeBatch,
} from 'firebase/firestore';
import { auth } from '../../lib/firebase';
import { db } from '../../lib/firebase';
import { DB, Pond, Seat, Booking, Score, Competition, Settings, ScoreEntry, User } from '../types';
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
  pricePerPeg: typeof data.pricePerPeg === 'number' ? data.pricePerPeg : undefined,
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
  pondMapImg: data.pondMapImg || '',
  // OCR pipeline toggle (default true = run existing preprocessing before ONNX)
  ocrUsePreprocess: data.ocrUsePreprocess !== false,
  // Decimal-place override for ONNX output. Undefined = auto (use structure detection).
  ocrDecimalPlaces:
    typeof data.ocrDecimalPlaces === 'number' && [0, 1, 2, 3].includes(data.ocrDecimalPlaces)
      ? (data.ocrDecimalPlaces as 0 | 1 | 2 | 3)
      : undefined,
  // Landing v4 — homepage CMS-editable fields
  heroKicker: data.heroKicker || '',
  heroTitle: data.heroTitle || '',
  heroSubtitle: data.heroSubtitle || '',
  heroStats: Array.isArray(data.heroStats) ? data.heroStats : [],
  introCopy: data.introCopy || '',
  rules: Array.isArray(data.rules) ? data.rules : [],
  rulesPdfUrl: data.rulesPdfUrl || '',
  wazeUrl: data.wazeUrl || '',
  googleMapsUrl: data.googleMapsUrl || '',
  mapEmbedUrl: data.mapEmbedUrl || '',
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

  const statusLower = (data.status || 'PENDING_APPROVAL').toLowerCase();
  const isConfirmed = statusLower === 'approved' || statusLower === 'confirmed' || statusLower === 'live';
  const amount = data.amount || 0;
  const totalAmount = data.totalAmount || data.amount || 0;

  // Map the receipts array; fall back to the legacy single-receipt shape so
  // pre-change bookings still render. A legacy confirmed booking counts its
  // single receipt as accepted; otherwise pending.
  const receipts = Array.isArray(data.receipts) && data.receipts.length
    ? data.receipts.map((r: any) => ({
        url: r?.url || '',
        amount: Number(r?.amount) || 0,
        status: (r?.status || 'pending') as 'pending' | 'accepted' | 'rejected',
        submittedAt: normalizeTimestamp(r?.submittedAt) || new Date().toISOString(),
      }))
    : (data.receiptUrl
        ? [{
            url: data.receiptUrl,
            amount,
            status: (isConfirmed ? 'accepted' : 'pending') as 'pending' | 'accepted' | 'rejected',
            submittedAt: normalizeTimestamp(data.createdAt) || new Date().toISOString(),
          }]
        : []);

  const paidAmount = typeof data.paidAmount === 'number'
    ? data.paidAmount
    : receipts.filter((r) => r.status === 'accepted').reduce((s, r) => s + r.amount, 0);
  const balanceDue = Math.max(0, totalAmount - paidAmount);

  return {
    id: docSnap.id,
    competitionId: competitionIdRef?.toString() || undefined,
    competitionName: competition?.name || data.competitionName || 'Pertandingan',
    userId: data.userId?.id ? data.userId.id : data.userId || '',
    userEmail: data.userEmail || '',
    userName: data.userName || data.guestName || 'Guest',
    userPhone: data.userPhone || data.phone || '',
    pondId: pond?.id ?? 0,
    pondName: pond?.name || 'Unknown',
    pondCode: pond?.code || data.pondCode || undefined,
    pondDate: pond?.date || normalizeTimestamp(data.eventDate) || new Date().toISOString(),
    seats: seatNumbers,
    paymentType: data.paymentType || 'full',
    amount,
    totalAmount,
    receiptData: data.receiptUrl || receipts[0]?.url || '',
    receiptName: data.receiptName || 'receipt',
    receipts,
    paidAmount,
    balanceDue,
    notes: data.staffNotes || data.notes || '',
    status: (statusLower === 'rejected' ? 'rejected' : isConfirmed ? 'confirmed' : 'pending') as 'pending' | 'confirmed' | 'rejected',
    createdAt: normalizeTimestamp(data.createdAt) || new Date().toISOString(),
    bookingRef: data.bookingRef || undefined,
    createdByStaff: data.createdByStaff === true,
    balanceReminderSentAt: normalizeTimestamp(data.balanceReminderSentAt) || undefined,
    receiptReuploadUsed: data.receiptReuploadUsed === true,
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
    pricePerPeg: typeof data.pricePerPeg === 'number' ? data.pricePerPeg : 100,
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
    pricePerPeg: 100,
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
    pricePerPeg: 100,
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
      code: typeof data.code === 'string' && data.code.trim() ? data.code.trim().toUpperCase() : undefined,
      desc: data.description || '',
      date: normalizeTimestamp(data.eventDate) || new Date().toISOString(),
      open: data.open !== false,
      maxSeats: data.totalSeats || undefined,
      seats: normalizeSeats(pondSnap.id, totalSeats, seatDocs, data.seatLayout),
      shape: Array.isArray(data.shape) && data.shape.length > 0 ? data.shape : undefined,
      order: typeof data.order === 'number' ? data.order : undefined,
      _idx: index,
    } as Pond & { _idx: number };
  })
  // Honour the CMS-adjustable arrangement: ponds with an explicit `order` come
  // first (ascending), the rest keep their original fetch order.
  .sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a as any)._idx - (b as any)._idx;
  })
  .map(({ _idx, ...pond }: any) => pond as Pond);
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

// Fetch all user profile docs. Admin-only readable (firestore.rules); callers
// must already be staff/admin (e.g. CMSModal). Degrades to [] on any error so a
// permission hiccup never throws into the caller.
export const getUsers = async (): Promise<User[]> => {
  try {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        uid: d.id,
        email: (data.email as string) || '',
        name: (data.name as string) || '',
        phone: (data.phone as string) || '',
        role: (data.role as User['role']) || 'CLIENT',
      };
    });
  } catch (error) {
    console.error('Failed to load users:', error);
    return [];
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
  const snap = await getDocs(
    query(
      collection(db, 'bookings'),
      where('pondId', '==', data.pondId),
      where('competitionId', '==', data.competitionId)
    )
  );
  // Seats are implicitly locked between submission and staff decision: any existing
  // booking in PENDING_APPROVAL / APPROVED / CONFIRMED holds its seats here.
  const requestedSeats = new Set<number>(data.seatNumbers ?? []);
  snap.forEach((d) => {
    const s = (d.data().status || '').toUpperCase();
    if (!['PENDING_APPROVAL', 'APPROVED', 'CONFIRMED'].includes(s)) return;
    const taken = (d.data().seatNumbers ?? []) as number[];
    const clash = taken.find((n) => requestedSeats.has(n));
    if (clash) throw new Error(`Tempat #${clash} telah ditempah. Sila pilih tempat lain. / Seat #${clash} is already booked. Please choose another seat.`);
  });

  // Bookings made by staff/admin on behalf of a customer are trusted and
  // confirmed immediately — no separate approval step. Self-service bookings
  // still go through PENDING_APPROVAL for staff to verify the receipt.
  const isStaffBooking = data.createdByStaff === true;

  const bookingsRef = collection(db, 'bookings');
  return await addDoc(bookingsRef, {
    ...data,
    status: isStaffBooking ? 'CONFIRMED' : 'PENDING_APPROVAL',
    paymentStatus: isStaffBooking ? 'PAID' : 'PENDING',
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
  if (typeof updates.pricePerPeg !== 'undefined') payload.pricePerPeg = updates.pricePerPeg;
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
      photoUrl: data.photoUrl || undefined,
      ocrConfidence: typeof data.ocrConfidence === 'number' ? data.ocrConfidence : undefined,
      ocrRawText: data.ocrRawText || undefined,
      capturedBy: data.capturedBy || undefined,
      capturedAt: normalizeTimestamp(data.updatedAt) || normalizeTimestamp(data.createdAt) || undefined,
    });
  });
  return entries;
};

export const saveScoreEntry = async (entry: Omit<ScoreEntry, 'id'>): Promise<string> => {
  const resultsRef = collection(db, 'eventResults');
  const evidenceFields: Record<string, unknown> = {};
  if (entry.photoUrl)                       evidenceFields.photoUrl = entry.photoUrl;
  if (typeof entry.ocrConfidence === 'number') evidenceFields.ocrConfidence = entry.ocrConfidence;
  if (entry.ocrRawText)                     evidenceFields.ocrRawText = entry.ocrRawText;
  if (typeof entry.ocrUserVerified === 'boolean') evidenceFields.ocrUserVerified = entry.ocrUserVerified;
  if (entry.scanMethod)                     evidenceFields.scanMethod = entry.scanMethod;
  if (entry.capturedBy)                     evidenceFields.capturedBy = entry.capturedBy;

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
        ...evidenceFields,
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
    ...evidenceFields,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
};

export const deleteScoreEntry = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'eventResults', id));
};

const sumAcceptedReceipts = (receipts: any[]) =>
  (Array.isArray(receipts) ? receipts : [])
    .filter((r) => r?.status === 'accepted')
    .reduce((sum, r) => sum + (Number(r?.amount) || 0), 0);

// Mirror buildBooking's receipt derivation so the on-disk document matches the
// indexes the CMS renders. Legacy bookings store a single `receiptUrl` with no
// `receipts` array; we materialize that into the array shape before writing.
const deriveReceiptsFromBooking = (booking: any): any[] => {
  if (Array.isArray(booking?.receipts) && booking.receipts.length) {
    return booking.receipts.map((r: any) => ({
      url: r?.url || '',
      amount: Number(r?.amount) || 0,
      status: (r?.status || 'pending') as 'pending' | 'accepted' | 'rejected',
      submittedAt: r?.submittedAt ?? new Date().toISOString(),
    }));
  }
  if (booking?.receiptUrl) {
    const statusUpper = (booking.status || '').toUpperCase();
    const isConfirmed = ['APPROVED', 'CONFIRMED', 'LIVE'].includes(statusUpper);
    return [{
      url: booking.receiptUrl,
      amount: Number(booking.amount) || 0,
      status: (isConfirmed ? 'accepted' : 'pending') as 'pending' | 'accepted' | 'rejected',
      submittedAt: booking.createdAt ?? new Date().toISOString(),
    }];
  }
  return [];
};

const setSeatStatusForBooking = async (bookingData: any, nextStatus: 'booked' | 'pending' | 'available') => {
  const rawSeatIds: string[] = Array.isArray(bookingData?.seatIds)
    ? bookingData.seatIds
        .map((ref: any) => (typeof ref === 'string' ? ref : ref?.id || ref?.path?.split('/').pop() || null))
        .filter(Boolean)
    : [];

  let seatIds = rawSeatIds;
  if (!seatIds.length && Array.isArray(bookingData?.seatNumbers)) {
    const rawPondId = bookingData.pondId;
    const pondDocId = typeof rawPondId === 'string' ? rawPondId : rawPondId?.id;
    if (pondDocId) {
      const seatSnap = await getDocs(query(collection(db, 'seats'), where('pondId', '==', pondDocId)));
      const seatNumberSet = new Set<number>(bookingData.seatNumbers);
      seatSnap.forEach((docSnap) => {
        const data = docSnap.data();
        if (seatNumberSet.has(data.seatNumber)) seatIds.push(docSnap.id);
      });
    }
  }

  if (!seatIds.length) return;
  const batch = writeBatch(db);
  seatIds.forEach((seatId) => {
    batch.set(doc(db, 'seats', seatId), { status: nextStatus, updatedAt: serverTimestamp() }, { merge: true });
  });
  await batch.commit();
};

const MAX_RECEIPTS = 3;

export const submitBookingReceiptDirect = async (bookingId: string, receiptUrl: string, amount: number) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;

  if ((booking.status || '').toUpperCase() === 'REJECTED') {
    throw new Error('Tempahan ini telah ditolak. / This booking has been rejected.');
  }

  const receipts = deriveReceiptsFromBooking(booking);
  if (receipts.length >= MAX_RECEIPTS) {
    throw new Error(`Maksimum ${MAX_RECEIPTS} resit telah dicapai. / Maximum of ${MAX_RECEIPTS} receipts reached.`);
  }

  const totalAmount = Number(booking.totalAmount) || 0;
  if (totalAmount > 0 && sumAcceptedReceipts(receipts) >= totalAmount) {
    throw new Error('Tempahan ini telah dibayar sepenuhnya. / This booking is already fully paid.');
  }

  const next = [
    ...receipts,
    { url: receiptUrl, amount: Number(amount) || 0, status: 'pending' as const, submittedAt: new Date().toISOString() },
  ];
  await setDoc(bookingRef, {
    receipts: next,
    receiptUrl,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
  }, { merge: true });

  return { receipts: next };
};

// Receipt correction: the owner replaces the file of any not-yet-approved receipt
// (e.g. wrong photo, or a staff-rejected receipt). A rejected receipt returns to
// 'pending' so staff re-review it. Approved receipts and rejected bookings are
// frozen. Owner-scoped write (see firestore.rules).
export const replaceBookingReceiptDirect = async (bookingId: string, receiptIndex: number, newReceiptUrl: string) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;

  if ((booking.status || '').toUpperCase() === 'REJECTED') {
    throw new Error('Tempahan ini telah ditolak. / This booking has been rejected.');
  }

  const receipts = deriveReceiptsFromBooking(booking);
  if (receiptIndex < 0 || receiptIndex >= receipts.length) {
    throw new Error('Indeks resit tidak sah. / Invalid receipt index.');
  }
  if (receipts[receiptIndex].status === 'accepted') {
    throw new Error('Resit yang telah disahkan tidak boleh digantikan. / An approved receipt cannot be replaced.');
  }

  // Replacing a receipt always (re)submits it for review, so it goes/stays pending.
  receipts[receiptIndex] = { ...receipts[receiptIndex], url: newReceiptUrl, status: 'pending', submittedAt: new Date().toISOString() };

  await setDoc(bookingRef, {
    receipts,
    receiptUrl: newReceiptUrl,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
  }, { merge: true });

  return { receipts };
};

export const acceptBookingReceiptDirect = async (bookingId: string, receiptIndex: number) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;
  const receipts = deriveReceiptsFromBooking(booking);
  if (receiptIndex < 0 || receiptIndex >= receipts.length) throw new Error('Indeks resit tidak sah. / Invalid receipt index.');

  const wasAccepted = receipts[receiptIndex]?.status === 'accepted';
  receipts[receiptIndex] = { ...receipts[receiptIndex], status: 'accepted' };
  const paidAmount = sumAcceptedReceipts(receipts);
  const totalAmount = Number(booking.totalAmount) || 0;
  const fullyPaid = totalAmount > 0 && paidAmount >= totalAmount;
  const statusUpper = (booking.status || '').toUpperCase();
  const alreadyConfirmed = ['APPROVED', 'CONFIRMED', 'LIVE'].includes(statusUpper);
  // Confirm the booking (status + hold seats) only once it is fully paid. A deposit
  // booking with only the deposit receipt accepted stays PENDING_APPROVAL — its seats
  // remain held by the pending-booking seat-conflict logic — until the balance is in.
  const shouldConfirm = fullyPaid && !alreadyConfirmed;

  const update: Record<string, any> = {
    receipts,
    paidAmount,
    paymentStatus: fullyPaid ? 'APPROVED' : 'PARTIAL',
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
  };
  if (shouldConfirm) update.status = 'APPROVED';

  await setDoc(bookingRef, update, { merge: true });

  if (!wasAccepted) {
    await addDoc(collection(db, 'bookings', bookingId, 'payments'), {
      amount: Number(receipts[receiptIndex].amount) || 0,
      method: 'receipt',
      recordedBy: auth.currentUser?.uid || null,
      createdAt: serverTimestamp(),
    });
  }
  if (shouldConfirm) await setSeatStatusForBooking(booking, 'booked');

  return { success: true, paidAmount, fullyPaid, status: update.status || booking.status };
};

// Staff-assisted deposit approval path: attach uploaded proof, mark the
// deposit as accepted, confirm the booking, and convert paymentType to `baki`
// while a balance remains.
export const approveDepositWithProofDirect = async (bookingId: string, proofUrl: string, depositAmount?: number) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;

  const receipts = deriveReceiptsFromBooking(booking);
  const amount = Number(depositAmount ?? booking.amount) || 0;
  const acceptedReceipt = {
    url: proofUrl,
    amount,
    status: 'accepted' as const,
    submittedAt: new Date().toISOString(),
  };
  const nextReceipts = [...receipts, acceptedReceipt];

  const paidAmount = sumAcceptedReceipts(nextReceipts);
  const totalAmount = Number(booking.totalAmount) || 0;
  const balanceDue = Math.max(0, totalAmount - paidAmount);
  const nextPaymentType = balanceDue > 0 ? 'baki' : 'full';

  await setDoc(bookingRef, {
    receipts: nextReceipts,
    receiptUrl: proofUrl,
    paidAmount,
    paymentType: nextPaymentType,
    paymentStatus: balanceDue > 0 ? 'PARTIAL' : 'APPROVED',
    status: 'APPROVED',
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
  }, { merge: true });

  await addDoc(collection(db, 'bookings', bookingId, 'payments'), {
    amount,
    method: 'manual-proof',
    type: 'baki',
    recordedBy: auth.currentUser?.uid || null,
    createdAt: serverTimestamp(),
  });

  await setSeatStatusForBooking(booking, 'booked');
  return { success: true, paidAmount, balanceDue, paymentType: nextPaymentType };
};

// Stamp the time a balance reminder was sent so the 7-day auto-remind window
// resets. Admin-only write (allowed by the bookings update rule for staff).
export const markBalanceReminderSent = async (bookingId: string) => {
  await setDoc(doc(db, 'bookings', bookingId), {
    balanceReminderSentAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
  }, { merge: true });
};

export const rejectBookingReceiptDirect = async (bookingId: string, receiptIndex: number) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;
  const receipts = deriveReceiptsFromBooking(booking);
  if (receiptIndex < 0 || receiptIndex >= receipts.length) throw new Error('Indeks resit tidak sah. / Invalid receipt index.');

  receipts[receiptIndex] = { ...receipts[receiptIndex], status: 'rejected' };
  const paidAmount = sumAcceptedReceipts(receipts);

  await setDoc(bookingRef, {
    receipts,
    paidAmount,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
  }, { merge: true });

  return { success: true, paidAmount };
};
