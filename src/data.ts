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
    },
    heroKicker: 'Tempat Di Mana',
    heroTitle: 'Juara Dilahirkan',
    heroSubtitle: 'Kolam Keli Sayang - Port Terbaik di Kedah',
    heroStats: [
      { value: '12', label: 'Lubuk Mega' },
      { value: '480', label: 'Peserta / Kocah' },
      { value: 'Weekly Strike', label: 'Pertandingan' }
    ],
    introCopy: 'Kolam Keli Sayang dibuka untuk pertandingan sahaja — bukan aktiviti memancing harian. Terletak di Kubang Rotan, Alor Setar, dikelilingi hamparan sawah padi yang menghijau, kami menawarkan pengalaman bertanding yang adil, teratur, dan penuh semangat.',
    rules: [
      { title: 'Daftar & Sahkan Tempat', body: 'Semua peserta wajib mendaftar terlebih dahulu dengan menunjukkan kod QR yang diterima dalam emel tempahan kepada petugas.' },
      { title: 'Pemilihan Tempat Duduk', body: 'Setiap peserta akan bertanding mengikut nombor tempat duduk yang telah dipilih semasa tempahan.' },
      { title: 'Masa Bertanding', body: 'Semua peserta akan memulakan pertandingan pada masa yang sama. Apabila tamat diumumkan, semua joran perlu diangkat.' },
      { title: 'Proses Timbang Ikan', body: 'Semua ikan perlu dibawa ke kaunter timbang rasmi untuk semakan berat. Peserta perlu menunjukkan kod QR dan hanya ikan yang sah akan direkod oleh pengadil.' },
      { title: 'Anugerah & Keputusan', body: 'Pemenang akan diumumkan dan menerima hadiah selepas semakan rasmi pengadil.' }
    ],
    wazeUrl: '',
    googleMapsUrl: '',
    mapEmbedUrl: ''
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