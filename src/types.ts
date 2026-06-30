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
  pondId: number;
  pondName: string;
  /** Pond alphabet code captured at booking time, used to prefix seat labels (e.g. "A-23"). */
  pondCode?: string;
  pondDate: string;
  seats: number[];
  seatIds?: string[];
  paymentType: 'full' | 'deposit' | 'baki';
  amount: number;
  totalAmount: number;
  receiptData: string;
  receiptName: string;
  receipts?: BookingReceipt[];
  paidAmount?: number;
  balanceDue?: number;
  notes: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
  updatedAt?: string;
  createdByStaff?: boolean;
  checkedIn?: boolean;
  /** Last time a balance-due reminder email was sent to the user (ISO). */
  balanceReminderSentAt?: string;
  /** True once the owner has used their one-time receipt re-upload (correction). */
  receiptReuploadUsed?: boolean;
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
  introCopy?: string;
  aboutTitle?: string;
  aboutContent?: string;
  contactTitle?: string;
  contactSubtitle?: string;
  ctaTitle?: string;
  ctaSubtitle?: string;
  /** Numbered rules shown in the homepage "Format Bertanding" section */
  rules?: { title: string; body: string }[];
  /** Uploaded PDF URL for Syarat & Peraturan. */
  rulesPdfUrl?: string;
  /** Google Maps embed URL used in the Lokasi section. If absent, derived from `location`. */
  mapEmbedUrl?: string;
  /** External map/directions deep links shown as quick-link buttons */
  wazeUrl?: string;
  googleMapsUrl?: string;
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