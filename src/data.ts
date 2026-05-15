import { DB, Pond, Booking, Score, Competition, Settings, User } from './types';

/** Generate seats for CMS pond creation only — all statuses start as 'available' */
export const gs = (pid: number, st: number, cnt: number, pr: number) => Array.from({ length: cnt }, (_, i) => ({
  num: st + i,
  zone: i < Math.ceil(cnt / 2) ? 'A' : 'B',
  price: pr,
  status: 'available' as const
}));

/** Empty DB — no placeholder data. All real data comes from Firestore. */
export const emptyDB: DB = {
  ponds: [],
  bookings: [],
  scores: {},
  comp: {
    name: '',
    startDate: new Date().toISOString(),
    endDate: new Date().toISOString(),
    topN: 20,
    prizes: []
  },
  competitions: [],
  settings: {
    qrBank: '',
    qrName: '',
    qrAccNo: '',
    qrImg: '',
    heroLogo: '',
    pondMapImg: '',
    phone: '',
    whatsapp: '',
    email: '',
    location: '',
    openingHours: {
      days: [],
      timeStart: '06:00',
      timeEnd: '18:00'
    },
    grandOpening: {
      date: new Date().toISOString().slice(0, 10),
      time: '08:00'
    }
  },
  users: []
};

/** @deprecated Use emptyDB. Kept for backwards compat during migration. */
export const initialDB = emptyDB;

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