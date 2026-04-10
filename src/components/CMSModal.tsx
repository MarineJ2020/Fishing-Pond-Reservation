import React, { useState, useEffect } from 'react';
import { User, Pond, Competition, Prize, Settings } from '../types';
import { gs } from '../data';
import {
  createPond as createPondFirestore,
  createCompetition as createCompetitionFirestore,
  deleteCompetition as deleteCompetitionFirestore,
  updatePond as updatePondFirestore,
  updateBookingStatus as updateBookingStatusFirestore,
  updateCompetition as updateCompetitionFirestore,
  updateSettings as updateSettingsFirestore,
} from '../lib/firestore';

type CMSPage = 'dashboard' | 'competitions' | 'ponds' | 'prizes' | 'approvals' | 'manual-booking' | 'all-bookings' | 'checkin' | 'results' | 'users';

interface CMSModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  ponds: Pond[];
  comp: Competition;
  competitions?: Competition[];
  settings: Settings;
  bookings: { id: string; competitionId?: string; competitionName?: string; userName: string; pondName: string; seats: number[]; amount: number; userId: string; userPhone: string; receiptData: string; status: string; pondId: number; createdAt?: string; paymentType?: string }[];
  onUpdateData: (updates: { ponds?: Pond[]; comp?: Competition }) => void;
  reloadDB: () => Promise<void>;
}

const CMSModal: React.FC<CMSModalProps> = ({ isOpen, onClose, user, ponds, comp, competitions = [], settings, bookings, onUpdateData, reloadDB }) => {
  const [page, setPage] = useState<CMSPage>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingPond, setEditingPond] = useState<Pond | null>(null);
  const [compEdit, setCompEdit] = useState<Competition>(comp);
  const [compList, setCompList] = useState<Competition[]>(competitions.length ? competitions : (comp.name ? [comp] : []));
  const [competitionEditorOpen, setCompetitionEditorOpen] = useState(false);
  const [competitionDeleteTarget, setCompetitionDeleteTarget] = useState<Competition | null>(null);
  const [settingsEdit, setSettingsEdit] = useState(settings);
  const [newPond, setNewPond] = useState<Partial<Pond>>({ name: '', date: '', desc: '', seats: [], open: true });
  const [newPondSeatPrice, setNewPondSeatPrice] = useState(100);
  const [saving, setSaving] = useState(false);
  const [bookingFilter, setBookingFilter] = useState<'all' | 'pending' | 'confirmed' | 'rejected'>('all');
  const [checkinRef, setCheckinRef] = useState('');
  const [checkinResult, setCheckinResult] = useState<any>(null);

  useEffect(() => {
    setCompEdit(comp);
    setCompList(competitions.length ? competitions : (comp.name ? [comp] : []));
  }, [comp, competitions]);
  useEffect(() => { setSettingsEdit(settings); }, [settings]);

  const toLocalDatetime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const openDatePicker = (event: React.MouseEvent<HTMLButtonElement>) => {
    const wrap = event.currentTarget.closest('.date-input-wrap') as HTMLElement | null;
    const input = wrap?.querySelector('input[type="date"], input[type="datetime-local"]') as HTMLInputElement | null;
    if (!input) return;
    input.focus();
    if (typeof (input as any).showPicker === 'function') {
      (input as any).showPicker();
    }
  };

  const isStaff = user && (user.role === 'ADMIN' || user.role === 'STAFF');
  if (!isOpen) return null;

  const handlePondUpdate = async (pond: Pond) => {
    setSaving(true);
    try {
      await updatePondFirestore(pond._docId || pond.id.toString(), {
        name: pond.name, description: pond.desc, eventDate: pond.date,
        open: pond.open, totalSeats: pond.seats.length, pricePerSeat: pond.seats[0]?.price || 100,
      } as any);
      await reloadDB();
      setEditingPond(null);
    } catch (err) { console.error('Failed to update pond:', err); }
    setSaving(false);
  };

  const handleCompetitionUpdate = async () => {
    setSaving(true);
    try {
      if (!compEdit.id) { setSaving(false); return; }
      await updateCompetitionFirestore(compEdit.id, compEdit as any);
      await reloadDB();
      setCompetitionEditorOpen(false);
    } catch (err) { console.error('Failed to update competition:', err); }
    setSaving(false);
  };

  const handleCreateCompetition = async () => {
    setSaving(true);
    try {
      await createCompetitionFirestore({
        name: `Pertandingan ${new Date().getFullYear()}`,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        topN: 20,
        prizes: [],
        activePondIds: []
      });
      await reloadDB();
    } catch (err) {
      console.error('Failed to create competition:', err);
    }
    setSaving(false);
  };

  const handleDeleteCompetition = async () => {
    if (!competitionDeleteTarget?.id) return;
    setSaving(true);
    try {
      await deleteCompetitionFirestore(competitionDeleteTarget.id);
      await reloadDB();
      setCompetitionDeleteTarget(null);
      setCompetitionEditorOpen(false);
    } catch (err) {
      console.error('Failed to delete competition:', err);
    }
    setSaving(false);
  };

  const handleApproveBooking = async (bookingId: string) => {
    setSaving(true);
    try { await updateBookingStatusFirestore(bookingId, 'confirmed'); await reloadDB(); }
    catch (err) { console.error('Failed to approve booking:', err); }
    setSaving(false);
  };

  const handleRejectBooking = async (bookingId: string) => {
    setSaving(true);
    try { await updateBookingStatusFirestore(bookingId, 'rejected'); await reloadDB(); }
    catch (err) { console.error('Failed to reject booking:', err); }
    setSaving(false);
  };

  const handleViewReceipt = (receiptData: string) => {
    const w = window.open('', '_blank');
    if (w) { w.document.write('<img src="' + receiptData + '" style="max-width:100%;max-height:100vh;" />'); w.document.close(); }
  };

  const handleCheckin = () => {
    const found = bookings.find(b => b.id === checkinRef.trim());
    setCheckinResult(found || null);
  };

  const openCreatePondModal = () => {
    setNewPond({ name: '', date: '', desc: '', seats: [], open: true });
    setNewPondSeatPrice(100);
    setEditingPond({} as any);
  };

  const closePondModal = () => {
    setEditingPond(null);
  };

  const normalizeSeatPrice = (raw: string | number) => {
    const n = typeof raw === 'number' ? raw : parseFloat(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Number(n));
  };

  const applySeatPrice = (price: number) => {
    const safePrice = normalizeSeatPrice(price);
    if (editingPond?.id) {
      const currentSeats = editingPond.seats || [];
      setEditingPond({
        ...editingPond,
        seats: currentSeats.map((seat) => ({ ...seat, price: safePrice }))
      });
      return;
    }

    setNewPondSeatPrice(safePrice);
    if ((newPond.seats || []).length) {
      setNewPond({
        ...newPond,
        seats: (newPond.seats || []).map((seat) => ({ ...seat, price: safePrice }))
      });
    }
  };

  if (!isStaff) {
    return (
      <div className="modal-overlay open">
        <div className="modal" style={{ maxWidth: '400px' }}>
          <div className="modal-header">
            <div className="modal-title">Akses Terhad</div>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>🔒</div>
            <p style={{ color: 'var(--text-muted)' }}>Kawasan ini hanya untuk kakitangan dan pentadbir.</p>
            <button className="btn btn-primary mt-4" onClick={onClose}>Kembali</button>
          </div>
        </div>
      </div>
    );
  }

  const pendingCount = bookings.filter(b => b.status === 'pending').length;
  const confirmedCount = bookings.filter(b => b.status === 'confirmed').length;
  const totalRevenue = bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + b.amount, 0);

  const navSections = [
    { label: 'Utama', items: [{ id: 'dashboard' as CMSPage, icon: '📊', text: 'Dashboard' }] },
    { label: 'Pengurusan', items: [
      { id: 'competitions' as CMSPage, icon: '🏆', text: 'Pertandingan' },
      { id: 'ponds' as CMSPage, icon: '🏊', text: 'Kolam' },
      { id: 'prizes' as CMSPage, icon: '🥇', text: 'Hadiah & Ranking' },
    ]},
    { label: 'Tempahan', items: [
      { id: 'approvals' as CMSPage, icon: '✅', text: 'Kelulusan', badge: pendingCount },
      { id: 'manual-booking' as CMSPage, icon: '➕', text: 'Tempahan Manual' },
      { id: 'all-bookings' as CMSPage, icon: '📋', text: 'Semua Tempahan' },
    ]},
    { label: 'Hari Pertandingan', items: [
      { id: 'checkin' as CMSPage, icon: '📲', text: 'Check-In' },
      { id: 'results' as CMSPage, icon: '⚖️', text: 'Keputusan & Live' },
    ]},
    { label: 'Admin', items: [{ id: 'users' as CMSPage, icon: '👥', text: 'Pengguna' }] },
  ];

  const pageTitle = navSections.flatMap(s => s.items).find(i => i.id === page)?.text || 'Dashboard';

  return (
    <div className="cms-page" style={{ position: 'fixed', inset: 0, zIndex: 500 }}>
      <div className={`overlay-bg ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)}></div>

      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-text">KKS CMS</div>
          <div className="sidebar-logo-sub">Staff Portal</div>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>×</button>
        </div>
        <div className="sidebar-nav">
          {navSections.map(sec => (
            <React.Fragment key={sec.label}>
              <div className="nav-section-label">{sec.label}</div>
              {sec.items.map(item => (
                <div key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`}
                  onClick={() => { setPage(item.id); setSidebarOpen(false); }}>
                  <span className="nav-icon">{item.icon}</span>
                  {item.text}
                  {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
        <div className="sidebar-user">
          <div className="user-avatar">{(user?.name || 'S')[0].toUpperCase()}</div>
          <div>
            <div className="user-name">{user?.name || user?.email}</div>
            <div className="user-role">{user?.role || 'Staff'}</div>
          </div>
        </div>
      </div>

      <div className="cms-main">
        <div className="topbar">
          <div className="topbar-left">
            <button className="topbar-hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
            <div>
              <div className="topbar-title">{pageTitle}</div>
              <div className="topbar-breadcrumb">KKS CMS › {pageTitle}</div>
            </div>
          </div>
          <div className="topbar-right">
            <a onClick={onClose} style={{ fontSize: '0.85rem', color: 'var(--gold)', cursor: 'pointer', fontWeight: 600 }}>🌐 Laman Web</a>
          </div>
        </div>

        <div className="cms-content">
          {page === 'dashboard' && (
            <div className="page active">
              <div className="stats-grid">
                <div className="stat-card stat-accent"><div className="stat-label">Jumlah Tempahan</div><div className="stat-value">{bookings.length}</div><div className="stat-change">Keseluruhan</div></div>
                <div className="stat-card stat-accent"><div className="stat-label">Menunggu Kelulusan</div><div className="stat-value">{pendingCount}</div><div className="stat-change">Perlu tindakan</div></div>
                <div className="stat-card stat-accent"><div className="stat-label">Disahkan</div><div className="stat-value">{confirmedCount}</div><div className="stat-change">Diluluskan</div></div>
                <div className="stat-card stat-accent"><div className="stat-label">Jumlah Hasil</div><div className="stat-value">RM {totalRevenue}</div><div className="stat-change">Keseluruhan</div></div>
              </div>
              <div className="two-col">
                <div className="card">
                  <div className="card-header"><div className="card-title">Tempahan Terbaru</div></div>
                  <div className="card-body">
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Ref</th><th>Pertandingan</th><th>Nama</th><th>Kolam</th><th>Jumlah</th><th>Status</th></tr></thead>
                        <tbody>
                          {bookings.slice(0, 5).map(b => (
                            <tr key={b.id}>
                              <td className="td-ref">{b.id.slice(0, 10)}</td>
                              <td>{b.competitionName || comp.name || '-'}</td>
                              <td className="td-name">{b.userName}</td>
                              <td>{b.pondName}</td>
                              <td>RM {b.amount}</td>
                              <td><span className={`badge badge-${b.status === 'confirmed' ? 'approved' : b.status}`}>{b.status}</span></td>
                            </tr>
                          ))}
                          {bookings.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Tiada tempahan</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="card-header"><div className="card-title">Pertandingan Aktif</div></div>
                  <div className="card-body">
                    {comp.name ? (
                      <div style={{ padding: '1rem', background: 'var(--cream)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                          <span className="live-dot"></span>
                          <strong>{comp.name}</strong>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          📅 {new Date(comp.startDate).toLocaleDateString('ms-MY')}<br />
                          👥 {ponds.reduce((s, p) => s + p.seats.filter(se => se.status === 'available').length, 0)} tempat tersedia
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Tiada pertandingan aktif</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {page === 'competitions' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Pertandingan</div><div className="page-sub">Urus semua pertandingan</div></div><button className="btn btn-primary" onClick={handleCreateCompetition} disabled={saving}>{saving ? 'Menambah...' : '+ Tambah Pertandingan'}</button></div>
              <div className="card">
                <div className="card-header"><div className="card-title">Senarai Pertandingan</div></div>
                <div className="card-body"><div className="table-wrap"><table>
                  <thead><tr><th>Nama</th><th>Tarikh</th><th>Kolam Aktif</th><th>Tempat</th><th>Status</th><th>Tindakan</th></tr></thead>
                  <tbody>
                    {(compList.length ? compList : (comp.name ? [comp] : [])).map((competition) => (
                      <tr key={competition.id || competition.name}>
                        <td className="td-name">{competition.name}</td>
                        <td>{competition.startDate ? new Date(competition.startDate).toLocaleDateString('ms-MY') : '-'}</td>
                        <td>{competition.activePondIds?.length ? competition.activePondIds.length : ponds.length} kolam</td>
                        <td>{ponds.filter((pond) => !competition.activePondIds?.length || competition.activePondIds.includes(pond._docId || pond.id.toString())).reduce((s, p) => s + p.seats.length, 0)}</td>
                        <td><span className="badge badge-open">Aktif</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button className="btn btn-sm btn-ghost" onClick={() => { setCompEdit({ ...competition }); setCompetitionEditorOpen(true); }}>Manage</button>
                            <button className="btn btn-sm btn-danger" onClick={() => setCompetitionDeleteTarget(competition)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div></div>
              </div>
            </div>
          )}
          {page === 'ponds' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Kolam</div><div className="page-sub">Urus kolam dan tempat duduk</div></div><button className="btn btn-primary" onClick={openCreatePondModal}>+ Tambah Kolam</button></div>
              <div className="three-col">
                {ponds.map((pond) => {
                  const avail = pond.seats.filter(s => s.status === 'available').length;
                  const booked = pond.seats.filter(s => s.status === 'booked').length;
                  return (
                    <div key={pond._docId || pond.id} className="card">
                      <div className="card-header"><div className="card-title">{pond.name}</div><span className={`badge ${pond.open ? 'badge-open' : 'badge-draft'}`}>{pond.open ? 'Buka' : 'Tutup'}</span></div>
                      <div className="card-body">
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>{pond.seats.length} tempat · RM{pond.seats[0]?.price || 0}/peg</div>
                        <div className="mini-seat-grid">{pond.seats.map(s => (<div key={s.num} className={`mini-seat ${s.status === 'available' ? 'avail' : 'taken'}`}>{s.num}</div>))}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', fontSize: '0.82rem' }}><span style={{ color: 'var(--green)' }}>✓ {avail} kosong</span><span style={{ color: 'var(--red)' }}>✕ {booked} penuh</span></div>
                        <button className="btn btn-sm btn-ghost" style={{ width: '100%', marginTop: '0.75rem' }} onClick={() => setEditingPond(pond)}>Edit</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {page === 'prizes' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Hadiah &amp; Ranking</div><div className="page-sub">Tetapan hadiah pertandingan</div></div></div>
              <div className="two-col">
                <div className="card"><div className="card-header"><div className="card-title">Pertandingan</div></div><div className="card-body"><div style={{ padding: '1rem', background: 'var(--gold-pale)', borderRadius: '8px', border: '1px solid rgba(200,146,42,0.3)' }}><strong>{comp.name || 'Tiada pertandingan'}</strong><div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>📅 {new Date(comp.startDate).toLocaleDateString('ms-MY')}</div></div></div></div>
                <div className="card">
                  <div className="card-header"><div className="card-title">Senarai Hadiah</div><button className="btn btn-sm btn-primary" onClick={() => { const nr = compEdit.prizes.length ? Math.max(...compEdit.prizes.map((p: Prize) => p.rank)) + 1 : 1; setCompEdit({ ...compEdit, prizes: [...compEdit.prizes, { rank: nr, label: 'Tempat #' + nr, prize: '' }] }); }}>+ Tambah</button></div>
                  <div className="card-body">
                    <div className="prize-rows">
                      {compEdit.prizes.map((p: Prize, i: number) => (
                        <div key={i} className="prize-row">
                          <div className="prize-rank-badge">{p.rank}</div>
                          <input value={p.label || ''} onChange={e => { const prizes = [...compEdit.prizes]; prizes[i] = { ...prizes[i], label: e.target.value }; setCompEdit({ ...compEdit, prizes }); }} placeholder="Label" />
                          <input value={p.prize} onChange={e => { const prizes = [...compEdit.prizes]; prizes[i] = { ...prizes[i], prize: e.target.value }; setCompEdit({ ...compEdit, prizes }); }} placeholder="Hadiah (e.g. RM500)" />
                          <button className="prize-del" onClick={() => { setCompEdit({ ...compEdit, prizes: compEdit.prizes.filter((_: Prize, idx: number) => idx !== i) }); }}>✕</button>
                        </div>
                      ))}
                      {compEdit.prizes.length === 0 && <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>Tiada hadiah ditambah</div>}
                    </div>
                    <div className="form-actions" style={{ marginTop: '1rem' }}><button className="btn btn-primary" disabled={saving} onClick={handleCompetitionUpdate}>{saving ? 'Menyimpan...' : 'Simpan Hadiah'}</button></div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {page === 'approvals' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Kelulusan Tempahan</div><div className="page-sub">{pendingCount} tempahan menunggu kelulusan</div></div></div>
              <div className="card"><div className="card-body"><div className="table-wrap"><table>
                <thead><tr><th>Ref</th><th>Pertandingan</th><th>Nama</th><th>Kolam</th><th>Pegs</th><th>Jumlah</th><th>Bayaran</th><th>Resit</th><th>Tindakan</th></tr></thead>
                <tbody>
                  {bookings.filter(b => b.status === 'pending').map(b => (
                    <tr key={b.id}>
                      <td className="td-ref">{b.id.slice(0, 10)}</td>
                      <td>{b.competitionName || comp.name || '-'}</td>
                      <td className="td-name">{b.userName}</td>
                      <td>{b.pondName}</td>
                      <td>{b.seats.join(', ')}</td>
                      <td>RM {b.amount}</td>
                      <td><span className={`badge ${b.paymentType === 'deposit' ? 'badge-deposit' : 'badge-paid'}`}>{b.paymentType === 'deposit' ? 'Deposit' : 'Penuh'}</span></td>
                      <td>{b.receiptData && <button className="btn btn-sm btn-ghost" onClick={() => handleViewReceipt(b.receiptData)}>Lihat</button>}</td>
                      <td><div style={{ display: 'flex', gap: '6px' }}><button className="btn btn-sm btn-green" disabled={saving} onClick={() => handleApproveBooking(b.id)}>✓</button><button className="btn btn-sm btn-red" disabled={saving} onClick={() => handleRejectBooking(b.id)}>✕</button></div></td>
                    </tr>
                  ))}
                  {bookings.filter(b => b.status === 'pending').length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada tempahan menunggu</td></tr>}
                </tbody>
              </table></div></div></div>
            </div>
          )}
          {page === 'manual-booking' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Tempahan Manual</div><div className="page-sub">Buat tempahan untuk pelanggan</div></div></div>
              <div className="card"><div className="card-body" style={{ textAlign: 'center', padding: '3rem' }}>
                <div style={{ fontSize: '3rem', opacity: 0.3, marginBottom: '1rem' }}>📝</div>
                <p style={{ color: 'var(--text-muted)' }}>Fungsi tempahan manual akan datang. Sila gunakan laman utama untuk tempahan buat masa ini.</p>
                <button className="btn btn-primary mt-4" onClick={onClose}>Pergi ke Laman Utama</button>
              </div></div>
            </div>
          )}
          {page === 'all-bookings' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Semua Tempahan</div><div className="page-sub">{bookings.length} tempahan ditemui</div></div></div>
              <div className="card">
                <div className="card-header" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {(['all', 'pending', 'confirmed', 'rejected'] as const).map(f => (<button key={f} className={`btn btn-sm ${bookingFilter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setBookingFilter(f)}>{f === 'all' ? 'Semua' : f === 'pending' ? 'Menunggu' : f === 'confirmed' ? 'Disahkan' : 'Ditolak'}({f === 'all' ? bookings.length : bookings.filter(b => b.status === f).length})</button>))}
                  </div>
                </div>
                <div className="card-body"><div className="table-wrap"><table>
                  <thead><tr><th>Ref</th><th>Pertandingan</th><th>Nama</th><th>Kolam</th><th>Pegs</th><th>Jumlah</th><th>Status</th><th>Tarikh</th><th>Tindakan</th></tr></thead>
                  <tbody>
                    {bookings.filter(b => bookingFilter === 'all' || b.status === bookingFilter).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).map(b => (
                      <tr key={b.id}>
                        <td className="td-ref">{b.id.slice(0, 10)}</td>
                        <td>{b.competitionName || comp.name || '-'}</td>
                        <td className="td-name">{b.userName}</td>
                        <td>{b.pondName}</td>
                        <td>{b.seats.join(', ')}</td>
                        <td>RM {b.amount}</td>
                        <td><span className={`badge badge-${b.status === 'confirmed' ? 'approved' : b.status}`}>{b.status}</span></td>
                        <td style={{ fontSize: '0.82rem' }}>{b.createdAt ? new Date(b.createdAt).toLocaleDateString('ms-MY') : '-'}</td>
                        <td><div style={{ display: 'flex', gap: '6px' }}>
                          {b.receiptData && <button className="btn btn-sm btn-ghost" onClick={() => handleViewReceipt(b.receiptData)}>Resit</button>}
                          {b.status === 'pending' && (<><button className="btn btn-sm btn-green" disabled={saving} onClick={() => handleApproveBooking(b.id)}>✓</button><button className="btn btn-sm btn-red" disabled={saving} onClick={() => handleRejectBooking(b.id)}>✕</button></>)}
                        </div></td>
                      </tr>
                    ))}
                    {bookings.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada tempahan</td></tr>}
                  </tbody>
                </table></div></div>
              </div>
            </div>
          )}
          {page === 'checkin' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Check-In Peserta</div><div className="page-sub">Cari dan sahkan kehadiran</div></div></div>
              <div className="checkin-search">
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📲</div>
                <h3 style={{ marginBottom: '0.25rem' }}>Carian Tempahan</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Masukkan nombor rujukan tempahan</p>
                <div className="checkin-input-wrap"><input className="checkin-input" value={checkinRef} onChange={e => setCheckinRef(e.target.value)} placeholder="Cth: CB1234567" onKeyDown={e => e.key === 'Enter' && handleCheckin()} /><button className="btn btn-primary" onClick={handleCheckin}>Cari</button></div>
              </div>
              {checkinResult && (
                <div className="checkin-result">
                  <div className="checkin-result-header"><h3>✓ Tempahan Dijumpai</h3><span className={`badge badge-${checkinResult.status === 'confirmed' ? 'approved' : checkinResult.status}`}>{checkinResult.status}</span></div>
                  <div className="checkin-result-body">
                    <div className="checkin-detail-row"><span className="checkin-detail-key">Rujukan</span><span className="checkin-detail-val">{checkinResult.id}</span></div>
                    <div className="checkin-detail-row"><span className="checkin-detail-key">Nama</span><span className="checkin-detail-val">{checkinResult.userName}</span></div>
                    <div className="checkin-detail-row"><span className="checkin-detail-key">Kolam</span><span className="checkin-detail-val">{checkinResult.pondName}</span></div>
                    <div className="checkin-detail-row"><span className="checkin-detail-key">Tempat</span><span className="checkin-detail-val">{checkinResult.seats.join(', ')}</span></div>
                    <div className="checkin-detail-row"><span className="checkin-detail-key">Jumlah</span><span className="checkin-detail-val">RM {checkinResult.amount}</span></div>
                    {checkinResult.status !== 'confirmed' && <div className="warning-banner">⚠️ Tempahan ini belum disahkan.</div>}
                    {checkinResult.status === 'confirmed' && <button className="btn btn-green w-full mt-3">✓ Check-In Peserta</button>}
                  </div>
                </div>
              )}
              {checkinRef && !checkinResult && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Tempahan tidak dijumpai.</div>}
            </div>
          )}
          {page === 'results' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span className="live-dot"></span> Keputusan &amp; Live</div><div className="page-sub">Papan markah langsung</div></div></div>
              <div className="card">
                <div className="card-header"><div className="card-title">Papan Markah — {comp.name || 'Tiada Pertandingan'}</div></div>
                <div className="card-body"><div className="table-wrap"><table>
                  <thead><tr><th>#</th><th>Peserta</th><th>Kolam</th><th>Peg</th><th>Berat (kg)</th><th>Ranking</th></tr></thead>
                  <tbody>
                    {bookings.filter(b => b.status === 'confirmed').map((b, i) => (
                      <tr key={b.id}>
                        <td>{i + 1}</td>
                        <td className="td-name">{b.userName}</td>
                        <td>{b.pondName}</td>
                        <td>{b.seats.join(', ')}</td>
                        <td><input className="weight-input" type="number" step="0.01" placeholder="0.00" /></td>
                        <td><span className={`result-rank ${i < 3 ? 'rank-' + (i + 1) : ''}`}>{i < 3 ? ['🥇', '🥈', '🥉'][i] : '#' + (i + 1)}</span></td>
                      </tr>
                    ))}
                    {bookings.filter(b => b.status === 'confirmed').length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada peserta yang disahkan</td></tr>}
                  </tbody>
                </table></div></div>
              </div>
            </div>
          )}
          {page === 'users' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Pengguna</div><div className="page-sub">Urus pengguna sistem</div></div></div>
              <div className="card"><div className="card-body"><div className="table-wrap"><table>
                <thead><tr><th></th><th>Nama</th><th>Email</th><th>Peranan</th><th>Tempahan</th></tr></thead>
                <tbody>
                  {Array.from(new Map(bookings.map(b => [b.userId, b])).values()).map(b => (
                    <tr key={b.userId}>
                      <td><span className="user-avatar-sm">{(b.userName || 'U')[0].toUpperCase()}</span></td>
                      <td className="td-name">{b.userName}</td>
                      <td>{b.userId}</td>
                      <td><span className="badge badge-open">Pengguna</span></td>
                      <td>{bookings.filter(bk => bk.userId === b.userId).length}</td>
                    </tr>
                  ))}
                  {bookings.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada pengguna</td></tr>}
                </tbody>
              </table></div></div></div>
            </div>
          )}
        </div>

        {competitionEditorOpen && (
          <div className="modal-overlay open" onClick={() => setCompetitionEditorOpen(false)}>
            <div className="modal" style={{ maxWidth: '760px', width: '95%' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Manage Competition</div>
                <button className="modal-close" onClick={() => setCompetitionEditorOpen(false)}>×</button>
              </div>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={compEdit.name || ''} onChange={(e) => setCompEdit({ ...compEdit, name: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Tarikh Mula</label><div className="date-input-wrap"><input className="form-input" type="datetime-local" value={toLocalDatetime(compEdit.startDate)} onChange={(e) => e.target.value && setCompEdit({ ...compEdit, startDate: new Date(e.target.value).toISOString() })} /><button type="button" className="date-picker-btn" onClick={openDatePicker}>📅</button></div></div>
                  <div className="form-group"><label className="form-label">Tarikh Tamat</label><div className="date-input-wrap"><input className="form-input" type="datetime-local" value={toLocalDatetime(compEdit.endDate)} onChange={(e) => e.target.value && setCompEdit({ ...compEdit, endDate: new Date(e.target.value).toISOString() })} /><button type="button" className="date-picker-btn" onClick={openDatePicker}>📅</button></div></div>
                  <div className="form-group"><label className="form-label">Top N</label><input className="form-input" type="number" value={compEdit.topN || 20} onChange={(e) => setCompEdit({ ...compEdit, topN: parseInt(e.target.value) || 20 })} /></div>
                </div>

                <div className="card" style={{ marginTop: '12px' }}>
                  <div className="card-header"><div className="card-title">Active Ponds For This Competition</div></div>
                  <div className="card-body">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '8px' }}>
                      {ponds.map((pond) => {
                        const pondKey = pond._docId || pond.id.toString();
                        const checked = (compEdit.activePondIds || []).includes(pondKey);
                        return (
                          <label key={pondKey} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set(compEdit.activePondIds || []);
                                if (e.target.checked) next.add(pondKey);
                                else next.delete(pondKey);
                                setCompEdit({ ...compEdit, activePondIds: Array.from(next) });
                              }}
                            />
                            <span>{pond.name}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      Leave all unchecked to allow all ponds for this competition.
                    </div>
                  </div>
                </div>

                <div className="form-actions" style={{ marginTop: '12px' }}>
                  <button className="btn btn-ghost" onClick={() => setCompetitionEditorOpen(false)}>Batal</button>
                  <button className="btn btn-primary" onClick={handleCompetitionUpdate} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {editingPond && (
          <div className="modal-overlay open" onClick={closePondModal}>
            <div className="modal" style={{ maxWidth: '760px', width: '95%' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">{editingPond.id ? 'Edit Kolam' : 'Tambah Kolam Baru'}</div>
                <button className="modal-close" onClick={closePondModal}>×</button>
              </div>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={editingPond.id ? editingPond.name : newPond.name} onChange={e => editingPond.id ? setEditingPond({ ...editingPond, name: e.target.value }) : setNewPond({ ...newPond, name: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Keterangan</label><input className="form-input" value={editingPond.id ? editingPond.desc : newPond.desc} onChange={e => editingPond.id ? setEditingPond({ ...editingPond, desc: e.target.value }) : setNewPond({ ...newPond, desc: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Tarikh</label><div className="date-input-wrap"><input className="form-input" type="date" value={editingPond.id ? editingPond.date : newPond.date} onChange={e => editingPond.id ? setEditingPond({ ...editingPond, date: e.target.value }) : setNewPond({ ...newPond, date: e.target.value })} /><button type="button" className="date-picker-btn" onClick={openDatePicker}>📅</button></div></div>
                  <div className="form-group"><label className="form-label">Bilangan Tempat</label><input className="form-input" type="number" value={editingPond.id ? editingPond.seats?.length || 0 : newPond.seats?.length || 0} onChange={e => {
                    const count = parseInt(e.target.value) || 0;
                    if (editingPond.id) {
                      const price = editingPond.seats?.[0]?.price || 100;
                      setEditingPond({ ...editingPond, seats: gs(editingPond.id, 1, count, price) });
                    } else {
                      const price = newPondSeatPrice;
                      setNewPond({ ...newPond, seats: gs(Math.max(...ponds.map(p => p.id), 0) + 1, 1, count, price) });
                    }
                  }} /></div>
                  <div className="form-group"><label className="form-label">Harga Per Tempat (RM)</label><input className="form-input" type="number" min="0" step="1" value={editingPond.id ? (editingPond.seats?.[0]?.price || 0) : newPondSeatPrice} onChange={e => applySeatPrice(e.target.value)} /></div>
                </div>
                <div className="form-actions" style={{ marginTop: '12px' }}>
                  {editingPond.id ? (<>
                    <button className="btn btn-ghost" onClick={closePondModal}>Batal</button>
                    <button className="btn btn-primary" disabled={saving} onClick={() => handlePondUpdate(editingPond)}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
                  </>) : (<>
                    <button className="btn btn-ghost" onClick={closePondModal}>Batal</button>
                    <button className="btn btn-primary" disabled={saving} onClick={async () => {
                      if (newPond.name && newPond.seats && newPond.seats.length > 0) {
                        setSaving(true);
                        try {
                          await createPondFirestore({ name: newPond.name, date: newPond.date || '', desc: newPond.desc || '', open: true, totalSeats: newPond.seats.length, pricePerSeat: newPond.seats[0]?.price || newPondSeatPrice || 100 } as any);
                          await reloadDB(); setNewPond({ name: '', date: '', desc: '', seats: [], open: true }); setEditingPond(null);
                        } catch (err) { console.error('Failed to add pond:', err); }
                        setSaving(false);
                      }
                    }}>{saving ? 'Menyimpan...' : 'Tambah'}</button>
                  </>)}
                </div>
              </div>
            </div>
          </div>
        )}

        {competitionDeleteTarget && (
          <div className="modal-overlay open" onClick={() => setCompetitionDeleteTarget(null)}>
            <div className="modal" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Delete Competition</div>
                <button className="modal-close" onClick={() => setCompetitionDeleteTarget(null)}>×</button>
              </div>
              <div className="modal-body">
                <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>
                  Anda pasti mahu padam pertandingan <strong>{competitionDeleteTarget.name}</strong>?
                </p>
                <div className="form-actions">
                  <button className="btn btn-ghost" onClick={() => setCompetitionDeleteTarget(null)}>Batal</button>
                  <button className="btn btn-danger" onClick={handleDeleteCompetition} disabled={saving}>{saving ? 'Memadam...' : 'Delete'}</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CMSModal;