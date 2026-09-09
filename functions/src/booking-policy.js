import { createHash, randomInt } from 'node:crypto';

export const fail = (message, status = 400) => {
    const error = new Error(message);
    error.status = status;
    throw error;
};
export const refId = (value) => String(value?.id ?? value ?? '');
export const occupiesSeats = (booking) => ['PENDING', 'PENDING_APPROVAL', 'APPROVED', 'CONFIRMED', 'LIVE'].includes(String(booking.status).toUpperCase());
export const confirmed = (booking) => ['APPROVED', 'CONFIRMED', 'LIVE'].includes(String(booking.status).toUpperCase());
export const ownsBooking = (booking, user) => refId(booking.userId) === user.uid
    || (user.email_verified === true && !!user.email && [booking.userEmail, refId(booking.userId)].includes(user.email));
export const claimId = (competitionId, pondId, seatNum) => createHash('sha256').update(JSON.stringify([competitionId, pondId, seatNum])).digest('hex');
export const newBookingRef = () => {
    const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    return `KKS-${Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join('')}`;
};
const millis = (value) => value?.toMillis?.() ?? (value ? new Date(value).getTime() : NaN);

export function validateBookingWindow(competition, now = Date.now()) {
    if (!competition || ['INACTIVE', 'DRAFT', 'CLOSED', 'ENDED', 'COMPLETED'].includes(String(competition.status).toUpperCase())) {
        fail('Pertandingan ini tidak tersedia untuk tempahan.');
    }
    const end = millis(competition.endDate || competition.eventDate);
    if (!Number.isFinite(end) || now >= end) fail('Pertandingan ini telah tamat atau tarikh pertandingan tidak sah.');
    const open = millis(competition.bookingOpenAt);
    const close = millis(competition.bookingCloseAt);
    if (now < open || now > close) fail('Tempahan untuk pertandingan ini belum dibuka atau telah ditutup.');
}

export function receiptPath(url, uid, bucket, emulatorHost) {
    let parsed;
    try { parsed = new URL(url); } catch { fail('Fail resit tidak sah.'); }
    const prefix = `/v0/b/${bucket}/o/`;
    const trustedOrigin = parsed.protocol === 'https:' && parsed.hostname === 'firebasestorage.googleapis.com'
        || (!!emulatorHost && parsed.protocol === 'http:' && parsed.host === emulatorHost);
    if (!trustedOrigin || !parsed.pathname.startsWith(prefix)) fail('Fail resit tidak sah.');
    let path;
    try { path = decodeURIComponent(parsed.pathname.slice(prefix.length)); } catch { fail('Fail resit tidak sah.'); }
    if (!path.startsWith(`fishing-pond-receipts/${uid}/`) || path.includes('..')) fail('Fail resit bukan milik akaun ini.', 403);
    return path;
}

export function deriveReceipts(booking) {
    if (Array.isArray(booking.receipts) && booking.receipts.length) return booking.receipts.map((receipt) => ({ ...receipt }));
    return booking.receiptUrl ? [{ url: booking.receiptUrl, amount: Number(booking.amount) || 0, status: confirmed(booking) ? 'accepted' : 'pending', submittedAt: booking.createdAt || new Date() }] : [];
}

export function receiptUpdate(booking, { receiptUrl, amount, bankReference, receiptIndex }, now = new Date()) {
    if (!occupiesSeats(booking)) fail('Tempahan ini tidak lagi menerima resit.', 409);
    const receipts = deriveReceipts(booking);
    if (receiptIndex !== undefined) {
        if (!Number.isInteger(receiptIndex) || receiptIndex < 0 || receiptIndex >= receipts.length) fail('Indeks resit tidak sah.');
        if (!['pending', 'rejected'].includes(receipts[receiptIndex].status)) fail('Resit yang telah disahkan tidak boleh digantikan.', 409);
        receipts[receiptIndex] = { ...receipts[receiptIndex], url: receiptUrl, status: 'pending', submittedAt: now };
    } else {
        if (receipts.length >= 3) fail('Maksimum 3 resit telah dicapai.', 409);
        const accepted = receipts.filter((r) => r.status === 'accepted').reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
        const paid = Math.max(accepted, Number(booking.paidAmount) || 0);
        const remaining = (Number(booking.totalAmount) || 0) - paid;
        if (remaining <= 0) fail('Tempahan telah dibayar sepenuhnya.', 409);
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > remaining) fail('Jumlah bayaran tidak sah.');
        receipts.push({ url: receiptUrl, amount, status: 'pending', submittedAt: now, bankReference: String(bankReference || '').trim().slice(0, 120) });
    }
    return { receipts, receiptUrl, updatedAt: now };
}

// Resolve legacy numeric pond ids and reference-based ids using the same order as the client.
export function pondCatalog(pondDocs, seatDocs) {
    return pondDocs.map((snap, index) => {
        const data = snap.data();
        const numeric = Number(snap.id);
        const id = Number.isFinite(numeric) ? numeric : index + 1;
        const seats = seatDocs.filter((seat) => refId(seat.data().pondId) === snap.id)
            .map((seat) => ({ id: seat.id, ...seat.data() })).sort((a, b) => a.seatNumber - b.seatNumber);
        return { ...data, docId: snap.id, id, seats };
    });
}

export function bookingSelections(booking, ponds, seats) {
    const selections = booking.pondSelections?.length ? booking.pondSelections
        : [{ pondId: booking.pondId, seats: booking.seatNumbers || booking.seats || [], seatIds: booking.seatIds || [] }];
    return selections.map((selection) => {
        const pond = ponds.find((p) => p.docId === refId(selection.pondId) || String(p.id) === refId(selection.pondId));
        const numbers = selection.seats?.length ? selection.seats : (selection.seatIds || []).map((id) => seats.find((s) => s.id === refId(id))?.data().seatNumber).filter(Number.isInteger);
        return { pondId: pond?.id ?? Number(refId(selection.pondId)), seats: numbers };
    });
}

export function validateSelections(payload, competition, ponds) {
    if (!['full', 'deposit'].includes(payload.paymentType)) fail('Jenis bayaran tidak sah.');
    const requested = payload.pondSelections;
    if (!Array.isArray(requested) || !requested.length || requested.length > ponds.length) fail('Sila pilih No Pancang.');
    const seen = new Set();
    const selected = requested.map((group) => {
        const pond = ponds.find((p) => p.id === group.pondId);
        if (!pond || pond.open === false || (competition.activePondIds?.length && !competition.activePondIds.map(refId).includes(pond.docId))) fail('Kolam tidak tersedia.');
        const allSeats = pond.seats.length ? pond.seats : Array.from({ length: pond.totalSeats || 30 }, (_, i) => ({ seatNumber: i + 1, price: 100 }));
        const cap = competition.pondSeats?.[pond.docId] ?? competition.pondSeats?.[String(pond.id)] ?? allSeats.length;
        const allowed = allSeats.slice(0, Math.max(0, Math.floor(cap)));
        if (!Array.isArray(group.seats) || !group.seats.length) fail('No Pancang tidak sah.');
        const selectedSeats = group.seats.map((num) => {
            const seat = allowed.find((s) => s.seatNumber === num);
            const key = `${pond.docId}:${num}`;
            if (!Number.isInteger(num) || !seat || seen.has(key) || pond.seatLayout?.some((s) => s.num === num && s.active === false)) fail('No Pancang tidak tersedia.');
            seen.add(key);
            return seat;
        });
        return { pondId: pond.id, pondDocId: pond.docId, pondName: pond.name || '', pondCode: pond.code || '', pondDate: pond.eventDate || null, seats: selectedSeats.map((s) => s.seatNumber), seatIds: selectedSeats.map((s) => s.id).filter(Boolean), fallbackPrice: allSeats[0]?.price ?? 100 };
    });
    if (seen.size > 100) fail('Maksimum 100 No Pancang bagi setiap tempahan.');
    const price = typeof competition.pricePerPeg === 'number' ? Math.max(0, competition.pricePerPeg) : selected[0].fallbackPrice;
    if (!Number.isFinite(price) || price < 0) fail('Harga pertandingan tidak sah.');
    const totalAmount = Math.round(seen.size * price * 100) / 100;
    const amount = payload.paymentType === 'deposit' ? Math.ceil(totalAmount * 0.5) : totalAmount;
    return { selections: selected.map(({ fallbackPrice, ...selection }) => selection), amount, totalAmount };
}
