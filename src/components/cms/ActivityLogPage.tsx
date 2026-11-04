import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { ACTIVITY_CATEGORIES, getActivityLogPage, getUsersPage } from '../../lib/firestore';
import { AuditEntry, Booking, User } from '../../types';
import { formatDate } from '../../utils';

const STAFF_ROLES = ['STAFF', 'COUNTER_STAFF', 'ADMIN', 'SUPER_ADMIN'];
const PAGE_SIZE = 50;

interface ActivityLogPageProps {
  /** Bookings already loaded in the CMS; used to resolve a ref / player name to a booking id. */
  bookings: Booking[];
}

// Dedicated activity trail: check-in, weigh-in, prize and approval actions, filtered
// on the server and loaded 50 at a time so it stays fast with thousands of entries.
const ActivityLogPage: React.FC<ActivityLogPageProps> = ({ bookings }) => {
  const [category, setCategory] = useState('');
  const [actorUid, setActorUid] = useState('');
  const [playerQuery, setPlayerQuery] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [staff, setStaff] = useState<User[]>([]);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cursor = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  // Drops results of a superseded request when filters change mid-load.
  const requestId = useRef(0);

  useEffect(() => {
    getUsersPage({ roles: STAFF_ROLES, pageSize: 200 })
      .then((res) => setStaff(res.items))
      .catch((err) => console.error('Failed to load staff list:', err));
  }, []);

  // Bookings matching the typed ref / name, so staff can pick the exact player.
  const playerMatches = useMemo(() => {
    const q = playerQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return bookings
      .filter((b) => (b.bookingRef || '').toLowerCase().includes(q)
        || (b.userName || '').toLowerCase().includes(q)
        || (b.id || '').toLowerCase() === q)
      .slice(0, 12);
  }, [bookings, playerQuery]);

  const load = async (append: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const res = await getActivityLogPage({
        category: category || undefined,
        actorUid: actorUid || undefined,
        bookingId: bookingId || undefined,
        from: fromDate ? new Date(`${fromDate}T00:00:00`) : undefined,
        to: toDate ? new Date(`${toDate}T23:59:59.999`) : undefined,
        pageSize: PAGE_SIZE,
        cursor: append ? cursor.current : null,
      });
      if (id !== requestId.current) return;
      cursor.current = res.lastDoc;
      setHasMore(res.hasMore);
      setEntries((prev) => (append ? [...prev, ...res.items] : res.items));
    } catch (err: any) {
      if (id !== requestId.current) return;
      console.error('Failed to load activity log:', err);
      setError(err?.code === 'failed-precondition'
        ? 'Indeks pangkalan data sedang disediakan. Cuba lagi dalam beberapa minit.'
        : 'Log aktiviti gagal dimuatkan. Sila cuba lagi.');
      if (!append) setEntries([]);
      setHasMore(false);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    cursor.current = null;
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, actorUid, bookingId, fromDate, toDate]);

  const categoryLabel = (action: string) =>
    ACTIVITY_CATEGORIES.find((c) => (c.actions as readonly string[]).includes(action))?.label || '';

  const filtersActive = !!(category || actorUid || bookingId || fromDate || toDate);
  const selectedBooking = bookingId ? bookings.find((b) => b.id === bookingId) : null;

  return (
    <div className="page active">
      <div className="page-header">
        <div>
          <div className="page-title">Log Aktiviti</div>
          <div className="page-sub">Check-in, timbangan, rekod hadiah &amp; kelulusan tempahan — tapis ikut staf, peserta atau tarikh</div>
        </div>
      </div>
      <div className="card">
        <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={`btn btn-sm ${category === '' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCategory('')}>Semua</button>
            {ACTIVITY_CATEGORIES.map((c) => (
              <button key={c.id} className={`btn btn-sm ${category === c.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCategory(c.id)}>{c.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field">
              <label>Staf</label>
              <select className="form-input" value={actorUid} onChange={(e) => setActorUid(e.target.value)}>
                <option value="">Semua staf</option>
                {staff.map((s) => <option key={s.uid} value={s.uid}>{s.name || s.email}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Dari</label>
              <input className="form-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Hingga</label>
              <input className="form-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="field" style={{ minWidth: 220, flex: '1 1 220px' }}>
              <label>Peserta (nama / ref tempahan)</label>
              <input
                className="form-input"
                value={playerQuery}
                onChange={(e) => { setPlayerQuery(e.target.value); if (bookingId) setBookingId(''); }}
                placeholder="Taip nama atau Ref…"
              />
            </div>
            {filtersActive && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => { setCategory(''); setActorUid(''); setBookingId(''); setPlayerQuery(''); setFromDate(''); setToDate(''); }}
              >
                Reset
              </button>
            )}
          </div>
          {!bookingId && playerMatches.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Pilih tempahan:</span>
              {playerMatches.map((b) => (
                <button
                  key={b.id}
                  className="btn btn-sm btn-ghost"
                  onClick={() => { setBookingId(b.id); setPlayerQuery(`${b.userName} (${b.bookingRef || b.id.slice(0, 8)})`); }}
                >
                  {b.userName} · {b.bookingRef || b.id.slice(0, 8)}
                </button>
              ))}
            </div>
          )}
          {bookingId && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Menapis tempahan: <strong>{selectedBooking ? `${selectedBooking.userName} · ${selectedBooking.bookingRef || selectedBooking.id}` : bookingId}</strong>.
              Rekod lama sebelum fungsi ini mungkin tidak dipaparkan.
            </div>
          )}
        </div>
        <div className="card-body">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Waktu</th><th>Staf</th><th>Kategori</th><th>Tindakan</th><th>Butiran</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.createdAt, { time: true }) || '-'}</td>
                    <td className="td-name">{e.actorName || e.actorEmail || e.actorUid || '—'}</td>
                    <td>{categoryLabel(e.action) || '—'}</td>
                    <td>{e.actionLabel}</td>
                    <td>{[e.entityLabel, e.details, e.reason].filter(Boolean).join(' — ') || '—'}</td>
                  </tr>
                ))}
                {!loading && entries.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: error ? '#b91c1c' : 'var(--text-muted)', padding: '2rem' }}>
                    {error || (filtersActive ? 'Tiada aktiviti sepadan dengan tapisan' : 'Tiada aktiviti lagi')}
                  </td></tr>
                )}
                {loading && entries.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Memuat...</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px 4px', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{entries.length} aktiviti dipaparkan</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-ghost" disabled={loading} onClick={() => { cursor.current = null; void load(false); }}>🔄 Muat Semula</button>
              <button className="btn btn-sm btn-primary" disabled={!hasMore || loading} onClick={() => void load(true)}>
                {loading && entries.length > 0 ? 'Memuat...' : 'Muat Lagi'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ActivityLogPage;
