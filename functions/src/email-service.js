import { adminDb } from './auth-utils.js';
import {
    renderBalanceReminderEmail,
    renderBookingApprovedEmail,
    renderBookingCancelledEmail,
    renderBookingReceivedEmail,
    renderPasswordResetEmail,
    renderReceiptRejectedEmail,
    renderVerificationEmail,
    renderWelcomeEmail,
} from './email-templates.js';

export const APP_URL = process.env.APP_URL || 'https://kolamkelisayang.com.my';
export const STAFF_CC = 'hello@kolamkelisayang.com.my';
const MAIL_COLLECTION = 'mail';

const isEmail = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const isConfirmedStatus = (status) =>
    ['APPROVED', 'CONFIRMED', 'LIVE'].includes(String(status || '').toUpperCase());

export const initialBookingEmailKind = (status) =>
    isConfirmedStatus(status) ? 'booking_approved' : 'booking_received';

export const shouldQueueBookingApprovedEmail = (beforeStatus, afterStatus) =>
    !isConfirmedStatus(beforeStatus) && isConfirmedStatus(afterStatus);

const timestampIso = (value) => {
    if (!value) return '';
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

// Never expose `message` from mail jobs: verification and password-reset HTML
// can contain one-time account links. The CMS only needs operational metadata.
export const safeMailLogEntry = (id, data = {}) => {
    const recipients = Array.isArray(data.to) ? data.to : [data.to];
    const recipient = recipients.map((value) => String(value || '').trim()).filter(Boolean).join(', ');
    const accepted = Array.isArray(data.delivery?.info?.accepted)
        ? data.delivery.info.accepted.map((value) => String(value || '').trim().toLowerCase())
        : [];
    return {
        id,
        recipient,
        kind: String(data.metadata?.kind || 'unknown'),
        triggeredAt: timestampIso(data.metadata?.queuedAt || data.createdAt),
        completedAt: timestampIso(data.delivery?.endTime),
        status: String(data.delivery?.state || 'PENDING'),
        attempts: Number(data.delivery?.attempts) || 0,
        recipientAccepted: accepted.includes(recipient.toLowerCase()),
    };
};

export const resolveBookingRecipient = async (booking) => {
    if (isEmail(booking.userEmail)) return booking.userEmail.trim();
    if (isEmail(booking.userId)) return booking.userId.trim();
    if (booking.userId && typeof booking.userId.get === 'function') {
        const userSnap = await booking.userId.get();
        const email = userSnap.exists ? userSnap.data()?.email : '';
        if (isEmail(email)) return email.trim();
    }
    return '';
};

const mailMetadata = ({ kind, bookingId, userId, anchorMs }) => ({
    kind,
    retryable: true,
    ...(bookingId ? { bookingId } : {}),
    ...(userId ? { userId } : {}),
    ...(anchorMs ? { anchorMs } : {}),
    queuedAt: new Date(),
});

// ccStaff defaults to true (staff keep a copy of booking correspondence) but must
// be false for anything carrying an account-access link — a password-reset link in
// the shared staff inbox would be an account-takeover vector.
export const createMailJob = async ({ id, to, message, kind, bookingId, userId, anchorMs, ccStaff = true }) => {
    if (!isEmail(to)) return { created: false, reason: 'missing-recipient' };
    const ref = id
        ? adminDb.collection(MAIL_COLLECTION).doc(id)
        : adminDb.collection(MAIL_COLLECTION).doc();
    try {
        await ref.create({
            to,
            ...(ccStaff ? { cc: [STAFF_CC] } : {}),
            message,
            metadata: mailMetadata({ kind, bookingId, userId, anchorMs }),
            createdAt: new Date(),
        });
        return { created: true, id: ref.id };
    } catch (error) {
        if (error?.code === 6 || error?.code === 'already-exists') {
            return { created: false, id: ref.id, reason: 'already-exists' };
        }
        throw error;
    }
};

export const queueWelcomeMail = ({ uid, email, name }) => createMailJob({
    id: `welcome_${uid}`,
    to: email,
    kind: 'welcome',
    userId: uid,
    message: renderWelcomeEmail({ name, appUrl: APP_URL }),
});

export const queueVerificationMail = ({ uid, email, link, requestWindow }) => createMailJob({
    id: `verification_${uid}_${requestWindow}`,
    to: email,
    kind: 'verification',
    userId: uid,
    message: renderVerificationEmail({ link }),
});

export const queuePasswordResetMail = ({ uid, email, link, name, requestWindow }) => createMailJob({
    id: `password_reset_${uid}_${requestWindow}`,
    to: email,
    kind: 'password_reset',
    userId: uid,
    ccStaff: false,
    message: renderPasswordResetEmail({ link, name }),
});

export const queueBookingLifecycleMail = async ({ bookingId, booking, kind }) => {
    const recipient = await resolveBookingRecipient(booking);
    const message = kind === 'booking_approved'
        ? renderBookingApprovedEmail({ bookingId, booking, appUrl: APP_URL })
        : renderBookingReceivedEmail({ booking });
    return createMailJob({
        id: `${kind}_${bookingId}`,
        to: recipient,
        kind,
        bookingId,
        message,
    });
};

const timestampMs = (value) => {
    if (!value) return 0;
    const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

// Receipts that moved into 'rejected' in this update. A legacy booking with no
// receipts array before counts its first receipt as previously unrejected.
export const newlyRejectedReceipts = (before = {}, after = {}) => {
    const previous = Array.isArray(before.receipts) ? before.receipts : [];
    const current = Array.isArray(after.receipts) ? after.receipts : [];
    return current
        .map((receipt, index) => ({ receipt, index }))
        .filter(({ receipt, index }) => receipt?.status === 'rejected' && previous[index]?.status !== 'rejected');
};

export const queueReceiptRejectedMail = async ({ bookingId, before, after, receipt, index }) => {
    const recipient = await resolveBookingRecipient(after);
    const bookingCancelled = String(after.status || '').toUpperCase() === 'REJECTED'
        && String(before.status || '').toUpperCase() !== 'REJECTED';
    // One email per rejection event; a replaced-then-rejected-again receipt gets a new one.
    const eventMs = timestampMs(receipt.rejectedAt) || timestampMs(after.updatedAt) || Date.now();
    return createMailJob({
        id: `receipt_rejected_${bookingId}_${index}_${eventMs}`,
        to: recipient,
        kind: 'receipt_rejected',
        bookingId,
        message: renderReceiptRejectedEmail({
            bookingId, booking: after, receiptIndex: index, amount: receipt.amount,
            reason: receipt.rejectReason, bookingCancelled, appUrl: APP_URL,
        }),
    });
};

// A confirmed booking moved to REJECTED = staff force-cancel. Rejecting a
// pending booking's receipt never starts from a confirmed status, so the
// receipt-rejected mail and this one cannot both fire for one update.
export const shouldQueueBookingCancelledEmail = (before = {}, after = {}) =>
    isConfirmedStatus(before.status) && String(after.status || '').toUpperCase() === 'REJECTED';

export const queueBookingCancelledMail = async ({ bookingId, booking }) => {
    const recipient = await resolveBookingRecipient(booking);
    const eventMs = timestampMs(booking.cancelledAt) || timestampMs(booking.updatedAt) || Date.now();
    return createMailJob({
        id: `booking_cancelled_${bookingId}_${eventMs}`,
        to: recipient,
        kind: 'booking_cancelled',
        bookingId,
        message: renderBookingCancelledEmail({ bookingId, booking, reason: booking.cancelReason, appUrl: APP_URL }),
    });
};

export const queueBalanceReminderMail = async ({ bookingId, booking, balanceDue, id, anchorMs }) => {
    const recipient = await resolveBookingRecipient(booking);
    return createMailJob({
        id,
        to: recipient,
        kind: 'balance_reminder',
        bookingId,
        anchorMs,
        message: renderBalanceReminderEmail({ bookingId, booking, balanceDue, appUrl: APP_URL }),
    });
};
