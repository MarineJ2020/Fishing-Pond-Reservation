/**
 * Default homepage copy + SEO metadata.
 *
 * These mirror the strings that used to be hardcoded directly in
 * `AppContent.tsx`'s `renderHome()` and `Footer.tsx`. They are applied by
 * `normalizeSettings` (src/lib/firestore.ts) whenever a CMS-editable field is
 * absent from Firestore, so a brand-new `settings/global` doc renders an
 * identical homepage to before this feature existed. The CMS "Laman Utama"
 * and "SEO" tabs edit these same fields.
 */
import { SeoSettings } from '../types';

export const LANDING_DEFAULTS = {
  heroKicker: 'Tempat Di Mana',
  heroTitle: 'Juara Dilahirkan',
  heroSubtitle: 'Kolam Keli Sayang - Port Terbaik di Kedah',
  heroCtaLabel: 'Book Slot Sekarang!',
  heroStats: [
    { value: '12', label: 'Lubuk Mega' },
    { value: '480', label: 'Peserta / Kocah' },
    { value: 'Weekly Strike', label: 'Pertandingan' },
  ],

  aboutEyebrow: 'Kolam Keli Sayang',
  aboutTitle: 'Bukan *Kolam* Biasa',
  introCopy:
    'Kolam Keli Sayang dibuka untuk pertandingan sahaja — bukan aktiviti memancing harian. Terletak di Kubang Rotan, Alor Setar, dikelilingi hamparan sawah padi yang menghijau, kami menawarkan pengalaman bertanding yang adil, teratur, dan penuh semangat.',
  aboutCtaLabel: 'Semak Layout Kolam',
  features: [
    {
      icon: 'fa-solid fa-flag-checkered',
      title: 'Event Pertandingan Sahaja',
      body: 'Tak dibuka untuk umum harian. Setiap sesi adalah event rasmi dengan peraturan, pengadil, dan hadiah yang jelas.',
    },
    {
      icon: 'fa-solid fa-water',
      title: '12 Lubuk Mega',
      body: 'Tak perlu berebut spot. 12 kolam besar mampu tampung 480 peserta sekali.',
    },
    {
      icon: 'fa-solid fa-car-side',
      title: 'Parking King Size',
      body: 'Datang konvoi besar pun tak ada hal. Kawasan parking tersusun, luas, dan tanpa caj tambahan.',
    },
    {
      icon: 'fa-solid fa-seedling',
      title: 'Suasana Bendang Padi',
      body: 'Dikelilingi sawah padi hijau Kedah. Pemandangan alami yang tulen jadi latar belakang setiap pertandingan anda.',
    },
  ],

  competitionsEyebrow: 'Pertandingan',
  competitionsTitle: 'Sertai & *Menang* Besar',
  weeklyCardTitle: 'Weekly Strike',
  weeklyCardBody: 'Format kompetitif mingguan dengan slot terhad dan susunan lubuk yang lebih kemas.',
  weeklyCardTag1: 'Setiap Minggu',
  weeklyCardTag2: 'Slot Terhad',

  stepsEyebrow: 'Cara Tempah',
  stepsTitle: 'Langkah Tempah *Yang Mudah*',
  stepsSubtitle: 'Proses tempahan yang simple dan cepat — kurang dari 2 minit siap.',
  stepsCtaLabel: 'Pilih Pertandingan',
  steps: [
    {
      icon: 'fa-solid fa-trophy',
      title: 'Pilih Pertandingan',
      body: 'Tengok senarai pertandingan yang available dan pilih yang berkenan.',
    },
    {
      icon: 'fa-solid fa-fish-fins',
      title: 'Pilih Kolam & Tempat',
      body: 'Pilih kolam dan tempat duduk yang anda suka.',
    },
    {
      icon: 'fa-solid fa-credit-card',
      title: 'Buat Bayaran',
      body: 'Bayaran penuh atau deposit 50% melalui transfer bank. Muat naik resit.',
    },
    {
      icon: 'fa-solid fa-circle-check',
      title: 'Dapat Pengesahan',
      body: 'Staff akan sahkan tempahan. Anda akan menerima notifikasi e-mel bersama.',
    },
  ],

  rulesEyebrow: 'Format Bertanding',
  rulesTitle: 'Macam Mana *Ia Berjalan?*',
  rulesCtaLabel: 'SEMAK SYARAT & PERATURAN',

  lokasiEyebrow: 'Lokasi KKS',
  lokasiTitle: 'Jumpa Kami *Di Sini*',
  contactName: 'Kolam Keli Sayang',

  footerTagline: 'Arena pertandingan memancing keli yang adil, meriah dan penuh cabaran di Kedah.',
};

export const SEO_DEFAULTS: SeoSettings = {
  siteUrl: 'https://kolamkelisayang.com.my',
  siteName: 'Kolam Keli Sayang',
  defaultOgImage: '',
  pages: {
    home: {
      title: 'Kolam Keli Sayang (KKS) – Port Pancing Terbaik Kedah',
      description:
        'Kolam pertandingan memancing keli di Kubang Rotan, Alor Setar. 12 lubuk mega, 480 peserta. Tempah slot pertandingan anda secara online.',
    },
    book: {
      title: 'Tempah Slot Pertandingan | Kolam Keli Sayang',
      description:
        'Pilih pertandingan, kolam dan tempat duduk anda, kemudian buat bayaran secara online — tempahan siap kurang dari 2 minit.',
    },
    live: {
      title: 'Keputusan Live | Kolam Keli Sayang',
      description: 'Ikuti keputusan dan carta pendahulu pertandingan memancing keli secara langsung di Kolam Keli Sayang.',
    },
    confirmed: {
      title: 'Tempahan Disahkan | Kolam Keli Sayang',
      description: 'Tempahan slot pertandingan anda di Kolam Keli Sayang telah disahkan.',
    },
  },
};
