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

const formatDate = (value) => {
    if (!value) return '-';
    if (typeof value === 'string') {
        const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
        if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
    }
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime())
        ? String(value)
        : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur' }).format(date);
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

const selectionDetails = (booking) => selectionList(booking).map((selection) => {
    const seats = selection.seats.map((seat) => escapeHtml(seatLabel(seat, selection.pondCode))).join(', ') || '-';
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;">
        <div style="font-weight:700;">${escapeHtml(selection.pondName)}</div>
        <div style="font-size:13px;color:#666;">Tarikh: ${escapeHtml(formatDate(selection.pondDate))}</div>
        <div style="font-size:13px;color:#666;">Peg: ${seats}</div>
      </td>
    </tr>`;
}).join('');

const selectionText = (booking) => selectionList(booking)
    .map((selection) => {
        const seats = selection.seats.map((seat) => seatLabel(seat, selection.pondCode)).join(', ') || '-';
        return `${selection.pondName} | ${formatDate(selection.pondDate)} | ${seats}`;
    })
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

export const renderBookingReceivedEmail = ({ booking }) => {
    const bookingRef = subjectText(booking.bookingRef, 'Pending Approval');
    return {
        subject: `Tempahan Diterima - ${bookingRef}`,
        text: `Tempahan ${bookingRef} diterima dan menunggu pengesahan.\n${selectionText(booking)}\nJumlah bayaran: RM ${Number(booking.amount || 0).toFixed(2)}`,
        html: layout('Tempahan Diterima', `
            <p>Salam sejahtera,</p>
            <p>Kami telah menerima permohonan tempahan anda. Pasukan kami akan menyemak resit bayaran dan mengesahkan tempahan sebentar lagi.</p>
            <p><strong>No. Rujukan:</strong> ${escapeHtml(bookingRef)}</p>
            <table style="width:100%;border-collapse:collapse;margin:14px 0;">${selectionDetails(booking)}</table>
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

export const renderBookingApprovedEmail = ({ bookingId, booking, appUrl }) => {
    const bookingRef = subjectText(booking.bookingRef, bookingId);
    const bookingUrl = `${appUrl}/bookings/${encodeURIComponent(bookingId)}`;
    return {
        subject: `Tempahan Disahkan - ${bookingRef}`,
        text: `Tempahan ${bookingRef} telah disahkan.\n${selectionText(booking)}\nLihat tempahan: ${bookingUrl}`,
        html: layout('Tempahan Disahkan', `
            <p>Salam sejahtera,</p>
            <p>Tempahan anda telah <strong style="color:${BRAND_RED};">disahkan</strong>. Sila simpan butiran berikut untuk rujukan pada hari pertandingan.</p>
            <p><strong>No. Rujukan:</strong> ${escapeHtml(bookingRef)}</p>
            <table style="width:100%;border-collapse:collapse;margin:14px 0;">${selectionDetails(booking)}</table>
            <div style="text-align:center;margin:22px 0;">
              <div style="font-size:12px;color:#888;margin-bottom:8px;">Setiap peg mempunyai QR sendiri — imbas QR peg berkenaan semasa check-in / timbang ikan</div>
              <table style="border-collapse:collapse;margin:0 auto;">${qrTable({ bookingId, booking, appUrl })}</table>
            </div>
            <p style="text-align:center;"><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Lihat Butiran Tempahan</a></p>
            <p style="font-size:12px;color:#666;">Pautan terus: <a href="${escapeHtml(bookingUrl)}" style="color:${BRAND_NAVY};">${escapeHtml(bookingUrl)}</a></p>
            <p>Jumpa di kolam!</p>`),
    };
};

export const renderBalanceReminderEmail = ({ bookingId, booking, balanceDue, appUrl }) => {
    const bookingRef = subjectText(booking.bookingRef, bookingId);
    const bookingUrl = `${appUrl}/bookings/${encodeURIComponent(bookingId)}`;
    return {
        subject: `Peringatan Baki Bayaran - ${bookingRef}`,
        text: `Baki RM ${Number(balanceDue || 0).toFixed(2)} untuk tempahan ${bookingRef} masih tertunggak.\n${selectionText(booking)}\nMuat naik resit: ${bookingUrl}`,
        html: layout('Peringatan: Baki Bayaran Tertunggak', `
            <p>Salam sejahtera,</p>
            <p>Tempahan deposit anda masih menunggu <strong style="color:${BRAND_RED};">baki bayaran</strong>. Sila muat naik resit bayaran baki anda untuk mengesahkan tempahan dan mengekalkan tempat anda.</p>
            <p><strong>No. Rujukan:</strong> ${escapeHtml(bookingRef)}</p>
            <table style="width:100%;border-collapse:collapse;margin:14px 0;">${selectionDetails(booking)}</table>
            <p><strong>Baki Tertunggak:</strong> <span style="color:${BRAND_RED};">RM ${Number(balanceDue || 0).toFixed(2)}</span></p>
            <p style="text-align:center;margin:24px 0;"><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;background:${BRAND_RED};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Muat Naik Resit Baki</a></p>
            <p style="font-size:12px;color:#666;">Pautan terus: <a href="${escapeHtml(bookingUrl)}" style="color:${BRAND_NAVY};">${escapeHtml(bookingUrl)}</a></p>
            <p style="font-size:12px;color:#888;">Jika anda telah membuat bayaran, sila abaikan e-mel ini.</p>`),
    };
};

export const bookingSelectionsForTest = selectionList;
