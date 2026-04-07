import { DB, Pond, Booking, Score, Competition, Settings, User } from './types';

export const gs = (pid: number, st: number, cnt: number, pr: number) => Array.from({ length: cnt }, (_, i) => ({
  num: st + i,
  zone: i < Math.ceil(cnt / 2) ? 'A' : 'B',
  price: pr,
  status: Math.random() > 0.75 ? 'booked' : 'available' as const
}));

export const initialDB: DB = {
  ponds: [
    { id: 1, name: 'Pond A — Trophy Bass', date: '28 Mar 2026', desc: 'Deep water bass habitat. Premium pegs along the eastern bank.', seats: gs(1, 1, 40, 150), open: true },
    { id: 2, name: 'Pond B — Catfish Challenge', date: '28 Mar 2026', desc: 'Evening catfish tournament. Night fishing pegs available.', seats: gs(2, 41, 36, 120), open: true },
    { id: 3, name: 'Pond C — Tilapia Masters', date: '29 Mar 2026', desc: 'Family-friendly competition. Ideal for all skill levels.', seats: gs(3, 77, 30, 100), open: true }
  ],
  bookings: [],
  scores: {},
  comp: {
    name: 'Annual Fishing Competition 2026',
    startDate: '2026-03-28T08:00',
    endDate: '2026-03-28T17:00',
    topN: 20,
    prizes: [
      { rank: 1, label: 'Champion', prize: 'RM 5,000' },
      { rank: 2, label: '1st Runner-up', prize: 'RM 3,000' },
      { rank: 3, label: '2nd Runner-up', prize: 'RM 1,500' },
      { rank: 4, label: 'Top 10', prize: 'RM 500' },
      { rank: 11, label: 'Top 20', prize: 'RM 200' }
    ]
  },
  settings: {
    qrBank: 'DuitNow / Bank Transfer',
    qrName: 'CastBook Sdn Bhd',
    qrAccNo: '3841-2038-491',
    qrImg: '',
    heroLogo: '',
    whatsapp: 'https://wa.me/60123456789',
    location: 'Alor Setar, Kedah',
    openingHours: {
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      timeStart: '06:00',
      timeEnd: '18:00'
    },
    grandOpening: {
      date: '2026-05-20',
      time: '08:00'
    }
  },
  users: [
    { email: 'user@example.com', name: 'Test User', phone: '', pass: 'test123' },
    { email: 'user', name: 'User', phone: '', pass: 'user' },
    { email: 'admin', name: 'Admin', phone: '', pass: 'admin' }
  ]
};

export const getDB = (): DB => {
  try {
    const v = localStorage.getItem('cb_DB');
    if (v) {
      const parsed = JSON.parse(v);
      return { ...initialDB, ...parsed, settings: { ...initialDB.settings, ...parsed.settings } };
    }
    return initialDB;
  } catch {
    return initialDB;
  }
};

export const setDB = (db: DB) => {
  localStorage.setItem('cb_DB', JSON.stringify(db));
};