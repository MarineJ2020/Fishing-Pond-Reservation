import test from 'node:test';
import assert from 'node:assert/strict';
import { claimId, receiptPath, receiptUpdate, validateBookingWindow, validateSelections } from '../src/booking-policy.js';

const now = Date.parse('2026-09-09T04:00:00Z');
const competition = { eventDate: '2026-09-09T02:00:00Z', endDate: '2026-09-09T10:00:00Z', pricePerPeg: 101 };
const ponds = [{ id: 1, docId: 'pond-a', name: 'A', open: true, seats: [{ id: 'a1', seatNumber: 1 }, { id: 'a2', seatNumber: 2 }] }];
const payload = { paymentType: 'deposit', amount: 1, totalAmount: 1, pondSelections: [{ pondId: 1, seats: [1] }] };

test('booking windows match open and close boundaries, end fallback and hidden status', () => {
    assert.doesNotThrow(() => validateBookingWindow(competition, now));
    assert.doesNotThrow(() => validateBookingWindow({ ...competition, bookingOpenAt: new Date(now), bookingCloseAt: new Date(now) }, now));
    for (const overrides of [{ status: 'DRAFT' }, { status: 'INACTIVE' }, { endDate: new Date(now) }, { bookingOpenAt: new Date(now + 1) }, { bookingCloseAt: new Date(now - 1) }, { endDate: null }]) {
        assert.throws(() => validateBookingWindow({ ...competition, ...overrides }, now));
    }
    // Future event dates are bookable when their existing booking window is open.
    assert.doesNotThrow(() => validateBookingWindow({ ...competition, eventDate: new Date(now + 1000) }, now));
});

test('server price and deposit ignore forged totals', () => {
    const result = validateSelections(payload, competition, ponds);
    assert.equal(result.totalAmount, 101);
    assert.equal(result.amount, 51);
    assert.equal(validateSelections({ ...payload, paymentType: 'full' }, competition, ponds).amount, 101);
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
