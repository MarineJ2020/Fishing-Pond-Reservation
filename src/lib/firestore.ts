import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  getDoc,
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
  runTransaction,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { auth } from '../../lib/firebase';
import { db } from '../../lib/firebase';
import { DB, Pond, Seat, Booking, Score, Competition, Settings, ScoreEntry, User, AuditEntry, SeoSettings } from '../types';
import { emptyDB } from '../data';
import { LANDING_DEFAULTS, SEO_DEFAULTS } from '../config/landingDefaults';
import { normalizeLandingSections } from '../config/landingSections';

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
    eventDate: data.startDate || new Date().toISOString(),
    endDate: data.endDate || data.startDate || new Date().toISOString(),
    topN: data.topN || 20,
    prizes: data.prizes || [],
    pricePerPeg: typeof data.pricePerPeg === 'number' ? data.pricePerPeg : 100,
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

export const getPondsWithSeats = async (
  preFetched?: { pondDocs: QueryDocumentSnapshot<DocumentData>[]; seatDocs: QueryDocumentSnapshot<DocumentData>[] }
): Promise<Pond[]> => {
  const { pondDocs, seatDocs } = preFetched ?? await (async () => {
    const [pondSnapshot, seatSnapshot] = await Promise.all([
      getDocs(collection(db, 'ponds')),
      getDocs(collection(db, 'seats')),
    ]);
    return { pondDocs: pondSnapshot.docs, seatDocs: seatSnapshot.docs };
  })();

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

export const getBookings = async (
  competitionId?: string,
  competitions: Competition[] = [],
  preFetched?: {
    ponds?: Pond[];
    seatDocs?: QueryDocumentSnapshot<DocumentData>[];
    bookingDocs?: QueryDocumentSnapshot<DocumentData>[];
  }
): Promise<Booking[]> => {
  const bookingDocs = preFetched?.bookingDocs ?? (await getDocs(collection(db, 'bookings'))).docs;

  const ponds = preFetched?.ponds ?? await getPondsWithSeats();
  const pondMap = new Map<string, Pond>();
  ponds.forEach((pond) => {
    pondMap.set(pond.id.toString(), pond);
    if (pond._docId) pondMap.set(pond._docId, pond);
  });

  const seatDocs = preFetched?.seatDocs ?? (await getDocs(collection(db, 'seats'))).docs;
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
export const getBookingsPage = async (opts: BookingsPageOptions): Promise<BookingsPageResult> => {
  const pageSize = opts.pageSize ?? 50;
  const sortField = opts.sortField ?? 'createdAt';
  const sortDir = opts.sortDir ?? 'desc';

  const clauses: ReturnType<typeof where>[] = [where('status', 'in', opts.statuses)];
  if (opts.balanceStage) clauses.push(where('balanceStage', '==', opts.balanceStage));

  let q = query(collection(db, 'bookings'), ...clauses, orderBy(sortField, sortDir), limit(pageSize + 1));
  if (opts.cursor) q = query(q, startAfter(opts.cursor));

  const snap = await getDocs(q);
  const hasMore = snap.docs.length > pageSize;
  const pageDocs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;

  // Same lookup-map setup getBookings() uses — ponds/seats are bounded by
  // physical infrastructure, not booking volume, so fetching them in full
  // here isn't a scalability concern.
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
  (opts.competitions || []).forEach((c) => { if (c.id) competitionMap.set(c.id, c); });

  const items = pageDocs.map((d) => buildBooking(d, seatMap, pondMap, competitionMap));
  return {
    items,
    firstDoc: pageDocs[0] || null,
    lastDoc: pageDocs[pageDocs.length - 1] || null,
    hasMore,
  };
};

export const loadAppDB = async (): Promise<DB> => {
  try {
    const [pondSnapshot, seatSnapshot, competitionSnapshot, bookingSnapshot, settings] = await Promise.all([
      getDocs(collection(db, 'ponds')),
      getDocs(collection(db, 'seats')),
      getDocs(collection(db, 'competitions')),
      getDocs(collection(db, 'bookings')),
      getSettings(),
    ]);

    const ponds = await getPondsWithSeats({ pondDocs: pondSnapshot.docs, seatDocs: seatSnapshot.docs });
    const competitions = await getCompetitions(competitionSnapshot.docs);
    const activeComp = await getActiveCompetition(competitionSnapshot.docs);
    const competition = await getOrCreateDefaultCompetition({ active: activeComp });

    // Fetch all bookings (not just for one competition) — reuse the ponds/seats/bookings
    // already fetched above instead of re-querying them.
    const bookings = await getBookings(undefined, competitions, {
      ponds,
      seatDocs: seatSnapshot.docs,
      bookingDocs: bookingSnapshot.docs,
    });

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
}

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

  let q = query(collection(db, 'users'), orderBy('name', sortDir), limit(pageSize + 1));
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
      where('competitionId', '==', data.competitionId)
    )
  );
  // Seats are implicitly locked between submission and staff decision: any existing
  // booking in PENDING_APPROVAL / APPROVED / CONFIRMED holds its seats here.
  const requestedSelections = Array.isArray(data.pondSelections) && data.pondSelections.length
    ? data.pondSelections
    : [{ pondId: data.pondId, seats: data.seatNumbers ?? [] }];
  const requestedSeats = new Set<string>();
  requestedSelections.forEach((selection: any) => {
    (selection.seats ?? []).forEach((seatNum: number) => requestedSeats.add(`${selection.pondId}-${seatNum}`));
  });
  snap.forEach((d) => {
    const existingData = d.data();
    const s = (existingData.status || '').toUpperCase();
    if (!['PENDING_APPROVAL', 'APPROVED', 'CONFIRMED'].includes(s)) return;
    const existingSelections = Array.isArray(existingData.pondSelections) && existingData.pondSelections.length
      ? existingData.pondSelections
      : [{ pondId: existingData.pondId, seats: existingData.seatNumbers ?? [] }];
    for (const selection of existingSelections) {
      const clash = (selection.seats ?? []).find((seatNum: number) => requestedSeats.has(`${selection.pondId}-${seatNum}`));
      if (clash) throw new Error(`Pancang #${clash} telah ditempah. Sila pilih pancang lain. / Seat #${clash} is already booked. Please choose another seat.`);
    }
  });

  // Bookings made by staff/admin on behalf of a customer are trusted and
  // confirmed immediately — no separate approval step. Self-service bookings
  // still go through PENDING_APPROVAL for staff to verify the receipt.
  const isStaffBooking = data.createdByStaff === true;
  const totalAmount = Number(data.totalAmount ?? data.amount) || 0;
  const paymentAmount = Number(data.amount) || 0;
  const paidAmount = isStaffBooking ? paymentAmount : 0;
  const balanceDue = Math.max(0, totalAmount - paidAmount);
  const initialReceipts = data.receiptUrl
    ? [{
        url: data.receiptUrl,
        amount: paymentAmount,
        status: isStaffBooking ? 'accepted' : 'pending',
        submittedAt: new Date().toISOString(),
      }]
    : [];

  const bookingsRef = collection(db, 'bookings');
  return await addDoc(bookingsRef, {
    ...data,
    receipts: initialReceipts,
    paidAmount,
    balanceDue,
    ...(isStaffBooking ? { balanceStage: balanceDue > 0 ? 'pending-balance' : 'fully-paid' } : {}),
    status: isStaffBooking ? 'CONFIRMED' : 'PENDING_APPROVAL',
    paymentStatus: isStaffBooking ? (balanceDue > 0 ? 'PARTIAL' : 'APPROVED') : 'PENDING',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

interface DirectCheckInPayload {
  bookingId: string;
  bookingRef?: string;
  amount: number;
  method: string;
  seatNum?: number;
  pondId?: number;
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

    transaction.update(bookingRef, {
      checkedInSeatKeys: result.checkedInSeatKeys,
      checkedInSeats: result.checkedInSeats,
      checkedIn: result.checkedIn,
      checkedInAt: Timestamp.fromDate(new Date(checkedAt)),
      checkedInSeatTimes: result.checkedInSeatTimes,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid || null,
    });
    if (isFirstArrival) {
      transaction.set(paymentRef, {
        amount: Number(payload.amount) || 0,
        method: payload.method || 'manual',
        recordedBy: auth.currentUser?.uid || null,
        createdAt: serverTimestamp(),
      });
    }
    return result;
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
  } as ScoreEntry;
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
      where('seatNum', '==', entry.seatNum),
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

// Append-only admin activity log. Logging failures are swallowed — recording
// an action must never block the action itself from succeeding.
export const logAuditEvent = async (entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> => {
  try {
    await addDoc(collection(db, 'auditLog'), { ...entry, createdAt: serverTimestamp() });
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
      // Per-receipt bank reference must survive every rewrite of the array.
      ...(r?.bankReference ? { bankReference: String(r.bankReference) } : {}),
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

const MAX_RECEIPTS = 3;

export const submitBookingReceiptDirect = async (bookingId: string, receiptUrl: string, amount: number, bankReference?: string) => {
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
    {
      url: receiptUrl,
      amount: Number(amount) || 0,
      status: 'pending' as const,
      submittedAt: new Date().toISOString(),
      ...(bankReference?.trim() ? { bankReference: bankReference.trim() } : {}),
    },
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

// Staff-assisted deposit approval path: attach uploaded proof, mark the
// deposit as accepted, confirm the booking, and convert paymentType to `baki`
// while a balance remains.
export const approveDepositWithProofDirect = async (bookingId: string, proofUrl: string, depositAmount?: number) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;

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

export const rejectBookingReceiptDirect = async (bookingId: string, receiptIndex: number) => {
  const bookingRef = doc(db, 'bookings', bookingId);
  const snap = await getDoc(bookingRef);
  if (!snap.exists()) throw new Error('Tempahan tidak dijumpai. / Booking not found.');
  const booking = snap.data() as any;
  const receipts = deriveReceiptsFromBooking(booking);
  if (receiptIndex < 0 || receiptIndex >= receipts.length) throw new Error('Indeks resit tidak sah. / Invalid receipt index.');

  receipts[receiptIndex] = { ...receipts[receiptIndex], status: 'rejected' };
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
