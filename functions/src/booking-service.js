import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import admin from 'firebase-admin';
import { adminDb, verifyToken } from './auth-utils.js';
import { bookingPegs, bookingSelections, claimId, confirmed, fail, legacySeatIds, newBookingRef, occupiesSeats, ownsBooking, pondCatalog, receiptPath, receiptUpdate, refId, validateBookingWindow, validateSelections } from './booking-policy.js';
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
// Seat docs for just the requested peg numbers, in both pondId encodings.
const requestedSeatQueries = (db, pondDocId, nums) => {
    const queries = [];
    for (let i = 0; i < nums.length; i += 30) {
        const chunk = nums.slice(i, i + 30);
        for (const pondValue of [pondDocId, db.collection('ponds').doc(pondDocId)]) {
            queries.push(db.collection('seats').where('pondId', '==', pondValue).where('seatNumber', 'in', chunk));
        }
    }
    return queries;
};
const anySeatQueries = (db, pondDocId) => [pondDocId, db.collection('ponds').doc(pondDocId)]
    .map((pondValue) => db.collection('seats').where('pondId', '==', pondValue).limit(1));
// Written by scripts/backfill-seat-claims.mjs once every occupying booking has
// claim docs. Until then checkout keeps scanning the competition's bookings.
export const seatClaimsFlagRef = (db) => db.collection('systemFlags').doc('seatClaims');
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
    try { [metadata] = await bucket.file(path).getMetadata(); } catch { fail('Fail slip bayaran tidak dijumpai.'); }
    if (!(Number(metadata.size) > 0 && Number(metadata.size) <= 10 * 1024 * 1024)
        || !/^(image\/[^;]+|application\/pdf)$/.test(metadata.contentType || '')) fail('Format atau saiz fail slip bayaran tidak sah.');
    const token = new URL(url).searchParams.get('token');
    if (!token || !String(metadata.metadata?.firebaseStorageDownloadTokens || '').split(',').includes(token)) fail('Pautan slip bayaran tidak sah.');
};

// Cloudflare Turnstile bot check for customer bookings. Active only once the
// TURNSTILE_SECRET secret exists; staff bookings are exempt (the transaction
// still rejects non-staff who claim staff mode). If Cloudflare itself can't be
// reached we let the booking through rather than block a whole event day.
const verifyTurnstile = async (req) => {
    const secret = process.env.TURNSTILE_SECRET;
    if (!secret || req.body?.createdByStaff === true) return;
    const token = typeof req.body?.turnstileToken === 'string' ? req.body.turnstileToken : '';
    if (!token || token.length > 2048) fail('Pengesahan keselamatan diperlukan. Sila muat semula halaman dan cuba lagi. / Security check required, please reload and try again.', 403);
    let result;
    try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: new URLSearchParams({ secret, response: token }),
            signal: AbortSignal.timeout(5000),
        });
        result = await response.json();
    } catch (error) {
        console.warn('Turnstile verify unavailable, allowing booking:', error?.message || error);
        return;
    }
    if (!result?.success) {
        console.warn('Turnstile rejected booking:', result?.['error-codes']);
        fail('Pengesahan keselamatan gagal. Sila cuba lagi. / Security check failed, please try again.', 403);
    }
};

// Checkout and holds share these checks: role, booking window, ponds/seats,
// price, peg/pending limits and (legacy mode only) the competition scan.
async function loadSelection(tx, db, payload, user, { checkout }) {
    const compRef = db.collection('competitions').doc(payload.competitionId);
    const profile = await tx.get(db.collection('users').doc(user.uid));
    const role = normalizeRole(profile.data()?.role);
    const staffMode = payload.createdByStaff === true;
    if (staffMode && !STAFF_ROLES.has(role)) fail('Kebenaran petugas diperlukan.', 403);
    if (!staffMode && !user.email_verified && !STAFF_ROLES.has(role)) fail('Sila sahkan alamat e-mel anda.', 403);
    if (staffMode && !BOOKING_MANAGER_ROLES.has(role) && text(payload.userEmail) && payload.userEmail !== user.email) fail('Kebenaran staf kaunter diperlukan untuk tempahan bagi pihak pelanggan.', 403);
    if (checkout && (!text(payload.bookingPhone) || !text(payload.bankReference))) fail('Nombor telefon dan rujukan bank diperlukan.');
    const competitionSnap = await tx.get(compRef);
    const competition = competitionSnap.data();
    validateBookingWindow(competition);
    const pondIndex = (await tx.get(pondIndexQuery(db))).docs;
    const requestedGroups = Array.isArray(payload.pondSelections) ? payload.pondSelections : [];
    const requestedIds = new Set(requestedGroups.map((group) => group?.pondId));
    const wanted = pondCatalog(pondIndex, []).filter((pond) => requestedIds.has(pond.id));
    const wantedDocIds = wanted.map((pond) => pond.docId);
    const fullPonds = wantedDocIds.length ? await tx.getAll(...wantedDocIds.map((id) => db.collection('ponds').doc(id))) : [];
    const fullById = new Map(fullPonds.filter((snap) => snap.exists).map((snap) => [snap.id, snap]));
    // Claims mode: every occupying booking owns bookingSeatClaims docs, so the
    // per-peg claim reads below are the whole double-booking check and only the
    // requested seat docs are needed. Legacy mode scans the competition instead.
    const claimsMode = (await tx.get(seatClaimsFlagRef(db))).exists;
    let seatDocs;
    const partial = new Map();
    if (claimsMode) {
        seatDocs = [];
        for (const pond of wanted) {
            const nums = new Set(requestedGroups.filter((group) => group?.pondId === pond.id)
                .flatMap((group) => (Array.isArray(group.seats) ? group.seats : [])).filter(Number.isInteger));
            // validateSelections falls back to the lowest seat's price.
            if (typeof competition.pricePerPeg !== 'number') nums.add(1);
            if (nums.size > 101) fail('Maksimum 100 No Pancang bagi setiap tempahan.');
            const found = (await Promise.all(requestedSeatQueries(db, pond.docId, [...nums]).map((query) => tx.get(query)))).flatMap((snap) => snap.docs);
            const hasSeatDocs = found.length > 0
                || (await Promise.all(anySeatQueries(db, pond.docId).map((query) => tx.get(query)))).some((snap) => !snap.empty);
            seatDocs.push(...found);
            partial.set(pond.docId, hasSeatDocs);
        }
    } else {
        seatDocs = (await Promise.all(seatQueries(db, wantedDocIds).map((query) => tx.get(query)))).flatMap((snap) => snap.docs);
    }
    const ponds = pondCatalog(pondIndex.map((snap) => fullById.get(snap.id) || snap), seatDocs)
        .map((pond) => (partial.has(pond.docId) ? { ...pond, seatsPartial: true, hasSeatDocs: partial.get(pond.docId) } : pond));
    const { selections, amount, totalAmount } = validateSelections(payload, competition, ponds);
    const maxPegs = limitOf(competition.maxPegsPerBooking, DEFAULT_MAX_PEGS_PER_BOOKING);
    const pegCount = selections.reduce((sum, group) => sum + group.seats.length, 0);
    if (!staffMode && pegCount > maxPegs) fail(`Maksimum ${maxPegs} No Pancang bagi setiap tempahan.`);

    // Query both historical competitionId encodings. No backfill is required.
    const competitionBookings = claimsMode
        ? [
            ...(await tx.get(db.collection('bookings').where('userId', '==', user.uid).where('competitionId', '==', payload.competitionId))).docs,
            ...(await tx.get(db.collection('bookings').where('userId', '==', user.uid).where('competitionId', '==', compRef))).docs,
        ]
        : [
            ...(await tx.get(db.collection('bookings').where('competitionId', '==', payload.competitionId).where('status', 'in', OCCUPYING_STATUSES))).docs,
            ...(await tx.get(db.collection('bookings').where('competitionId', '==', compRef).where('status', 'in', OCCUPYING_STATUSES))).docs,
        ];
    if (!staffMode) {
        const maxPending = limitOf(competition.maxPendingBookingsPerUser, DEFAULT_MAX_PENDING_PER_USER);
        const mine = new Set(competitionBookings
            .filter((snap) => snap.data().userId === user.uid && PENDING_STATUSES.has(snap.data().status))
            .map((snap) => snap.id));
        if (mine.size >= maxPending) fail(`Anda mempunyai ${mine.size} tempahan yang belum disahkan untuk pertandingan ini. Sila tunggu pengesahan sebelum membuat tempahan baru. / You have reached the limit of ${maxPending} pending bookings.`, 429);
    }
    const occupied = new Set();
    if (!claimsMode) {
        competitionBookings.forEach((snap) => {
            if (!occupiesSeats(snap.data())) return;
            // Seats outside the requested ponds are not loaded; they cannot conflict anyway.
            bookingSelections(snap.data(), ponds, seatDocs).forEach((group) => group.seats.forEach((num) => occupied.add(`${group.pondId}:${num}`)));
        });
    }
    return { compRef, profile, staffMode, competition, selections, amount, totalAmount, occupied };
}

// Messages name the peg ("A-11") so the customer knows which one to swap.
const pegLabel = (group, num) => (group.pondCode ? `${String(group.pondCode).trim().toUpperCase()}-${num}` : `${num}`);
const PEG_TAKEN = (peg) => `No Pancang ${peg} telah ditempah. Sila pilih No Pancang lain. / Peg ${peg} is already booked. Please pick another peg.`;
const PEG_HELD = (peg) => `No Pancang ${peg} sedang ditahan oleh pelanggan lain yang sedang membuat bayaran. Sila pilih No Pancang lain atau cuba semula selepas 10 minit. / Peg ${peg} is on hold for another customer who is paying. Pick another peg or try again in 10 minutes.`;
const holdActive = (claim, now) => !claim.bookingId && !!claim.holdUid && (claim.holdExpiresAt?.toMillis?.() ?? new Date(claim.holdExpiresAt || 0).getTime()) > now;

// Claim refs for the selection, failing if a live booking or another
// customer's unexpired hold already has any of the pegs.
async function freePegRefs(tx, db, competitionId, selections, occupied, user, now) {
    const refs = [];
    for (const group of selections) {
        for (const num of group.seats) {
            if (occupied.has(`${group.pondId}:${num}`)) fail(PEG_TAKEN(pegLabel(group, num)), 409);
            const ref = db.collection('bookingSeatClaims').doc(claimId(competitionId, group.pondDocId, num));
            const claim = (await tx.get(ref)).data();
            if (claim?.bookingId) {
                const owner = await tx.get(db.collection('bookings').doc(claim.bookingId));
                if (owner.exists && occupiesSeats(owner.data())) fail(PEG_TAKEN(pegLabel(group, num)), 409);
            } else if (claim && holdActive(claim, now.getTime()) && claim.holdUid !== user.uid) {
                fail(PEG_HELD(pegLabel(group, num)), 409);
            }
            refs.push({ ref, pondId: group.pondId, num });
        }
    }
    return refs;
}

export const HOLD_MS = 10 * 60 * 1000;
// Same value the client computes with SubtleCrypto (sha256 of the uid, hex, first 16).
export const holderKey = (uid) => createHash('sha256').update(String(uid)).digest('hex').slice(0, 16);

// Holds the pegs for this customer for 10 minutes while they pay. One hold set
// per customer per competition: a new hold replaces their previous one.
export async function holdPegs(db, payload, user) {
    if (!validId(payload.competitionId)) fail('Pertandingan tidak sah.');
    return db.runTransaction(async (tx) => {
        const now = new Date();
        const { selections, occupied } = await loadSelection(tx, db, { ...payload, paymentType: 'full' }, user, { checkout: false });
        const pegs = await freePegRefs(tx, db, payload.competitionId, selections, occupied, user, now);
        const keep = new Set(pegs.map(({ ref }) => ref.id));
        const previous = (await tx.get(db.collection('bookingSeatClaims').where('holdUid', '==', user.uid))).docs
            .filter((claim) => claim.data().competitionId === payload.competitionId && !claim.data().bookingId && !keep.has(claim.id));
        const expiresAt = new Date(now.getTime() + HOLD_MS);
        previous.forEach((claim) => tx.delete(claim.ref));
        pegs.forEach(({ ref, pondId, num }) => tx.set(ref, {
            competitionId: payload.competitionId, pondId, seatNumber: num,
            holdUid: user.uid, holdExpiresAt: expiresAt, updatedAt: now,
        }));
        return { expiresAt: expiresAt.toISOString(), holdMs: HOLD_MS };
    });
}

export async function releaseHold(db, competitionId, user) {
    if (!validId(competitionId)) fail('Pertandingan tidak sah.');
    // Transactional so a hold that checkout just turned into a booking claim is never deleted.
    return db.runTransaction(async (tx) => {
        const held = (await tx.get(db.collection('bookingSeatClaims').where('holdUid', '==', user.uid))).docs
            .filter((claim) => claim.data().competitionId === competitionId && !claim.data().bookingId);
        held.forEach((claim) => tx.delete(claim.ref));
        return { released: held.length };
    });
}

export async function createSecureBooking(db, payload, user) {
    if (!validId(payload.competitionId)) fail('Pertandingan tidak sah.');
    const bookingDoc = db.collection('bookings').doc();
    const bookingRef = newBookingRef();
    const result = await db.runTransaction(async (tx) => {
        const now = new Date();
        const { profile, staffMode, competition, selections, amount, totalAmount, occupied } = await loadSelection(tx, db, payload, user, { checkout: true });
        // The buyer's own hold is taken over; anyone else's unexpired hold blocks.
        const claims = (await freePegRefs(tx, db, payload.competitionId, selections, occupied, user, now)).map(({ ref }) => ref);
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
    if (replace && !Number.isInteger(payload.receiptIndex)) fail('Indeks slip bayaran tidak sah.');
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

// Re-claims the pegs of a booking that became occupying outside checkout (rules
// and the approve/accept routes block that, so this only catches console or
// script edits). Never steals a peg another live booking holds; logs instead.
export async function ensureClaims(db, bookingId) {
    return db.runTransaction(async (tx) => {
        const bookingSnap = await tx.get(db.collection('bookings').doc(bookingId));
        const booking = bookingSnap.data();
        if (!bookingSnap.exists || !occupiesSeats(booking)) return { conflicts: [] };
        const pondIndex = (await tx.get(pondIndexQuery(db))).docs;
        const seatIds = legacySeatIds(booking);
        const seats = seatIds.length ? (await tx.getAll(...seatIds.map((id) => db.collection('seats').doc(id)))).filter((snap) => snap.exists) : [];
        const competitionId = refId(booking.competitionId);
        const pegs = bookingPegs(booking, pondCatalog(pondIndex, []), seats);
        const refs = pegs.map(({ pondDocId, num }) => db.collection('bookingSeatClaims').doc(claimId(competitionId, pondDocId, num)));
        const claims = refs.length ? await tx.getAll(...refs) : [];
        const wantedIds = new Set(refs.map((ref) => ref.id));
        const stale = (await tx.get(db.collection('bookingSeatClaims').where('bookingId', '==', bookingId))).docs
            .filter((claim) => !wantedIds.has(claim.id));
        const conflicts = [];
        const toWrite = [];
        for (let i = 0; i < claims.length; i += 1) {
            const owner = claims[i].exists ? claims[i].data().bookingId : null;
            if (owner === bookingId) continue;
            if (owner) {
                const ownerSnap = await tx.get(db.collection('bookings').doc(owner));
                if (ownerSnap.exists && occupiesSeats(ownerSnap.data())) { conflicts.push({ ...pegs[i], owner }); continue; }
            }
            toWrite.push(refs[i]);
        }
        const now = new Date();
        toWrite.forEach((ref) => tx.set(ref, { bookingId, competitionId, updatedAt: now }));
        stale.forEach((claim) => tx.delete(claim.ref));
        if (conflicts.length) console.error(`ensureClaims: booking ${bookingId} shares pegs with other live bookings`, conflicts);
        return { conflicts };
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
        const [bookings, pondIndex, holdSnap] = await Promise.all([
            adminDb.collection('bookings').where('status', 'in', OCCUPYING_STATUSES).get(),
            pondIndexQuery(adminDb).get(),
            adminDb.collection('bookingSeatClaims').where('holdExpiresAt', '>', new Date()).get(),
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
        // Pegs on hold, grouped per holder. `holder` is a one-way hash so the
        // holder's own page can skip its pegs without exposing who holds them.
        const holds = new Map();
        holdSnap.docs.map((snap) => snap.data()).filter((claim) => !claim.bookingId && claim.holdUid).forEach((claim) => {
            const holder = holderKey(claim.holdUid);
            const key = `${claim.competitionId}|${holder}`;
            if (!holds.has(key)) holds.set(key, { competitionId: claim.competitionId, holder, pegs: new Map() });
            const pegs = holds.get(key).pegs;
            if (!pegs.has(claim.pondId)) pegs.set(claim.pondId, []);
            pegs.get(claim.pondId).push(claim.seatNumber);
        });
        payload.holds = [...holds.values()].map(({ competitionId, holder, pegs }) => ({
            competitionId, holder, pondSelections: [...pegs].map(([pondId, seats]) => ({ pondId, seats })),
        }));
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
    app.post('/holdPegs', verifyToken, handle(async (req) => holdPegs(adminDb, req.body || {}, req.user)));
    app.post('/releaseHold', verifyToken, handle(async (req) => releaseHold(adminDb, req.body?.competitionId, req.user)));
    app.post('/createBooking', verifyToken, handle(async (req) => {
        await verifyTurnstile(req);
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
