import test from 'node:test';
import assert from 'node:assert/strict';
import { pegZoneRanges, zoneForPeg } from '../src/peg-zones.js';
import { renderBookingApprovedEmail, renderBookingReceivedEmail } from '../src/email-templates.js';

// Layout from the peg-number PDF: Aisyah 1-233 Zon A / 234-465 Zon B, Bella 466-699 A / 700-934 B.
const ponds = [
    { startNumber: 1, totalSeats: 465, leftCount: 233, leftZone: 'A' },
    { startNumber: 466, totalSeats: 469, leftCount: 234, leftZone: 'A' },
    { startNumber: 935, totalSeats: 100, leftCount: 40, leftZone: 'B' },
];
const ranges = pegZoneRanges(ponds);

test('zoneForPeg maps pegs to the left/right zone of their pond', () => {
    assert.equal(zoneForPeg(ranges, 1), 'A');
    assert.equal(zoneForPeg(ranges, 233), 'A');
    assert.equal(zoneForPeg(ranges, 234), 'B');
    assert.equal(zoneForPeg(ranges, 465), 'B');
    assert.equal(zoneForPeg(ranges, 472), 'A');
    assert.equal(zoneForPeg(ranges, 473), 'A');
    assert.equal(zoneForPeg(ranges, 700), 'B');
    // leftZone B flips the sides
    assert.equal(zoneForPeg(ranges, 935), 'B');
    assert.equal(zoneForPeg(ranges, 975), 'A');
    assert.equal(zoneForPeg(ranges, 5000), null);
});

test('booking emails print "peg (Zon X)" in the summary and on each QR card', () => {
    const booking = { bookingRef: 'KKS-Z', amount: 100, pondSelections: [{ pondId: 2, pondName: 'Bella', seats: [472, 473] }] };
    const competition = { name: 'Test', pegZones: ranges };
    const received = renderBookingReceivedEmail({ booking, competition });
    assert.match(received.text, /472 \(Zon A\), 473 \(Zon A\)/);
    assert.match(received.html, /472 \(Zon A\)/);
    const approved = renderBookingApprovedEmail({ bookingId: 'b1', booking, competition, appUrl: 'https://x.my' });
    assert.match(approved.html, /Bella &middot; 472 \(Zon A\)/);
    assert.match(approved.html, /t=472\+%28Zon\+A%29/);
});

test('without pond data emails fall back to the bare peg number', () => {
    const booking = { bookingRef: 'KKS-Z', amount: 100, pondSelections: [{ pondId: 2, pondName: 'Bella', seats: [472] }] };
    const received = renderBookingReceivedEmail({ booking });
    assert.match(received.text, /Bella: 472(\n|$)/);
});
