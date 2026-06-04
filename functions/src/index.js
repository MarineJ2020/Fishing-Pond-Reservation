import express from 'express';
import cors from 'cors';
import * as functions from 'firebase-functions';
import { adminAuth, adminDb, verifyToken, requireStaff } from './auth-utils.js';
// Email sending has moved to the client-side `mail` Firestore collection,
// which is consumed by the "Trigger Email from Firestore" Firebase extension.

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const randomTempPassword = () => Math.random().toString(36).slice(2, 10) + '!1A';
const getRole = (user) => user?.role || user?.claims?.role || user?.custom_claims?.role || 'CLIENT';
const isStaffUser = (user) => ['STAFF', 'ADMIN'].includes(getRole(user));

const MAX_RECEIPTS = 3;

const sumAccepted = (receipts) =>
    (Array.isArray(receipts) ? receipts : [])
        .filter((r) => r?.status === 'accepted')
        .reduce((sum, r) => sum + (Number(r?.amount) || 0), 0);

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
    const { competitionId, pondId, seatIds, seatNumbers, paymentType, amount, totalAmount, receiptUrl, notes, createdByStaff } = req.body;
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
        // Seed the receipts array with the initial payment receipt. Staff-mode
        // bookings are pre-accepted; self-service start as pending staff review.
        const initialReceipts = receiptUrl
            ? [{ url: receiptUrl, amount, status: staffMode ? 'accepted' : 'pending', submittedAt: now }]
            : [];
        const bookingDoc = await adminDb.collection('bookings').add({
            bookingRef,
            userId: adminDb.doc(`users/${user.uid}`),
            competitionId: adminDb.doc(`competitions/${competitionId}`),
            pondId: adminDb.doc(`ponds/${pondId}`),
            seatIds: seatIds.map((id) => adminDb.doc(`seats/${id}`)),
            seatNumbers: seatNumbers || [],
            paymentType,
            paymentStatus: staffMode ? 'APPROVED' : 'PENDING_APPROVAL',
            receiptUrl: receiptUrl || null,
            receipts: initialReceipts,
            paidAmount: staffMode ? amount : 0,
            staffNotes: notes || '',
            createdByStaff: staffMode,
            checkedIn: false,
            status: staffMode ? 'APPROVED' : 'PENDING_APPROVAL',
            amount,
            totalAmount: totalAmount ?? amount,
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

        return res.json({ bookingId: bookingDoc.id, bookingRef });
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
        const wasPending = (booking.status || '').toUpperCase() === 'PENDING_APPROVAL';

        const update = {
            receipts,
            paidAmount,
            paymentStatus: fullyPaid ? 'APPROVED' : 'PARTIAL',
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        };
        if (wasPending) update.status = 'APPROVED';

        await bookingDocRef.update(update);

        // Record the payment (only when newly accepted) and hold seats on first confirm.
        if (!wasAccepted) {
            await bookingDocRef.collection('payments').add({
                amount: Number(receipts[receiptIndex].amount) || 0,
                method: 'receipt',
                recordedBy: req.user.uid,
                createdAt: new Date(),
            });
        }
        if (wasPending) {
            await updateSeatsForBooking(booking, 'booked');
        }

        return res.json({ success: true, paidAmount, fullyPaid, status: update.status || booking.status });
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

        await bookingDocRef.update({
            receipts,
            paidAmount,
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        });

        return res.json({ success: true, paidAmount });
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
    const { bookingRef, amount, method } = req.body;
    if (!bookingRef || amount == null || !method) {
        return res.status(400).json({ error: 'bookingRef, amount and method are required.' });
    }

    try {
        const bookingQuery = await adminDb.collection('bookings').where('bookingRef', '==', bookingRef).limit(1).get();
        if (bookingQuery.empty) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        const bookingDoc = bookingQuery.docs[0];
        await bookingDoc.ref.update({
            checkedIn: true,
            checkedInAt: new Date(),
            updatedAt: new Date(),
            updatedBy: req.user.uid,
        });

        await bookingDoc.ref.collection('payments').add({
            amount,
            method,
            recordedBy: req.user.uid,
            createdAt: new Date(),
        });

        return res.json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to check in booking.' });
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

// Sends the email-verification link via the Zoho-backed Trigger Email extension
// (instead of Firebase's default noreply@...firebaseapp.com sender) by queueing
// a branded doc in the `mail` collection. Admin SDK writes bypass Firestore rules.
const CONTINUE_URL = process.env.APP_URL || 'https://kolamkelisayang.web.app';
const STAFF_CC = 'hello@kolamkelisayang.com.my';

const renderVerificationEmail = (link) => `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#222;max-width:620px;margin:0 auto;padding:24px;background:#fff;">
      <div style="border-top:4px solid #b91c1c;padding-top:16px;">
        <h2 style="margin:0 0 14px;color:#112a41;font-size:22px;">Sahkan Email Anda</h2>
        <p>Salam sejahtera,</p>
        <p>Terima kasih kerana mendaftar dengan Kolam Keli Sayang. Sila klik butang di bawah untuk mengesahkan alamat email anda dan mengaktifkan akaun.</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${link}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Sahkan Email</a>
        </p>
        <p style="font-size:12px;color:#666;">Jika butang tidak berfungsi, salin pautan ini ke pelayar anda:<br/><a href="${link}" style="color:#112a41;">${link}</a></p>
        <p style="font-size:12px;color:#888;">Jika anda tidak mendaftar, abaikan email ini.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0 12px;" />
        <p style="font-size:12px;color:#888;margin:0;">Kolam Keli Sayang &middot; hello@kolamkelisayang.com.my</p>
      </div>
    </div>
`;

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
        const link = await adminAuth.generateEmailVerificationLink(userRecord.email, {
            url: CONTINUE_URL,
            handleCodeInApp: false,
        });

        await adminDb.collection('mail').add({
            to: userRecord.email,
            cc: [STAFF_CC],
            message: {
                subject: 'Sahkan Email Anda - Kolam Keli Sayang',
                html: renderVerificationEmail(link),
            },
        });

        return { sent: true };
    } catch (error) {
        console.error('requestEmailVerification failed:', error);
        throw new functions.https.HttpsError('internal', 'Failed to send verification email.');
    }
});
