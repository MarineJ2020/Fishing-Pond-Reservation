const BRAND_RED = '#b91c1c';
const BRAND_NAVY = '#112a41';

const subjectText = (value, fallback) => {
    const normalized = String(value || fallback || '').replace(/[\r\n]+/g, ' ').trim();
    return normalized.slice(0, 120) || String(fallback || 'Kolam Keli Sayang');
};

export const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const layout = (title, body) => `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#222;max-width:620px;margin:0 auto;padding:24px;background:#fff;">
      <div style="border-top:4px solid ${BRAND_RED};padding-top:16px;">
        <h2 style="margin:0 0 14px;color:${BRAND_NAVY};font-size:22px;">${escapeHtml(title)}</h2>
        ${body}
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px;" />
        <p style="font-size:12px;color:#888;margin:0;">Kolam Keli Sayang &middot; hello@kolamkelisayang.com.my</p>
      </div>
    </div>
`;

const MY_TIME_ZONE = 'Asia/Kuala_Lumpur';
// e.g. "Ahd, 4 Okt 2026, 8:30 PG"
const myDateTime = new Intl.DateTimeFormat('ms-MY', {
    timeZone: MY_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
});
const myTime = new Intl.DateTimeFormat('ms-MY', { timeZone: MY_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true });
const myDayKey = new Intl.DateTimeFormat('en-CA', { timeZone: MY_TIME_ZONE });

const toDate = (value) => {
    if (!value) return null;
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateTime = (value) => {
    const date = toDate(value);
    return date ? myDateTime.format(date) : '-';
};

// "Ahd, 4 Okt 2026, 8:00 PG – 6:00 PTG" (end time only when on the same day).
const competitionSchedule = (competition) => {
    const start = toDate(competition?.eventDate ?? competition?.startDate);
    if (!start) return '-';
    const end = toDate(competition?.endDate);
    if (!end || end <= start) return myDateTime.format(start);
    return myDayKey.format(start) === myDayKey.format(end)
        ? `${myDateTime.format(start)} – ${myTime.format(end)}`
        : `${myDateTime.format(start)} – ${myDateTime.format(end)}`;
};

const seatLabel = (seat, pondCode) => {
    const code = String(pondCode || '').trim().toUpperCase();
    return code ? `${code}-${seat}` : `#${seat}`;
};

const selectionList = (booking) => {
    if (Array.isArray(booking.pondSelections) && booking.pondSelections.length) {
        return booking.pondSelections.map((selection) => ({
            pondId: selection?.pondId ?? booking.pondId,
            pondName: selection?.pondName || booking.pondName || 'Kolam',
            pondCode: selection?.pondCode || booking.pondCode || '',
            pondDate: selection?.pondDate || booking.pondDate || booking.eventDate || '',
            seats: Array.isArray(selection?.seats) ? selection.seats : [],
        }));
    }
    return [{
        pondId: booking.pondId,
        pondName: booking.pondName || booking.competitionName || 'Kolam',
        pondCode: booking.pondCode || '',
        pondDate: booking.pondDate || booking.eventDate || '',
        seats: Array.isArray(booking.seatNumbers)
            ? booking.seatNumbers
            : (Array.isArray(booking.seats) ? booking.seats : []),
    }];
};

// Booking summary shared by every booking email. `competition` is the
// competitions doc (for its schedule); the booking only stores the name.
const summaryRows = (booking, competition) => [
    ['Tarikh & Masa Tempahan', formatDateTime(booking.createdAt)],
    ['Pertandingan', booking.competitionName || competition?.name || '-'],
    ['Tarikh & Masa Pertandingan', competitionSchedule(competition)],
    ['Kolam & No. Pancang', selectionList(booking).map((selection) => {
        const seats = selection.seats.map((seat) => seatLabel(seat, selection.pondCode)).join(', ') || '-';
        return `${selection.pondName}: ${seats}`;
    })],
];

const selectionDetails = (booking, competition) => summaryRows(booking, competition).map(([label, value]) => {
    const html = (Array.isArray(value) ? value : [value]).map(escapeHtml).join('<br/>');
    return `<tr>
      <td style="padding:7px 12px 7px 0;border-bottom:1px solid #eee;color:#666;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
      <td style="padding:7px 0;border-bottom:1px solid #eee;font-weight:700;vertical-align:top;">${html}</td>
    </tr>`;
}).join('');

const selectionText = (booking, competition) => summaryRows(booking, competition)
    .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join('; ') : value}`)
    .join('\n');

export const renderWelcomeEmail = ({ name, appUrl }) => ({
    subject: 'Selamat Datang ke Kolam Keli Sayang',
    text: `Salam sejahtera ${name || ''}. Akaun anda telah berjaya didaftarkan. Buat tempahan di ${appUrl}`,
    html: layout('Selamat Datang ke Kolam Keli Sayang', `
        <p>Salam sejahtera ${escapeHtml(name)},</p>
        <p>Akaun anda telah berjaya didaftarkan. Anda kini boleh menempah tempat untuk pertandingan memancing kami.</p>
        <p style="text-align:center;margin:22px 0;">
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Buat Tempahan</a>
        </p>
        <p>Jumpa di kolam!</p>`),
});

export const renderVerificationEmail = ({ link }) => ({
    subject: 'Sahkan Email Anda - Kolam Keli Sayang',
    text: `Sahkan alamat email anda menggunakan pautan ini: ${link}`,
    html: layout('Sahkan Email Anda', `
        <p>Salam sejahtera,</p>
        <p>Terima kasih kerana mendaftar dengan Kolam Keli Sayang. Sila klik butang di bawah untuk mengesahkan alamat email anda dan mengaktifkan akaun.</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${escapeHtml(link)}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Sahkan Email</a>
        </p>
        <p style="font-size:12px;color:#666;">Jika butang tidak berfungsi, salin pautan ini ke pelayar anda:<br/><a href="${escapeHtml(link)}" style="color:${BRAND_NAVY};">${escapeHtml(link)}</a></p>
        <p style="font-size:12px;color:#888;">Jika anda tidak mendaftar, abaikan email ini.</p>`),
});

// Replaces Firebase Auth's built-in reset email (English, "project-<id>" sender)
// with a branded Malay message. Some mail apps do not linkify a bare URL, so the
// primary call-to-action is a button with the raw link kept as a fallback.
export const renderPasswordResetEmail = ({ link, name }) => ({
    subject: 'Tetapkan Semula Kata Laluan - Kolam Keli Sayang',
    text: `Salam sejahtera${name ? ` ${name}` : ''},\n\nKami menerima permintaan untuk menetapkan semula kata laluan akaun Kolam Keli Sayang anda.\nBuka pautan ini untuk memilih kata laluan baharu (sah selama 1 jam): ${link}\n\nJika anda tidak membuat permintaan ini, abaikan e-mel ini — kata laluan anda kekal tidak berubah.`,
    html: layout('Tetapkan Semula Kata Laluan', `
        <p>Salam sejahtera${name ? ` ${escapeHtml(name)}` : ''},</p>
        <p>Kami menerima permintaan untuk menetapkan semula kata laluan bagi akaun <strong>Kolam Keli Sayang</strong> anda. Klik butang di bawah untuk memilih kata laluan baharu.</p>
        <p style="text-align:center;margin:26px 0;">
          <a href="${escapeHtml(link)}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:14px 30px;border-radius:8px;font-weight:700;font-size:16px;">Tetapkan Kata Laluan Baharu</a>
        </p>
        <p style="font-size:12px;color:#666;">Butang tidak berfungsi? Salin dan tampal pautan ini ke pelayar anda:<br/><a href="${escapeHtml(link)}" style="color:${BRAND_NAVY};word-break:break-all;">${escapeHtml(link)}</a></p>
        <p style="font-size:12px;color:#888;">Pautan ini sah selama 1 jam dan hanya boleh digunakan sekali. Jika anda tidak membuat permintaan ini, abaikan e-mel ini — kata laluan anda kekal tidak berubah.</p>`),
});

export const renderBookingReceivedEmail = ({ booking, competition }) => {
    const bookingRef = subjectText(booking.bookingRef, 'Pending Approval');
    return {
        subject: `Tempahan Diterima - ${bookingRef}`,
        text: `Tempahan ${bookingRef} diterima dan menunggu pengesahan.\n${selectionText(booking, competition)}\nJumlah bayaran: RM ${Number(booking.amount || 0).toFixed(2)}`,
        html: layout('Tempahan Diterima', `
            <p>Salam sejahtera,</p>
            <p>Kami telah menerima permohonan tempahan anda. Pasukan kami akan menyemak resit bayaran dan mengesahkan tempahan sebentar lagi.</p>
            <p><strong>No. Rujukan:</strong> ${escapeHtml(bookingRef)}</p>
            <table style="width:100%;border-collapse:collapse;margin:14px 0;">${selectionDetails(booking, competition)}</table>
            <p><strong>Jumlah Bayaran:</strong> <span style="color:${BRAND_RED};">RM ${Number(booking.amount || 0).toFixed(2)}</span></p>
            <p>Status: <strong>Menunggu Pengesahan</strong></p>
            <p>Tempat anda telah dikunci buat sementara waktu. Anda akan menerima e-mel lain sebaik sahaja staf mengesahkan tempahan.</p>`),
    };
};

const qrTable = ({ bookingId, booking, appUrl }) => {
    const cells = selectionList(booking).flatMap((selection) => selection.seats.map((seat) => {
        const label = seatLabel(seat, selection.pondCode);
        const pondQuery = selection.pondId != null
            ? `&pond=${encodeURIComponent(String(selection.pondId?.id ?? selection.pondId))}`
            : '';
        const qrValue = `${appUrl}/bookings/${encodeURIComponent(bookingId)}?seat=${encodeURIComponent(String(seat))}${pondQuery}`;
        const imageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrValue)}`;
        return `<td style="padding:8px;text-align:center;vertical-align:top;">
            <img src="${imageUrl}" alt="QR Peg ${escapeHtml(label)}" width="150" height="150" style="width:150px;height:150px;display:block;margin:0 auto;border:1px solid #eee;border-radius:8px;padding:6px;background:#fff;" />
            <div style="font-size:12px;font-weight:700;color:${BRAND_NAVY};margin-top:6px;">${escapeHtml(selection.pondName)} &middot; ${escapeHtml(label)}</div>
          </td>`;
    }));
    const rows = [];
    for (let index = 0; index < cells.length; index += 3) {
        rows.push(`<tr>${cells.slice(index, index + 3).join('')}</tr>`);
    }
    return rows.join('');
};

export const renderBookingApprovedEmail = ({ bookingId, booking, competition, appUrl }) => {
    const bookingRef = subjectText(booking.bookingRef, bookingId);
    const bookingUrl = `${appUrl}/bookings/${encodeURIComponent(bookingId)}`;
    return {
        subject: `Tempahan Disahkan - ${bookingRef}`,
        text: `Tempahan ${bookingRef} telah disahkan.\n${selectionText(booking, competition)}\nLihat tempahan: ${bookingUrl}`,
        html: layout('Tempahan Disahkan', `
            <p>Salam sejahtera,</p>
            <p>Tempahan anda telah <strong style="color:${BRAND_RED};">disahkan</strong>. Sila simpan butiran berikut untuk rujukan pada hari pertandingan.</p>
            <p><strong>No. Rujukan:</strong> ${escapeHtml(bookingRef)}</p>
            <table style="width:100%;border-collapse:collapse;margin:14px 0;">${selectionDetails(booking, competition)}</table>
            <div style="text-align:center;margin:22px 0;">
              <div style="font-size:12px;color:#888;margin-bottom:8px;">Setiap peg mempunyai QR sendiri — imbas QR peg berkenaan semasa check-in / timbang ikan</div>
              <table style="border-collapse:collapse;margin:0 auto;">${qrTable({ bookingId, booking, appUrl })}</table>
            </div>
            <p style="text-align:center;"><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Lihat Butiran Tempahan</a></p>
            <p style="font-size:12px;color:#666;">Pautan terus: <a href="${escapeHtml(bookingUrl)}" style="color:${BRAND_NAVY};">${escapeHtml(bookingUrl)}</a></p>
            <p>Jumpa di kolam!</p>`),
    };
};

export const renderBalanceReminderEmail = ({ bookingId, booking, competition, balanceDue, appUrl }) => {
    const bookingRef = subjectText(booking.bookingRef, bookingId);
    const bookingUrl = `${appUrl}/bookings/${encodeURIComponent(bookingId)}`;
    return {
        subject: `Peringatan Baki Bayaran - ${bookingRef}`,
        text: `Baki RM ${Number(balanceDue || 0).toFixed(2)} untuk tempahan ${bookingRef} masih tertunggak.\n${selectionText(booking, competition)}\nMuat naik resit: ${bookingUrl}`,
        html: layout('Peringatan: Baki Bayaran Tertunggak', `
            <p>Salam sejahtera,</p>
            <p>Tempahan deposit anda masih menunggu <strong style="color:${BRAND_RED};">baki bayaran</strong>. Sila muat naik resit bayaran baki anda untuk mengesahkan tempahan dan mengekalkan tempat anda.</p>
            <p><strong>No. Rujukan:</strong> ${escapeHtml(bookingRef)}</p>
            <table style="width:100%;border-collapse:collapse;margin:14px 0;">${selectionDetails(booking, competition)}</table>
            <p><strong>Baki Tertunggak:</strong> <span style="color:${BRAND_RED};">RM ${Number(balanceDue || 0).toFixed(2)}</span></p>
            <p style="text-align:center;margin:24px 0;"><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Muat Naik Resit Baki</a></p>
            <p style="font-size:12px;color:#666;">Pautan terus: <a href="${escapeHtml(bookingUrl)}" style="color:${BRAND_NAVY};">${escapeHtml(bookingUrl)}</a></p>
            <p style="font-size:12px;color:#888;">Jika anda telah membuat bayaran, sila abaikan e-mel ini.</p>`),
    };
};

// bookingCancelled: the first (only) receipt was rejected, which rejects the whole
// booking and frees its pegs; otherwise the customer can re-upload that receipt.
export const renderReceiptRejectedEmail = ({ bookingId, booking, competition, receiptIndex, amount, reason, bookingCancelled, appUrl }) => {
    const bookingRef = subjectText(booking.bookingRef, bookingId);
    const bookingUrl = `${appUrl}/bookings/${encodeURIComponent(bookingId)}`;
    const reasonText = String(reason || '').trim() || 'Tiada sebab dinyatakan. Sila hubungi kami untuk maklumat lanjut.';
    const amountText = `RM ${Number(amount || 0).toFixed(2)}`;
    const nextStep = bookingCancelled
        ? 'Tempahan ini telah dibatalkan dan peg telah dilepaskan. Anda boleh membuat tempahan baharu dengan resit yang betul.'
        : 'Sila muat naik resit yang betul melalui halaman tempahan anda untuk semakan semula.';
    const ctaUrl = bookingCancelled ? `${appUrl}/book` : bookingUrl;
    const ctaLabel = bookingCancelled ? 'Buat Tempahan Baharu' : 'Muat Naik Resit Semula';
    return {
        subject: `${bookingCancelled ? 'Tempahan Tidak Diluluskan' : 'Resit Ditolak'} - ${bookingRef}`,
        text: `Resit #${receiptIndex + 1} (${amountText}) untuk tempahan ${bookingRef} telah ditolak.\nSebab: ${reasonText}\n${nextStep}\n${ctaUrl}`,
        html: layout(bookingCancelled ? 'Tempahan Tidak Diluluskan' : 'Resit Bayaran Ditolak', `
            <p>Salam sejahtera,</p>
            <p>Resit bayaran <strong>#${receiptIndex + 1}</strong> (${escapeHtml(amountText)}) untuk tempahan anda telah <strong style="color:${BRAND_RED};">ditolak</strong> oleh petugas kami.</p>
            <p><strong>No. Rujukan:</strong> ${escapeHtml(bookingRef)}</p>
            <div style="background:#fdf2f2;border-left:4px solid ${BRAND_RED};padding:12px 14px;margin:16px 0;border-radius:4px;">
              <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Sebab ditolak</div>
              <div style="font-weight:700;">${escapeHtml(reasonText)}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;margin:14px 0;">${selectionDetails(booking, competition)}</table>
            <p>${escapeHtml(nextStep)}</p>
            <p style="text-align:center;margin:24px 0;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">${escapeHtml(ctaLabel)}</a></p>
            <p style="font-size:12px;color:#888;">Ada pertanyaan? Balas e-mel ini atau hubungi kami.</p>`),
    };
};

// Staff force-cancelled an already-confirmed booking; its pegs are released.
// cancelType (set by CMS > Batal Paksa) decides what we say about the money.
const moneyText = (value) => `RM ${Number(value || 0).toFixed(2)}`;
const cancelMoneyCopy = (booking, rulesPdfUrl) => {
    if (booking.cancelType === 'no_show_forfeit') {
        const rules = rulesPdfUrl ? ` Rujuk Syarat & Peraturan: ${rulesPdfUrl}` : '';
        return {
            title: 'Tempahan Dibatalkan (Tidak Hadir)',
            text: `Tempahan ini dibatalkan kerana anda tidak hadir pada hari pertandingan, dan peg telah dilepaskan kepada peserta lain. Mengikut syarat & peraturan pertandingan, bayaran yang telah dibuat tidak dikembalikan.${rules}`,
            html: `<p>Tempahan ini dibatalkan kerana anda <strong>tidak hadir</strong> pada hari pertandingan, dan peg telah dilepaskan kepada peserta lain.</p>
            <p>Mengikut syarat &amp; peraturan pertandingan, <strong>bayaran yang telah dibuat tidak dikembalikan</strong>.${rulesPdfUrl ? ` <a href="${escapeHtml(rulesPdfUrl)}" style="color:${BRAND_NAVY};">Lihat Syarat &amp; Peraturan</a>.` : ''}</p>`,
        };
    }
    if (booking.cancelType === 'refund') {
        const amount = moneyText(booking.refundAmount);
        return {
            title: 'Tempahan Dibatalkan',
            text: `Bayaran balik sebanyak ${amount} akan diproses ke akaun anda. Kami akan menghantar e-mel apabila bayaran balik telah dibuat.`,
            html: `<p>Bayaran balik sebanyak <strong style="color:${BRAND_RED};">${amount}</strong> akan diproses ke akaun anda. Kami akan menghantar e-mel apabila bayaran balik telah dibuat.</p>`,
        };
    }
    return {
        title: 'Tempahan Dibatalkan',
        text: 'Untuk sebarang pertanyaan, termasuk bayaran yang telah dibuat, sila hubungi kami.',
        html: '<p>Untuk sebarang pertanyaan, termasuk bayaran yang telah dibuat, sila balas e-mel ini atau hubungi kami.</p>',
    };
};

export const renderBookingCancelledEmail = ({ bookingId, booking, competition, reason, appUrl, rulesPdfUrl = '' }) => {
    const bookingRef = subjectText(booking.bookingRef, bookingId);
    const reasonText = String(reason || '').trim() || 'Tiada sebab dinyatakan. Sila hubungi kami untuk maklumat lanjut.';
    const bookingUrl = `${appUrl}/bookings/${encodeURIComponent(bookingId)}`;
    const money = cancelMoneyCopy(booking, rulesPdfUrl);
    return {
        subject: `${money.title} - ${bookingRef}`,
        text: `Tempahan ${bookingRef} telah dibatalkan oleh pihak kami.\nSebab: ${reasonText}\n${selectionText(booking, competition)}\n${money.text}`,
        html: layout(money.title, `
            <p>Salam sejahtera,</p>
            <p>Dimaklumkan bahawa tempahan anda yang telah disahkan sebelum ini telah <strong style="color:${BRAND_RED};">dibatalkan</strong> oleh pihak kami. QR peg untuk tempahan ini tidak lagi sah.</p>
            <p><strong>No. Rujukan:</strong> ${escapeHtml(bookingRef)}</p>
            <div style="background:#fdf2f2;border-left:4px solid ${BRAND_RED};padding:12px 14px;margin:16px 0;border-radius:4px;">
              <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Sebab pembatalan</div>
              <div style="font-weight:700;">${escapeHtml(reasonText)}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;margin:14px 0;">${selectionDetails(booking, competition)}</table>
            ${money.html}
            <p style="font-size:12px;color:#666;">Butiran tempahan: <a href="${escapeHtml(bookingUrl)}" style="color:${BRAND_NAVY};">${escapeHtml(bookingUrl)}</a></p>`),
    };
};

// Staff recorded the refund for a "Batal – bayaran dikembalikan" booking.
export const renderBookingRefundedEmail = ({ bookingId, booking, competition, appUrl }) => {
    const bookingRef = subjectText(booking.bookingRef, bookingId);
    const amount = moneyText(booking.refundAmount);
    const reference = String(booking.refundReference || '').trim();
    const bookingUrl = `${appUrl}/bookings/${encodeURIComponent(bookingId)}`;
    return {
        subject: `Bayaran Balik Dibuat - ${bookingRef}`,
        text: `Bayaran balik ${amount} untuk tempahan ${bookingRef} telah dibuat.${reference ? `\nRujukan: ${reference}` : ''}\n${selectionText(booking, competition)}\nSila semak akaun bank anda. Hubungi kami jika belum diterima dalam 3 hari bekerja.`,
        html: layout('Bayaran Balik Dibuat', `
            <p>Salam sejahtera,</p>
            <p>Bayaran balik untuk tempahan anda yang dibatalkan telah <strong style="color:${BRAND_RED};">dibuat</strong>.</p>
            <p><strong>No. Rujukan Tempahan:</strong> ${escapeHtml(bookingRef)}</p>
            <p><strong>Jumlah Dikembalikan:</strong> <span style="color:${BRAND_RED};">${amount}</span></p>
            ${reference ? `<p><strong>Rujukan Pindahan:</strong> ${escapeHtml(reference)}</p>` : ''}
            <table style="width:100%;border-collapse:collapse;margin:14px 0;">${selectionDetails(booking, competition)}</table>
            <p>Sila semak akaun bank anda. Hubungi kami jika bayaran belum diterima dalam 3 hari bekerja.</p>
            <p style="font-size:12px;color:#666;">Butiran tempahan: <a href="${escapeHtml(bookingUrl)}" style="color:${BRAND_NAVY};">${escapeHtml(bookingUrl)}</a></p>`),
    };
};

export const bookingSelectionsForTest = selectionList;
