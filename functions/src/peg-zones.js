// Peg zones for emails. Peg numbers are globally unique and each pond owns one range
// (startNumber..), left side first (leftCount pegs) then right side; each side is a
// zone ('A'/'B', leftZone says which the left side is). Mirrors src/utils/pegZone.ts.

export const pegZoneRanges = (ponds) => ponds.map((pond) => {
    const total = Number.isInteger(pond.totalSeats) && pond.totalSeats > 0 ? pond.totalSeats : 30;
    const start = Number.isInteger(pond.startNumber) && pond.startNumber >= 1 ? pond.startNumber : 1;
    const leftZone = pond.leftZone === 'B' ? 'B' : 'A';
    const left = Number.isInteger(pond.leftCount)
        ? Math.max(0, Math.min(total, pond.leftCount))
        : Number.isInteger(pond.zoneACount)
            ? Math.max(0, Math.min(total, leftZone === 'B' ? total - pond.zoneACount : pond.zoneACount))
            : Math.ceil(total / 2);
    return { start, end: start + total - 1, left, leftZone };
});

export const zoneForPeg = (ranges, num) => {
    const range = (ranges || []).find((r) => num >= r.start && num <= r.end);
    if (!range) return null;
    return num - range.start < range.left ? range.leftZone : (range.leftZone === 'A' ? 'B' : 'A');
};

// A dozen small docs (seat layouts excluded by the projection); cached briefly because
// a booking can fan out several emails at once.
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, ranges: [] };

export const loadPegZones = async (db) => {
    if (Date.now() - cache.at < CACHE_MS) return cache.ranges;
    try {
        const snap = await db.collection('ponds').select('startNumber', 'leftCount', 'leftZone', 'totalSeats', 'zoneACount').get();
        cache = { at: Date.now(), ranges: pegZoneRanges(snap.docs.map((d) => d.data())) };
    } catch (error) {
        console.error('Could not load pond zones for booking email:', error);
        return cache.ranges;
    }
    return cache.ranges;
};
