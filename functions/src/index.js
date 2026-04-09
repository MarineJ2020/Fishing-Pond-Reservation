import express from 'express';
import cors from 'cors';
import { json } from 'body-parser';
import * as functions from 'firebase-functions';
import { adminAuth, adminDb, verifyToken, requireStaff } from './auth-utils';
import { sendEmail } from './email';
import { renderToStaticMarkup } from 'react-dom/server';
const app = express();
app.use(cors({ origin: true }));
app.use(json());
const randomTempPassword = () => Math.random().toString(36).slice(2, 10) + '!1A';
app.post('/createClientAccount', verifyToken, requireStaff, async (req, res) => {
    const { name, email, phone } = req.body;
    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required.' });
    }
    try {
        let userRecord;
        try {
            userRecord = await adminAuth.getUserByEmail(email);
        }
        catch (error) {
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
        }, { merge: true });
        const html = renderToStaticMarkup(name, { name }, email = { email }, appUrl = { process, : .env.APP_URL || 'https://your-app-url.com' } /  >
        );
        await sendEmail({
            to: email,
            subject: 'Welcome to the Fishing Competition Portal',
            html,
        });
        return res.json({ success: true, uid: userRecord.uid });
    }
    catch (error) {
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
        const bookingQuery = await adminDb.collection('bookings')
            .where('competitionId', '==', adminDb.doc(`competitions/${competitionId}`))
            .where('seatIds', 'array-contains', adminDb.doc(`seats/${seatId}`))
            .where('status', 'in', ['APPROVED', 'CONFIRMED', 'LIVE'])
            .get();
        if (!bookingQuery.empty) {
            return res.status(409).json({ error: 'Seat has already been booked.' });
        }
        const lockRef = await adminDb.collection('seatLocks').add({
            seatId: adminDb.doc(`seats/${seatId}`),
            userId: adminDb.doc(`users/${user.uid}`),
            competitionId: adminDb.doc(`competitions/${competitionId}`),
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        });
        return res.json({ lockId: lockRef.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to acquire seat lock.' });
    }
});
app.post('/createBooking', verifyToken, async (req, res) => {
    const { competitionId, pondId, seatIds, seatNumbers, paymentType, amount, totalAmount, receiptUrl, notes, createdByStaff } = req.body;
    const user = req.user;
    if (!competitionId || !pondId || !seatIds?.length || !paymentType || amount == null) {
        return res.status(400).json({ error: 'Missing booking payload.' });
    }
    try {
        const bookingRef = `BKG-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
        const bookingDoc = await adminDb.collection('bookings').add({
            bookingRef,
            userId: adminDb.doc(`users/${user.uid}`),
            competitionId: adminDb.doc(`competitions/${competitionId}`),
            pondId: adminDb.doc(`ponds/${pondId}`),
            seatIds: seatIds.map((id) => adminDb.doc(`seats/${id}`)),
            seatNumbers: seatNumbers || [],
            paymentType,
            paymentStatus: createdByStaff ? 'APPROVED' : 'PENDING_APPROVAL',
            receiptUrl: receiptUrl || null,
            staffNotes: notes || '',
            createdByStaff: !!createdByStaff,
            checkedIn: false,
            status: createdByStaff ? 'APPROVED' : 'PENDING_APPROVAL',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        await adminDb.collection('bookings').doc(bookingDoc.id).collection('payments').add({
            amount,
            type: paymentType,
            method: receiptUrl ? 'receipt' : 'manual',
            recordedBy: user.uid,
            createdAt: new Date(),
        });
        await adminDb.collection('seatLocks')
            .where('competitionId', '==', adminDb.doc(`competitions/${competitionId}`))
            .where('userId', '==', adminDb.doc(`users/${user.uid}`))
            .get()
            .then((snapshot) => {
            snapshot.forEach((docSnap) => docSnap.ref.delete());
        });
        const html = renderToStaticMarkup(bookingRef, { bookingRef }, amount = { amount }, appUrl = { process, : .env.APP_URL || 'https://your-app-url.com' } /  >
        );
        const userRecord = await adminAuth.getUser(user.uid);
        await sendEmail({
            to: userRecord.email || '',
            subject: 'Booking Received — Pending Approval',
            html,
        });
        return res.json({ bookingId: bookingDoc.id, bookingRef });
    }
    catch (error) {
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
        const bookingRef = adminDb.collection('bookings').doc(bookingId);
        await bookingRef.update({ status: 'APPROVED', updatedAt: new Date() });
        const bookingSnap = await bookingRef.get();
        const booking = bookingSnap.data();
        const userId = booking.userId?.id;
        const userRecord = userId ? await adminAuth.getUser(userId) : null;
        const html = renderToStaticMarkup(bookingRef, { booking, bookingRef } || '');
    }
    finally { }
    appUrl = { process, : .env.APP_URL || 'https://your-app-url.com' } /  > ;
});
if (userRecord?.email) {
    await sendEmail({
        to: userRecord.email,
        subject: 'Booking Approved',
        html,
    });
}
return res.json({ success: true });
try { }
catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to approve booking.' });
}
;
app.post('/rejectBooking', verifyToken, requireStaff, async (req, res) => {
    const { bookingId } = req.body;
    if (!bookingId) {
        return res.status(400).json({ error: 'bookingId is required.' });
    }
    try {
        const bookingRef = adminDb.collection('bookings').doc(bookingId);
        await bookingRef.update({ status: 'REJECTED', updatedAt: new Date() });
        const bookingSnap = await bookingRef.get();
        const booking = bookingSnap.data();
        const userId = booking.userId?.id;
        const userRecord = userId ? await adminAuth.getUser(userId) : null;
        const html = renderToStaticMarkup(bookingRef, { booking, bookingRef } || '');
    }
    finally { }
    appUrl = { process, : .env.APP_URL || 'https://your-app-url.com' } /  > ;
});
if (userRecord?.email) {
    await sendEmail({
        to: userRecord.email,
        subject: 'Booking Rejected',
        html,
    });
}
return res.json({ success: true });
try { }
catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to reject booking.' });
}
;
app.post('/checkInBooking', verifyToken, async (req, res) => {
    const { bookingRef, amount, method } = req.body;
    if (!bookingRef || amount == null || !method) {
        return res.status(400).json({ error: 'bookingRef, amount and method are required.' });
    }
    try {
        const bookingQuery = await adminDb.collection('bookings').where('bookingRef', '==', bookingRef).get();
        if (bookingQuery.empty) {
            return res.status(404).json({ error: 'Booking not found.' });
        }
        const bookingDoc = bookingQuery.docs[0];
        await bookingDoc.ref.update({ checkedIn: true, checkedInAt: new Date(), updatedAt: new Date() });
        await bookingDoc.ref.collection('payments').add({
            amount,
            method,
            recordedBy: req.user.uid,
            createdAt: new Date(),
        });
        return res.json({ success: true });
    }
    catch (error) {
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
            .get();
        let resultRef;
        if (resultQuery.empty) {
            resultRef = await adminDb.collection('eventResults').add({
                bookingId: bookingRef,
                competitionId: competitionRef,
                totalWeight,
                fishCount,
                updatedAt: new Date(),
                updatedBy: req.user.uid,
            });
        }
        else {
            resultRef = resultQuery.docs[0].ref;
            await resultRef.update({ totalWeight, fishCount, updatedAt: new Date(), updatedBy: req.user.uid });
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
    }
    catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to update event result.' });
    }
});
export const api = functions.https.onRequest(app);
