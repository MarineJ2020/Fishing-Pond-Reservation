import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bookingSelectionsForTest,
    renderBookingApprovedEmail,
    renderBookingReceivedEmail,
} from '../src/email-templates.js';

const multiPondBooking = {
    bookingRef: 'KKS-TEST',
    amount: 100,
    pondSelections: [
        { pondName: 'Kolam Utara', pondCode: 'A', pondDate: '2026-08-10', seats: [1, 2] },
        { pondName: 'Kolam Selatan', pondCode: 'B', pondDate: '2026-08-11', seats: [7] },
    ],
};

test('booking emails include every pond and seat selection', () => {
    const received = renderBookingReceivedEmail({ booking: multiPondBooking });
    assert.match(received.html, /Kolam Utara/);
    assert.match(received.html, /Kolam Selatan/);
    assert.match(received.html, /A-1/);
    assert.match(received.html, /A-2/);
    assert.match(received.html, /B-7/);
    assert.equal(bookingSelectionsForTest(multiPondBooking).length, 2);
});

test('approved email creates one QR for every selected peg', () => {
    const approved = renderBookingApprovedEmail({
        bookingId: 'booking-123',
        booking: multiPondBooking,
        appUrl: 'https://example.test',
    });
    assert.equal((approved.html.match(/api\.qrserver\.com/g) || []).length, 3);
    assert.match(approved.html, /Kolam Utara &middot; A-1/);
    assert.match(approved.html, /Kolam Selatan &middot; B-7/);
});

test('booking-controlled fields are HTML escaped', () => {
    const received = renderBookingReceivedEmail({
        booking: {
            ...multiPondBooking,
            bookingRef: '<script>alert(1)</script>',
            pondSelections: [{ pondName: '<img src=x>', pondCode: 'A', seats: [1] }],
        },
    });
    assert.doesNotMatch(received.html, /<script>|<img src=x>/);
    assert.match(received.html, /&lt;script&gt;/);
    assert.match(received.html, /&lt;img src=x&gt;/);
});
