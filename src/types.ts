export interface Seat {
  id?: string;
  num: number;
  zone: string;
  price: number;
  status: 'available' | 'booked' | 'pending';
}

export interface Pond {
  id: number;
  _docId?: string;
  name: string;
  date: string;
  desc: string;
  seats: Seat[];
  open: boolean;
}

export interface Booking {
  id: string;
  bookingRef?: string;
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
}

export interface Settings {
  qrBank: string;
  qrName: string;
  qrAccNo: string;
  qrImg: string;
  heroLogo: string;
  whatsapp: string;
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
  ctaTitle?: string;
  ctaSubtitle?: string;
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