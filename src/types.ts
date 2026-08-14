export interface PondVertex {
  x: number; // 0–100 percentage of SVG viewBox width
  y: number; // 0–100 percentage of SVG viewBox height
}

export interface Seat {
  id?: string;
  num: number;
  zone: string;
  price: number;
  status: 'available' | 'booked' | 'pending';
  px?: number;     // visual position x (0–100 % of SVG viewBox)
  py?: number;     // visual position y (0–100 % of SVG viewBox)
  active?: boolean; // false = seat is inactive / disabled
}

export interface Pond {
  id: number;
  _docId?: string;
  name: string;
  /** Unique single-letter alphabet code (A–Z) used to prefix seat labels, e.g. "A-23". */
  code?: string;
  date: string;
  desc: string;
  seats: Seat[];
  open: boolean;
  maxSeats?: number; // target seat count — drives legacy capsule count and polygon editor enforcement
  shape?: PondVertex[]; // polygon vertices for the custom visual editor
  order?: number; // display order (CMS-adjustable arrangement); lower shows first
}

export interface BookingReceipt {
  url: string;
  amount: number;
  status: 'pending' | 'accepted' | 'rejected';
  submittedAt: string;
  /**
   * Bank transfer/reference number entered with THIS receipt. The first receipt
   * predates the field and keeps its value in the booking-level
   * `bankReference`; read them with `receiptBankReference()`.
   */
  bankReference?: string;
}

export interface BookingPondSelection {
  pondId: number;
  pondName: string;
  pondCode?: string;
  pondDate?: string;
  seats: number[];
  seatIds?: string[];
}

export interface Booking {
  id: string;
  bookingRef?: string;
  competitionId?: string;
  competitionName?: string;
  userId: string;
  userEmail?: string;
  userName: string;
  userPhone: string;
  /**
   * Phone number the customer keys in fresh for THIS booking (self-service) or
   * that staff enter for the customer (admin proxy). Kept separate from the
   * profile `userPhone` so staff can cross-check the two if one can't be reached.
   */
  bookingPhone?: string;
  pondId: number;
  pondName: string;
  /** Pond alphabet code captured at booking time, used to prefix seat labels (e.g. "A-23"). */
  pondCode?: string;
  pondDate: string;
  seats: number[];
  seatIds?: string[];
  /** All pancang grouped by pond. Present when one booking spans multiple ponds. */
  pondSelections?: BookingPondSelection[];
  paymentType: 'full' | 'deposit' | 'baki';
  amount: number;
  totalAmount: number;
  receiptData: string;
  receiptName: string;
  /** Customer-entered bank transfer/reference number. */
  bankReference?: string;
  receipts?: BookingReceipt[];
  paidAmount?: number;
  balanceDue?: number;
  notes: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
  updatedAt?: string;
  createdByStaff?: boolean;
  /** UID of the staff/admin account that created a proxy customer booking. */
  createdByUid?: string;
  checkedIn?: boolean;
  /** Seat numbers that have individually checked in (subset of `seats`). */
  checkedInSeats?: number[];
  /**
   * Unambiguous per-pond seat keys (`pondId:seatNumber`). Unlike
   * `checkedInSeats`, this remains correct when one booking contains the same
   * numeric seat in two different ponds.
   */
  checkedInSeatKeys?: string[];
  /** Most recent check-in time for the booking. */
  checkedInAt?: string;
  /** Per-seat check-in times, keyed by `pondId:seatNumber` (legacy numeric keys are also read). */
  checkedInSeatTimes?: Record<string, string>;
  /** Last time a balance-due reminder email was sent to the user (ISO). */
  balanceReminderSentAt?: string;
  /** Server-observed SMTP state for each transactional booking email. */
  emailDelivery?: Record<string, {
    state: string;
    attempts: number;
    recipientAccepted?: boolean;
    updatedAt?: string;
    error?: string;
  }>;
  /** True once the owner has used their one-time receipt re-upload (correction). */
  receiptReuploadUsed?: boolean;
  /**
   * Fine-grained payment stage, only meaningful when status === 'confirmed'.
   * Maintained at write-time (receipt accept/reject) so the CMS can filter on
   * it server-side. Absent on older bookings — derive on the fly from
   * balanceDue/receipts when missing (see computeBalanceStage).
   */
  balanceStage?: 'review-balance' | 'pending-balance' | 'fully-paid';
  /** Append-only staff note log shown on Kelulusan/Semua Tempahan. */
  staffRemarks?: { text: string; byUid?: string; byName?: string; at: string }[];
}

export interface Score {
  weight: number;
  anglerName: string;
  pondId: number;
  pondName: string;
}

export interface ScoreEntry {
  id?: string;
  competitionId: string;
  bookingId?: string;
  anglerName: string;
  pondId: number;
  pondName: string;
  seatNum: number;
  weight: number;
  // Scale-scan evidence (optional for backwards compatibility with manually-entered legacy records)
  photoUrl?: string;
  ocrConfidence?: number;
  ocrRawText?: string;
  /** True when the saved weight matched the OCR output (no staff edit). */
  ocrUserVerified?: boolean;
  /** How the weight was obtained: ONNX model, no-ML fallback scan, or manual entry. */
  scanMethod?: 'onnx' | 'sevenseg' | 'manual';
  capturedBy?: string;
  /** ISO time the weight was recorded (staff "imbas timbangan"). Derived from the doc's updatedAt/createdAt. */
  capturedAt?: string;
}

export interface AuditEntry {
  id?: string;
  /** Machine key, e.g. 'booking.reject', 'competition.delete'. */
  action: string;
  /** Malay display label, e.g. "Tolak Tempahan". */
  actionLabel: string;
  entityType: 'booking' | 'competition' | 'pond' | 'prize' | 'settings' | 'score';
  entityId?: string;
  /** Human-readable target, e.g. booking ref / competition name / pond code. */
  entityLabel?: string;
  actorUid?: string;
  actorEmail?: string;
  actorName?: string;
  /** Optional short free-text summary. */
  details?: string;
  /** ISO, normalized on read from serverTimestamp. */
  createdAt: string;
}

export interface Prize {
  /** Legacy single rank — kept for back-compat; equals rankFrom for new data. */
  rank: number;
  /** Range start (inclusive). Falls back to `rank` when absent. */
  rankFrom?: number;
  /** Range end (inclusive). Falls back to `rank` when absent. */
  rankTo?: number;
  label: string;
  prize: string;
}

export interface Competition {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  topN: number;
  _spf?: number;
  prizes: Prize[];
  activePondIds?: string[];
  pondSeats?: Record<string, number>;
  pricePerPeg?: number;
  /** Booking window opens (ISO). When unset, booking is open until the event ends. */
  bookingOpenAt?: string;
  /** Booking window closes (ISO, inclusive). When unset, booking stays open until the event ends. */
  bookingCloseAt?: string;
  /** Public visibility. INACTIVE competitions are hidden from the public site. Defaults to ACTIVE. */
  status?: 'ACTIVE' | 'INACTIVE';
}

export type SeoPageKey = 'home' | 'book' | 'live';

export interface SeoPageMeta {
  title: string;
  description: string;
  /** Absolute URL to a JPEG (not WebP) share image, 1200×630. Falls back to seo.defaultOgImage. */
  ogImage?: string;
}

export interface SeoSettings {
  /** Canonical production origin, no trailing slash, e.g. https://kolamkelisayang.com.my */
  siteUrl: string;
  siteName: string;
  /** Absolute JPEG URL, 1200×630, used when a page has no ogImage of its own. */
  defaultOgImage: string;
  latitude?: number;
  longitude?: number;
  pages: Record<SeoPageKey, SeoPageMeta>;
}

export interface Settings {
  qrBank: string;
  qrName: string;
  qrAccNo: string;
  qrImg: string;
  heroLogo: string;
  phone?: string;
  whatsapp: string;
  email?: string;
  location: string;
  openingHours: {
    days: string[];
    timeStart: string;
    timeEnd: string;
  };
  grandOpening: {
    date: string;
    time: string;
  };
  // Homepage customization
  heroTitle?: string;
  heroSubtitle?: string;
  heroKicker?: string;
  heroStats?: { label: string; value: string }[];
  heroCtaLabel?: string;
  introCopy?: string;
  aboutEyebrow?: string;
  aboutTitle?: string;
  aboutContent?: string;
  aboutCtaLabel?: string;
  /** Fixed set of 4 "why us" feature cards shown under the intro section */
  features?: { icon: string; title: string; body: string }[];
  competitionsEyebrow?: string;
  competitionsTitle?: string;
  weeklyCardTitle?: string;
  weeklyCardBody?: string;
  weeklyCardTag1?: string;
  weeklyCardTag2?: string;
  stepsEyebrow?: string;
  stepsTitle?: string;
  stepsSubtitle?: string;
  stepsCtaLabel?: string;
  /** Fixed set of 4 "how to book" step cards */
  steps?: { icon: string; title: string; body: string }[];
  rulesEyebrow?: string;
  rulesTitle?: string;
  rulesCtaLabel?: string;
  lokasiEyebrow?: string;
  lokasiTitle?: string;
  contactName?: string;
  contactTitle?: string;
  contactSubtitle?: string;
  ctaTitle?: string;
  ctaSubtitle?: string;
  footerTagline?: string;
  /** CMS-uploaded landing images (Firebase Storage URLs). Empty = fall back to the built-in asset. */
  landingImages?: {
    logo?: string;
    footerLogo?: string;
    heroBg?: string;
    pondBg?: string;
    bookingBg?: string;
  };
  /** Numbered rules shown in the homepage "Format Bertanding" section */
  rules?: { title: string; body: string }[];
  /** Uploaded PDF URL for Syarat & Peraturan. */
  rulesPdfUrl?: string;
  /** Google Maps embed URL used in the Lokasi section. If absent, derived from `location`. */
  mapEmbedUrl?: string;
  /** External map/directions deep links shown as quick-link buttons */
  wazeUrl?: string;
  googleMapsUrl?: string;
  /** Site-wide + per-page SEO metadata, rendered server-side by the seoRender function. */
  seo?: SeoSettings;
  /** When true, the booking page and CMS show the legacy capsule pond view instead of the SVG polygon */
  useLegacyPondView?: boolean;
  /** URL of the pond arrangement overview image shown to users during booking */
  pondMapImg?: string;
  /**
   * When true (default), the OCR pipeline runs the existing imageProcessing
   * preprocessing on each crop before invoking the ONNX model. When false,
   * the raw crop is fed directly to the model. Toggleable via CMS Settings
   * for A/B testing on real KKS scales.
   */
  ocrUsePreprocess?: boolean;
  /**
   * Override where the decimal point is injected into the ONNX digit string.
   * The model reliably reads digits but often misses the decimal dot on real
   * scale photos. Set to N (1/2/3) to always insert the decimal so that the
   * last N digits sit after the dot. Example: ONNX reads "12345", N=2 →
   * 123.45 kg. Set to 0 to treat output as a whole-number weight. Leave
   * undefined ("auto") to fall back to the existing structure-based decimal
   * detection (works well only with preprocessing on).
   */
  ocrDecimalPlaces?: 0 | 1 | 2 | 3;
}

export interface User {
  uid?: string;
  email: string;
  emailVerified?: boolean;
  name: string;
  phone: string;
  pass?: string;
  role?: 'CLIENT' | 'STAFF' | 'ADMIN';
}

export interface DB {
  ponds: Pond[];
  bookings: Booking[];
  scores: Record<number, Score>;
  comp: Competition;
  competitions: Competition[];
  settings: Settings;
  users: User[];
}

export interface AppState {
  user: User | null;
  pond: number | null;
  seats: number[];
  payType: 'full' | 'deposit';
  receiptData: string | null;
  receiptFile: File | null;
  cmsAuthed: boolean;
  cdInt: number | null;
  lpf: string;
}

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}
