import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingPegs, claimId, legacySeatIds, receiptPath, receiptUpdate, validateBookingWindow, validateSelections } from '../src/booking-policy.js';

const now = Date.parse('2026-09-09T04:00:00Z');
const competition = { eventDate: '2026-09-09T02:00:00Z', endDate: '2026-09-09T10:00:00Z', pricePerPeg: 101 };
const ponds = [{ id: 1, docId: 'pond-a', name: 'A', open: true, seats: [{ id: 'a1', seatNumber: 1 }, { id: 'a2', seatNumber: 2 }] }];
const payload = { paymentType: 'full', amount: 1, totalAmount: 1, pondSelections: [{ pondId: 1, seats: [1] }] };

test('booking windows match open and close boundaries, end fallback and hidden status', () => {
    assert.doesNotThrow(() => validateBookingWindow(competition, now));
    assert.doesNotThrow(() => validateBookingWindow({ ...competition, bookingOpenAt: new Date(now), bookingCloseAt: new Date(now) }, now));
    for (const overrides of [{ status: 'DRAFT' }, { status: 'INACTIVE' }, { endDate: new Date(now) }, { bookingOpenAt: new Date(now + 1) }, { bookingCloseAt: new Date(now - 1) }, { endDate: null }]) {
        assert.throws(() => validateBookingWindow({ ...competition, ...overrides }, now));
    }
    // Future event dates are bookable when their existing booking window is open.
    assert.doesNotThrow(() => validateBookingWindow({ ...competition, eventDate: new Date(now + 1000) }, now));
});

test('server price ignores forged totals and rejects deposits', () => {
    const result = validateSelections(payload, competition, ponds);
    assert.equal(result.totalAmount, 101);
    assert.equal(result.amount, 101);
    assert.throws(() => validateSelections({ ...payload, paymentType: 'deposit' }, competition, ponds));
});

test('invalid, duplicate, disabled and out-of-cap pegs cannot be booked', () => {
    for (const seats of [[1, 1], [3], ['1'], []]) assert.throws(() => validateSelections({ ...payload, pondSelections: [{ pondId: 1, seats }] }, competition, ponds));
    assert.throws(() => validateSelections(payload, { ...competition, activePondIds: ['other'] }, ponds));
    assert.throws(() => validateSelections(payload, { ...competition, pondSeats: { 'pond-a': 0 } }, ponds));
    assert.throws(() => validateSelections(payload, competition, [{ ...ponds[0], open: false }]));
    assert.throws(() => validateSelections(payload, competition, [{ ...ponds[0], seatLayout: [{ num: 1, active: false }] }]));
});

test('claim keys isolate competition, pond and peg, without delimiter collisions', () => {
    assert.notEqual(claimId('a-b', 'c', 1), claimId('a', 'b-c', 1));
    assert.notEqual(claimId('a', 'b', 1), claimId('a', 'c', 1));
    assert.notEqual(claimId('a', 'b', 1), claimId('c', 'b', 1));
});

test('receipt paths require the configured bucket and authenticated uploader', () => {
    const url = 'https://firebasestorage.googleapis.com/v0/b/test-bucket/o/fishing-pond-receipts%2Fowner%2Fphoto.jpg?alt=media&token=abc';
    assert.equal(receiptPath(url, 'owner', 'test-bucket'), 'fishing-pond-receipts/owner/photo.jpg');
    assert.throws(() => receiptPath(url, 'other', 'test-bucket'));
    assert.throws(() => receiptPath(url, 'owner', 'other-bucket'));
    assert.throws(() => receiptPath(url.replace('firebasestorage.googleapis.com', 'evil.example'), 'owner', 'test-bucket'));
});

test('balance receipts preserve accepted history and cannot change financial fields', () => {
    const booking = { status: 'APPROVED', totalAmount: 200, paidAmount: 100, receipts: [{ url: 'old', status: 'accepted', amount: 100 }] };
    const next = receiptUpdate(booking, { receiptUrl: 'new', amount: 100 });
    assert.deepEqual(next.receipts[0], booking.receipts[0]);
    assert.equal(next.receipts[1].status, 'pending');
    assert.equal('paidAmount' in next, false);
    assert.equal('status' in next, false);
    for (const amount of [-1, 0, NaN, Infinity, 101, '100']) assert.throws(() => receiptUpdate(booking, { receiptUrl: 'new', amount }));
    assert.throws(() => receiptUpdate(booking, { receiptUrl: 'new', receiptIndex: 0 }));
});

test('rejected receipt replacement retains amount, and legacy receipts remain supported', () => {
    const booking = { status: 'APPROVED', totalAmount: 200, receipts: [{ url: 'old', status: 'rejected', amount: 100 }] };
    const next = receiptUpdate(booking, { receiptUrl: 'new', receiptIndex: 0, amount: 999 });
    assert.equal(next.receipts[0].amount, 100);
    assert.equal(next.receipts[0].status, 'pending');
    assert.throws(() => receiptUpdate({ ...booking, status: 'REJECTED' }, { receiptUrl: 'new', receiptIndex: 0 }));
    const legacy = receiptUpdate({ status: 'APPROVED', totalAmount: 200, amount: 100, receiptUrl: 'old' }, { receiptUrl: 'new', amount: 100 });
    assert.equal(legacy.receipts[0].status, 'accepted');
    assert.equal(legacy.receipts[1].status, 'pending');
});

test('legacy seat ids are only needed for selections without seat numbers', () => {
    assert.deepEqual(legacySeatIds({ seatIds: ['s1', { id: 's2' }] }), ['s1', 's2']);
    assert.deepEqual(legacySeatIds({ seatNumbers: [3], seatIds: ['s3'] }), []);
    assert.deepEqual(legacySeatIds({ pondSelections: [{ pondId: 1, seats: [1], seatIds: ['a'] }, { pondId: 2, seatIds: ['b'] }] }), ['b']);
});

test('partial seat loads (claim-mode checkout) apply the same caps and existence checks', () => {
    // Only the requested seat docs are loaded; seats are numbered 1..N.
    const partial = (seats, hasSeatDocs = true) => [{ ...ponds[0], seats, seatsPartial: true, hasSeatDocs }];
    const seat = (n) => ({ id: `a${n}`, seatNumber: n });
    const pick = (seats) => ({ ...payload, pondSelections: [{ pondId: 1, seats }] });
    assert.deepEqual(validateSelections(pick([2]), competition, partial([seat(2)])).selections[0].seatIds, ['a2']);
    assert.throws(() => validateSelections(pick([3]), competition, partial([])), /tidak tersedia/);
    assert.throws(() => validateSelections(pick([3]), { ...competition, pondSeats: { 'pond-a': 2 } }, partial([seat(3)])), /tidak tersedia/);
    assert.doesNotThrow(() => validateSelections(pick([2]), { ...competition, pondSeats: { 'pond-a': 2 } }, partial([seat(2)])));
    assert.throws(() => validateSelections(pick([1]), { ...competition, pondSeats: { 'pond-a': 0 } }, partial([seat(1)])));
    // Pond without any seat docs keeps the totalSeats fallback.
    assert.doesNotThrow(() => validateSelections(pick([5]), competition, [{ ...ponds[0], seats: [], totalSeats: 5, seatsPartial: true, hasSeatDocs: false }]));
    assert.throws(() => validateSelections(pick([6]), competition, [{ ...ponds[0], seats: [], totalSeats: 5, seatsPartial: true, hasSeatDocs: false }]));
});

test('booking pegs resolve numeric and doc-id ponds and legacy seat ids to claim keys', () => {
    const catalog = [{ id: 1, docId: 'pond-a' }, { id: 2, docId: 'pond-b' }];
    assert.deepEqual(bookingPegs({ pondSelections: [{ pondId: 1, seats: [3, 3, 4] }, { pondId: 'pond-b', seats: [1] }] }, catalog, []),
        [{ pondDocId: 'pond-a', num: 3 }, { pondDocId: 'pond-a', num: 4 }, { pondDocId: 'pond-b', num: 1 }]);
    assert.deepEqual(bookingPegs({ pondId: { id: 'pond-b' }, seatIds: ['s9'] }, catalog, [{ id: 's9', data: () => ({ seatNumber: 9 }) }]),
        [{ pondDocId: 'pond-b', num: 9 }]);
    assert.deepEqual(bookingPegs({ pondId: 'gone', seatNumbers: [1] }, catalog, []), []);
});
