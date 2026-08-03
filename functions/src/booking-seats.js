const normalizePondId = (value) => {
    if (value == null) return '';
    if (typeof value === 'object') {
        if (value.id != null) return String(value.id);
        if (typeof value.path === 'string') return String(value.path.split('/').pop() || '');
    }
    return String(value);
};

export const bookingSeatKey = (pondId, seatNum) =>
    `${normalizePondId(pondId) || 'legacy'}:${Number(seatNum)}`;

/** Flatten all current and legacy booking seat shapes into unique peg entries. */
export const bookingSeatEntries = (booking) => {
    const selections = Array.isArray(booking?.pondSelections) && booking.pondSelections.length
        ? booking.pondSelections
        : [{
            pondId: booking?.pondId,
            seats: Array.isArray(booking?.seatNumbers)
                ? booking.seatNumbers
                : (Array.isArray(booking?.seats) ? booking.seats : []),
        }];
    const seen = new Set();
    const entries = [];
    selections.forEach((selection) => {
        const pondId = normalizePondId(selection?.pondId);
        const seats = Array.isArray(selection?.seats) ? selection.seats : [];
        seats.forEach((rawSeat) => {
            const seatNum = Number(rawSeat);
            if (!Number.isFinite(seatNum)) return;
            const key = bookingSeatKey(pondId, seatNum);
            if (seen.has(key)) return;
            seen.add(key);
            entries.push({ key, pondId, seatNum });
        });
    });
    return entries;
};

const priorCheckedKeys = (booking, entries) => {
    const keys = new Set(
        (Array.isArray(booking?.checkedInSeatKeys) ? booking.checkedInSeatKeys : [])
            .map(String),
    );
    // Migrate legacy numeric check-in state. If the same number appears in two
    // ponds, the old schema could not distinguish them, so both are preserved.
    const legacySeats = new Set(
        (Array.isArray(booking?.checkedInSeats) ? booking.checkedInSeats : [])
            .map(Number)
            .filter(Number.isFinite),
    );
    entries.forEach((entry) => {
        if (legacySeats.has(entry.seatNum)) keys.add(entry.key);
    });
    return keys;
};

const matchingEntries = (entries, seatNum, pondId) => {
    if (seatNum == null) return entries;
    const numericSeat = Number(seatNum);
    const bySeat = entries.filter((entry) => entry.seatNum === numericSeat);
    if (pondId == null || pondId === '') return bySeat;
    const normalizedPond = normalizePondId(pondId);
    const exact = bySeat.filter((entry) => entry.pondId === normalizedPond);
    // Legacy bookings can carry a pond document ID while the QR has the old
    // numeric model ID. A unique seat match is still safe in that case.
    return exact.length ? exact : (bySeat.length === 1 ? bySeat : []);
};

const checkedSeatNumbers = (entries, checkedKeys) =>
    Array.from(new Set(entries.filter((entry) => checkedKeys.has(entry.key)).map((entry) => entry.seatNum)));

export const buildCheckInState = (booking, { seatNum, pondId, checkedAt = new Date().toISOString() } = {}) => {
    const entries = bookingSeatEntries(booking);
    const targets = matchingEntries(entries, seatNum, pondId);
    if (!targets.length) throw new Error('Seat is not part of this booking.');

    const priorKeys = priorCheckedKeys(booking, entries);
    const isFirstArrival = priorKeys.size === 0;
    const nextKeys = new Set(priorKeys);
    targets.forEach((entry) => nextKeys.add(entry.key));
    const nextTimes = booking?.checkedInSeatTimes && typeof booking.checkedInSeatTimes === 'object'
        ? { ...booking.checkedInSeatTimes }
        : {};
    targets.forEach((entry) => {
        if (!nextTimes[entry.key]) nextTimes[entry.key] = checkedAt;
    });

    return {
        checkedInSeatKeys: Array.from(nextKeys),
        checkedInSeats: checkedSeatNumbers(entries, nextKeys),
        checkedIn: entries.every((entry) => nextKeys.has(entry.key)),
        checkedInAt: checkedAt,
        checkedInSeatTimes: nextTimes,
        isFirstArrival,
    };
};

export const buildCancelCheckInState = (booking, { seatNum, pondId } = {}) => {
    const entries = bookingSeatEntries(booking);
    const targets = matchingEntries(entries, seatNum, pondId);
    if (!targets.length) throw new Error('Seat is not part of this booking.');

    const nextKeys = priorCheckedKeys(booking, entries);
    const nextTimes = booking?.checkedInSeatTimes && typeof booking.checkedInSeatTimes === 'object'
        ? { ...booking.checkedInSeatTimes }
        : {};
    targets.forEach((entry) => {
        nextKeys.delete(entry.key);
        delete nextTimes[entry.key];
    });
    const targetSeatNumbers = new Set(targets.map((entry) => entry.seatNum));
    targetSeatNumbers.forEach((targetSeat) => {
        const sameNumberStillChecked = entries.some(
            (entry) => entry.seatNum === targetSeat && nextKeys.has(entry.key),
        );
        if (!sameNumberStillChecked) delete nextTimes[String(targetSeat)];
    });

    return {
        checkedInSeatKeys: Array.from(nextKeys),
        checkedInSeats: checkedSeatNumbers(entries, nextKeys),
        checkedIn: entries.length > 0 && entries.every((entry) => nextKeys.has(entry.key)),
        checkedInSeatTimes: nextTimes,
    };
};
