import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  updateDoc,
  addDoc,
  setDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
  runTransaction,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { auth } from '../../lib/firebase';
import { db } from '../../lib/firebase';
import { DB, Pond, Seat, Booking, Score, Competition, Settings, ScoreEntry, User, AuditEntry, SeoSettings, PrizeClaim } from '../types';
import { emptyDB } from '../data';
import { LANDING_DEFAULTS, SEO_DEFAULTS } from '../config/landingDefaults';
import { normalizeLandingSections } from '../config/landingSections';
import { bookingRequest } from './bookingApi';
import { isStaffRole } from '../utils/roles';

// Cloud Functions can cold-start above 5 seconds. Keep the public booking page
// from falsely closing peg selection while the backend warms up.
const AVAILABILITY_TIMEOUT_MS = 30000;

const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

// Staff used to read every booking ever on each CMS load, which grows with
// every event. Now they load only competitions that are upcoming or ended in
// the last RECENT_COMPETITION_DAYS days (plus their own bookings); older
// events load on demand (loadCompetitionBookingDocs / loadAllBookingDocs).
export const RECENT_COMPETITION_DAYS = 30;

const competitionEndMillis = (data: DocumentData) => {
  const value = data.endDate ?? data.eventDate ?? data.startDate;
  if (!value) return NaN;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return new Date(value).getTime();
};

/** Competition ids whose bookings staff load up front. */
export const recentCompetitionIds = (competitionDocs: Array<{ id: string; data: () => DocumentData }>, now = Date.now()) =>
  competitionDocs
    .filter((snap) => {
      const end = competitionEndMillis(snap.data());
      return !Number.isFinite(end) || end >= now - RECENT_COMPETITION_DAYS * 24 * 60 * 60 * 1000;
    })
    .map((snap) => snap.id);

/** Bookings of these competitions, matching both stored competitionId encodings. */
export const getBookingDocsForCompetitions = async (competitionIds: string[]) => {
  const chunks = Array.from({ length: Math.ceil(competitionIds.length / 15) }, (_, i) => competitionIds.slice(i * 15, i * 15 + 15));
  const snaps = await Promise.all(chunks.map((ids) => getDocs(query(
    collection(db, 'bookings'),
    where('competitionId', 'in', ids.flatMap((id) => [id, doc(db, 'competitions', id)])),
  ))));
  return snaps.flatMap((snap) => snap.docs);
};

export const getAllBookingDocs = async () => (await getDocs(collection(db, 'bookings'))).docs;

/** Cancelled-with-refund bookings from any event (dashboard "refunds owed"). */
export const getRefundBookingDocs = async () =>
  (await getDocs(query(collection(db, 'bookings'), where('cancelType', '==', 'refund')))).docs;

const getVisibleBookingDocs = async (
  competitionDocsPromise?: Promise<Array<{ id: string; data: () => DocumentData }>>,
): Promise<{ docs: QueryDocumentSnapshot<DocumentData>[]; scope: string[] | null }> => {
  const user = auth.currentUser;
  if (!user) return { docs: [], scope: null };
  const profilePromise = getDoc(doc(db, 'users', user.uid));
  const ownerValues: unknown[] = [user.uid, doc(db, 'users', user.uid)];
  if (user.emailVerified && user.email) ownerValues.push(user.email);
  const requests = ownerValues.map((value) => getDocs(query(collection(db, 'bookings'), where('userId', '==', value))));
  if (user.emailVerified && user.email) requests.push(getDocs(query(collection(db, 'bookings'), where('userEmail', '==', user.email))));
  const ownerBookingsPromise = Promise.all(requests);
  const profile = await profilePromise;
  const ownDocs = (await ownerBookingsPromise).flatMap((snap) => snap.docs);
  let scope: string[] | null = null;
  let staffDocs: QueryDocumentSnapshot<DocumentData>[] = [];
  if (isStaffRole(profile.data()?.role)) {
    const competitionDocs = await (competitionDocsPromise ?? getDocs(collection(db, 'competitions')).then((snap) => snap.docs));
    scope = recentCompetitionIds(competitionDocs);
    staffDocs = scope.length ? await getBookingDocsForCompetitions(scope) : [];
  }
  return { docs: [...new Map([...staffDocs, ...ownDocs].map((snap) => [snap.id, snap])).values()], scope };
};

// buildBooking needs seat docs only for legacy bookings that stored seatIds
// without seatNumbers; fetch those few instead of the whole seats collection.
const getLegacySeatDocs = async (bookingDocs: Array<{ data: () => DocumentData }>) => {
  const ids = new Set<string>();
  bookingDocs.forEach((snap) => {
    const data = snap.data();
    if (Array.isArray(data.seatNumbers) || !Array.isArray(data.seatIds)) return;
    data.seatIds.forEach((ref: any) => {
      const id = typeof ref === 'string' ? ref.split('/').pop() : ref?.id;
      if (id) ids.add(id);
    });
  });
  const list = [...ids];
  const chunks = Array.from({ length: Math.ceil(list.length / 30) }, (_, i) => list.slice(i * 30, i * 30 + 30));
  const snaps = await Promise.all(chunks.map((chunk) => getDocs(query(collection(db, 'seats'), where(documentId(), 'in', chunk)))));
  return snaps.flatMap((snap) => snap.docs);
};

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
  seatLayout?: Array<{ num: number; px: number; py: number; active: boolean }>,
  pricePerSeat?: unknown,
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
      price: typeof pricePerSeat === 'number' && Number.isFinite(pricePerSeat) ? pricePerSeat : 100,
      status: 'available' as const,
      ...(layout ? { px: layout.px, py: layout.py, active: layout.active } : {}),
    };
  });
};

const normalizeCompetition = (data: any): Competition => ({
  id: data.id,
  name: data.name || 'Fishing Competition',
  description: data.description || '',
  prizeHighlight: typeof data.prizeHighlight === 'string' ? data.prizeHighlight : undefined,
  startDate: normalizeTimestamp(data.eventDate) || new Date().toISOString(),
  endDate: normalizeTimestamp(data.endDate) || normalizeTimestamp(data.eventDate) || new Date().toISOString(),
  topN: data.topN || 20,
  prizes: data.prizes || [],
  activePondIds: Array.isArray(data.activePondIds) ? data.activePondIds.map((id: any) => id?.toString?.() || '').filter(Boolean) : [],
  pondSeats: data.pondSeats && typeof data.pondSeats === 'object' ? data.pondSeats : undefined,
  pricePerPeg: typeof data.pricePerPeg === 'number' ? data.pricePerPeg : undefined,
  fastestPrize: typeof data.fastestPrize === 'string' ? data.fastestPrize : null,
  mostPrize: typeof data.mostPrize === 'string' ? data.mostPrize : null,
  maxPegsPerBooking: typeof data.maxPegsPerBooking === 'number' ? data.maxPegsPerBooking : undefined,
  maxPendingBookingsPerUser: typeof data.maxPendingBookingsPerUser === 'number' ? data.maxPendingBookingsPerUser : undefined,
  bookingOpenAt: normalizeTimestamp(data.bookingOpenAt) || undefined,
  bookingCloseAt: normalizeTimestamp(data.bookingCloseAt) || undefined,
  // Treat any explicit closed/inactive marker as INACTIVE; everything else (incl. legacy
  // docs with no status) is ACTIVE so existing competitions stay publicly visible.
  status: ['INACTIVE', 'DRAFT', 'CLOSED'].includes((data.status || '').toString().toUpperCase()) ? 'INACTIVE' : 'ACTIVE',
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
  heroCtaLabel: data.heroCtaLabel || LANDING_DEFAULTS.heroCtaLabel,
  introCopy: data.introCopy || '',
  rules: Array.isArray(data.rules) ? data.rules : [],
  rulesPdfUrl: data.rulesPdfUrl || '',
  wazeUrl: data.wazeUrl || '',
  googleMapsUrl: data.googleMapsUrl || '',
  mapEmbedUrl: data.mapEmbedUrl || '',

  // Landing v5 — full homepage content customization + images. Real (non-empty)
  // defaults so first deploy is visually identical and CMS inputs show live text.
  aboutEyebrow: data.aboutEyebrow || LANDING_DEFAULTS.aboutEyebrow,
  aboutTitle: data.aboutTitle || LANDING_DEFAULTS.aboutTitle,
  aboutCtaLabel: data.aboutCtaLabel || LANDING_DEFAULTS.aboutCtaLabel,
  features: Array.isArray(data.features) && data.features.length === 4 ? data.features : LANDING_DEFAULTS.features,
  competitionsEyebrow: data.competitionsEyebrow || LANDING_DEFAULTS.competitionsEyebrow,
  competitionsTitle: data.competitionsTitle || LANDING_DEFAULTS.competitionsTitle,
  weeklyCardTitle: data.weeklyCardTitle || LANDING_DEFAULTS.weeklyCardTitle,
  weeklyCardBody: data.weeklyCardBody || LANDING_DEFAULTS.weeklyCardBody,
  weeklyCardTag1: data.weeklyCardTag1 || LANDING_DEFAULTS.weeklyCardTag1,
  weeklyCardTag2: data.weeklyCardTag2 || LANDING_DEFAULTS.weeklyCardTag2,
  stepsEyebrow: data.stepsEyebrow || LANDING_DEFAULTS.stepsEyebrow,
  stepsTitle: data.stepsTitle || LANDING_DEFAULTS.stepsTitle,
  stepsSubtitle: data.stepsSubtitle || LANDING_DEFAULTS.stepsSubtitle,
  stepsCtaLabel: data.stepsCtaLabel || LANDING_DEFAULTS.stepsCtaLabel,
  steps: Array.isArray(data.steps) && data.steps.length === 4 ? data.steps : LANDING_DEFAULTS.steps,
  rulesEyebrow: data.rulesEyebrow || LANDING_DEFAULTS.rulesEyebrow,
  rulesTitle: data.rulesTitle || LANDING_DEFAULTS.rulesTitle,
  rulesCtaLabel: data.rulesCtaLabel || LANDING_DEFAULTS.rulesCtaLabel,
  lokasiEyebrow: data.lokasiEyebrow || LANDING_DEFAULTS.lokasiEyebrow,
  lokasiTitle: data.lokasiTitle || LANDING_DEFAULTS.lokasiTitle,
  contactName: data.contactName || LANDING_DEFAULTS.contactName,
  footerTagline: data.footerTagline || LANDING_DEFAULTS.footerTagline,
  landingSections: normalizeLandingSections(data.landingSections),
  landingImages: { ...(data.landingImages || {}) },

  seo: normalizeSeo(data.seo),
});

const normalizeSeo = (data: any): SeoSettings => {
  const pages = data?.pages || {};
  return {
    siteUrl: data?.siteUrl || SEO_DEFAULTS.siteUrl,
    siteName: data?.siteName || SEO_DEFAULTS.siteName,
    defaultOgImage: data?.defaultOgImage || SEO_DEFAULTS.defaultOgImage,
    latitude: typeof data?.latitude === 'number' ? data.latitude : undefined,
    longitude: typeof data?.longitude === 'number' ? data.longitude : undefined,
    pages: {
      home: { ...SEO_DEFAULTS.pages.home, ...(pages.home || {}) },
      book: { ...SEO_DEFAULTS.pages.book, ...(pages.book || {}) },
      live: { ...SEO_DEFAULTS.pages.live, ...(pages.live || {}) },
    },
  };
};

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
  const pondSelections = Array.isArray(data.pondSelections)
    ? data.pondSelections.map((selection: any) => {
        const selectionPondIdRef = selection?.pondId?.id ?? selection?.pondId;
        const selectionPond = pondMap.get(selectionPondIdRef?.toString() || '');
        return {
          pondId: selectionPond?.id ?? Number(selectionPondIdRef) ?? 0,
          pondName: selectionPond?.name || selection?.pondName || 'Kolam',
          pondCode: selectionPond?.code || selection?.pondCode || undefined,
          pondDate: selectionPond?.date || selection?.pondDate || undefined,
          seats: Array.isArray(selection?.seats) ? selection.seats : [],
          seatIds: Array.isArray(selection?.seatIds) ? selection.seatIds : [],
        };
      }).filter((selection: any) => selection.pondId && selection.seats.length)
    : undefined;
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
        bankReference: r?.bankReference || '',
        ...(r?.rejectReason ? { rejectReason: String(r.rejectReason) } : {}),
      }))
    : (data.receiptUrl
        ? [{
            url: data.receiptUrl,
            amount,
            status: (isConfirmed ? 'accepted' : 'pending') as 'pending' | 'accepted' | 'rejected',
            submittedAt: normalizeTimestamp(data.createdAt) || new Date().toISOString(),
            bankReference: data.bankReference || '',
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
    bookingPhone: data.bookingPhone || '',
    pondId: pond?.id ?? 0,
    pondName: pond?.name || 'Unknown',
    pondCode: pond?.code || data.pondCode || undefined,
    pondDate: pond?.date || normalizeTimestamp(data.eventDate) || new Date().toISOString(),
    seats: seatNumbers,
    pondSelections,
    paymentType: data.paymentType || 'full',
    amount,
    totalAmount,
    receiptData: data.receiptUrl || receipts[0]?.url || '',
    receiptName: data.receiptName || 'receipt',
    bankReference: data.bankReference || '',
    receipts,
    paidAmount,
    balanceDue,
    notes: data.staffNotes || data.notes || '',
    status: (statusLower === 'rejected' ? 'rejected' : isConfirmed ? 'confirmed' : 'pending') as 'pending' | 'confirmed' | 'rejected',
    createdAt: normalizeTimestamp(data.createdAt) || new Date().toISOString(),
    bookingRef: data.bookingRef || undefined,
    createdByStaff: data.createdByStaff === true,
    createdByUid: data.createdByUid || undefined,
    createdByName: data.createdByName || undefined,
    cancelReason: data.cancelReason || undefined,
    cancelType: ['no_show_forfeit', 'refund', 'no_payment'].includes(data.cancelType) ? data.cancelType : undefined,
    cancelledAt: normalizeTimestamp(data.cancelledAt) || undefined,
    forfeitedAmount: typeof data.forfeitedAmount === 'number' ? data.forfeitedAmount : undefined,
    refundStatus: data.refundStatus === 'refunded' ? 'refunded' : data.refundStatus === 'pending' ? 'pending' : undefined,
    refundAmount: typeof data.refundAmount === 'number' ? data.refundAmount : undefined,
    refundedAt: normalizeTimestamp(data.refundedAt) || undefined,
    refundedByName: data.refundedByName || undefined,
    refundReference: data.refundReference || undefined,
    refundProofUrl: data.refundProofUrl || undefined,
    checkedIn: data.checkedIn === true,
    checkedInSeats: Array.isArray(data.checkedInSeats)
      ? data.checkedInSeats.map((seat: any) => Number(seat)).filter(Number.isFinite)
      : [],
    checkedInSeatKeys: Array.isArray(data.checkedInSeatKeys)
      ? data.checkedInSeatKeys.map((key: any) => String(key)).filter(Boolean)
      : [],
    checkedInAt: normalizeTimestamp(data.checkedInAt) || undefined,
    checkedInSeatTimes: data.checkedInSeatTimes && typeof data.checkedInSeatTimes === 'object'
      ? Object.fromEntries(
          Object.entries(data.checkedInSeatTimes).map(([seat, value]) => [seat, normalizeTimestamp(value) || String(value || '')]),
        )
      : {},
    balanceReminderSentAt: normalizeTimestamp(data.balanceReminderSentAt) || undefined,
    emailDelivery: data.emailDelivery && typeof data.emailDelivery === 'object'
      ? Object.fromEntries(Object.entries(data.emailDelivery).map(([kind, delivery]: [string, any]) => [kind, {
          state: String(delivery?.state || ''),
          attempts: Number(delivery?.attempts) || 0,
          recipientAccepted: delivery?.recipientAccepted === true,
          updatedAt: normalizeTimestamp(delivery?.updatedAt) || undefined,
          error: delivery?.error ? String(delivery.error) : undefined,
        }]))
      : undefined,
    receiptReuploadUsed: data.receiptReuploadUsed === true,
    staffRemarks: Array.isArray(data.staffRemarks)
      ? data.staffRemarks
          .map((remark: any) => ({
            text: String(remark?.text || '').trim(),
            byUid: remark?.byUid || undefined,
            byName: remark?.byName || undefined,
            at: normalizeTimestamp(remark?.at) || String(remark?.at || ''),
          }))
          .filter((remark: any) => remark.text)
      : [],
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
      pondName: booking?.pondName || '',
    };
  });

  return scores;
};

const pickActiveCompetitionRaw = (docs: QueryDocumentSnapshot<DocumentData>[]): any | null => {
  const comps = docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((data: any) => data.status !== 'DRAFT')
    .sort((a: any, b: any) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
  return comps.length ? comps[0] : null;
};

const buildCompetitionsList = (docs: QueryDocumentSnapshot<DocumentData>[]): Competition[] =>
  docs
    .map((docSnap) => normalizeCompetition({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

export const getActiveCompetition = async (
  preFetchedDocs?: QueryDocumentSnapshot<DocumentData>[]
): Promise<Competition | null> => {
  const docs = preFetchedDocs ?? (await getDocs(collection(db, 'competitions'))).docs;
  const raw = pickActiveCompetitionRaw(docs);
  return raw ? normalizeCompetition(raw) : null;
};

export const getCompetitions = async (
  preFetchedDocs?: QueryDocumentSnapshot<DocumentData>[]
): Promise<Competition[]> => {
  const docs = preFetchedDocs ?? (await getDocs(collection(db, 'competitions'))).docs;
  return buildCompetitionsList(docs);
};

export const createCompetition = async (data: Partial<Competition>) => {
  const competitionsRef = collection(db, 'competitions');
  const docRef = await addDoc(competitionsRef, {
    name: data.name || 'Pertandingan Baru',
    prizeHighlight: data.prizeHighlight?.trim() || '',
    eventDate: data.startDate || new Date().toISOString(),
    endDate: data.endDate || data.startDate || new Date().toISOString(),
    topN: data.topN || 20,
    prizes: data.prizes || [],
    pricePerPeg: typeof data.pricePerPeg === 'number' ? data.pricePerPeg : 100,
    maxPegsPerBooking: typeof data.maxPegsPerBooking === 'number' ? data.maxPegsPerBooking : 20,
    maxPendingBookingsPerUser: typeof data.maxPendingBookingsPerUser === 'number' ? data.maxPendingBookingsPerUser : 10,
    activePondIds: data.activePondIds || [],
    pondSeats: data.pondSeats || {},
    bookingOpenAt: data.bookingOpenAt || null,
    bookingCloseAt: data.bookingCloseAt || null,
    status: data.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
};

export const getOrCreateDefaultCompetition = async (
  preFetched?: { active: Competition | null }
): Promise<Competition> => {
  const comp = preFetched ? preFetched.active : await getActiveCompetition();
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

// Seats are derived from each pond's totalSeats/pricePerSeat/seatLayout instead
// of reading the `seats` collection (~480 docs per pond) on every page load —
// syncPondSeats keeps those docs at exactly that count and price. Pass seatDocs
// only where real seat doc ids are required.
type PondDocLike = { id: string; data: () => DocumentData };

// Public pond docs from the CDN-cached /publicPonds route, shaped like
// snapshots; falls back to a direct Firestore read if the route fails.
const getPublicPondDocs = async (): Promise<PondDocLike[]> => {
  try {
    const result = await bookingRequest('/publicPonds');
    if (!Array.isArray(result?.ponds)) throw new Error('Invalid ponds response.');
    return result.ponds.map((pond: { id: string; data: DocumentData }) => ({ id: pond.id, data: () => pond.data }));
  } catch (error) {
    console.warn('Falling back to direct pond read:', error);
    return (await getDocs(collection(db, 'ponds'))).docs;
  }
};

export const getPondsWithSeats = async (
  preFetched?: { pondDocs: PondDocLike[]; seatDocs?: QueryDocumentSnapshot<DocumentData>[] }
): Promise<Pond[]> => {
  const pondDocs = preFetched?.pondDocs ?? (await getDocs(collection(db, 'ponds'))).docs;
  const seatDocs = preFetched?.seatDocs ?? [];

  const seatsByPond = new Map<string, Array<any>>();
  seatDocs.forEach((seatSnap) => {
    const seatData = seatSnap.data();
    const pondId = seatData.pondId?.id || seatData.pondId;
    if (!pondId) return;
    const existing = seatsByPond.get(pondId.toString()) || [];
    existing.push({ id: seatSnap.id, ...seatData });
    seatsByPond.set(pondId.toString(), existing);
  });

  return pondDocs.map((pondSnap, index) => {
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
      seats: normalizeSeats(pondSnap.id, totalSeats, seatDocs, data.seatLayout, data.pricePerSeat),
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

export const getBookings = async (
  competitionId?: string,
  competitions: Competition[] = [],
  preFetched?: {
    ponds?: Pond[];
    seatDocs?: QueryDocumentSnapshot<DocumentData>[];
    bookingDocs?: QueryDocumentSnapshot<DocumentData>[];
  }
): Promise<Booking[]> => {
  const bookingDocs = preFetched?.bookingDocs ?? (await getVisibleBookingDocs()).docs;

  const ponds = preFetched?.ponds ?? await getPondsWithSeats();
  const pondMap = new Map<string, Pond>();
  ponds.forEach((pond) => {
    pondMap.set(pond.id.toString(), pond);
    if (pond._docId) pondMap.set(pond._docId, pond);
  });

  const seatDocs = preFetched?.seatDocs ?? await getLegacySeatDocs(bookingDocs);
  const seatMap = new Map<string, number>();
  seatDocs.forEach((seatSnap) => {
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

  return bookingDocs
    .filter((docSnap) => {
      if (!competitionId) return true;
      const data = docSnap.data();
      const bookingCompetitionId = (data.competitionId?.id || data.competitionId || '').toString();
      return bookingCompetitionId === competitionId;
    })
    .map((docSnap) => buildBooking(docSnap, seatMap, pondMap, competitionMap));
};

export interface BookingsPageOptions {
  /** Raw Firestore status values, e.g. ['PENDING_APPROVAL'] or ['APPROVED','CONFIRMED','REJECTED']. */
  statuses: string[];
  balanceStage?: 'review-balance' | 'pending-balance' | 'fully-paid';
  /** Only this competition (both stored encodings); omit for every competition. */
  competitionId?: string;
  sortField?: 'createdAt' | 'userName' | 'totalAmount';
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  /** Needed to resolve competitionId -> name/dates on each row, same as getBookings(). */
  competitions?: Competition[];
}

export interface BookingsPageResult {
  items: Booking[];
  firstDoc: QueryDocumentSnapshot<DocumentData> | null;
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/**
 * Scoped, cursor-paginated booking fetch for the Kelulusan / Semua Tempahan
 * CMS pages — unlike getBookings() (used for the app's global in-memory
 * bookings blob), this only ever pulls one page's worth of documents that
 * match the given status/filter combo, so these two admin pages stay fast
 * even once the bookings collection grows into the thousands.
 *
 * Deliberately does NOT take competitionId/paymentType as server-side
 * filters — every additional equality clause combined with orderBy needs
 * its own Firestore composite index, and that combinatorial explosion (3
 * sort fields x every filter combo) isn't worth it for what are secondary
 * refinement filters. Callers apply those two client-side over the loaded
 * page instead. balanceStage stays server-side since it's Semua Tempahan's
 * primary lens — see firestore.indexes.json for the small, fixed set of
 * composite indexes this function actually needs.
 */
// Same lookup-map setup getBookings() uses — ponds/seats are bounded by
// physical infrastructure, not booking volume, so fetching them in full
// here isn't a scalability concern.
const buildBookingsFromDocs = async (docs: any[], competitions: Competition[] = []): Promise<Booking[]> => {
  const ponds = await getPondsWithSeats();
  const pondMap = new Map<string, Pond>();
  ponds.forEach((pond) => {
    pondMap.set(pond.id.toString(), pond);
    if (pond._docId) pondMap.set(pond._docId, pond);
  });
  const seatSnapshot = await getLegacySeatDocs(docs);
  const seatMap = new Map<string, number>();
  seatSnapshot.forEach((seatSnap) => {
    const data = seatSnap.data();
    if (data.seatNumber) {
      seatMap.set(seatSnap.id, data.seatNumber);
      seatMap.set(seatSnap.ref.path, data.seatNumber);
    }
  });
  const competitionMap = new Map<string, Competition>();
  competitions.forEach((c) => { if (c.id) competitionMap.set(c.id, c); });
  return docs.map((d) => buildBooking(d, seatMap, pondMap, competitionMap));
};

/** One booking, built like the CMS lists. null when the doc no longer exists. */
export const getBookingById = async (bookingId: string, competitions: Competition[] = []): Promise<Booking | null> => {
  const snap = await getDoc(doc(db, 'bookings', bookingId));
  if (!snap.exists()) return null;
  return (await buildBookingsFromDocs([snap], competitions))[0] || null;
};

export const getBookingsPage = async (opts: BookingsPageOptions): Promise<BookingsPageResult> => {
  const pageSize = opts.pageSize ?? 50;
  const sortField = opts.sortField ?? 'createdAt';
  const sortDir = opts.sortDir ?? 'desc';

  const clauses: ReturnType<typeof where>[] = [where('status', 'in', opts.statuses)];
  if (opts.balanceStage) clauses.push(where('balanceStage', '==', opts.balanceStage));
  // Needs the (competitionId, status, sortField) indexes in firestore.indexes.json.
  if (opts.competitionId) clauses.push(where('competitionId', 'in', [opts.competitionId, doc(db, 'competitions', opts.competitionId)]));

  let q = query(collection(db, 'bookings'), ...clauses, orderBy(sortField, sortDir), limit(pageSize + 1));
  if (opts.cursor) q = query(q, startAfter(opts.cursor));

  const snap = await getDocs(q);
  const hasMore = snap.docs.length > pageSize;
  const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;

  const items = await buildBookingsFromDocs(pageDocs, opts.competitions);
  return {
    items,
    firstDoc: pageDocs[0] || null,
    lastDoc: pageDocs[pageDocs.length - 1] || null,
    hasMore,
  };
};

// `fresh` skips the CDN-cached pond list (used after CMS edits via reloadDB).
export const loadAppDB = async (onCoreLoaded?: (core: DB) => void, opts: { fresh?: boolean } = {}): Promise<DB> => {
  try {
    const availabilityPromise = withTimeout(
      bookingRequest('/bookingAvailability'),
      AVAILABILITY_TIMEOUT_MS,
      'Availability request timed out.',
    )
      .then((result) => {
        if (!Array.isArray(result.availability)) throw new Error('Invalid availability response.');
        return result;
      })
      .catch((error) => {
        console.error('Failed to load availability:', error);
        return { availability: [], availabilityError: true };
      });
    const competitionSnapshotPromise = getDocs(collection(db, 'competitions'));
    const [pondDocs, competitionSnapshot, visible, settings] = await Promise.all([
      opts.fresh ? getDocs(collection(db, 'ponds')).then((snap) => snap.docs) : getPublicPondDocs(),
      competitionSnapshotPromise,
      getVisibleBookingDocs(competitionSnapshotPromise.then((snap) => snap.docs)),
      getSettings(),
    ]);
    const bookingDocs = visible.docs;

    const ponds = await getPondsWithSeats({ pondDocs });
    const competitions = await getCompetitions(competitionSnapshot.docs);
    const activeComp = await getActiveCompetition(competitionSnapshot.docs);
    const competition = await getOrCreateDefaultCompetition({ active: activeComp });

    // Fetch all bookings (not just for one competition) — reuse the ponds/seats/bookings
    // already fetched above instead of re-querying them.
    const bookings = await getBookings(undefined, competitions, {
      ponds,
      bookingDocs,
    });
    const bookingAvailabilityFallback = bookings
      .filter((booking) => booking.status === 'pending' || booking.status === 'confirmed')
      .map((booking) => ({
        competitionId: booking.competitionId || '',
        status: booking.status,
        pondId: booking.pondSelections?.[0]?.pondId || booking.pondId,
        seats: booking.pondSelections?.[0]?.seats || booking.seats,
        pondSelections: booking.pondSelections?.length
          ? booking.pondSelections
          : [{
              pondId: booking.pondId,
              pondName: booking.pondName,
              pondCode: booking.pondCode,
              pondDate: booking.pondDate,
              seats: booking.seats,
              seatIds: booking.seatIds,
            }],
      }));

    const core: DB = {
      availability: bookingAvailabilityFallback,
      availabilityError: false,
      ponds,
      bookings,
      scores: {},
      comp: competition,
      competitions: competitions.length ? competitions : [competition],
      settings,
      users: [],
      bookingScope: visible.scope,
    };
    onCoreLoaded?.(core);

    const [availabilityResult, scores] = await Promise.all([
      availabilityPromise,
      competition && competition.id ? buildScores(competition.id, bookings) : Promise.resolve({}),
    ]);
    return {
      ...core,
      availability: availabilityResult.availabilityError ? bookingAvailabilityFallback : availabilityResult.availability,
      holds: Array.isArray((availabilityResult as any).holds) ? (availabilityResult as any).holds : [],
      availabilityError: availabilityResult.availabilityError || false,
      scores,
    };
  } catch (error) {
    console.error('Failed to load Firestore DB:', error);
    return emptyDB;
  }
};

const buildUserFromDoc = (d: QueryDocumentSnapshot<DocumentData>): User => {
  const data = d.data() as Record<string, unknown>;
  return {
    uid: d.id,
    email: (data.email as string) || '',
    name: (data.name as string) || '',
    phone: (data.phone as string) || '',
    role: (data.role as User['role']) || 'CLIENT',
  };
};

export interface UsersPageOptions {
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
  /** Only these roles (needs the users role+name index); omit for everyone. */
  roles?: string[];
}

const userRoleClauses = (roles?: string[]) => (roles?.length
  ? [roles.length === 1 ? where('role', '==', roles[0]) : where('role', 'in', roles)]
  : []);

/** Server-side count (one aggregation read) for the Pengguna tabs. */
export const countUsers = async (roles?: string[]): Promise<number> =>
  (await getCountFromServer(query(collection(db, 'users'), ...userRoleClauses(roles)))).data().count;

export interface UsersPageResult {
  items: User[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/**
 * Scoped, cursor-paginated fetch of registered accounts for the Pengguna CMS
 * page — every account write (email/password, Google, staff-created) always
 * sets `name` (possibly ''), so ordering by it never silently drops a doc.
 */
export const getUsersPage = async (opts: UsersPageOptions = {}): Promise<UsersPageResult> => {
  const pageSize = opts.pageSize ?? 50;
  const sortDir = opts.sortDir ?? 'asc';

  let q = query(collection(db, 'users'), ...userRoleClauses(opts.roles), orderBy('name', sortDir), limit(pageSize + 1));
  if (opts.cursor) q = query(q, startAfter(opts.cursor));

  const snap = await getDocs(q);
  const hasMore = snap.docs.length > pageSize;
  const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;

  return {
    items: pageDocs.map(buildUserFromDoc),
    lastDoc: pageDocs[pageDocs.length - 1] || null,
    hasMore,
  };
};

// Per-staff "seen" marker for the Kelulusan badge: pending bookings created
// after this time count as new for that staff member.
export const getApprovalsSeenAt = async (uid: string): Promise<number | null> => {
  const snap = await getDoc(doc(db, 'users', uid));
  const value = snap.exists() ? snap.data().approvalsSeenAt : null;
  const ms = value ? Date.parse(normalizeTimestamp(value) || '') : NaN;
  return Number.isFinite(ms) ? ms : null;
};

export const markApprovalsSeen = async (uid: string): Promise<void> => {
  await setDoc(doc(db, 'users', uid), { approvalsSeenAt: serverTimestamp() }, { merge: true });
};

export const createUserProfile = async (uid: string, data: { email: string; name: string; phone?: string; role?: string }) => {
  await setDoc(doc(db, 'users', uid), {
    ...data,
    role: data.role || 'CLIENT',
    createdAt: serverTimestamp(),
  });
};


interface DirectCheckInPayload {
  bookingId: string;
  bookingRef?: string;
  amount: number;
  method: string;
  seatNum?: number;
  pondId?: number;
  settleBalance?: boolean;
}

interface RawBookingSeatEntry {
  key: string;
  pondId: string;
  seatNum: number;
}

const rawPondId = (value: any): string => {
  if (value == null) return '';
  if (value?.id != null) return String(value.id);
  if (typeof value?.path === 'string') return value.path.split('/').pop() || '';
  return String(value);
};

const rawBookingSeatEntries = (booking: any): RawBookingSeatEntry[] => {
  const selections = Array.isArray(booking?.pondSelections) && booking.pondSelections.length
    ? booking.pondSelections
    : [{
        pondId: booking?.pondId,
        seats: Array.isArray(booking?.seatNumbers)
          ? booking.seatNumbers
          : (Array.isArray(booking?.seats) ? booking.seats : []),
      }];
  const seen = new Set<string>();
  const entries: RawBookingSeatEntry[] = [];
  selections.forEach((selection: any) => {
    const pondId = rawPondId(selection?.pondId);
    (Array.isArray(selection?.seats) ? selection.seats : []).forEach((rawSeat: any) => {
      const seatNum = Number(rawSeat);
      if (!Number.isFinite(seatNum)) return;
      const key = `${pondId || 'legacy'}:${seatNum}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ key, pondId, seatNum });
    });
  });
  return entries;
};

const rawPriorCheckInKeys = (booking: any, entries: RawBookingSeatEntry[]): Set<string> => {
  const keys = new Set<string>(
    (Array.isArray(booking?.checkedInSeatKeys) ? booking.checkedInSeatKeys : []).map(String),
  );
  const legacySeats = new Set<number>(
    (Array.isArray(booking?.checkedInSeats) ? booking.checkedInSeats : [])
      .map(Number)
      .filter(Number.isFinite),
  );
  entries.forEach((entry) => {
    if (legacySeats.has(entry.seatNum)) keys.add(entry.key);
  });
  return keys;
};

const rawMatchingBookingSeats = (
  entries: RawBookingSeatEntry[],
  seatNum?: number,
  pondId?: number,
): RawBookingSeatEntry[] => {
  if (seatNum == null) return entries;
  const matches = entries.filter((entry) => entry.seatNum === Number(seatNum));
  if (pondId == null) return matches;
  const exact = matches.filter((entry) => entry.pondId === String(pondId));
  return exact.length ? exact : (matches.length === 1 ? matches : []);
};

const rawCheckedSeatNumbers = (entries: RawBookingSeatEntry[], checkedKeys: Set<string>): number[] =>
  Array.from(new Set(entries.filter((entry) => checkedKeys.has(entry.key)).map((entry) => entry.seatNum)));

/**
 * Staff check-in through an authenticated Firestore transaction. Production
 * uses this direct path (the same architecture as booking/receipt writes), so
 * the HTTP `api` function can remain private at IAM level.
 */
export const checkInBookingDirect = async (payload: DirectCheckInPayload) => {
  if (!auth.currentUser) throw new Error('Sila log masuk dahulu. / Authentication required.');
  const bookingRef = doc(db, 'bookings', payload.bookingId);
  const paymentRef = doc(collection(bookingRef, 'payments'));
  const checkedAt = new Date().toISOString();

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(bookingRef);
    if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
    const booking = snap.data() as any;
    const status = String(booking.status || '').toUpperCase();
    if (!['APPROVED', 'CONFIRMED', 'LIVE'].includes(status)) {
      throw new Error('Tempahan mesti disahkan sebelum check-in. / Booking must be confirmed before check-in.');
    }
    const totalAmount = Number(booking.totalAmount ?? booking.amount) || 0;
    const paidAmount = Number(booking.paidAmount ?? booking.amount) || 0;
    const balanceDue = Math.max(0, totalAmount - paidAmount);
    const manualPaymentAmount = payload.settleBalance ? balanceDue : 0;
    if (payload.settleBalance && manualPaymentAmount <= 0) {
      throw new Error('Tiada baki bayaran untuk disahkan. / No outstanding balance to validate.');
    }

    const entries = rawBookingSeatEntries(booking);
    const targets = rawMatchingBookingSeats(entries, payload.seatNum, payload.pondId);
    if (!targets.length) throw new Error('Pancang tidak terdapat dalam tempahan ini. / Seat is not part of this booking.');
    const priorKeys = rawPriorCheckInKeys(booking, entries);
    const isFirstArrival = priorKeys.size === 0;
    const nextKeys = new Set(priorKeys);
    targets.forEach((entry) => nextKeys.add(entry.key));
    const nextTimes = booking.checkedInSeatTimes && typeof booking.checkedInSeatTimes === 'object'
      ? { ...booking.checkedInSeatTimes }
      : {};
    targets.forEach((entry) => {
      if (!nextTimes[entry.key]) nextTimes[entry.key] = checkedAt;
    });
    const result = {
      success: true,
      checkedInSeatKeys: Array.from(nextKeys),
      checkedInSeats: rawCheckedSeatNumbers(entries, nextKeys),
      checkedIn: entries.length > 0 && entries.every((entry) => nextKeys.has(entry.key)),
      checkedInAt: checkedAt,
      checkedInSeatTimes: nextTimes,
    };

    const bookingUpdate: Record<string, any> = {
      checkedInSeatKeys: result.checkedInSeatKeys,
      checkedInSeats: result.checkedInSeats,
      checkedIn: result.checkedIn,
      checkedInAt: Timestamp.fromDate(new Date(checkedAt)),
      checkedInSeatTimes: result.checkedInSeatTimes,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || null,
    };
    if (payload.settleBalance) {
      bookingUpdate.paidAmount = totalAmount;
      bookingUpdate.balanceDue = 0;
      bookingUpdate.paymentStatus = 'APPROVED';
      bookingUpdate.balanceStage = 'fully-paid';
      bookingUpdate.paymentType = 'full';
    }
    transaction.update(bookingRef, bookingUpdate);
    if (payload.settleBalance || isFirstArrival) {
      transaction.set(paymentRef, {
        amount: payload.settleBalance ? manualPaymentAmount : Number(payload.amount) || 0,
        method: payload.settleBalance ? 'cash' : payload.method || 'manual',
        ...(payload.settleBalance ? { type: 'manual-checkin-balance' } : {}),
        recordedBy: auth.currentUser?.uid || null,
        createdAt: serverTimestamp(),
      });
    }
    return {
      ...result,
      ...(payload.settleBalance ? {
        paidAmount: totalAmount,
        balanceDue: 0,
        paymentStatus: 'APPROVED',
        balanceStage: 'fully-paid',
        paymentType: 'full',
        manualPaymentAmount,
      } : {}),
    };
  });
};

export const cancelBookingCheckInDirect = async (payload: { bookingId: string; seatNum: number; pondId?: number }) => {
  if (!auth.currentUser) throw new Error('Sila log masuk dahulu. / Authentication required.');
  const bookingRef = doc(db, 'bookings', payload.bookingId);

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(bookingRef);
    if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
    const booking = snap.data() as any;
    const entries = rawBookingSeatEntries(booking);
    const targets = rawMatchingBookingSeats(entries, payload.seatNum, payload.pondId);
    if (!targets.length) throw new Error('Pancang tidak terdapat dalam tempahan ini. / Seat is not part of this booking.');

    const nextKeys = rawPriorCheckInKeys(booking, entries);
    const nextTimes = booking.checkedInSeatTimes && typeof booking.checkedInSeatTimes === 'object'
      ? { ...booking.checkedInSeatTimes }
      : {};
    targets.forEach((entry) => {
      nextKeys.delete(entry.key);
      delete nextTimes[entry.key];
    });
    const targetSeatNumbers = new Set(targets.map((entry) => entry.seatNum));
    targetSeatNumbers.forEach((targetSeat) => {
      if (!entries.some((entry) => entry.seatNum === targetSeat && nextKeys.has(entry.key))) {
        delete nextTimes[String(targetSeat)];
      }
    });
    const result = {
      success: true,
      checkedInSeatKeys: Array.from(nextKeys),
      checkedInSeats: rawCheckedSeatNumbers(entries, nextKeys),
      checkedIn: entries.length > 0 && entries.every((entry) => nextKeys.has(entry.key)),
      checkedInSeatTimes: nextTimes,
    };

    transaction.update(bookingRef, {
      checkedInSeatKeys: result.checkedInSeatKeys,
      checkedInSeats: result.checkedInSeats,
      checkedIn: result.checkedIn,
      checkedInSeatTimes: result.checkedInSeatTimes,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || null,
    });
    return result;
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

// `extra` carries fields written atomically with the status (e.g. force-cancel reason).
export const updateBookingStatus = async (
  bookingId: string,
  status: 'pending' | 'confirmed' | 'rejected',
  extra: Record<string, unknown> = {},
) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const bookingSnap = await getDoc(bookingRef);
  await setDoc(bookingRef, {
    ...extra,
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
  if (typeof updates.prizeHighlight !== 'undefined') payload.prizeHighlight = updates.prizeHighlight.trim();
  if (typeof updates.startDate !== 'undefined') payload.eventDate = updates.startDate;
  if (typeof updates.endDate !== 'undefined') payload.endDate = updates.endDate;
  if (typeof updates.topN !== 'undefined') payload.topN = updates.topN;
  if (typeof updates.pricePerPeg !== 'undefined') payload.pricePerPeg = updates.pricePerPeg;
  if (typeof updates.maxPegsPerBooking !== 'undefined') payload.maxPegsPerBooking = updates.maxPegsPerBooking;
  if (typeof updates.maxPendingBookingsPerUser !== 'undefined') payload.maxPendingBookingsPerUser = updates.maxPendingBookingsPerUser;
  if (typeof updates.prizes !== 'undefined') payload.prizes = updates.prizes;
  if (typeof updates.fastestPrize !== 'undefined') payload.fastestPrize = updates.fastestPrize?.trim() || null;
  if (typeof updates.mostPrize !== 'undefined') payload.mostPrize = updates.mostPrize?.trim() || null;
  if (typeof updates.activePondIds !== 'undefined') payload.activePondIds = updates.activePondIds;
  if (typeof updates.pondSeats !== 'undefined') payload.pondSeats = updates.pondSeats;
  if (typeof updates.bookingOpenAt !== 'undefined') payload.bookingOpenAt = updates.bookingOpenAt || null;
  if (typeof updates.bookingCloseAt !== 'undefined') payload.bookingCloseAt = updates.bookingCloseAt || null;
  if (typeof updates.status !== 'undefined') payload.status = updates.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
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

// Firestore rejects `undefined` field values (the SDK is not initialised with
// ignoreUndefinedProperties). Settings sub-objects like `seo` legitimately carry
// undefined for optional, unset fields (e.g. latitude/longitude), which would
// otherwise make setDoc throw and silently fail the save. Recursively drop them.
const stripUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
};

export const updateSettings = async (updates: Partial<Settings>) => {
  const settingsRef = doc(db, 'settings', 'global');
  await setDoc(settingsRef, {
    ...stripUndefined(updates),
    ...(Object.prototype.hasOwnProperty.call(updates, 'ocrDecimalPlaces') && updates.ocrDecimalPlaces === undefined
      ? { ocrDecimalPlaces: deleteField() } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

/** Shared live settings for CMS and public pages, normalized identically to initial loads. */
export const subscribeSettings = (onChange: (settings: Settings) => void) =>
  onSnapshot(doc(db, 'settings', 'global'),
    (snapshot) => onChange(normalizeSettings(snapshot.exists() ? snapshot.data() : {})),
    (error) => console.error('Failed to listen for settings:', error));

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
  const seatPromises: Promise<unknown>[] = [];
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
      deletedAt: normalizeTimestamp(data.deletedAt) || undefined,
      deletedBy: data.deletedBy || undefined,
    });
  });
  return entries.filter((entry) => !entry.deletedAt);
};

const buildScoreEntryFromDoc = (d: QueryDocumentSnapshot<DocumentData>): ScoreEntry => {
  const data = d.data() as any;
  const rawCompetitionId = data.competitionId;
  const competitionId = rawCompetitionId && typeof rawCompetitionId === 'object' ? rawCompetitionId.id : rawCompetitionId || '';
  const rawBookingId = data.bookingId;
  const bookingId = rawBookingId && typeof rawBookingId === 'object' ? rawBookingId.id : rawBookingId || undefined;
  return {
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
    ocrUserVerified: typeof data.ocrUserVerified === 'boolean' ? data.ocrUserVerified : undefined,
    scanMethod: data.scanMethod || undefined,
    capturedBy: data.capturedBy || undefined,
    capturedAt: normalizeTimestamp(data.updatedAt) || normalizeTimestamp(data.createdAt) || undefined,
    deletedAt: normalizeTimestamp(data.deletedAt) || undefined,
    deletedBy: data.deletedBy || undefined,
  } as ScoreEntry;
};

const buildPrizeClaimFromDoc = (d: QueryDocumentSnapshot<DocumentData>): PrizeClaim => {
  const data = d.data() as any;
  return {
    id: d.id,
    competitionId: data.competitionId || '',
    rank: Number(data.rank) || 0,
    scoreEntryId: data.scoreEntryId || undefined,
    bookingId: data.bookingId || undefined,
    status: data.status === 'claimed' ? 'claimed' : 'pending',
    claimedAt: normalizeTimestamp(data.claimedAt) || undefined,
    claimedBy: data.claimedBy || undefined,
    updatedAt: normalizeTimestamp(data.updatedAt) || undefined,
  };
};

export interface ScoreEntriesPageOptions {
  competitionId?: string;
  pondName?: string;
  sortDir?: 'asc' | 'desc';
  pageSize?: number;
  cursor?: QueryDocumentSnapshot<DocumentData> | null;
}

export interface ScoreEntriesPageResult {
  items: ScoreEntry[];
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/**
 * Cursor-paginated weigh-in history for the "Semua Timbangan Rekod" admin
 * page. saveScoreEntry always writes competitionId/pondName as plain strings,
 * so filtering on them directly is safe for all current and future data; a
 * handful of pre-migration docs that stored competitionId as a
 * DocumentReference (see getScoresForCompetition, which dual-queries both
 * forms for scoring accuracy) won't match a competition filter here — browsing
 * with no competition selected still finds them via plain orderBy.
 */
export const getScoreEntriesPage = async (opts: ScoreEntriesPageOptions = {}): Promise<ScoreEntriesPageResult> => {
  const pageSize = opts.pageSize ?? 50;
  const clauses: ReturnType<typeof where>[] = [];
  if (opts.competitionId) clauses.push(where('competitionId', '==', opts.competitionId));
  if (opts.pondName) clauses.push(where('pondName', '==', opts.pondName));

  let q = query(collection(db, 'eventResults'), ...clauses, orderBy('createdAt', opts.sortDir ?? 'desc'), limit(pageSize + 1));
  if (opts.cursor) q = query(q, startAfter(opts.cursor));

  const snap = await getDocs(q);
  const hasMore = snap.docs.length > pageSize;
  const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;

  return {
    items: pageDocs.map(buildScoreEntryFromDoc),
    lastDoc: pageDocs[pageDocs.length - 1] || null,
    hasMore,
  };
};

/**
 * `id` makes the save idempotent: the weigh-in modal reuses one id per reading,
 * so retrying after a timeout cannot create a second record.
 */
export const saveScoreEntry = async (entry: Omit<ScoreEntry, 'id'>, id?: string): Promise<string> => {
  const resultsRef = collection(db, 'eventResults');
  const evidenceFields: Record<string, unknown> = {};
  if (entry.photoUrl)                       evidenceFields.photoUrl = entry.photoUrl;
  if (typeof entry.ocrConfidence === 'number') evidenceFields.ocrConfidence = entry.ocrConfidence;
  if (entry.ocrRawText)                     evidenceFields.ocrRawText = entry.ocrRawText;
  if (typeof entry.ocrUserVerified === 'boolean') evidenceFields.ocrUserVerified = entry.ocrUserVerified;
  if (entry.scanMethod)                     evidenceFields.scanMethod = entry.scanMethod;
  if (entry.capturedBy)                     evidenceFields.capturedBy = entry.capturedBy;

  const docRef = id ? doc(resultsRef, id) : doc(resultsRef);
  await setDoc(docRef, {
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

/** Weight of an existing record, or null when it has not been saved yet. */
export const getScoreEntryWeight = async (id: string): Promise<number | null> => {
  const snap = await getDoc(doc(db, 'eventResults', id));
  return snap.exists() ? Number(snap.data().weight) : null;
};

/** Admin-only correction (enforced by rules); history goes to the audit log. */
export const updateScoreWeight = async (id: string, weight: number, previousWeight: number, reason: string): Promise<void> => {
  await updateDoc(doc(db, 'eventResults', id), {
    weight,
    previousWeight,
    editReason: reason.trim().slice(0, 500),
    editedBy: auth.currentUser?.uid || null,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const deleteScoreEntry = async (id: string): Promise<void> => {
  await updateDoc(doc(db, 'eventResults', id), {
    deletedAt: serverTimestamp(),
    deletedBy: auth.currentUser?.uid || null,
    updatedAt: serverTimestamp(),
  });
};

export const getPrizeClaimsForCompetition = async (competitionId: string): Promise<PrizeClaim[]> => {
  if (!competitionId) return [];
  const snap = await getDocs(query(collection(db, 'prizeClaims'), where('competitionId', '==', competitionId)));
  return snap.docs.map(buildPrizeClaimFromDoc);
};

export const savePrizeClaimStatus = async (claim: {
  competitionId: string;
  rank: number;
  scoreEntryId?: string;
  bookingId?: string;
  status: 'claimed' | 'pending';
}): Promise<void> => {
  const claimId = `${claim.competitionId}_${claim.rank}`;
  const payload: Record<string, unknown> = {
    competitionId: claim.competitionId,
    rank: claim.rank,
    scoreEntryId: claim.scoreEntryId || null,
    bookingId: claim.bookingId || null,
    status: claim.status,
    updatedAt: serverTimestamp(),
  };
  if (claim.status === 'claimed') {
    payload.claimedAt = serverTimestamp();
    payload.claimedBy = auth.currentUser?.uid || null;
  } else {
    payload.claimedAt = null;
    payload.claimedBy = null;
  }
  await setDoc(doc(db, 'prizeClaims', claimId), payload, { merge: true });
};

// Append-only admin activity log. Logging failures are swallowed — recording
// an action must never block the action itself from succeeding.
export const logAuditEvent = async (entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> => {
  try {
    // bookingId lets the per-booking activity log find this entry (see /bookingActivity).
    const bookingId = entry.bookingId || (entry.entityType === 'booking' ? entry.entityId : undefined);
    // Firestore rejects undefined field values.
    const clean = Object.fromEntries(Object.entries({ ...entry, bookingId }).filter(([, value]) => value !== undefined));
    await addDoc(collection(db, 'auditLog'), { ...clean, createdAt: serverTimestamp() });
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
};

export const getAuditLog = async (limitCount = 200): Promise<AuditEntry[]> => {
  const snap = await getDocs(query(collection(db, 'auditLog'), orderBy('createdAt', 'desc'), limit(limitCount)));
  return snap.docs.map((d) => {
    const data = d.data() as any;
    return { id: d.id, ...data, createdAt: normalizeTimestamp(data.createdAt) || '' } as AuditEntry;
  });
};

const sumAcceptedReceipts = (receipts: any[]) =>
  (Array.isArray(receipts) ? receipts : [])
    .filter((r) => r?.status === 'accepted')
    .reduce((sum, r) => sum + (Number(r?.amount) || 0), 0);

/**
 * Fine-grained payment stage for a CONFIRMED booking, used so Semua Tempahan
 * can filter/paginate on `balanceStage` server-side instead of scanning every
 * booking's receipts. Computed from primitives so it's usable both at
 * write-time (accept/reject a receipt) and as a display fallback for older
 * bookings that don't have the field stored yet.
 */
export const computeBalanceStage = (
  paidAmount: number,
  totalAmount: number,
  hasPendingReceipts: boolean,
): 'review-balance' | 'pending-balance' | 'fully-paid' => {
  const balanceDue = Math.max(0, (Number(totalAmount) || 0) - (Number(paidAmount) || 0));
  if (balanceDue <= 0) return 'fully-paid';
  return hasPendingReceipts ? 'review-balance' : 'pending-balance';
};

/** Display-side fallback for bookings written before `balanceStage` existed. */
export const deriveBalanceStage = (booking: Booking): 'review-balance' | 'pending-balance' | 'fully-paid' => {
  if (booking.balanceStage) return booking.balanceStage;
  const hasPendingReceipts = (booking.receipts || []).some((r) => r.status === 'pending');
  return computeBalanceStage(booking.paidAmount ?? booking.amount, booking.totalAmount, hasPendingReceipts);
};

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
      // Per-receipt bank reference and rejection audit must survive every rewrite of the array.
      ...(r?.bankReference ? { bankReference: String(r.bankReference) } : {}),
      ...(r?.rejectReason ? { rejectReason: String(r.rejectReason) } : {}),
      ...(r?.rejectedBy ? { rejectedBy: r.rejectedBy } : {}),
      ...(r?.rejectedAt ? { rejectedAt: r.rejectedAt } : {}),
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
      ...(booking.bankReference ? { bankReference: String(booking.bankReference) } : {}),
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

export const acceptBookingReceiptDirect = async (bookingId: string, receiptIndex: number) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;
  assertStillHoldsPegs(booking);
  const receipts = deriveReceiptsFromBooking(booking);
  if (receiptIndex < 0 || receiptIndex >= receipts.length) throw new Error('Indeks resit tidak sah. / Invalid receipt index.');

  const wasAccepted = receipts[receiptIndex]?.status === 'accepted';
  receipts[receiptIndex] = { ...receipts[receiptIndex], status: 'accepted' };
  const paidAmount = sumAcceptedReceipts(receipts);
  const totalAmount = Number(booking.totalAmount) || 0;
  const fullyPaid = totalAmount > 0 && paidAmount >= totalAmount;
  const statusUpper = (booking.status || '').toUpperCase();
  const alreadyConfirmed = ['APPROVED', 'CONFIRMED', 'LIVE'].includes(statusUpper);
  // Confirm the booking (status + hold seats) on its FIRST ever accepted
  // receipt — a deposit booking confirms as soon as the deposit is approved,
  // not only once the balance is also in. `justConfirmed` tells the caller
  // this is the moment to fire the approval email / secure the seat.
  const justConfirmed = !alreadyConfirmed;
  const hasPendingReceipts = receipts.some((r) => r.status === 'pending');
  const balanceStage = computeBalanceStage(paidAmount, totalAmount, hasPendingReceipts);

  const update: Record<string, any> = {
    receipts,
    paidAmount,
    paymentStatus: fullyPaid ? 'APPROVED' : 'PARTIAL',
    balanceStage,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
  };
  if (justConfirmed) update.status = 'APPROVED';

  await setDoc(bookingRef, update, { merge: true });

  if (!wasAccepted) {
    await addDoc(collection(db, 'bookings', bookingId, 'payments'), {
      amount: Number(receipts[receiptIndex].amount) || 0,
      method: 'receipt',
      recordedBy: auth.currentUser?.uid || null,
      createdAt: serverTimestamp(),
    });
  }
  if (justConfirmed) await setSeatStatusForBooking(booking, 'booked');

  return { success: true, paidAmount, fullyPaid, justConfirmed, balanceStage, status: update.status || booking.status };
};

// Rules refuse to revive a cancelled/rejected booking (its pegs may be resold).
const assertStillHoldsPegs = (booking: any) => {
  if (!['PENDING', 'PENDING_APPROVAL', 'APPROVED', 'CONFIRMED', 'LIVE'].includes(String(booking?.status || '').toUpperCase())) {
    throw new Error('Tempahan ini telah dibatalkan atau ditolak dan No Pancangnya mungkin telah ditempah semula. Sila buat tempahan baharu. / This booking was cancelled or rejected; its pegs may be rebooked. Please make a new booking.');
  }
};

// Staff-assisted deposit approval path: attach uploaded proof, mark the
// deposit as accepted, confirm the booking, and convert paymentType to `baki`
// while a balance remains.
export const approveDepositWithProofDirect = async (bookingId: string, proofUrl: string, depositAmount?: number) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;
  assertStillHoldsPegs(booking);

  // A staff-uploaded proof replaces the decision on any currently pending
  // customer receipt. Preserve it in history, but make it non-actionable.
  const receipts = deriveReceiptsFromBooking(booking).map((receipt) =>
    receipt.status === 'pending' ? { ...receipt, status: 'rejected' as const } : receipt);
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
  const hasPendingReceipts = nextReceipts.some((r) => r.status === 'pending');
  const balanceStage = computeBalanceStage(paidAmount, totalAmount, hasPendingReceipts);

  await setDoc(bookingRef, {
    receipts: nextReceipts,
    receiptUrl: proofUrl,
    paidAmount,
    paymentType: nextPaymentType,
    paymentStatus: balanceDue > 0 ? 'PARTIAL' : 'APPROVED',
    status: 'APPROVED',
    balanceStage,
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

// Append-only staff note log on a booking (Kelulusan/Semua Tempahan). Never
// overwrites prior notes — each call adds one dated entry.
export const addStaffRemark = async (bookingId: string, text: string, byName?: string) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;
  const staffRemarks = Array.isArray(booking.staffRemarks) ? booking.staffRemarks : [];
  const entry = {
    text: text.trim(),
    byUid: auth.currentUser?.uid || null,
    byName: byName || auth.currentUser?.email || null,
    at: new Date().toISOString(),
  };
  await setDoc(bookingRef, {
    staffRemarks: [...staffRemarks, entry],
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
  }, { merge: true });
  return entry;
};

export const rejectBookingReceiptDirect = async (bookingId: string, receiptIndex: number, reason = '') => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;
  const receipts = deriveReceiptsFromBooking(booking);
  if (receiptIndex < 0 || receiptIndex >= receipts.length) throw new Error('Indeks resit tidak sah. / Invalid receipt index.');

  const trimmedReason = reason.trim().slice(0, 500);
  receipts[receiptIndex] = {
    ...receipts[receiptIndex], status: 'rejected',
    ...(trimmedReason ? { rejectReason: trimmedReason } : {}),
    rejectedBy: auth.currentUser?.uid || null, rejectedAt: new Date().toISOString(),
  };
  const paidAmount = sumAcceptedReceipts(receipts);
  const totalAmount = Number(booking.totalAmount) || 0;
  const statusUpper = (booking.status || '').toUpperCase();
  const alreadyConfirmed = ['APPROVED', 'CONFIRMED', 'LIVE'].includes(statusUpper);

  const update: Record<string, any> = {
    receipts,
    paidAmount,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
  };
  if (alreadyConfirmed) {
    // Rejecting the balance receipt on an already-confirmed (deposit-approved)
    // booking doesn't undo the confirmation — it just sends the balance back
    // to "awaiting a fresh upload" so the owner can re-submit.
    const hasPendingReceipts = receipts.some((r) => r.status === 'pending');
    update.balanceStage = computeBalanceStage(paidAmount, totalAmount, hasPendingReceipts);
  } else {
    // No decision has been made on this booking yet — rejecting its (only)
    // receipt at this stage IS the decision: reject the whole booking.
    update.status = 'REJECTED';
  }

  await setDoc(bookingRef, update, { merge: true });
  if (!alreadyConfirmed) await setSeatStatusForBooking(booking, 'available');

  return { success: true, paidAmount, bookingRejected: !alreadyConfirmed };
};
