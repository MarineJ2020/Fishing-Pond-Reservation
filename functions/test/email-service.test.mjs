import assert from 'node:assert/strict';
import test from 'node:test';
import {
    initialBookingEmailKind,
    resolveBookingRecipient,
    shouldQueueBookingApprovedEmail,
} from '../src/email-service.js';

test('initial booking mail matches the persisted booking status', () => {
    assert.equal(initialBookingEmailKind('PENDING_APPROVAL'), 'booking_received');
    assert.equal(initialBookingEmailKind('confirmed'), 'booking_approved');
    assert.equal(initialBookingEmailKind('APPROVED'), 'booking_approved');
    assert.equal(initialBookingEmailKind('LIVE'), 'booking_approved');
});

test('approval mail is queued only on a transition into a confirmed status', () => {
    assert.equal(shouldQueueBookingApprovedEmail('PENDING_APPROVAL', 'APPROVED'), true);
    assert.equal(shouldQueueBookingApprovedEmail('pending', 'confirmed'), true);
    assert.equal(shouldQueueBookingApprovedEmail('APPROVED', 'APPROVED'), false);
    assert.equal(shouldQueueBookingApprovedEmail('CONFIRMED', 'REJECTED'), false);
    assert.equal(shouldQueueBookingApprovedEmail('pending', 'REJECTED'), false);
});

test('legacy booking recipients resolve from email-shaped userId values', async () => {
    assert.equal(
        await resolveBookingRecipient({ userId: 'legacy@example.com' }),
        'legacy@example.com',
    );
});

test('legacy booking recipients resolve from user document references', async () => {
    const userId = {
        get: async () => ({
            exists: true,
            data: () => ({ email: 'profile@example.com' }),
        }),
    };
    assert.equal(
        await resolveBookingRecipient({ userId }),
        'profile@example.com',
    );
});
