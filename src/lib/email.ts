import { addDoc, collection } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const STAFF_CC = 'hello@kolamkelisayang.com.my';
const BRAND_RED = '#b91c1c';
const BRAND_NAVY = '#112a41';

const layout = (title: string, body: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#222;max-width:620px;margin:0 auto;padding:24px;background:#fff;">
    <div style="border-top:4px solid ${BRAND_RED};padding-top:16px;">
      <h2 style="margin:0 0 14px;color:${BRAND_NAVY};font-size:22px;">${title}</h2>
      ${body}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px;" />
      <p style="font-size:12px;color:#888;margin:0;">Kolam Keli Sayang &middot; hello@kolamkelisayang.com.my</p>
    </div>
  </div>
`;

// HTML-escape every interpolation that could contain user- or admin-controlled
// text (pond name, dates, booking refs). Numbers are escaped uniformly for
// consistency even though they cannot break out of the template.
const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Seat labels carry the pond's alphabet code when available (e.g. "A-23"),
// falling back to the bare "#23" form for legacy bookings without a code.
const fmtSeats = (seats: number[], pondCode?: string) => {
  const c = (pondCode || '').trim().toUpperCase();
  return (seats || []).map((n) => (c ? `${esc(c)}-${esc(n)}` : `#${esc(n)}`)).join(', ') || '-';
};

interface ReceivedArgs {
  to: string;
  bookingRef?: string;
  amount: number;
  pondName: string;
  pondCode?: string;
  pondDate: string;
  seats: number[];
}

interface ApprovedArgs {
  to: string;
  bookingId: string;
  bookingRef?: string;
  pondName: string;
  pondCode?: string;
  pondDate: string;
  seats: number[];
}

interface WelcomeArgs {
  to: string;
  name: string;
}

export const queueWelcomeEmail = async (args: WelcomeArgs): Promise<void> => {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const html = layout(
      'Selamat Datang ke Kolam Keli Sayang',
      `<p>Salam sejahtera ${esc(args.name)},</p>
       <p>Akaun anda telah berjaya didaftarkan. Anda kini boleh menempah tempat untuk pertandingan memancing kami.</p>
       <p style="text-align:center;margin:22px 0;">
         <a href="${esc(origin)}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Buat Tempahan</a>
       </p>
       <p>Jumpa di kolam!</p>`
    );

    await addDoc(collection(db, 'mail'), {
      to: args.to,
      cc: [STAFF_CC],
      message: {
        subject: 'Selamat Datang ke Kolam Keli Sayang',
        html,
      },
    });
  } catch (err) {
    console.error('Failed to queue welcome email:', err);
  }
};

export const queueBookingReceivedEmail = async (args: ReceivedArgs): Promise<void> => {
  try {
    const html = layout(
      'Tempahan Diterima',
      `<p>Salam sejahtera,</p>
       <p>Kami telah menerima permohonan tempahan anda. Pasukan kami akan menyemak resit bayaran dan mengesahkan tempahan sebentar lagi.</p>
       <table style="width:100%;border-collapse:collapse;margin:14px 0;">
         <tr><td style="padding:6px 0;color:#666;width:40%;">No. Rujukan</td><td style="padding:6px 0;font-weight:700;">${esc(args.bookingRef) || '-'}</td></tr>
         <tr><td style="padding:6px 0;color:#666;">Kolam</td><td style="padding:6px 0;font-weight:700;">${esc(args.pondName)}</td></tr>
         <tr><td style="padding:6px 0;color:#666;">Tarikh</td><td style="padding:6px 0;font-weight:700;">${esc(args.pondDate)}</td></tr>
         <tr><td style="padding:6px 0;color:#666;">Peg</td><td style="padding:6px 0;font-weight:700;">${fmtSeats(args.seats, args.pondCode)}</td></tr>
         <tr><td style="padding:6px 0;color:#666;">Jumlah Bayaran</td><td style="padding:6px 0;font-weight:700;color:${BRAND_RED};">RM ${Number(args.amount || 0).toFixed(2)}</td></tr>
       </table>
       <p>Status: <strong>Menunggu Pengesahan</strong></p>
       <p>Tempat anda telah dikunci buat sementara waktu. Anda akan menerima e-mel lain sebaik sahaja staf mengesahkan tempahan.</p>
       <p>Terima kasih kerana memilih Kolam Keli Sayang.</p>`
    );

    await addDoc(collection(db, 'mail'), {
      to: args.to,
      cc: [STAFF_CC],
      message: {
        subject: `Tempahan Diterima - ${esc(args.bookingRef) || 'Pending Approval'}`,
        html,
      },
    });
  } catch (err) {
    console.error('Failed to queue booking-received email:', err);
  }
};

interface BalanceReminderArgs {
  to: string;
  bookingId: string;
  bookingRef?: string;
  pondName: string;
  pondCode?: string;
  pondDate: string;
  seats: number[];
  balanceDue: number;
}

export const queueBalanceReminderEmail = async (args: BalanceReminderArgs): Promise<void> => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const bookingUrl = `${origin}/bookings/${encodeURIComponent(args.bookingId)}`;
  const bookingUrlEsc = esc(bookingUrl);

  const html = layout(
    'Peringatan: Baki Bayaran Tertunggak',
    `<p>Salam sejahtera,</p>
     <p>Tempahan deposit anda masih menunggu <strong style="color:${BRAND_RED};">baki bayaran</strong>.
        Sila muat naik resit bayaran baki anda untuk mengesahkan tempahan dan mengekalkan tempat anda.</p>
     <table style="width:100%;border-collapse:collapse;margin:14px 0;">
       <tr><td style="padding:6px 0;color:#666;width:40%;">No. Rujukan</td><td style="padding:6px 0;font-weight:700;">${esc(args.bookingRef) || '-'}</td></tr>
       <tr><td style="padding:6px 0;color:#666;">Kolam</td><td style="padding:6px 0;font-weight:700;">${esc(args.pondName)}</td></tr>
       <tr><td style="padding:6px 0;color:#666;">Tarikh</td><td style="padding:6px 0;font-weight:700;">${esc(args.pondDate)}</td></tr>
       <tr><td style="padding:6px 0;color:#666;">Peg</td><td style="padding:6px 0;font-weight:700;">${fmtSeats(args.seats, args.pondCode)}</td></tr>
       <tr><td style="padding:6px 0;color:#666;">Baki Tertunggak</td><td style="padding:6px 0;font-weight:700;color:${BRAND_RED};">RM ${Number(args.balanceDue || 0).toFixed(2)}</td></tr>
     </table>
     <p style="text-align:center;margin:22px 0;">
       <a href="${bookingUrlEsc}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Muat Naik Resit Baki</a>
     </p>
     <p style="font-size:12px;color:#666;">Pautan terus: <a href="${bookingUrlEsc}" style="color:${BRAND_NAVY};">${bookingUrlEsc}</a></p>
     <p>Jika anda telah membuat bayaran, sila abaikan e-mel ini. Terima kasih.</p>`
  );

  await addDoc(collection(db, 'mail'), {
    to: args.to,
    cc: [STAFF_CC],
    message: {
      subject: `Peringatan Baki Bayaran - ${esc(args.bookingRef) || args.bookingId}`,
      html,
    },
  });
};

export const queueBookingApprovedEmail = async (args: ApprovedArgs): Promise<void> => {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const bookingUrl = `${origin}/bookings/${encodeURIComponent(args.bookingId)}`;
    const bookingUrlEsc = esc(bookingUrl);
    // Use a hosted HTTPS QR image instead of base64 data-URL so Gmail clients
    // can render it consistently (some Gmail paths strip/ignore large data URIs).
    // The QR encodes the bare booking id (not the URL) so the CMS check-in /
    // weigh-in scanners decode a clean id to look up.
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(args.bookingId)}`;

    const html = layout(
      'Tempahan Disahkan',
      `<p>Salam sejahtera,</p>
       <p>Tempahan anda telah <strong style="color:${BRAND_RED};">disahkan</strong>. Sila simpan butiran berikut untuk rujukan pada hari pertandingan.</p>
       <table style="width:100%;border-collapse:collapse;margin:14px 0;">
         <tr><td style="padding:6px 0;color:#666;width:40%;">No. Rujukan</td><td style="padding:6px 0;font-weight:700;">${esc(args.bookingRef) || '-'}</td></tr>
         <tr><td style="padding:6px 0;color:#666;">Kolam</td><td style="padding:6px 0;font-weight:700;">${esc(args.pondName)}</td></tr>
         <tr><td style="padding:6px 0;color:#666;">Tarikh</td><td style="padding:6px 0;font-weight:700;">${esc(args.pondDate)}</td></tr>
         <tr><td style="padding:6px 0;color:#666;">Peg</td><td style="padding:6px 0;font-weight:700;">${fmtSeats(args.seats, args.pondCode)}</td></tr>
       </table>
       <div style="text-align:center;margin:22px 0;">
         <img src="${qrImgUrl}" alt="QR Tempahan" width="200" height="200" style="width:200px;height:200px;display:block;margin:0 auto;border:1px solid #eee;border-radius:8px;padding:8px;background:#fff;" />
         <div style="font-size:12px;color:#888;margin-top:6px;">Imbas QR untuk paparkan butiran tempahan</div>
       </div>
       <p style="text-align:center;">
         <a href="${bookingUrlEsc}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Lihat Butiran Tempahan</a>
       </p>
       <p style="font-size:12px;color:#666;">Pautan terus: <a href="${bookingUrlEsc}" style="color:${BRAND_NAVY};">${bookingUrlEsc}</a></p>
       <p>Jumpa di kolam!</p>`
    );

    await addDoc(collection(db, 'mail'), {
      to: args.to,
      cc: [STAFF_CC],
      message: {
        subject: `Tempahan Disahkan - ${esc(args.bookingRef) || args.bookingId}`,
        html,
      },
    });
  } catch (err) {
    console.error('Failed to queue booking-approved email:', err);
  }
};
