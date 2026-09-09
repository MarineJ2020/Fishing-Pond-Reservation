import admin from 'firebase-admin';
import { adminDb, verifyToken } from './auth-utils.js';
import { bookingSelections, claimId, confirmed, fail, newBookingRef, occupiesSeats, ownsBooking, pondCatalog, receiptPath, receiptUpdate, refId, validateBookingWindow, validateSelections } from './booking-policy.js';

const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 150 && !value.includes('/');
const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const handle = (handler) => async (req, res) => {
    try { return res.json(await handler(req)); }
    catch (error) {
        if (!error.status) console.error('Booking service:', error);
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
        const role = String(profile.data()?.role || '').toUpperCase();
        const staffMode = payload.createdByStaff === true;
        if (staffMode && !['ADMIN', 'STAFF'].includes(role)) fail('Kebenaran petugas diperlukan.', 403);
        if (!staffMode && !user.email_verified && !['ADMIN', 'STAFF'].includes(role)) fail('Sila sahkan alamat e-mel anda.', 403);
        if (staffMode && role !== 'ADMIN' && text(payload.userEmail) && payload.userEmail !== user.email) fail('Kebenaran pentadbir diperlukan untuk tempahan bagi pihak pelanggan.', 403);
        if (!text(payload.bookingPhone) || !text(payload.bankReference)) fail('Nombor telefon dan rujukan bank diperlukan.');
        const competitionSnap = await tx.get(compRef);
        const competition = competitionSnap.data();
        validateBookingWindow(competition);
        const pondSnapshot = await tx.get(db.collection('ponds'));
        const seatSnapshot = await tx.get(db.collection('seats'));
        const ponds = pondCatalog(pondSnapshot.docs, seatSnapshot.docs);
        const { selections, amount, totalAmount } = validateSelections(payload, competition, ponds);

        // Query both historical encodings inside the transaction. No backfill is required.
        const legacyStrings = await tx.get(db.collection('bookings').where('competitionId', '==', payload.competitionId));
        const legacyRefs = await tx.get(db.collection('bookings').where('competitionId', '==', compRef));
        const occupied = new Set();
        [...legacyStrings.docs, ...legacyRefs.docs].forEach((snap) => {
            if (!occupiesSeats(snap.data())) return;
            bookingSelections(snap.data(), ponds, seatSnapshot.docs).forEach((group) => group.seats.forEach((num) => occupied.add(`${group.pondId}:${num}`)));
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
            competitionId: payload.competitionId, competitionName: competition.name || '',
            pondId: primary.pondId, pondCode: primary.pondCode,
            pondSelections: selections.map(({ pondDocId, ...selection }) => selection),
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
    app.get('/bookingAvailability', handle(async () => {
        const [bookings, ponds, seats] = await Promise.all([
            adminDb.collection('bookings').get(), adminDb.collection('ponds').get(), adminDb.collection('seats').get(),
        ]);
        const catalog = pondCatalog(ponds.docs, seats.docs);
        return { availability: bookings.docs.filter((snap) => occupiesSeats(snap.data())).map((snap) => {
            const booking = snap.data();
            const groups = bookingSelections(booking, catalog, seats.docs);
            return { competitionId: refId(booking.competitionId), status: confirmed(booking) ? 'confirmed' : 'pending', pondId: groups[0]?.pondId || 0, seats: groups[0]?.seats || [], pondSelections: groups };
        }) };
    }));
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
