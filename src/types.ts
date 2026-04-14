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
  date: string;
  desc: string;
  seats: Seat[];
  open: boolean;
  maxSeats?: number; // target seat count — drives legacy capsule count and polygon editor enforcement
  shape?: PondVertex[]; // polygon vertices for the custom visual editor
}

export interface Booking {
  id: string;
  bookingRef?: string;
  competitionId?: string;
  competitionName?: string;
  userId: string;
  userName: string;
  userPhone: string;
  pondId: number;
  pondName: string;
  pondDate: string;
  seats: number[];
  seatIds?: string[];
  paymentType: 'full' | 'deposit';
  amount: number;
  totalAmount: number;
  receiptData: string;
  receiptName: string;
  notes: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
  updatedAt?: string;
  createdByStaff?: boolean;
  checkedIn?: boolean;
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
}

export interface Prize {
  rank: number;
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
  aboutTitle?: string;
  aboutContent?: string;
  contactTitle?: string;
  contactSubtitle?: string;
  ctaTitle?: string;
  ctaSubtitle?: string;
  /** When true, the booking page and CMS show the legacy capsule pond view instead of the SVG polygon */
  useLegacyPondView?: boolean;
}

export interface User {
  uid?: string;
  email: string;
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