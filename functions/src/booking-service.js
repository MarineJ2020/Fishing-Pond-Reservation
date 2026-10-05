import { gzipSync } from 'node:zlib';
import admin from 'firebase-admin';
import { adminDb, verifyToken } from './auth-utils.js';
import { bookingSelections, claimId, confirmed, fail, legacySeatIds, newBookingRef, occupiesSeats, ownsBooking, pondCatalog, receiptPath, receiptUpdate, refId, validateBookingWindow, validateSelections } from './booking-policy.js';
import { BOOKING_MANAGER_ROLES, STAFF_ROLES, normalizeRole } from './role-policy.js';

const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 150 && !value.includes('/');
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const OCCUPYING_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'CONFIRMED', 'LIVE', 'pending', 'confirmed'];
const PENDING_STATUSES = new Set(['PENDING_APPROVAL', 'pending']);
// Anti-hoarding defaults for customer bookings; admins override per competition in CMS.
export const DEFAULT_MAX_PEGS_PER_BOOKING = 20;
export const DEFAULT_MAX_PENDING_PER_USER = 10;
const limitOf = (value, fallback) => (Number.isInteger(value) && value > 0 ? value : fallback);
const AVAILABILITY_CACHE_MS = 15 * 1000;
const AVAILABILITY_CACHE_CONTROL = 'public, max-age=5, s-maxage=10';
// Pond docs carry a ~65 KB seatLayout each; the CDN serves them to crowds and
// browsers always revalidate against it, so CMS edits show within a minute.
const PONDS_CACHE_CONTROL = 'public, max-age=0, s-maxage=60';

// Firestore values -> plain JSON the client's normalizers accept (ISO dates).
const toPlain = (value) => {
    if (value === null || typeof value !== 'object') return value;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value.path === 'string' && value.firestore) return value.path;
    if (Array.isArray(value)) return value.map(toPlain);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlain(item)]));
};
let availabilityCache = null;
// Each pond has hundreds of seat docs (and a matching seatLayout), so never read
// the whole seats collection or full pond docs when only a few ponds matter.
// select() keeps pond order, which pondCatalog uses for non-numeric pond ids.
const pondIndexQuery = (db) => db.collection('ponds').select();
const seatQueries = (db, pondDocIds) => {
    const queries = [];
    // Match string and reference encodings; 'in' takes at most 30 values.
    for (let i = 0; i < pondDocIds.length; i += 15) {
        const values = pondDocIds.slice(i, i + 15).flatMap((id) => [id, db.collection('ponds').doc(id)]);
        queries.push(db.collection('seats').where('pondId', 'in', values));
    }
    return queries;
};
const handle = (handler) => async (req, res) => {
    try { return res.json(await handler(req)); }
    catch (error) {
        if (!error.status) console.error('Booking service:', error);
        res.set('Cache-Control', 'no-store');
        return res.status(error.status || 500).json({ error: error.status ? error.message : 'Tempahan tidak dapat diproses. Sila cuba lagi.' });
    }
};

const validateReceipt = async (url, uid) => {
    const bucket = admin.storage().bucket();
    const path = receiptPath(url, uid, bucket.name, process.env.FIREBASE_STORAGE_EMULATOR_HOST);
    let metadata;
    try { [metadata] = await bucket.file(path).getMetadata(); } catch { fail('Fail resit tidak dijumpai.'); }
    if (!(Number(metadata.size) > 0 && Number(metadata.size) <= 10 * 1024 * 1024)
        || !/^(image\/[^;]+|application\/pdf)$/.test(metadata.contentType || '')) fail('Format atau saiz fail resit tidak sah.');
    const token = new URL(url).searchParams.get('token');
    if (!token || !String(metadata.metadata?.firebaseStorageDownloadTokens || '').split(',').includes(token)) fail('Pautan resit tidak sah.');
};

export async function createSecureBooking(db, payload, user) {
    if (!validId(payload.competitionId)) fail('Pertandingan tidak sah.');
    const bookingDoc = db.collection('bookings').doc();
    const bookingRef = newBookingRef();
    const result = await db.runTransaction(async (tx) => {
        const compRef = db.collection('competitions').doc(payload.competitionId);
        const profile = await tx.get(db.collection('users').doc(user.uid));
        const role = normalizeRole(profile.data()?.role);
        const staffMode = payload.createdByStaff === true;
        if (staffMode && !STAFF_ROLES.has(role)) fail('Kebenaran petugas diperlukan.', 403);
        if (!staffMode && !user.email_verified && !STAFF_ROLES.has(role)) fail('Sila sahkan alamat e-mel anda.', 403);
        if (staffMode && !BOOKING_MANAGER_ROLES.has(role) && text(payload.userEmail) && payload.userEmail !== user.email) fail('Kebenaran staf kaunter diperlukan untuk tempahan bagi pihak pelanggan.', 403);
        if (!text(payload.bookingPhone) || !text(payload.bankReference)) fail('Nombor telefon dan rujukan bank diperlukan.');
        const competitionSnap = await tx.get(compRef);
        const competition = competitionSnap.data();
        validateBookingWindow(competition);
        const pondIndex = (await tx.get(pondIndexQuery(db))).docs;
        const requestedIds = new Set((Array.isArray(payload.pondSelections) ? payload.pondSelections : []).map((group) => group?.pondId));
        const wantedDocIds = pondCatalog(pondIndex, []).filter((pond) => requestedIds.has(pond.id)).map((pond) => pond.docId);
        const fullPonds = wantedDocIds.length ? await tx.getAll(...wantedDocIds.map((id) => db.collection('ponds').doc(id))) : [];
        const seatDocs = (await Promise.all(seatQueries(db, wantedDocIds).map((query) => tx.get(query)))).flatMap((snap) => snap.docs);
        const fullById = new Map(fullPonds.filter((snap) => snap.exists).map((snap) => [snap.id, snap]));
        const ponds = pondCatalog(pondIndex.map((snap) => fullById.get(snap.id) || snap), seatDocs);
        const { selections, amount, totalAmount } = validateSelections(payload, competition, ponds);
        const maxPegs = limitOf(competition.maxPegsPerBooking, DEFAULT_MAX_PEGS_PER_BOOKING);
        const pegCount = selections.reduce((sum, group) => sum + group.seats.length, 0);
        if (!staffMode && pegCount > maxPegs) fail(`Maksimum ${maxPegs} No Pancang bagi setiap tempahan.`);

        // Query both historical encodings inside the transaction. No backfill is required.
        const legacyStrings = await tx.get(db.collection('bookings').where('competitionId', '==', payload.competitionId).where('status', 'in', OCCUPYING_STATUSES));
        const legacyRefs = await tx.get(db.collection('bookings').where('competitionId', '==', compRef).where('status', 'in', OCCUPYING_STATUSES));
        if (!staffMode) {
            // Counted from the occupying bookings already read above, so no extra reads.
            const maxPending = limitOf(competition.maxPendingBookingsPerUser, DEFAULT_MAX_PENDING_PER_USER);
            const mine = new Set([...legacyStrings.docs, ...legacyRefs.docs]
                .filter((snap) => snap.data().userId === user.uid && PENDING_STATUSES.has(snap.data().status))
                .map((snap) => snap.id));
            if (mine.size >= maxPending) fail(`Anda mempunyai ${mine.size} tempahan yang belum disahkan untuk pertandingan ini. Sila tunggu pengesahan sebelum membuat tempahan baru. / You have reached the limit of ${maxPending} pending bookings.`, 429);
        }
        const occupied = new Set();
        [...legacyStrings.docs, ...legacyRefs.docs].forEach((snap) => {
            if (!occupiesSeats(snap.data())) return;
            // Seats outside the requested ponds are not loaded; they cannot conflict anyway.
            bookingSelections(snap.data(), ponds, seatDocs).forEach((group) => group.seats.forEach((num) => occupied.add(`${group.pondId}:${num}`)));
        });
        const claims = [];
        for (const group of selections) {
            for (const num of group.seats) {
                if (occupied.has(`${group.pondId}:${num}`)) fail('No Pancang telah ditempah. Sila pilih No Pancang lain.', 409);
                const ref = db.collection('bookingSeatClaims').doc(claimId(payload.competitionId, group.pondDocId, num));
                const claim = await tx.get(ref);
                if (claim.exists && claim.data().bookingId) {
                    const owner = await tx.get(db.collection('bookings').doc(claim.data().bookingId));
                    if (owner.exists && occupiesSeats(owner.data())) fail('No Pancang telah ditempah. Sila pilih No Pancang lain.', 409);
                }
                claims.push(ref);
            }
        }
        const now = new Date();
        const primary = selections.find((s) => s.pondId === payload.pondId) || selections[0];
        const paidAmount = staffMode ? amount : 0;
        const balanceDue = Math.max(0, totalAmount - paidAmount);
        const status = staffMode ? 'APPROVED' : 'PENDING_APPROVAL';
        const booking = {
            bookingRef, userId: staffMode ? (text(payload.userEmail) || user.uid) : user.uid,
            userEmail: staffMode ? text(payload.userEmail) : (user.email || ''),
            userName: text(payload.userName) || text(profile.data()?.name) || text(user.name),
            userPhone: text(payload.userPhone), bookingPhone: text(payload.bookingPhone),
            createdByUid: staffMode ? user.uid : null, createdByStaff: staffMode,
            // Name at booking time, for the CMS activity log and "Ditempah oleh" badge.
            createdByName: staffMode ? (text(profile.data()?.name) || text(user.name) || text(user.email)) : null,
            competitionId: payload.competitionId, competitionName: competition.name || '',
            pondId: primary.pondId, pondCode: primary.pondCode,
            pondSelections: selections.map(({ pondDocId: _pondDocId, ...selection }) => selection),
            seatIds: selections.flatMap((s) => s.seatIds), seatNumbers: primary.seats,
            paymentType: payload.paymentType, amount, totalAmount, paidAmount, balanceDue,
            paymentStatus: staffMode ? (balanceDue > 0 ? 'PARTIAL' : 'APPROVED') : 'PENDING_APPROVAL',
            ...(staffMode ? { balanceStage: balanceDue > 0 ? 'pending-balance' : 'fully-paid' } : {}),
            receiptUrl: payload.receiptUrl, bankReference: text(payload.bankReference, 120),
            receipts: [{ url: payload.receiptUrl, amount, status: staffMode ? 'accepted' : 'pending', submittedAt: now }],
            staffNotes: text(payload.notes, 2000), checkedIn: false, status,
            createdAt: now, updatedAt: now, updatedBy: user.uid,
        };
        tx.create(bookingDoc, booking);
        claims.forEach((ref) => tx.set(ref, { bookingId: bookingDoc.id, competitionId: payload.competitionId, updatedAt: now }));
        if (staffMode) tx.create(bookingDoc.collection('payments').doc(), { amount, type: payload.paymentType, method: 'receipt', recordedBy: user.uid, createdAt: now });
        return { bookingId: bookingDoc.id, bookingRef, status: staffMode ? 'confirmed' : 'pending', amount, totalAmount };
    });
    return result;
}

export async function updateCustomerReceipt(db, payload, user, replace = false) {
    if (!validId(payload.bookingId)) fail('Tempahan tidak sah.');
    if (replace && !Number.isInteger(payload.receiptIndex)) fail('Indeks resit tidak sah.');
    return db.runTransaction(async (tx) => {
        const ref = db.collection('bookings').doc(payload.bookingId);
        const snap = await tx.get(ref);
        if (!snap.exists) fail('Tempahan tidak dijumpai.', 404);
        if (!ownsBooking(snap.data(), user)) fail('Tempahan bukan milik akaun ini.', 403);
        const update = receiptUpdate(snap.data(), {
            receiptUrl: payload.receiptUrl, amount: payload.amount, bankReference: payload.bankReference,
            ...(replace ? { receiptIndex: payload.receiptIndex } : {}),
        });
        tx.update(ref, { ...update, updatedBy: user.uid });
        return { receipts: update.receipts };
    });
}

export async function releaseClaims(db, bookingId) {
    await db.runTransaction(async (tx) => {
        const booking = await tx.get(db.collection('bookings').doc(bookingId));
        if (booking.exists && occupiesSeats(booking.data())) return;
        const claims = await tx.get(db.collection('bookingSeatClaims').where('bookingId', '==', bookingId));
        claims.docs.forEach((claim) => tx.delete(claim.ref));
    });
}

export function registerBookingRoutes(app) {
    app.get('/bookingAvailability', (_req, res, next) => {
        // Lets the Hosting CDN answer event-day crowds; seat conflicts are still
        // re-checked inside the createBooking transaction.
        res.set('Cache-Control', AVAILABILITY_CACHE_CONTROL);
        next();
    }, handle(async () => {
        if (availabilityCache && Date.now() - availabilityCache.createdAt < AVAILABILITY_CACHE_MS) {
            return availabilityCache.payload;
        }
        const [bookings, pondIndex] = await Promise.all([
            adminDb.collection('bookings').where('status', 'in', OCCUPYING_STATUSES).get(),
            pondIndexQuery(adminDb).get(),
        ]);
        const occupying = bookings.docs.filter((snap) => occupiesSeats(snap.data()));
        const seatIds = [...new Set(occupying.flatMap((snap) => legacySeatIds(snap.data())))];
        const seats = seatIds.length
            ? (await adminDb.getAll(...seatIds.map((id) => adminDb.collection('seats').doc(id)))).filter((snap) => snap.exists)
            : [];
        const catalog = pondCatalog(pondIndex.docs, []);
        const payload = { availability: occupying.map((snap) => {
            const booking = snap.data();
            const groups = bookingSelections(booking, catalog, seats);
            return { competitionId: refId(booking.competitionId), status: confirmed(booking) ? 'confirmed' : 'pending', pondId: groups[0]?.pondId || 0, seats: groups[0]?.seats || [], pondSelections: groups };
        }) };
        availabilityCache = { createdAt: Date.now(), payload };
        return payload;
    }));
    // Same documents (and default doc-id order) the client used to read directly.
    // Gzipped here because Hosting does not compress function responses (~245 KB raw).
    app.get('/publicPonds', async (req, res) => {
        try {
            const snapshot = await adminDb.collection('ponds').get();
            const body = JSON.stringify({ ponds: snapshot.docs.map((snap) => ({ id: snap.id, data: toPlain(snap.data()) })) });
            res.set('Cache-Control', PONDS_CACHE_CONTROL);
            res.set('Vary', 'Accept-Encoding');
            res.type('json');
            if (!req.acceptsEncodings('gzip')) return res.send(body);
            res.set('Content-Encoding', 'gzip');
            return res.send(gzipSync(body));
        } catch (error) {
            console.error('Booking service:', error);
            res.set('Cache-Control', 'no-store');
            return res.status(500).json({ error: 'Tempahan tidak dapat diproses. Sila cuba lagi.' });
        }
    });
    app.post('/createBooking', verifyToken, handle(async (req) => {
        await validateReceipt(req.body.receiptUrl, req.user.uid);
        return createSecureBooking(adminDb, req.body, req.user);
    }));
    for (const [route, replace] of [['/submitBookingReceipt', false], ['/replaceBookingReceipt', true]]) {
        app.post(route, verifyToken, handle(async (req) => {
            await validateReceipt(req.body.receiptUrl, req.user.uid);
            return updateCustomerReceipt(adminDb, req.body, req.user, replace);
        }));
    }
}
