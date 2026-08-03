import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bookingSeatEntries,
    buildCancelCheckInState,
    buildCheckInState,
} from '../src/booking-seats.js';

const multiPondBooking = {
    pondSelections: [
        { pondId: 2, seats: [5] },
        { pondId: 6, seats: [249] },
    ],
    checkedInSeats: [],
    checkedInSeatTimes: {},
};

test('flattens every pond selection instead of only the primary seats', () => {
    assert.deepEqual(bookingSeatEntries(multiPondBooking), [
        { key: '2:5', pondId: '2', seatNum: 5 },
        { key: '6:249', pondId: '6', seatNum: 249 },
    ]);
});

test('checks in one pond-specific peg and completes only after every peg arrives', () => {
    const first = buildCheckInState(multiPondBooking, { seatNum: 5, pondId: 2, checkedAt: '2026-08-03T10:00:00.000Z' });
    assert.equal(first.checkedIn, false);
    assert.deepEqual(first.checkedInSeatKeys, ['2:5']);
    assert.equal(first.checkedInSeatTimes['2:5'], '2026-08-03T10:00:00.000Z');

    const second = buildCheckInState({ ...multiPondBooking, ...first }, { seatNum: 249, pondId: 6, checkedAt: '2026-08-03T10:01:00.000Z' });
    assert.equal(second.checkedIn, true);
    assert.deepEqual(second.checkedInSeatKeys.sort(), ['2:5', '6:249']);
});

test('same numeric seat in different ponds remains independently checkable', () => {
    const duplicateNumbers = {
        pondSelections: [{ pondId: 2, seats: [5] }, { pondId: 6, seats: [5] }],
    };
    const checked = buildCheckInState(duplicateNumbers, { seatNum: 5, pondId: 6 });
    assert.deepEqual(checked.checkedInSeatKeys, ['6:5']);
    assert.equal(checked.checkedIn, false);
});

test('cancel removes only the requested pond-specific peg', () => {
    const state = {
        ...multiPondBooking,
        checkedInSeatKeys: ['2:5', '6:249'],
        checkedInSeats: [5, 249],
        checkedInSeatTimes: { '2:5': 'a', '6:249': 'b' },
    };
    const cancelled = buildCancelCheckInState(state, { seatNum: 5, pondId: 2 });
    assert.deepEqual(cancelled.checkedInSeatKeys, ['6:249']);
    assert.deepEqual(cancelled.checkedInSeats, [249]);
    assert.equal(cancelled.checkedIn, false);
});

test('legacy seatNumbers bookings still check in', () => {
    const legacy = { pondId: { id: 'pond-a' }, seatNumbers: [9] };
    const checked = buildCheckInState(legacy, { seatNum: 9 });
    assert.deepEqual(checked.checkedInSeatKeys, ['pond-a:9']);
    assert.equal(checked.checkedIn, true);
});
