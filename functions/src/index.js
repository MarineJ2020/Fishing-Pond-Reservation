import express from 'express';
import cors from 'cors';
import * as functions from 'firebase-functions';
import { adminAuth, adminDb, verifyToken, requireStaff, requireAdmin } from './auth-utils.js';
import {
    initialBookingEmailKind,
    isConfirmedStatus,
    queueBalanceReminderMail,
    queueBookingLifecycleMail,
    queuePasswordResetMail,
    queueVerificationMail,
    queueWelcomeMail,
    shouldQueueBookingApprovedEmail,
} from './email-service.js';
import { buildCancelCheckInState, buildCheckInState } from './booking-seats.js';
import { ALLOWED_ROLES, normalizeRole, roleChangeBlockReason } from './role-policy.js';
import { registerBookingRoutes, releaseClaims } from './booking-service.js';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
registerBookingRoutes(app);

const randomTempPassword = () => Math.random().toString(36).slice(2, 10) + '!1A';
const syncAuthRoleClaim = async (uid, rawRole) => {
    const nextRole = normalizeRole(rawRole);
    const userRecord = await adminAuth.getUser(uid);
    const existingClaims = userRecord.customClaims || {};
    if (existingClaims.role === nextRole) {
        return { updated: false, role: nextRole };
    }

    await adminAuth.setCustomUserClaims(uid, {
        ...existingClaims,
        role: nextRole,
    });
    return { updated: true, role: nextRole };
};


const sumAccepted = (receipts) =>
    (Array.isArray(receipts) ? receipts : [])
        .filter((r) => r?.status === 'accepted')
        .reduce((sum, r) => sum + (Number(r?.amount) || 0), 0);

const paidAmountForBooking = (booking) => {
    if (typeof booking?.paidAmount === 'number') return booking.paidAmount;
    const receipts = Array.isArray(booking?.receipts) ? booking.receipts : [];
    if (receipts.length) return sumAccepted(receipts);
    // Legacy/direct staff bookings store only receiptUrl + amount.
    return booking?.receiptUrl && isConfirmedStatus(booking.status)
        ? (Number(booking.amount) || 0)
        : 0;
};

// Mirrors computeBalanceStage in src/lib/firestore.ts — kept in sync manually
// since this endpoint currently isn't the live path (VITE_FUNCTIONS_BASE_URL
// is empty in this deployment) but should stay correct for when it is used.
const computeBalanceStage = (paidAmount, totalAmount, hasPendingReceipts) => {
    const balanceDue = Math.max(0, (Number(totalAmount) || 0) - (Number(paidAmount) || 0));
    if (balanceDue <= 0) return 'fully-paid';
    return hasPendingReceipts ? 'review-balance' : 'pending-balance';
};


const updateSeatsForBooking = async (bookingData, nextSeatStatus) => {
    const seatRefs = Array.isArray(bookingData?.seatIds)
        ? bookingData.seatIds.filter((ref) => ref && typeof ref.path === 'string')
        : [];

    if (!seatRefs.length) return;

    const batch = adminDb.batch();
    seatRefs.forEach((seatRef) => {
        batch.set(seatRef, {
            status: nextSeatStatus,
            updatedAt: new Date(),
        }, { merge: true });
    });
    await batch.commit();
};


const assertSeatsNotBooked = async ({ seatIds, competitionId }) => {
    const checks = await Promise.all(seatIds.map(async (seatId) => {
        const existing = await adminDb.collection('bookings')
            .where('competitionId', '==', adminDb.doc(`competitions/${competitionId}`))
            .where('seatIds', 'array-contains', adminDb.doc(`seats/${seatId}`))
            .where('status', 'in', ['PENDING_APPROVAL', 'APPROVED', 'CONFIRMED', 'LIVE'])
            .limit(1)
            .get();

        return { seatId, isBooked: !existing.empty };
    }));

    const conflicts = checks.filter((item) => item.isBooked).map((item) => item.seatId);
    return { ok: conflicts.length === 0, conflicts };
};

app.post('/createClientAccount', verifyToken, requireAdmin, async (req, res) => {
    const { name, email, phone } = req.body;
    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required.' });
    }

    try {
        let userRecord;
        try {
            userRecord = await adminAuth.getUserByEmail(email);
        } catch {
            const password = randomTempPassword();
            userRecord = await adminAuth.createUser({ email, password, displayName: name });
            await adminAuth.setCustomUserClaims(userRecord.uid, { role: 'CLIENT' });
        }

        await adminDb.collection('users').doc(userRecord.uid).set({
            email,
            name,
            phone: phone || '',
            role: 'CLIENT',
            createdAt: new Date(),
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        }, { merge: true });

        return res.json({ success: true, uid: userRecord.uid });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to create client account.' });
    }
});

app.post('/acquireSeatLock', verifyToken, async (req, res) => {
    const { seatId, competitionId } = req.body;
    const user = req.user;

    if (!seatId || !competitionId) {
        return res.status(400).json({ error: 'seatId and competitionId are required.' });
    }

    try {
        const now = new Date();
        const existing = await adminDb.collection('seatLocks')
            .where('seatId', '==', adminDb.doc(`seats/${seatId}`))
            .where('competitionId', '==', adminDb.doc(`competitions/${competitionId}`))
            .where('expiresAt', '>', now)
            .get();

        if (!existing.empty) {
            return res.status(409).json({ error: 'Seat is currently locked by another user.' });
        }

        const bookedCheck = await assertSeatsNotBooked({ seatIds: [seatId], competitionId });
        if (!bookedCheck.ok) {
            return res.status(409).json({ error: 'Seat has already been booked.' });
        }

        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const lockRef = await adminDb.collection('seatLocks').add({
            seatId: adminDb.doc(`seats/${seatId}`),
            userId: adminDb.doc(`users/${user.uid}`),
            competitionId: adminDb.doc(`competitions/${competitionId}`),
            createdAt: now,
            expiresAt,
        });

        return res.json({ lockId: lockRef.id, expiresAt: expiresAt.toISOString() });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to acquire seat lock.' });
    }
});

// Admins accept a single receipt. Recomputes paidAmount, records a payment, and
// (on the first accepted receipt) confirms the booking + holds the seats.
app.post('/acceptBookingReceipt', verifyToken, requireAdmin, async (req, res) => {
    const { bookingId, receiptIndex } = req.body;
    if (!bookingId || receiptIndex == null) {
        return res.status(400).json({ error: 'bookingId and receiptIndex are required.' });
    }

    try {
        const bookingDocRef = adminDb.collection('bookings').doc(bookingId);
        const bookingSnap = await bookingDocRef.get();
        if (!bookingSnap.exists) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        const booking = bookingSnap.data();
        const receipts = Array.isArray(booking.receipts) ? [...booking.receipts] : [];
        if (receiptIndex < 0 || receiptIndex >= receipts.length) {
            return res.status(400).json({ error: 'Invalid receiptIndex.' });
        }

        const wasAccepted = receipts[receiptIndex].status === 'accepted';
        receipts[receiptIndex] = { ...receipts[receiptIndex], status: 'accepted' };

        const paidAmount = sumAccepted(receipts);
        const totalAmount = Number(booking.totalAmount) || 0;
        const fullyPaid = totalAmount > 0 && paidAmount >= totalAmount;
        const statusUpper = (booking.status || '').toUpperCase();
        const alreadyConfirmed = ['APPROVED', 'CONFIRMED', 'LIVE'].includes(statusUpper);
        // Confirm the booking (status + hold seats) on its FIRST ever accepted
        // receipt — a deposit booking confirms as soon as the deposit is
        // approved, not only once the balance is also in.
        const justConfirmed = !alreadyConfirmed;
        const hasPendingReceipts = receipts.some((r) => r.status === 'pending');
        const balanceStage = computeBalanceStage(paidAmount, totalAmount, hasPendingReceipts);

        const update = {
            receipts,
            paidAmount,
            paymentStatus: fullyPaid ? 'APPROVED' : 'PARTIAL',
            balanceStage,
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        };
        if (justConfirmed) update.status = 'APPROVED';

        await bookingDocRef.update(update);

        // Record the payment (only when newly accepted) and hold seats once fully paid.
        if (!wasAccepted) {
            await bookingDocRef.collection('payments').add({
                amount: Number(receipts[receiptIndex].amount) || 0,
                method: 'receipt',
                recordedBy: req.user.uid,
                createdAt: new Date(),
            });
        }
        if (justConfirmed) {
            await updateSeatsForBooking(booking, 'booked');
        }

        return res.json({ success: true, paidAmount, fullyPaid, justConfirmed, balanceStage, status: update.status || booking.status });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to accept receipt.' });
    }
});

// Admins reject a single receipt (e.g. unreadable / wrong amount). Does not reject
// the whole booking — the user can re-upload while under the receipt cap.
app.post('/rejectBookingReceipt', verifyToken, requireAdmin, async (req, res) => {
    const { bookingId, receiptIndex } = req.body;
    if (!bookingId || receiptIndex == null) {
        return res.status(400).json({ error: 'bookingId and receiptIndex are required.' });
    }

    try {
        const bookingDocRef = adminDb.collection('bookings').doc(bookingId);
        const bookingSnap = await bookingDocRef.get();
        if (!bookingSnap.exists) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        const booking = bookingSnap.data();
        const receipts = Array.isArray(booking.receipts) ? [...booking.receipts] : [];
        if (receiptIndex < 0 || receiptIndex >= receipts.length) {
            return res.status(400).json({ error: 'Invalid receiptIndex.' });
        }

        receipts[receiptIndex] = { ...receipts[receiptIndex], status: 'rejected' };
        const paidAmount = sumAccepted(receipts);
        const totalAmount = Number(booking.totalAmount) || 0;
        const statusUpper = (booking.status || '').toUpperCase();
        const alreadyConfirmed = ['APPROVED', 'CONFIRMED', 'LIVE'].includes(statusUpper);

        const update = {
            receipts,
            paidAmount,
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        };
        if (alreadyConfirmed) {
            const hasPendingReceipts = receipts.some((r) => r.status === 'pending');
            update.balanceStage = computeBalanceStage(paidAmount, totalAmount, hasPendingReceipts);
        } else {
            update.status = 'REJECTED';
        }

        await bookingDocRef.update(update);
        if (!alreadyConfirmed) {
            await updateSeatsForBooking(booking, 'available');
        }

        return res.json({ success: true, paidAmount, bookingRejected: !alreadyConfirmed });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to reject receipt.' });
    }
});

app.post('/approveBooking', verifyToken, requireAdmin, async (req, res) => {
    const { bookingId } = req.body;
    if (!bookingId) {
        return res.status(400).json({ error: 'bookingId is required.' });
    }

    try {
        const bookingDocRef = adminDb.collection('bookings').doc(bookingId);
        const bookingSnap = await bookingDocRef.get();
        if (!bookingSnap.exists) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        const booking = bookingSnap.data();
        await bookingDocRef.update({
            status: 'APPROVED',
            paymentStatus: 'APPROVED',
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        });

        await updateSeatsForBooking(booking, 'booked');

        return res.json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to approve booking.' });
    }
});

app.post('/rejectBooking', verifyToken, requireAdmin, async (req, res) => {
    const { bookingId } = req.body;
    if (!bookingId) {
        return res.status(400).json({ error: 'bookingId is required.' });
    }

    try {
        const bookingDocRef = adminDb.collection('bookings').doc(bookingId);
        const bookingSnap = await bookingDocRef.get();
        if (!bookingSnap.exists) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        const booking = bookingSnap.data();
        await bookingDocRef.update({
            status: 'REJECTED',
            paymentStatus: 'REJECTED',
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        });

        await updateSeatsForBooking(booking, 'available');

        return res.json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to reject booking.' });
    }
});

app.post('/checkInBooking', verifyToken, requireStaff, async (req, res) => {
    const { bookingId, bookingRef, amount, method, seatNum, pondId } = req.body;
    if ((!bookingId && !bookingRef) || amount == null || !method) {
        return res.status(400).json({ error: 'bookingId or bookingRef, amount and method are required.' });
    }

    try {
        let bookingDoc = null;
        if (bookingId) {
            const directSnap = await adminDb.collection('bookings').doc(bookingId).get();
            if (directSnap.exists) bookingDoc = directSnap;
        }
        if (!bookingDoc && bookingRef) {
            const bookingQuery = await adminDb.collection('bookings').where('bookingRef', '==', bookingRef).limit(1).get();
            if (!bookingQuery.empty) bookingDoc = bookingQuery.docs[0];
        }
        if (!bookingDoc) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        const booking = bookingDoc.data();
        if (!isConfirmedStatus(booking.status)) {
            return res.status(409).json({ error: 'Booking must be confirmed before check-in.' });
        }
        const checkedInAt = new Date();
        let nextState;
        try {
            nextState = buildCheckInState(booking, {
                seatNum,
                pondId,
                checkedAt: checkedInAt.toISOString(),
            });
        } catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid booking seat.' });
        }

        await bookingDoc.ref.update({
            checkedInSeatKeys: nextState.checkedInSeatKeys,
            checkedInSeats: nextState.checkedInSeats,
            checkedIn: nextState.checkedIn,
            checkedInAt,
            checkedInSeatTimes: nextState.checkedInSeatTimes,
            updatedAt: checkedInAt,
            updatedBy: req.user.uid,
        });

        // Only log a payment record on the booking's first arrival — otherwise
        // checking in each seat of a group one-by-one would log the full booking
        // amount multiple times in the payments ledger.
        if (nextState.isFirstArrival) {
            await bookingDoc.ref.collection('payments').add({
                amount,
                method,
                recordedBy: req.user.uid,
                createdAt: new Date(),
            });
        }

        return res.json({
            success: true,
            checkedInSeatKeys: nextState.checkedInSeatKeys,
            checkedInSeats: nextState.checkedInSeats,
            checkedIn: nextState.checkedIn,
            checkedInAt: checkedInAt.toISOString(),
            checkedInSeatTimes: nextState.checkedInSeatTimes,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to check in booking.' });
    }
});

app.post('/cancelBookingCheckIn', verifyToken, requireStaff, async (req, res) => {
    const { bookingId, seatNum, pondId } = req.body;
    if (!bookingId || seatNum == null) {
        return res.status(400).json({ error: 'bookingId and seatNum are required.' });
    }

    try {
        const bookingDoc = await adminDb.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) return res.status(404).json({ error: 'Booking not found.' });
        const booking = bookingDoc.data();
        let nextState;
        try {
            nextState = buildCancelCheckInState(booking, { seatNum, pondId });
        } catch (error) {
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid booking seat.' });
        }

        await bookingDoc.ref.update({
            checkedInSeatKeys: nextState.checkedInSeatKeys,
            checkedInSeats: nextState.checkedInSeats,
            checkedIn: nextState.checkedIn,
            checkedInSeatTimes: nextState.checkedInSeatTimes,
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        });
        return res.json({ success: true, ...nextState });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to cancel check-in.' });
    }
});

app.post('/updateResult', verifyToken, requireStaff, async (req, res) => {
    const { bookingId, totalWeight, fishCount } = req.body;
    if (!bookingId || totalWeight == null || fishCount == null) {
        return res.status(400).json({ error: 'bookingId, totalWeight, and fishCount are required.' });
    }

    try {
        const bookingRef = adminDb.collection('bookings').doc(bookingId);
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        const bookingData = bookingSnap.data();
        const competitionRef = bookingData?.competitionId;

        const resultQuery = await adminDb.collection('eventResults')
            .where('bookingId', '==', bookingRef)
            .limit(1)
            .get();

        if (resultQuery.empty) {
            await adminDb.collection('eventResults').add({
                bookingId: bookingRef,
                competitionId: competitionRef,
                totalWeight,
                fishCount,
                createdAt: new Date(),
                updatedAt: new Date(),
                updatedBy: req.user.uid,
            });
        } else {
            await resultQuery.docs[0].ref.update({
                totalWeight,
                fishCount,
                updatedAt: new Date(),
                updatedBy: req.user.uid,
            });
        }

        const allResults = await adminDb.collection('eventResults')
            .where('competitionId', '==', competitionRef)
            .get();

        const sorted = allResults.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => (b.totalWeight || 0) - (a.totalWeight || 0));

        await Promise.all(sorted.map(async (entry, index) => {
            const ref = adminDb.collection('eventResults').doc(entry.id);
            await ref.update({ rank: index + 1 });
        }));

        return res.json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to update event result.' });
    }
});

export const api = functions.https.onRequest(app);

// Re-read current state so delayed trigger delivery cannot release a reused peg.
export const releaseBookingSeatClaims = functions.firestore.document('bookings/{bookingId}')
    .onWrite(async (_change, context) => {
        await releaseClaims(adminDb, context.params.bookingId);
        return null;
    });

export { seoRender } from './seo.js';

// Keep Firebase Auth custom claims in sync with users/{uid}.role for external
// consumers. Application authorization reads the profile document directly.
export const syncUserRoleClaims = functions.firestore
    .document('users/{uid}')
    .onWrite(async (change, context) => {
        const { uid } = context.params;
        if (!change.after.exists) return null;

        const afterData = change.after.data() || {};
        const beforeData = change.before.exists ? (change.before.data() || {}) : null;
        const afterRole = normalizeRole(afterData.role);
        const beforeRole = beforeData ? normalizeRole(beforeData.role) : null;

        // Skip when role didn't change on updates; still run for creates.
        if (beforeData && beforeRole === afterRole) return null;

        try {
            const result = await syncAuthRoleClaim(uid, afterRole);
            if (afterData.role !== afterRole) {
                await change.after.ref.set({ role: afterRole, updatedAt: new Date() }, { merge: true });
            }
            console.log(`syncUserRoleClaims: uid=${uid} role=${afterRole} updated=${result.updated}`);
            return null;
        } catch (error) {
            console.error(`syncUserRoleClaims failed for uid=${uid}:`, error);
            return null;
        }
    });

// One-time/manual fixer for existing users. Admin-only callable.
export const backfillUserRoleClaims = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    }

    const callerProfile = await adminDb.collection('users').doc(context.auth.uid).get();
    const callerRole = normalizeRole(callerProfile.data()?.role);
    if (callerRole !== 'ADMIN') {
        throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }

    const snapshot = await adminDb.collection('users').get();
    let updated = 0;
    let unchanged = 0;
    let failed = 0;

    for (const docSnap of snapshot.docs) {
        try {
            const role = normalizeRole(docSnap.data()?.role);
            const result = await syncAuthRoleClaim(docSnap.id, role);
            if (result.updated) updated += 1;
            else unchanged += 1;

            if (docSnap.data()?.role !== role) {
                await docSnap.ref.set({ role, updatedAt: new Date() }, { merge: true });
            }
        } catch (error) {
            failed += 1;
            console.error(`backfillUserRoleClaims failed for uid=${docSnap.id}:`, error);
        }
    }

    return {
        total: snapshot.size,
        updated,
        unchanged,
        failed,
    };
});

// Admin-only role management for CMS > Pengguna. Firestore profile roles are
// authoritative; custom claims are kept in sync for Firebase services that use
// token claims, but stale claims never grant application permissions.
export const updateUserRole = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    }

    const callerRef = adminDb.collection('users').doc(context.auth.uid);
    const callerSnap = await callerRef.get();
    const callerRole = callerSnap.exists ? normalizeRole(callerSnap.data()?.role) : 'CLIENT';
    if (callerRole !== 'ADMIN') {
        throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }

    const uid = typeof data?.uid === 'string' ? data.uid.trim() : '';
    const requestedRole = typeof data?.role === 'string' ? data.role.trim().toUpperCase() : '';
    if (!uid || !ALLOWED_ROLES.has(requestedRole)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid uid and role are required.');
    }
    const targetRef = adminDb.collection('users').doc(uid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'User profile not found.');
    }

    const targetData = targetSnap.data() || {};
    const previousRole = normalizeRole(targetData.role);
    const blockReason = roleChangeBlockReason({
        callerUid: context.auth.uid,
        callerRole,
        targetUid: uid,
        targetRole: previousRole,
        requestedRole,
    });
    if (blockReason === 'self-change') {
        throw new functions.https.HttpsError('failed-precondition', 'You cannot change your own role.');
    }
    if (blockReason === 'admin-locked') {
        throw new functions.https.HttpsError('failed-precondition', 'Existing admin roles cannot be changed in the CMS.');
    }
    if (previousRole === requestedRole) {
        return { success: true, uid, previousRole, role: requestedRole };
    }

    let userRecord;
    try {
        userRecord = await adminAuth.getUser(uid);
    } catch (error) {
        if (error?.code === 'auth/user-not-found') {
            throw new functions.https.HttpsError('not-found', 'Firebase Auth user not found.');
        }
        throw error;
    }

    const previousClaims = userRecord.customClaims || {};
    await adminAuth.setCustomUserClaims(uid, { ...previousClaims, role: requestedRole });

    try {
        await adminDb.runTransaction(async (transaction) => {
            const [freshCaller, freshTarget] = await Promise.all([
                transaction.get(callerRef),
                transaction.get(targetRef),
            ]);
            if (!freshCaller.exists || normalizeRole(freshCaller.data()?.role) !== 'ADMIN') {
                throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
            }
            if (!freshTarget.exists) {
                throw new functions.https.HttpsError('not-found', 'User profile not found.');
            }
            const freshPreviousRole = normalizeRole(freshTarget.data()?.role);
            if (freshPreviousRole !== previousRole || freshPreviousRole === 'ADMIN') {
                throw new functions.https.HttpsError('aborted', 'The user role changed while this request was being processed.');
            }

            const changedAt = new Date();
            transaction.set(targetRef, {
                role: requestedRole,
                roleUpdatedAt: changedAt,
                roleUpdatedBy: context.auth.uid,
                updatedAt: changedAt,
            }, { merge: true });
            transaction.set(adminDb.collection('auditLog').doc(), {
                action: 'user.role_change',
                actionLabel: 'Tukar Peranan Pengguna',
                entityType: 'user',
                entityId: uid,
                entityLabel: targetData.name || targetData.email || uid,
                actorUid: context.auth.uid,
                actorEmail: callerSnap.data()?.email || context.auth.token?.email || '',
                actorName: callerSnap.data()?.name || context.auth.token?.name || '',
                details: `${previousRole} → ${requestedRole}`,
                createdAt: changedAt,
            });
        });
    } catch (error) {
        try {
            await adminAuth.setCustomUserClaims(uid, previousClaims);
        } catch (rollbackError) {
            console.error(`updateUserRole claim rollback failed for uid=${uid}:`, rollbackError);
        }
        throw error;
    }

    return { success: true, uid, previousRole, role: requestedRole };
});

// Clients can request verification, but only trusted server code controls the
// recipient and rendered message. Deterministic one-minute ids rate-limit spam.
const CONTINUE_URL = process.env.APP_URL || 'https://kolamkelisayang.web.app';
const VERIFICATION_WINDOW_MS = 60 * 1000;

export const requestEmailVerification = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    }

    const userRecord = await adminAuth.getUser(context.auth.uid);
    if (!userRecord.email) {
        throw new functions.https.HttpsError('failed-precondition', 'No email on account.');
    }
    if (userRecord.emailVerified) {
        return { alreadyVerified: true };
    }

    try {
        const requestWindow = Math.floor(Date.now() / VERIFICATION_WINDOW_MS);
        const link = await adminAuth.generateEmailVerificationLink(userRecord.email, {
            url: CONTINUE_URL,
            handleCodeInApp: false,
        });
        const result = await queueVerificationMail({
            uid: context.auth.uid,
            email: userRecord.email,
            link,
            requestWindow,
        });
        if (!result.created) {
            throw new functions.https.HttpsError('resource-exhausted', 'Please wait before requesting another email.');
        }
        return { queued: true, mailId: result.id };
    } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error('requestEmailVerification failed:', error);
        throw new functions.https.HttpsError('internal', 'Failed to send verification email.');
    }
});

// Password reset is sent through our own branded Malay template instead of the
// Firebase Auth default ("Reset your password for project-<id>"). Callable
// without auth by nature — the caller is locked out — so it never reveals
// whether an address is registered and dedupes to one mail per account/minute.
export const requestPasswordReset = functions.https.onCall(async (data) => {
    const email = typeof data?.email === 'string' ? data.email.trim() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid email is required.');
    }

    // Neutral response shape in every branch below: an attacker must not be able
    // to tell a registered address from an unregistered one.
    const neutral = { queued: true };
    try {
        const userRecord = await adminAuth.getUserByEmail(email);
        const requestWindow = Math.floor(Date.now() / VERIFICATION_WINDOW_MS);
        const link = await adminAuth.generatePasswordResetLink(email, {
            url: CONTINUE_URL,
            handleCodeInApp: false,
        });
        const profileSnap = await adminDb.collection('users').doc(userRecord.uid).get();
        await queuePasswordResetMail({
            uid: userRecord.uid,
            email: userRecord.email,
            link,
            name: (profileSnap.exists ? profileSnap.data()?.name : '') || userRecord.displayName || '',
            requestWindow,
        });
        return neutral;
    } catch (error) {
        if (error?.code === 'auth/user-not-found') return neutral;
        console.error('requestPasswordReset failed:', error);
        throw new functions.https.HttpsError('internal', 'Failed to send password reset email.');
    }
});

// ── Balance-reminder scheduler ──────────────────────────────────────────────
export const requestWelcomeEmail = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    }
    const [userRecord, profileSnap] = await Promise.all([
        adminAuth.getUser(context.auth.uid),
        adminDb.collection('users').doc(context.auth.uid).get(),
    ]);
    if (!userRecord.email) {
        throw new functions.https.HttpsError('failed-precondition', 'No email on account.');
    }
    const profile = profileSnap.exists ? profileSnap.data() : {};
    const result = await queueWelcomeMail({
        uid: context.auth.uid,
        email: userRecord.email,
        name: profile?.name || userRecord.displayName || userRecord.email.split('@')[0],
    });
    return { queued: result.created, alreadyQueued: result.reason === 'already-exists', mailId: result.id };
});

const callableHasRole = async (context, allowedRoles) => {
    if (!context.auth) return false;
    const profile = await adminDb.collection('users').doc(context.auth.uid).get();
    const role = profile.exists ? String(profile.data()?.role || '').toUpperCase() : '';
    return allowedRoles.includes(role);
};

export const requestBalanceReminder = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    }
    if (!await callableHasRole(context, ['ADMIN'])) {
        throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }
    const bookingId = typeof data?.bookingId === 'string' ? data.bookingId.trim() : '';
    if (!bookingId) {
        throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.');
    }
    const bookingSnap = await adminDb.collection('bookings').doc(bookingId).get();
    if (!bookingSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Booking not found.');
    }
    const booking = bookingSnap.data();
    const totalAmount = Number(booking.totalAmount) || 0;
    const paidAmount = paidAmountForBooking(booking);
    const balanceDue = Math.max(0, totalAmount - paidAmount);
    if (balanceDue <= 0) {
        throw new functions.https.HttpsError('failed-precondition', 'Booking has no outstanding balance.');
    }
    const result = await queueBalanceReminderMail({
        bookingId,
        booking,
        balanceDue,
        id: `balance_manual_${bookingId}_${Date.now()}`,
    });
    if (!result.created) {
        throw new functions.https.HttpsError('failed-precondition', 'No valid recipient email for this booking.');
    }
    return { queued: true, mailId: result.id };
});

// Persisted booking state drives email creation, so browser disconnects cannot
// lose notifications. Deterministic ids make event retries idempotent.
export const queueInitialBookingEmail = functions.firestore
    .document('bookings/{bookingId}')
    .onCreate(async (snapshot, context) => {
        const booking = snapshot.data();
        const kind = initialBookingEmailKind(booking.status);
        const result = await queueBookingLifecycleMail({ bookingId: context.params.bookingId, booking, kind });
        if (!result.created && result.reason === 'missing-recipient') {
            console.warn(`No email recipient for booking ${context.params.bookingId}.`);
        }
        return null;
    });

export const queueBookingApprovedEmail = functions.firestore
    .document('bookings/{bookingId}')
    .onUpdate(async (change, context) => {
        if (!shouldQueueBookingApprovedEmail(change.before.data().status, change.after.data().status)) {
            return null;
        }
        await queueBookingLifecycleMail({
            bookingId: context.params.bookingId,
            booking: change.after.data(),
            kind: 'booking_approved',
        });
        return null;
    });

// Deposit bookings that still owe a balance get an email nudge every 7 days until
// the balance receipt is uploaded. Mirrors the client-side timing in
// src/utils/booking.ts (BALANCE_REMINDER_DAYS). Admin SDK writes bypass rules.
const BALANCE_REMINDER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Firestore values may be a Timestamp, a Date, or an ISO string (direct-write path).
const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
};

export const remindOutstandingBalances = functions.pubsub
    .schedule('every 24 hours')
    .timeZone('Asia/Kuala_Lumpur')
    .onRun(async () => {
        const now = Date.now();
        // Filter the deposit candidates in code to avoid a composite index.
        const snapshot = await adminDb.collection('bookings')
            .where('paymentType', '==', 'deposit')
            .get();

        let sent = 0;
        for (const docSnap of snapshot.docs) {
            const booking = docSnap.data();
            const statusUpper = (booking.status || '').toUpperCase();
            if (statusUpper === 'REJECTED') continue;

            const receipts = Array.isArray(booking.receipts) ? booking.receipts : [];
            const totalAmount = Number(booking.totalAmount) || 0;
            const paidAmount = paidAmountForBooking(booking);
            if (totalAmount <= 0 || paidAmount >= totalAmount) continue; // fully paid / no balance

            // If a receipt is awaiting staff review, the ball is in staff's court — skip.
            if (receipts.some((r) => r?.status === 'pending')) continue;

            const depositSubmittedMs = toMillis(receipts[0]?.submittedAt) || toMillis(booking.createdAt);
            const lastReminderMs = toMillis(booking.balanceReminderSentAt);
            const anchorMs = Math.max(depositSubmittedMs, lastReminderMs);
            if (anchorMs === 0 || now - anchorMs < BALANCE_REMINDER_DAYS * DAY_MS) continue;

            try {
                const result = await queueBalanceReminderMail({
                    bookingId: docSnap.id,
                    booking,
                    balanceDue: Math.max(0, totalAmount - paidAmount),
                    id: `balance_auto_${docSnap.id}_${anchorMs}_${Math.floor((now - anchorMs) / (BALANCE_REMINDER_DAYS * DAY_MS))}`,
                    anchorMs,
                });
                if (result.created) sent += 1;
            } catch (error) {
                console.error(`Failed to queue balance reminder for ${docSnap.id}:`, error);
            }
        }

        console.log(`remindOutstandingBalances: queued ${sent} reminder(s).`);
        return null;
    });

// The Trigger Email extension owns delivery.state. Persist business timestamps
// only after SMTP reports SUCCESS, and expose a compact status on the booking.
export const syncMailDeliveryStatus = functions.firestore
    .document('mail/{mailId}')
    .onUpdate(async (change) => {
        const beforeState = change.before.data()?.delivery?.state;
        const after = change.after.data();
        const state = after?.delivery?.state;
        if (!state || state === beforeState) return null;

        const metadata = after.metadata || {};
        if (metadata.bookingId) {
            const intendedRecipient = String(after.to || '').trim().toLowerCase();
            const acceptedRecipients = Array.isArray(after.delivery?.info?.accepted)
                ? after.delivery.info.accepted.map((email) => String(email).trim().toLowerCase())
                : [];
            const recipientAccepted = state === 'SUCCESS' && acceptedRecipients.includes(intendedRecipient);
            const status = {
                state,
                attempts: Number(after.delivery?.attempts) || 0,
                recipientAccepted,
                updatedAt: after.delivery?.endTime || new Date(),
                ...(after.delivery?.error ? { error: String(after.delivery.error).slice(0, 500) } : {}),
            };
            const update = { [`emailDelivery.${metadata.kind || 'unknown'}`]: status };
            if (recipientAccepted && metadata.kind === 'balance_reminder') {
                update.balanceReminderSentAt = after.delivery?.endTime || new Date();
            }
            const bookingRef = adminDb.collection('bookings').doc(metadata.bookingId);
            const bookingSnap = await bookingRef.get();
            if (bookingSnap.exists) await bookingRef.update(update);
        }
        return null;
    });

// The extension does not retry terminal ERROR jobs automatically. Retry only
// server-created, explicitly retryable messages, capped by delivery.attempts.
export const retryFailedTransactionalEmails = functions.pubsub
    .schedule('every 15 minutes')
    .timeZone('Asia/Kuala_Lumpur')
    .onRun(async () => {
        const failed = await adminDb.collection('mail')
            .where('delivery.state', '==', 'ERROR')
            .get();
        let retried = 0;
        for (const docSnap of failed.docs) {
            const data = docSnap.data();
            const attempts = Number(data?.delivery?.attempts) || 0;
            if (data?.metadata?.retryable !== true || attempts >= 3) continue;
            await docSnap.ref.update({
                'delivery.state': 'RETRY',
                'metadata.lastRetryRequestedAt': new Date(),
            });
            retried += 1;
        }
        console.log(`retryFailedTransactionalEmails: requested ${retried} retry/retries.`);
        return null;
    });
