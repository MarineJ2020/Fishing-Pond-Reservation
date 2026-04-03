export interface Seat {
  num: number;
  zone: string;
  price: number;
  status: 'available' | 'booked' | 'pending';
}

export interface Pond {
  id: number;
  name: string;
  date: string;
  desc: string;
  seats: Seat[];
  open: boolean;
}

export interface Booking {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  pondId: number;
  pondName: string;
  pondDate: string;
  seats: number[];
  paymentType: 'full' | 'deposit';
  amount: number;
  totalAmount: number;
  receiptData: string;
  receiptName: string;
  notes: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
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
}

export interface User {
  email: string;
  name: string;
  phone: string;
  pass: string;
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