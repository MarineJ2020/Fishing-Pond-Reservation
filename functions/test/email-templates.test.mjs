import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bookingSelectionsForTest,
    renderBookingApprovedEmail,
    renderBookingCancelledEmail,
    renderBookingRefundedEmail,
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
        booking: { ...multiPondBooking, bookingRef: 'KKS-QR123' },
        competition: { name: 'Piala <Keli>', eventDate: '2026-10-04T00:00:00Z' },
        appUrl: 'https://example.test',
    });
    assert.equal((approved.html.match(/<img src="https:\/\/api\.qrserver\.com/g) || []).length, 3);
    // Printed QRs carry competition, start time and ref under every peg (escaped).
    assert.equal((approved.html.match(/margin-top:4px;">Piala &lt;Keli&gt;/g) || []).length, 3);
    assert.equal((approved.html.match(/Ref: KKS-QR123/g) || []).length, 3);
    assert.match(approved.html, /4 Okt 2026/);
    // Download link and image open our own card page (QR + details), not the bare QR service.
    assert.equal((approved.html.match(/https:\/\/example\.test\/qr-card\?v=/g) || []).length, 6);
    assert.match(approved.html, /&amp;c=Piala\+%3CKeli%3E/);
    assert.equal((approved.html.match(/Muat turun QR/g) || []).length, 3);
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
    assert.match(reupload.subject, /^Slip Bayaran Ditolak - KKS-AB12$/);
    assert.match(reupload.html, /Jumlah &lt;salah&gt;/);
    assert.doesNotMatch(reupload.html, /<salah>/);
    assert.match(reupload.html, /https:\/\/x\.my\/bookings\/b1/);
    assert.match(reupload.text, /Sebab: Jumlah <salah>/);
    const cancelled = renderReceiptRejectedEmail({ bookingId: 'b1', booking, receiptIndex: 0, amount: 120, reason: '', bookingCancelled: true, appUrl: 'https://x.my' });
    assert.match(cancelled.subject, /^Tempahan Tidak Diluluskan/);
    assert.match(cancelled.html, /https:\/\/x\.my\/book"/);
    assert.match(cancelled.html, /Tiada sebab dinyatakan/);
});

test('cancellation email shows the escaped reason and the booking pegs', () => {
    const booking = { bookingRef: 'KKS-CX99', pondName: 'Bella', pondCode: 'B', seatNumbers: [7, 8] };
    const mail = renderBookingCancelledEmail({ bookingId: 'b9', booking, reason: 'Kolam <ditutup>', appUrl: 'https://x.my' });
    assert.equal(mail.subject, 'Tempahan Dibatalkan - KKS-CX99');
    assert.match(mail.html, /Kolam &lt;ditutup&gt;/);
    assert.doesNotMatch(mail.html, /<ditutup>/);
    assert.match(mail.html, /B-7, B-8/);
    assert.match(renderBookingCancelledEmail({ bookingId: 'b9', booking, reason: '', appUrl: 'https://x.my' }).html, /Tiada sebab dinyatakan/);
});

test('booking summary shows booking time, competition schedule and pegs in Malaysia time', () => {
    const booking = {
        bookingRef: 'KKS-GM726UJ8', competitionName: 'Pertandingan Bulanan Okt',
        createdAt: new Date('2026-10-02T04:15:00Z'),
        pondSelections: [{ pondName: 'Bella', pondCode: 'B', seats: [7, 8] }, { pondName: 'Aisyah', pondCode: 'A', seats: [3] }],
    };
    const competition = { eventDate: new Date('2026-10-04T00:00:00Z'), endDate: new Date('2026-10-04T10:00:00Z') };
    const mail = renderBookingReceivedEmail({ booking, competition });
    assert.match(mail.html, /Tarikh &amp; Masa Tempahan/);
    assert.match(mail.html, /Jum, 2 Okt 2026, 12:15 PTG/);
    assert.match(mail.html, /Pertandingan Bulanan Okt/);
    assert.match(mail.html, /Ahd, 4 Okt 2026, 8:00 PG – 6:00 PTG/);
    assert.match(mail.html, /Bella: B-7, B-8<br\/>Aisyah: A-3/);
    assert.doesNotMatch(mail.html, /Tarikh: -/);
    assert.match(mail.text, /Kolam & No\. Pancang: Bella: B-7, B-8; Aisyah: A-3/);
    // Missing competition doc degrades to '-' rather than failing the email.
    assert.match(renderBookingReceivedEmail({ booking }).html, /Tarikh &amp; Masa Pertandingan<\/td>\s*<td[^>]*>-<\/td>/);
});

test('cancellation email explains the money outcome for each cancel type', () => {
    const base = { bookingRef: 'KKS-NS1', pondName: 'Bella', pondCode: 'B', seatNumbers: [3] };
    const noShow = renderBookingCancelledEmail({ bookingId: 'b1', booking: { ...base, cancelType: 'no_show_forfeit' }, reason: 'Tidak hadir', appUrl: 'https://x.my', rulesPdfUrl: 'https://cdn.x/rules.pdf' });
    assert.equal(noShow.subject, 'Tempahan Dibatalkan (Tidak Hadir) - KKS-NS1');
    assert.match(noShow.html, /tidak dikembalikan/);
    assert.match(noShow.html, /https:\/\/cdn\.x\/rules\.pdf/);
    assert.doesNotMatch(noShow.html, /termasuk bayaran yang telah dibuat/);

    const refund = renderBookingCancelledEmail({ bookingId: 'b1', booking: { ...base, cancelType: 'refund', refundAmount: 80 }, reason: 'Kolam ditutup', appUrl: 'https://x.my' });
    assert.match(refund.html, /RM 80\.00/);
    assert.match(refund.text, /Bayaran balik sebanyak RM 80\.00/);

    const legacy = renderBookingCancelledEmail({ bookingId: 'b1', booking: base, reason: 'x', appUrl: 'https://x.my' });
    assert.match(legacy.html, /termasuk bayaran yang telah dibuat/);
});

test('refund email shows amount and escaped transfer reference', () => {
    const booking = { bookingRef: 'KKS-RF1', pondName: 'Bella', pondCode: 'B', seatNumbers: [3], refundAmount: 50, refundReference: 'DuitNow <123>' };
    const mail = renderBookingRefundedEmail({ bookingId: 'b2', booking, appUrl: 'https://x.my' });
    assert.equal(mail.subject, 'Bayaran Balik Dibuat - KKS-RF1');
    assert.match(mail.html, /RM 50\.00/);
    assert.match(mail.html, /DuitNow &lt;123&gt;/);
    assert.doesNotMatch(mail.html, /<123>/);
});
