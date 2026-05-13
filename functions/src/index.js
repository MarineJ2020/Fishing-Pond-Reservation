import express from 'express';
import cors from 'cors';
import { json } from 'body-parser';
import * as functions from 'firebase-functions';
import { adminAuth, adminDb, verifyToken, requireStaff } from './auth-utils';
import { sendEmail } from './email';

const app = express();
app.use(cors({ origin: true }));
app.use(json());

const appUrl = process.env.APP_URL || 'https://your-app-url.com';

const randomTempPassword = () => Math.random().toString(36).slice(2, 10) + '!1A';
const getRole = (user) => user?.role || user?.claims?.role || user?.custom_claims?.role || 'CLIENT';
const isStaffUser = (user) => ['STAFF', 'ADMIN'].includes(getRole(user));

const ensureStaffForCreatedByStaff = (req, res, next) => {
    if (!req.body?.createdByStaff) return next();
    if (!isStaffUser(req.user)) {
        return res.status(403).json({ error: 'Forbidden: staff role required for staff booking mode.' });
    }
    return next();
};

const htmlLayout = (title, body) => `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#222;max-width:620px;margin:0 auto;padding:16px;">
        <h2 style="margin:0 0 12px;">${title}</h2>
        <div>${body}</div>
    </div>
`;

const renderWelcomeEmail = ({ name, email }) => htmlLayout(
    'Welcome to Fishing Competition Portal',
    `<p>Hello ${name},</p>
     <p>Your account has been created for <strong>${email}</strong>.</p>
     <p><a href="${appUrl}">Open portal</a></p>`
);

const renderBookingReceivedEmail = ({ bookingRef, amount }) => htmlLayout(
    'Booking Received',
    `<p>Your booking <strong>${bookingRef}</strong> has been submitted and is pending approval.</p>
     <p>Recorded amount: <strong>RM ${Number(amount || 0).toFixed(2)}</strong></p>
     <p><a href="${appUrl}">View portal</a></p>`
);

const renderBookingApprovedEmail = ({ bookingRef }) => htmlLayout(
    'Booking Approved',
    `<p>Your booking <strong>${bookingRef}</strong> has been approved.</p>
     <p><a href="${appUrl}">View booking</a></p>`
);

const renderBookingRejectedEmail = ({ bookingRef }) => htmlLayout(
    'Booking Rejected',
    `<p>Your booking <strong>${bookingRef}</strong> has been rejected.</p>
     <p><a href="${appUrl}">Open portal</a></p>`
);

const getUserEmailByBooking = async (bookingData) => {
    const userRef = bookingData?.userId;
    const uid = typeof userRef === 'string' ? userRef : userRef?.id;
    if (!uid) return null;

    try {
        const userRecord = await adminAuth.getUser(uid);
        return userRecord.email || null;
    } catch {
        const userDoc = await adminDb.collection('users').doc(uid).get();
        const data = userDoc.exists ? userDoc.data() : null;
        return data?.email || null;
    }
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
            .where('status', 'in', ['APPROVED', 'CONFIRMED', 'LIVE'])
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

        const html = renderWelcomeEmail({ name, email });
        await sendEmail({
            to: email,
            subject: 'Welcome to the Fishing Competition Portal',
            html,
        });

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
            staffNotes: notes || '',
            createdByStaff: staffMode,
            checkedIn: false,
            status: staffMode ? 'APPROVED' : 'PENDING_APPROVAL',
            amount,
            totalAmount: totalAmount ?? amount,
            createdAt: new Date(),
            updatedAt: new Date(),
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

        const html = renderBookingReceivedEmail({ bookingRef, amount });
        const userRecord = await adminAuth.getUser(user.uid);
        if (userRecord.email) {
            await sendEmail({
                to: userRecord.email,
                subject: 'Booking Received - Pending Approval',
                html,
            });
        }

        return res.json({ bookingId: bookingDoc.id, bookingRef });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to create booking.' });
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

        const recipientEmail = await getUserEmailByBooking(booking);
        if (recipientEmail) {
            const html = renderBookingApprovedEmail({ bookingRef: booking?.bookingRef || '' });
            await sendEmail({
                to: recipientEmail,
                subject: 'Booking Approved',
                html,
            });
        }

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

        const recipientEmail = await getUserEmailByBooking(booking);
        if (recipientEmail) {
            const html = renderBookingRejectedEmail({ bookingRef: booking?.bookingRef || '' });
            await sendEmail({
                to: recipientEmail,
                subject: 'Booking Rejected',
                html,
            });
        }

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
