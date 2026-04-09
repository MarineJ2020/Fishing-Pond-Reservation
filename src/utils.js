export const fmt = (iso) => {
    if (!iso)
        return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
};
export const p2 = (n) => String(n).padStart(2, '0');
export const getPrize = (rank, prizes) => {
    let m = '';
    for (const p of prizes) {
        if (rank >= p.rank)
            m = p.prize;
    }
    return m;
};
export const getPrizeLabel = (rank, prizes) => {
    let m = '';
    for (const p of prizes) {
        if (rank >= p.rank)
            m = p.label || p.prize;
    }
    return m;
};
export const rbc = (r) => r === 1 ? 'r1' : r === 2 ? 'r2' : r === 3 ? 'r3' : 'rn';
export const rbg = (r) => r === 1 ? 'rgba(255,215,0,.15)' : r === 2 ? 'rgba(192,192,192,.15)' : r === 3 ? 'rgba(205,127,50,.15)' : 'var(--surface2)';
export const rbc2 = (r) => r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? '#cd7f32' : 'var(--muted)';
export const getLB = (scores, pondFilter) => {
    const e = [];
    for (const [peg, d] of Object.entries(scores)) {
        if (pondFilter && pondFilter !== null && d.pondId !== pondFilter)
            continue;
        if (d.weight == null || d.weight === '' || isNaN(parseFloat(d.weight.toString())))
            continue;
        e.push({ peg: parseInt(peg), name: d.anglerName || 'Angler #' + peg, weight: parseFloat(d.weight.toString()), pondId: d.pondId });
    }
    return e.sort((a, b) => b.weight - a.weight);
};
