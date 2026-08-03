import express from 'express';
import cors from 'cors';
import * as functions from 'firebase-functions';
import { adminAuth, adminDb, verifyToken, requireStaff } from './auth-utils.js';
import {
    initialBookingEmailKind,
    isConfirmedStatus,
    queueBalanceReminderMail,
    queueBookingLifecycleMail,
    queueVerificationMail,
    queueWelcomeMail,
    shouldQueueBookingApprovedEmail,
} from './email-service.js';
import { buildCancelCheckInState, buildCheckInState } from './booking-seats.js';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const randomTempPassword = () => Math.random().toString(36).slice(2, 10) + '!1A';
const getRole = (user) => user?.role || user?.claims?.role || user?.custom_claims?.role || 'CLIENT';
const isStaffUser = (user) => ['STAFF', 'ADMIN'].includes(getRole(user));
const ALLOWED_ROLES = new Set(['CLIENT', 'STAFF', 'ADMIN']);

const normalizeRole = (value) => {
    const normalized = String(value || 'CLIENT').trim().toUpperCase();
    return ALLOWED_ROLES.has(normalized) ? normalized : 'CLIENT';
};

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

const MAX_RECEIPTS = 3;

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

// A booking's userId is stored as a users/{uid} DocumentReference (server path)
// or, on the legacy direct-write path, the raw email string.
const ownsBooking = (bookingData, user) => {
    const ownerId = bookingData?.userId?.id || bookingData?.userId;
    return ownerId === user.uid
        || (!!bookingData?.userEmail && bookingData.userEmail === user.email)
        || (!!user.email && ownerId === user.email);
};

const ensureStaffForCreatedByStaff = (req, res, next) => {
    if (!req.body?.createdByStaff) return next();
    if (!isStaffUser(req.user)) {
        return res.status(403).json({ error: 'Forbidden: staff role required for staff booking mode.' });
    }
    return next();
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

const validateSeatLocks = async ({ seatIds, competitionId, userUid }) => {
    const now = new Date();
    const lockSnapshot = await adminDb.collection('seatLocks')
        .where('competitionId', '==', adminDb.doc(`competitions/${competitionId}`))
        .where('userId', '==', adminDb.doc(`users/${userUid}`))
        .where('expiresAt', '>', now)
        .get();

    const lockPaths = new Set(
        lockSnapshot.docs.map((docSnap) => docSnap.data()?.seatId?.path).filter(Boolean)
    );

    const missing = seatIds.filter((id) => !lockPaths.has(`seats/${id}`));
    return { ok: missing.length === 0, missing };
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

app.post('/createClientAccount', verifyToken, requireStaff, async (req, res) => {
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

app.post('/createBooking', verifyToken, ensureStaffForCreatedByStaff, async (req, res) => {
    const {
        competitionId, competitionName, pondId, pondCode, pondSelections,
        seatIds, seatNumbers, paymentType, amount, totalAmount, receiptUrl,
        bankReference, notes, createdByStaff, userEmail, userName, userPhone,
        bookingPhone,
    } = req.body;
    const user = req.user;

    if (!competitionId || !pondId || !seatIds?.length || !paymentType || amount == null) {
        return res.status(400).json({ error: 'Missing booking payload.' });
    }

    try {
        const staffMode = !!createdByStaff && isStaffUser(user);

        const bookedCheck = await assertSeatsNotBooked({ seatIds, competitionId });
        if (!bookedCheck.ok) {
            return res.status(409).json({ error: `Seat(s) already booked: ${bookedCheck.conflicts.join(', ')}` });
        }

        if (!staffMode) {
            const lockCheck = await validateSeatLocks({ seatIds, competitionId, userUid: user.uid });
            if (!lockCheck.ok) {
                return res.status(409).json({ error: `Missing active seat lock for seat(s): ${lockCheck.missing.join(', ')}` });
            }
        }

        const bookingRef = `BKG-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const now = new Date();
        const bookingTotal = Number(totalAmount ?? amount) || 0;
        const initialPaidAmount = staffMode ? (Number(amount) || 0) : 0;
        const initialBalanceDue = Math.max(0, bookingTotal - initialPaidAmount);
        // Seed the receipts array with the initial payment receipt. Staff-mode
        // bookings are pre-accepted; self-service start as pending staff review.
        const initialReceipts = receiptUrl
            ? [{ url: receiptUrl, amount, status: staffMode ? 'accepted' : 'pending', submittedAt: now }]
            : [];
        const bookingDoc = await adminDb.collection('bookings').add({
            bookingRef,
            userId: adminDb.doc(`users/${user.uid}`),
            userEmail: staffMode ? (userEmail || '') : (user.email || userEmail || ''),
            userName: staffMode ? (userName || '') : (userName || user.name || ''),
            userPhone: userPhone || '',
            bookingPhone: bookingPhone || '',
            createdByUid: staffMode ? user.uid : null,
            competitionId: adminDb.doc(`competitions/${competitionId}`),
            competitionName: competitionName || '',
            pondId: adminDb.doc(`ponds/${pondId}`),
            pondCode: pondCode || '',
            pondSelections: Array.isArray(pondSelections) ? pondSelections : [],
            seatIds: seatIds.map((id) => adminDb.doc(`seats/${id}`)),
            seatNumbers: seatNumbers || [],
            paymentType,
            paymentStatus: staffMode ? (initialBalanceDue > 0 ? 'PARTIAL' : 'APPROVED') : 'PENDING_APPROVAL',
            receiptUrl: receiptUrl || null,
            bankReference: bankReference || '',
            receipts: initialReceipts,
            paidAmount: initialPaidAmount,
            balanceDue: initialBalanceDue,
            ...(staffMode ? { balanceStage: initialBalanceDue > 0 ? 'pending-balance' : 'fully-paid' } : {}),
            staffNotes: notes || '',
            createdByStaff: staffMode,
            checkedIn: false,
            status: staffMode ? 'APPROVED' : 'PENDING_APPROVAL',
            amount,
            totalAmount: bookingTotal,
            createdAt: now,
            updatedAt: now,
            updatedBy: user.uid,
        });

        await bookingDoc.collection('payments').add({
            amount,
            type: paymentType,
            method: receiptUrl ? 'receipt' : 'manual',
            recordedBy: user.uid,
            createdAt: new Date(),
        });

        await updateSeatsForBooking({ seatIds: seatIds.map((id) => adminDb.doc(`seats/${id}`)) }, staffMode ? 'booked' : 'pending');

        await adminDb.collection('seatLocks')
            .where('competitionId', '==', adminDb.doc(`competitions/${competitionId}`))
            .where('userId', '==', adminDb.doc(`users/${user.uid}`))
            .get()
            .then((snapshot) => {
                snapshot.forEach((docSnap) => docSnap.ref.delete());
            });

        return res.json({ bookingId: bookingDoc.id, bookingRef, status: staffMode ? 'confirmed' : 'pending' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to create booking.' });
    }
});

// A booking owner submits an additional payment receipt (e.g. the balance for a
// deposit booking). Capped at MAX_RECEIPTS total; appended as 'pending' for staff review.
app.post('/submitBookingReceipt', verifyToken, async (req, res) => {
    const { bookingId, receiptUrl, amount } = req.body;
    if (!bookingId || !receiptUrl || amount == null) {
        return res.status(400).json({ error: 'bookingId, receiptUrl and amount are required.' });
    }

    try {
        const bookingDocRef = adminDb.collection('bookings').doc(bookingId);
        const bookingSnap = await bookingDocRef.get();
        if (!bookingSnap.exists) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        const booking = bookingSnap.data();
        if (!ownsBooking(booking, req.user)) {
            return res.status(403).json({ error: 'Forbidden: not your booking.' });
        }
        if ((booking.status || '').toUpperCase() === 'REJECTED') {
            return res.status(409).json({ error: 'Booking has been rejected.' });
        }

        const receipts = Array.isArray(booking.receipts) ? booking.receipts : [];
        if (receipts.length >= MAX_RECEIPTS) {
            return res.status(409).json({ error: `Maximum of ${MAX_RECEIPTS} receipts reached.` });
        }

        const totalAmount = Number(booking.totalAmount) || 0;
        if (sumAccepted(receipts) >= totalAmount && totalAmount > 0) {
            return res.status(409).json({ error: 'Booking is already fully paid.' });
        }

        const next = [...receipts, { url: receiptUrl, amount: Number(amount) || 0, status: 'pending', submittedAt: new Date() }];
        await bookingDocRef.update({
            receipts: next,
            receiptUrl,
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        });

        return res.json({ receipts: next });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to submit receipt.' });
    }
});

// Staff accept a single receipt. Recomputes paidAmount, records a payment, and
// (on the first accepted receipt) confirms the booking + holds the seats.
app.post('/acceptBookingReceipt', verifyToken, requireStaff, async (req, res) => {
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

// Staff reject a single receipt (e.g. unreadable / wrong amount). Does not reject
// the whole booking — the user can re-upload while under the receipt cap.
app.post('/rejectBookingReceipt', verifyToken, requireStaff, async (req, res) => {
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

app.post('/approveBooking', verifyToken, requireStaff, async (req, res) => {
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

app.post('/rejectBooking', verifyToken, requireStaff, async (req, res) => {
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

export { seoRender } from './seo.js';

// Keep Firebase Auth custom claims in sync with users/{uid}.role so Storage
// rules that depend on request.auth.token.role stay accurate.
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

    const callerRole = normalizeRole(context.auth.token?.role);
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

const callableIsStaff = async (context) => {
    const tokenRole = String(context.auth?.token?.role || '').toUpperCase();
    if (tokenRole === 'ADMIN' || tokenRole === 'STAFF') return true;
    if (!context.auth) return false;
    const profile = await adminDb.collection('users').doc(context.auth.uid).get();
    const role = profile.exists ? String(profile.data()?.role || '').toUpperCase() : '';
    return role === 'ADMIN' || role === 'STAFF';
};

export const requestBalanceReminder = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    }
    if (!await callableIsStaff(context)) {
        throw new functions.https.HttpsError('permission-denied', 'Staff role required.');
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
