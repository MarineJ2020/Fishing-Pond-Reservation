import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, getDownloadURL, deleteObject } from 'firebase/storage';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Run with the isolated Auth, Firestore and Storage emulators.');
const projectId = 'demo-kks-security';
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId, storageBucket: `${projectId}.appspot.com` });
const { adminDb, adminAuth } = await import('../../functions/src/auth-utils.js');
const { createSecureBooking, updateCustomerReceipt, registerBookingRoutes, releaseClaims, ensureClaims, seatClaimsFlagRef, holdPegs, releaseHold, holderKey } = await import('../../functions/src/booking-service.js');
const { execFileSync } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
const requireFunctions = createRequire(new URL('../../functions/src/index.js', import.meta.url));
const express = requireFunctions('express');
let server;
let baseUrl;
let env;
let owner;
let other;
let staff;
let admin;
let guest;
const firestoreClients = new WeakMap();
const firestoreFor = (context) => {
    if (!firestoreClients.has(context)) firestoreClients.set(context, context.firestore());
    return firestoreClients.get(context);
};
const user = { uid: 'owner', email: 'owner@example.com', email_verified: true };
const imageBytes = new Uint8Array([137, 80, 78, 71]);

before(async () => {
    for (const uid of ['owner', 'other', 'staff', 'admin']) await adminAuth.createUser({ uid, email: `${uid}@example.com`, password: 'Test123!secure', emailVerified: true });
    const app = express();
    app.use(express.json());
    registerBookingRoutes(app);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    env = await initializeTestEnvironment({ projectId,
        firestore: { rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') },
        storage: { rules: await readFile(new URL('../../storage.rules', import.meta.url), 'utf8') },
    });
    owner = env.authenticatedContext('owner', { email: user.email, email_verified: true });
    other = env.authenticatedContext('other', { email: 'other@example.com', email_verified: true });
    staff = env.authenticatedContext('staff', { email: 'staff@example.com', email_verified: true });
    admin = env.authenticatedContext('admin', { email: 'admin@example.com', email_verified: true });
    guest = env.unauthenticatedContext();
    await env.withSecurityRulesDisabled(async (context) => {
        const db = firestoreFor(context);
        for (const [uid, role] of [['owner', 'CLIENT'], ['other', 'CLIENT'], ['staff', 'STAFF'], ['admin', 'ADMIN']]) await setDoc(doc(db, 'users', uid), { role, email: `${uid}@example.com` });
        for (const [id, userId] of [['uid', 'owner'], ['email', user.email], ['reference', doc(db, 'users', 'owner')]]) {
            await setDoc(doc(db, 'bookings', id), { userId, userEmail: user.email, status: 'APPROVED', amount: 200, totalAmount: 200, paidAmount: 100, receipts: [{ url: 'legacy', amount: 100, status: 'accepted' }] });
        }
        await setDoc(doc(db, 'eventResults', 'winner'), { competitionId: 'past', anglerName: 'Winner', seatNum: 1, weight: 5 });
        await setDoc(doc(db, 'competitions', 'past'), { name: 'Past event' });
        await uploadBytes(ref(context.storage(), 'fishing-pond-receipts/legacy.jpg'), imageBytes, { contentType: 'image/jpeg' });
    });
});
after(async () => { await env?.cleanup(); await adminDb.terminate(); await new Promise((resolve) => server.close(resolve)); });

test('private booking reads: owner encodings, staff and admin succeed; anonymous and strangers fail', async () => {
    for (const id of ['uid', 'email', 'reference']) {
        for (const context of [owner, staff, admin]) await assertSucceeds(getDoc(doc(firestoreFor(context), 'bookings', id)));
        for (const context of [guest, other]) await assertFails(getDoc(doc(firestoreFor(context), 'bookings', id)));
    }
    await assertFails(getDocs(collection(firestoreFor(owner), 'bookings')));
    await assertSucceeds(getDocs(query(collection(firestoreFor(owner), 'bookings'), where('userId', '==', 'owner'))));
    await assertSucceeds(getDocs(query(collection(firestoreFor(owner), 'bookings'), where('userEmail', '==', user.email))));
    await assertSucceeds(getDocs(query(collection(firestoreFor(owner), 'bookings'), where('userId', '==', doc(firestoreFor(owner), 'users', 'owner')))));
    await assertSucceeds(getDocs(collection(firestoreFor(staff), 'bookings')));
});

test('user account list is admin-only while users can read their own profile', async () => {
    await assertSucceeds(getDoc(doc(firestoreFor(staff), 'users', 'staff')));
    await assertFails(getDoc(doc(firestoreFor(staff), 'users', 'owner')));
    await assertFails(getDocs(collection(firestoreFor(staff), 'users')));
    await assertSucceeds(getDocs(collection(firestoreFor(admin), 'users')));
});

test('forged creates and financial/receipt edits are denied, existing CMS checks remain allowed', async () => {
    for (const context of [owner, other, staff, admin]) await assertFails(setDoc(doc(firestoreFor(context), 'bookings', 'forged'), { userId: 'owner', userEmail: user.email, amount: 1, status: 'APPROVED' }));
    for (const update of [{ receipts: [{ amount: 9999, status: 'accepted' }] }, { paidAmount: 9999 }, { totalAmount: 1 }, { status: 'APPROVED' }, { receiptUrl: 'forged' }]) await assertFails(updateDoc(doc(firestoreFor(owner), 'bookings', 'uid'), update));
    await assertSucceeds(updateDoc(doc(firestoreFor(staff), 'bookings', 'uid'), { checkedIn: true, updatedBy: 'staff', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(firestoreFor(staff), 'bookings', 'uid'), {
        checkedIn: true,
        checkedInSeatKeys: ['legacy:1'],
        checkedInSeats: [1],
        checkedInAt: serverTimestamp(),
        checkedInSeatTimes: { 'legacy:1': new Date().toISOString() },
        paidAmount: 200,
        balanceDue: 0,
        paymentStatus: 'APPROVED',
        balanceStage: 'fully-paid',
        paymentType: 'full',
        updatedBy: 'staff',
        updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(collection(firestoreFor(staff), 'bookings', 'uid', 'payments')), {
        amount: 100,
        method: 'cash',
        type: 'manual-checkin-balance',
        recordedBy: 'staff',
        createdAt: serverTimestamp(),
    }));
    await assertFails(deleteDoc(doc(firestoreFor(staff), 'eventResults', 'winner')));
    await assertFails(deleteDoc(doc(firestoreFor(admin), 'eventResults', 'winner')));
    await assertFails(updateDoc(doc(firestoreFor(staff), 'eventResults', 'winner'), { deletedAt: serverTimestamp(), deletedBy: 'staff', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(firestoreFor(admin), 'eventResults', 'winner'), { deletedAt: serverTimestamp(), deletedBy: 'admin', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(firestoreFor(admin), 'bookings', 'uid'), { paymentStatus: 'PARTIAL' }));
    await assertFails(setDoc(doc(firestoreFor(owner), 'bookingSeatClaims', 'claim'), { bookingId: 'forged' }));
    await assertSucceeds(getDoc(doc(firestoreFor(guest), 'eventResults', 'winner')));
    await assertSucceeds(getDoc(doc(firestoreFor(guest), 'competitions', 'past')));
});

test('new receipts are scoped and immutable; staff review and old receipt previews work', async () => {
    const path = 'fishing-pond-receipts/owner/proof.jpg';
    await assertSucceeds(uploadBytes(ref(owner.storage(), path), imageBytes, { contentType: 'image/jpeg' }));
    for (const context of [owner, staff, admin]) await assertSucceeds(getBytes(ref(context.storage(), path)));
    for (const context of [other, guest]) await assertFails(getBytes(ref(context.storage(), path)));
    await assertFails(uploadBytes(ref(other.storage(), 'fishing-pond-receipts/owner/forged.jpg'), imageBytes, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(owner.storage(), path), imageBytes, { contentType: 'image/jpeg' }));
    await assertFails(deleteObject(ref(owner.storage(), path)));
    await assertFails(uploadBytes(ref(owner.storage(), 'fishing-pond-receipts/owner/script.html'), imageBytes, { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(owner.storage(), 'fishing-pond-receipts/new-legacy.jpg'), imageBytes, { contentType: 'image/jpeg' }));
    await assertSucceeds(getBytes(ref(staff.storage(), 'fishing-pond-receipts/legacy.jpg')));
    await assertSucceeds(getBytes(ref(owner.storage(), 'fishing-pond-receipts/legacy.jpg')));
});

const payload = { competitionId: 'open', paymentType: 'full', amount: 1, totalAmount: 1, pondId: 1, pondSelections: [{ pondId: 1, seats: [1] }], userEmail: 'forged@example.com', receiptUrl: 'test-proof', bookingPhone: '0123456789', bankReference: 'PAY123' };
test('server race: exactly one booking succeeds; authoritative price/identity win; rejected claims can be reused', async () => {
    await adminDb.collection('competitions').doc('open').set({ name: 'Open event', eventDate: new Date(Date.now() + 60000), endDate: new Date(Date.now() + 3600000), pricePerPeg: 101 });
    await adminDb.collection('ponds').doc('1').set({ name: 'Pond 1', totalSeats: 3, open: true });
    for (let num = 1; num <= 3; num++) await adminDb.collection('seats').doc(`seat-${num}`).set({ pondId: '1', seatNumber: num, price: 500 });
    const outcomes = await Promise.allSettled([createSecureBooking(adminDb, payload, user), createSecureBooking(adminDb, payload, { ...user, uid: 'other', email: 'other@example.com' })]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 1);
    const result = outcomes.find((outcome) => outcome.status === 'fulfilled').value;
    const bookingRef = adminDb.collection('bookings').doc(result.bookingId);
    const booking = (await bookingRef.get()).data();
    assert.equal(booking.amount, 101);
    assert.equal(booking.totalAmount, 101);
    assert.notEqual(booking.userEmail, 'forged@example.com');
    assert.equal(booking.status, 'PENDING_APPROVAL');
    await bookingRef.update({ status: 'REJECTED' });
    const replacement = await createSecureBooking(adminDb, payload, user);
    await releaseClaims(adminDb, result.bookingId);
    const claims = await adminDb.collection('bookingSeatClaims').where('bookingId', '==', replacement.bookingId).get();
    assert.equal(claims.size, 1, 'delayed cancellation must preserve the replacement claim');
    await releaseClaims(adminDb, replacement.bookingId);
    assert.equal((await claims.docs[0].ref.get()).exists, true, 'active bookings keep their claims');
    await adminDb.collection('bookings').doc(replacement.bookingId).update({ status: 'REJECTED' });
    await releaseClaims(adminDb, replacement.bookingId);
    assert.equal((await claims.docs[0].ref.get()).exists, false, 'rejected bookings release their claims');
});

test('legacy reservations still block duplicate pegs without changing old bookings', async () => {
    const legacy = { competitionId: adminDb.collection('competitions').doc('open'), pondId: 1, seatNumbers: [2], status: 'CONFIRMED', userId: user.email };
    const ref = adminDb.collection('bookings').doc('old-reservation');
    await ref.set(legacy);
    await assert.rejects(createSecureBooking(adminDb, { ...payload, pondSelections: [{ pondId: 1, seats: [2] }] }, user), { status: 409 });
    assert.deepEqual((await ref.get()).data(), legacy);
    await assert.rejects(createSecureBooking(adminDb, { ...payload, createdByStaff: true }, user), { status: 403 });
});

test('customer bookings respect per-competition peg and pending-booking limits; staff bookings do not', async () => {
    await adminDb.collection('competitions').doc('limits').set({ name: 'Limited event', eventDate: new Date(Date.now() + 60000), endDate: new Date(Date.now() + 3600000), pricePerPeg: 10, maxPegsPerBooking: 2, maxPendingBookingsPerUser: 1 });
    const limited = { ...payload, competitionId: 'limits', paymentType: 'full' };
    await assert.rejects(createSecureBooking(adminDb, { ...limited, pondSelections: [{ pondId: 1, seats: [1, 2, 3] }] }, user), /Maksimum 2/);
    await createSecureBooking(adminDb, { ...limited, pondSelections: [{ pondId: 1, seats: [1] }] }, user);
    await assert.rejects(createSecureBooking(adminDb, { ...limited, pondSelections: [{ pondId: 1, seats: [2] }] }, user), { status: 429 });
    await createSecureBooking(adminDb, { ...limited, pondSelections: [{ pondId: 1, seats: [2, 3] }] }, { ...user, uid: 'other', email: 'other@example.com' });
});

test('customer receipt transactions preserve approvals, reject foreign owners and serialize concurrent submissions', async () => {
    const bookingId = 'receipt-flow';
    const ref = adminDb.collection('bookings').doc(bookingId);
    await ref.set({ userId: 'owner', status: 'APPROVED', totalAmount: 200, paidAmount: 100, receipts: [{ url: 'accepted-proof', amount: 100, status: 'accepted' }] });
    await assert.rejects(updateCustomerReceipt(adminDb, { bookingId, receiptUrl: 'new', amount: 100 }, { ...user, uid: 'other', email: 'other@example.com' }), { status: 403 });
    await assert.rejects(updateCustomerReceipt(adminDb, { bookingId, receiptUrl: 'new', receiptIndex: 0 }, user, true), { status: 409 });
    await Promise.all([1, 2].map((num) => updateCustomerReceipt(adminDb, { bookingId, receiptUrl: `new-${num}`, amount: 50 }, user)));
    const booking = (await ref.get()).data();
    assert.equal(booking.receipts.length, 3);
    assert.deepEqual(booking.receipts[0], { url: 'accepted-proof', amount: 100, status: 'accepted' });
    assert.equal(booking.paidAmount, 100);
    assert.equal(booking.totalAmount, 200);
    assert.equal(booking.status, 'APPROVED');
    await assert.rejects(updateCustomerReceipt(adminDb, { bookingId, receiptUrl: 'extra', amount: 50 }, user), { status: 409 });
});

const tokenFor = async (identity) => {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${identity.uid}@example.com`, password: 'Test123!secure', returnSecureToken: true }),
    });
    const result = await response.json();
    assert.ok(result.idToken, JSON.stringify(result));
    return result.idToken;
};
const post = async (path, body, identity = user) => {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(identity ? { Authorization: `Bearer ${await tokenFor(identity)}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
};

test('HTTP booking and receipt flows validate real uploaded files, authentication, deposit balance and replacement', async () => {
    const storage = owner.storage(`gs://${projectId}.appspot.com`);
    const urls = [];
    for (let num = 0; num < 3; num++) {
        const file = ref(storage, `fishing-pond-receipts/owner/http-${num}.jpg`);
        await uploadBytes(file, imageBytes, { contentType: 'image/jpeg' });
        urls.push(await getDownloadURL(file));
    }
    const body = { ...payload, receiptUrl: urls[0], pondSelections: [{ pondId: 1, seats: [3] }] };
    assert.equal((await post('/createBooking', body, null)).status, 401);
    assert.equal((await post('/createBooking', { ...body, receiptUrl: urls[0].replace('/owner/', '/other/') }, { ...user, uid: 'other' })).status, 403);
    const created = await post('/createBooking', body);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const bookingId = created.body.bookingId;
    const bookingDoc = adminDb.collection('bookings').doc(bookingId);
    const original = (await bookingDoc.get()).data();
    await bookingDoc.update({ status: 'APPROVED', paidAmount: 51, receipts: [{ ...original.receipts[0], amount: 51, status: 'accepted' }] });
    assert.equal((await post('/submitBookingReceipt', { bookingId, receiptUrl: urls[1], amount: 50 })).status, 200);
    assert.equal((await post('/replaceBookingReceipt', { bookingId, receiptUrl: urls[2], receiptIndex: 0 })).status, 409);
    const current = (await bookingDoc.get()).data();
    await bookingDoc.update({ receipts: [current.receipts[0], { ...current.receipts[1], status: 'rejected' }] });
    assert.equal((await post('/replaceBookingReceipt', { bookingId, receiptUrl: urls[2], receiptIndex: 1 })).status, 200);
    const updated = (await bookingDoc.get()).data();
    assert.equal(updated.receipts[0].url, urls[0]);
    assert.equal(updated.receipts[0].status, 'accepted');
    assert.equal(updated.receipts[1].status, 'pending');
    assert.equal(updated.paidAmount, 51);
    assert.equal(updated.totalAmount, 101);
});

test('public availability endpoint exposes only non-sensitive seat occupancy', async () => {
    const response = await fetch(`${baseUrl}/bookingAvailability`);
    assert.equal(response.status, 200);
    const { availability } = await response.json();
    assert.ok(availability.some((entry) => entry.competitionId === 'open' && entry.seats.includes(3)));
    for (const entry of availability) {
        assert.deepEqual(Object.keys(entry).sort(), ['competitionId', 'pondId', 'pondSelections', 'seats', 'status'].sort());
        for (const group of entry.pondSelections) assert.deepEqual(Object.keys(group).sort(), ['pondId', 'seats']);
    }
    assert.equal(JSON.stringify(availability).includes('owner@example.com'), false);
    assert.equal(JSON.stringify(availability).includes('test-proof'), false);
});

// Runs last: switches checkout to claim mode via the real backfill script.
test('claim mode: backfill protects old bookings, concurrent checkouts never double-book, revivals are blocked', async () => {
    const comp = { name: 'Claims event', eventDate: new Date(Date.now() + 60000), endDate: new Date(Date.now() + 3600000), pricePerPeg: 20, pondSeats: { 2: 4 } };
    await adminDb.collection('competitions').doc('claims').set(comp);
    await adminDb.collection('ponds').doc('2').set({ name: 'Pond 2', totalSeats: 5, open: true });
    for (let num = 1; num <= 5; num++) await adminDb.collection('seats').doc(`p2-seat-${num}`).set({ pondId: '2', seatNumber: num, price: 20 });
    const full = { ...payload, competitionId: 'claims', pondId: 2 };
    const peg = (seats) => ({ ...full, pondSelections: [{ pondId: 2, seats }] });
    const customer = (n) => ({ uid: `buyer-${n}`, email: `buyer-${n}@example.com`, email_verified: true });
    // Pre-claim bookings: one with numbers, one legacy seatIds-only, one rejected.
    await adminDb.collection('bookings').doc('old-numbers').set({ competitionId: adminDb.collection('competitions').doc('claims'), pondId: 2, seatNumbers: [1], status: 'CONFIRMED', userId: 'x' });
    await adminDb.collection('bookings').doc('old-seatids').set({ competitionId: 'claims', pondId: '2', seatIds: ['p2-seat-2'], status: 'pending', userId: 'y' });
    await adminDb.collection('bookings').doc('old-rejected').set({ competitionId: 'claims', pondId: 2, seatNumbers: [3], status: 'REJECTED', userId: 'z' });

    const script = new URL('../../scripts/backfill-seat-claims.mjs', import.meta.url);
    const dry = execFileSync(process.execPath, [fileURLToPath(script)], { encoding: 'utf8', env: { ...process.env, FIREBASE_PROJECT_ID: projectId } });
    assert.match(dry, /DRY RUN/);
    assert.equal((await seatClaimsFlagRef(adminDb).get()).exists, false, 'dry run must not enable claim mode');
    execFileSync(process.execPath, [fileURLToPath(script), '--confirm'], { encoding: 'utf8', env: { ...process.env, FIREBASE_PROJECT_ID: projectId } });
    assert.equal((await seatClaimsFlagRef(adminDb).get()).exists, true);

    // Old bookings block their pegs through the backfilled claims; the rejected one does not.
    await assert.rejects(createSecureBooking(adminDb, peg([1]), customer(1)), { status: 409 });
    await assert.rejects(createSecureBooking(adminDb, peg([2]), customer(1)), { status: 409 });
    await createSecureBooking(adminDb, peg([3]), customer(1));

    // Eight buyers race for peg 4: exactly one wins.
    const race = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => createSecureBooking(adminDb, peg([4]), customer(10 + n))));
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(race.map((r) => r.reason?.message)));
    // Overlapping multi-peg bookings: at most one of [3,4] / [4] style overlaps can win.
    await assert.rejects(createSecureBooking(adminDb, peg([3, 4]), customer(30)), { status: 409 });
    // Cap 4 from pondSeats and missing seat docs still reject.
    await assert.rejects(createSecureBooking(adminDb, peg([5]), customer(31)), /tidak tersedia/);
    await assert.rejects(createSecureBooking(adminDb, peg([9]), customer(31)), /tidak tersedia/);
    // Pending limit still counts the buyer's own bookings.
    await adminDb.collection('competitions').doc('claims').update({ maxPendingBookingsPerUser: 1, pondSeats: { 2: 5 } });
    await assert.rejects(createSecureBooking(adminDb, peg([5]), customer(1)), { status: 429 });

    // Only one booking per peg is live.
    const live = (await adminDb.collection('bookings').where('competitionId', '==', 'claims').get()).docs
        .filter((d) => ['PENDING_APPROVAL', 'APPROVED', 'CONFIRMED', 'pending'].includes(d.data().status));
    const pegs = live.flatMap((d) => (d.data().pondSelections || []).flatMap((g) => g.seats));
    assert.equal(new Set(pegs).size, pegs.length);

    // Clients cannot revive a cancelled booking or move pegs; cancelling still works.
    const winner = live.find((d) => d.data().pondSelections?.[0]?.seats.includes(4));
    await assertSucceeds(updateDoc(doc(firestoreFor(admin), 'bookings', winner.id), { status: 'REJECTED' }));
    await releaseClaims(adminDb, winner.id);
    await assertFails(updateDoc(doc(firestoreFor(admin), 'bookings', winner.id), { status: 'APPROVED' }));
    await assertFails(updateDoc(doc(firestoreFor(admin), 'bookings', 'old-seatids'), { pondSelections: [{ pondId: 2, seats: [5] }] }));
    await assertSucceeds(updateDoc(doc(firestoreFor(admin), 'bookings', 'old-seatids'), { staffNotes: 'still editable' }));

    // A revival by trusted code re-claims only free pegs and never steals one.
    const resold = await createSecureBooking(adminDb, peg([4]), customer(40));
    await adminDb.collection('bookings').doc(winner.id).update({ status: 'APPROVED' });
    assert.equal((await ensureClaims(adminDb, winner.id)).conflicts.length, 1);
    await assert.rejects(createSecureBooking(adminDb, peg([4]), customer(41)), { status: 409 });
    const claim = (await adminDb.collection('bookingSeatClaims').where('bookingId', '==', resold.bookingId).get()).size;
    assert.equal(claim, 1, 'the resold booking keeps its claim');
    await adminDb.collection('bookings').doc('old-rejected').update({ status: 'APPROVED' });
    assert.equal((await ensureClaims(adminDb, 'old-rejected')).conflicts.length, 1, 'peg 3 was rebooked after rejection');
    await seatClaimsFlagRef(adminDb).delete();
});

test('10-minute peg holds: block other buyers, let the holder book, replace, release and expire', async () => {
    await adminDb.collection('competitions').doc('holds').set({ name: 'Hold event', eventDate: new Date(Date.now() + 60000), endDate: new Date(Date.now() + 3600000), pricePerPeg: 20 });
    const sel = (seats) => ({ ...payload, competitionId: 'holds', pondId: 2, pondSelections: [{ pondId: 2, seats }] });
    const buyer = (name) => ({ uid: `hold-${name}`, email: `hold-${name}@example.com`, email_verified: true });
    const [a, b, c] = ['a', 'b', 'c'].map(buyer);
    const { claimId } = await import('../../functions/src/booking-policy.js');
    const claimFor = (num) => adminDb.collection('bookingSeatClaims').doc(claimId('holds', '2', num)).get();

    const held = await holdPegs(adminDb, sel([1]), a);
    assert.ok(Date.parse(held.expiresAt) - Date.now() > 9 * 60 * 1000);
    await assert.rejects(createSecureBooking(adminDb, sel([1]), b), /ditahan/);
    await assert.rejects(holdPegs(adminDb, sel([1]), b), /ditahan/);
    const booked = await createSecureBooking(adminDb, sel([1]), a);
    assert.equal((await claimFor(1)).data().bookingId, booked.bookingId);
    assert.equal((await claimFor(1)).data().holdUid, undefined, 'booking replaces the hold');
    await assert.rejects(holdPegs(adminDb, sel([1]), b), { status: 409 });

    // A new hold replaces the previous one; release frees it; unverified buyers cannot hold.
    await holdPegs(adminDb, sel([2]), a);
    await holdPegs(adminDb, sel([3]), a);
    await holdPegs(adminDb, sel([2]), b);
    await assert.rejects(holdPegs(adminDb, sel([3]), b), /ditahan/);
    assert.equal((await releaseHold(adminDb, 'holds', a)).released, 1);
    await holdPegs(adminDb, sel([2, 3]), b);
    await assert.rejects(holdPegs(adminDb, sel([4]), { ...c, email_verified: false }), { status: 403 });

    // Expired holds no longer block.
    await (await claimFor(3)).ref.update({ holdExpiresAt: new Date(Date.now() - 1000) });
    await createSecureBooking(adminDb, sel([3]), c);
    // Releasing after checkout never drops the booking's claim.
    await holdPegs(adminDb, sel([4]), c);
    const own = await createSecureBooking(adminDb, sel([4]), c);
    await releaseHold(adminDb, 'holds', c);
    assert.equal((await claimFor(4)).data().bookingId, own.bookingId);

    // HTTP routes need a signed-in user; the public feed lists holds without identities.
    const hold = await post('/holdPegs', sel([5]), { uid: 'owner' });
    assert.equal(hold.status, 200, JSON.stringify(hold.body));
    assert.equal((await post('/holdPegs', sel([5]), null)).status, 401);
    await new Promise((resolve) => setTimeout(resolve, 15500)); // availability is cached for 15 s
    const feed = await (await fetch(`${baseUrl}/bookingAvailability`)).json();
    const mine = feed.holds.find((h) => h.competitionId === 'holds' && h.holder === holderKey('owner'));
    assert.deepEqual(mine?.pondSelections, [{ pondId: 2, seats: [5] }]);
    assert.ok(feed.holds.some((h) => h.holder === holderKey(b.uid) && h.pondSelections[0].seats.includes(2)));
    assert.equal(/hold-|owner@|holdUid/.test(JSON.stringify(feed.holds)), false);
    assert.equal((await post('/releaseHold', { competitionId: 'holds' }, { uid: 'owner' })).status, 200);
});
