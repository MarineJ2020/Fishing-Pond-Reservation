import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bookingSelectionsForTest,
    renderBookingApprovedEmail,
    renderBookingReceivedEmail,
    renderPasswordResetEmail,
    renderReceiptRejectedEmail,
} from '../src/email-templates.js';

const multiPondBooking = {
    bookingRef: 'KKS-TEST',
    amount: 100,
    pondSelections: [
        { pondId: 1, pondName: 'Kolam Utara', pondCode: 'A', pondDate: '2026-08-10', seats: [1, 2] },
        { pondId: 2, pondName: 'Kolam Selatan', pondCode: 'B', pondDate: '2026-08-11', seats: [7] },
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
    assert.match(approved.html, /pond%3D1/);
    assert.match(approved.html, /pond%3D2/);
});

test('password reset email is Malay, branded, and links from a button', () => {
    const link = 'https://kolamkelisayang.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc';
    const reset = renderPasswordResetEmail({ link, name: 'Ahmad' });
    assert.match(reset.subject, /Tetapkan Semula Kata Laluan - Kolam Keli Sayang/);
    assert.doesNotMatch(reset.subject, /project-/);
    assert.match(reset.html, /Tetapkan Kata Laluan Baharu<\/a>/);
    // Button href plus a copy-paste fallback for mail apps that do not linkify.
    assert.equal((reset.html.match(/mode=resetPassword/g) || []).length, 3);
    assert.match(reset.text, /Salam sejahtera Ahmad/);
});

test('password reset email escapes the generated link', () => {
    const reset = renderPasswordResetEmail({ link: 'https://x.test/"><script>alert(1)</script>' });
    assert.doesNotMatch(reset.html, /<script>/);
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

test('receipt rejection email shows the escaped reason and the right next step', () => {
    const booking = { bookingRef: 'KKS-AB12', pondName: 'Aisyah', pondCode: 'A', seatNumbers: [5] };
    const reupload = renderReceiptRejectedEmail({ bookingId: 'b1', booking, receiptIndex: 1, amount: 60, reason: 'Jumlah <salah>', bookingCancelled: false, appUrl: 'https://x.my' });
    assert.match(reupload.subject, /^Resit Ditolak - KKS-AB12$/);
    assert.match(reupload.html, /Jumlah &lt;salah&gt;/);
    assert.doesNotMatch(reupload.html, /<salah>/);
    assert.match(reupload.html, /https:\/\/x\.my\/bookings\/b1/);
    assert.match(reupload.text, /Sebab: Jumlah <salah>/);
    const cancelled = renderReceiptRejectedEmail({ bookingId: 'b1', booking, receiptIndex: 0, amount: 120, reason: '', bookingCancelled: true, appUrl: 'https://x.my' });
    assert.match(cancelled.subject, /^Tempahan Tidak Diluluskan/);
    assert.match(cancelled.html, /https:\/\/x\.my\/book"/);
    assert.match(cancelled.html, /Tiada sebab dinyatakan/);
});
