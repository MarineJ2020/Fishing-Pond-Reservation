import React, { useState, useEffect, useRef } from 'react';
import { User, Pond, Competition, Prize, Settings, ScoreEntry } from '../types';
import { gs } from '../data';
import PondEditor from './PondEditor';
import { checkInBooking } from '../lib/api';
import {
  createPond as createPondFirestore,
  createCompetition as createCompetitionFirestore,
  deleteCompetition as deleteCompetitionFirestore,
  syncPondSeats as syncPondSeatsFirestore,
  updatePond as updatePondFirestore,
  updateBookingStatus as updateBookingStatusFirestore,
  updateCompetition as updateCompetitionFirestore,
  updateSettings as updateSettingsFirestore,
  getScoresForCompetition,
  saveScoreEntry,
  deleteScoreEntry,
} from '../lib/firestore';

type CMSPage = 'dashboard' | 'competitions' | 'ponds' | 'prizes' | 'approvals' | 'manual-booking' | 'all-bookings' | 'checkin' | 'results' | 'contact-settings' | 'users';

interface CMSModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToBooking?: () => void;
  user: User | null;
  ponds: Pond[];
  comp: Competition;
  competitions?: Competition[];
  settings: Settings;
  bookings: { id: string; competitionId?: string; competitionName?: string; userName: string; pondName: string; seats: number[]; amount: number; userId: string; userPhone: string; receiptData: string; status: string; pondId: number; createdAt?: string; paymentType?: string }[];
  onUpdateData: (updates: { ponds?: Pond[]; comp?: Competition }) => void;
  reloadDB: () => Promise<void>;
}

// ── Inline SVG pond seat editor used in competition management ──────────────
const CMS_SVG_W = 600;
const CMS_SVG_H = 400;

function CMSPondSeatEditor({
  pond,
  seatEdits,
  onToggle,
  useLegacyView = false,
}: {
  pond: Pond;
  seatEdits: Record<number, boolean>;
  onToggle: (num: number, active: boolean) => void;
  useLegacyView?: boolean;
}) {
  const dragVal = useRef<boolean | null>(null);
  const hasShape    = (pond.shape?.length ?? 0) > 2;
  const posSeatsList = pond.seats.filter(s => s.px !== undefined && s.py !== undefined);
  const hasSVG      = !useLegacyView && hasShape && posSeatsList.length > 0;

  if (!hasSVG) {
    // Fallback: flat grid for ponds without a drawn shape
    return (
      <div className="sag-wrap"
        onMouseLeave={() => { dragVal.current = null; }}
        onMouseUp={() => { dragVal.current = null; }}>
        {pond.seats.map(s => {
          const edited   = seatEdits[s.num];
          const isActive = edited !== undefined ? edited : s.active !== false;
          return (
            <div key={s.num}
              className={`sag-seat ${isActive ? 'sag-active' : 'sag-inactive'}`}
              onMouseDown={() => { const nv = !isActive; dragVal.current = nv; onToggle(s.num, nv); }}
              onMouseEnter={() => { if (dragVal.current !== null) onToggle(s.num, dragVal.current); }}>
              {s.num}
            </div>
          );
        })}
      </div>
    );
  }

  const polyPts = pond.shape!.map(v => `${(v.x / 100) * CMS_SVG_W},${(v.y / 100) * CMS_SVG_H}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${CMS_SVG_W} ${CMS_SVG_H}`}
      style={{ width: '100%', display: 'block', borderRadius: '8px' }}
      onMouseLeave={() => { dragVal.current = null; }}
      onMouseUp={() => { dragVal.current = null; }}
    >
      {/* Background water */}
      <rect width={CMS_SVG_W} height={CMS_SVG_H} fill="#0d1c2e" rx="6" />
      {/* Shimmer lines */}
      {Array.from({ length: 7 }, (_, i) => (
        <line key={i} x1={30} y1={55 + i * 48} x2={CMS_SVG_W - 30} y2={55 + i * 48}
          stroke="rgba(77,166,255,0.05)" strokeWidth="1" pointerEvents="none" />
      ))}
      {/* Pond polygon */}
      <polygon points={polyPts}
        fill="rgba(0, 120, 220, 0.17)" stroke="rgba(77,166,255,0.6)"
        strokeWidth="2" strokeLinejoin="round" />
      {/* Seats */}
      {posSeatsList.map(s => {
        const cx       = (s.px! / 100) * CMS_SVG_W;
        const cy       = (s.py! / 100) * CMS_SVG_H;
        const edited   = seatEdits[s.num];
        const isActive = edited !== undefined ? edited : s.active !== false;
        const fill     = isActive ? '#1a7a3e' : '#2a2a2a';
        const stroke   = isActive ? 'rgba(100,220,100,0.55)' : '#444';
        return (
          <g key={s.num} style={{ cursor: 'pointer' }}
            onMouseDown={() => { const nv = !isActive; dragVal.current = nv; onToggle(s.num, nv); }}
            onMouseEnter={() => { if (dragVal.current !== null) onToggle(s.num, dragVal.current); }}>
            <circle cx={cx} cy={cy} r={13} fill={fill} stroke={stroke} strokeWidth={1.5} />
            <text x={cx} y={cy + 4} textAnchor="middle"
              fill={isActive ? 'rgba(255,255,255,0.92)' : '#666'}
              fontSize="10" fontWeight="bold" pointerEvents="none">{s.num}</text>
          </g>
        );
      })}
      {/* Watermark */}
      <text x={CMS_SVG_W / 2} y={CMS_SVG_H - 12} textAnchor="middle"
        fill="rgba(255,255,255,0.07)" fontSize="11" letterSpacing="3" pointerEvents="none">KOLAM</text>
    </svg>
  );
}

const CMSModal: React.FC<CMSModalProps> = ({ isOpen, onClose, onGoToBooking, user, ponds, comp, competitions = [], settings, bookings, onUpdateData, reloadDB }) => {
  const [page, setPage] = useState<CMSPage>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingPond, setEditingPond] = useState<Pond | null>(null);
  const [compEdit, setCompEdit] = useState<Competition>(comp);
  const [compList, setCompList] = useState<Competition[]>(competitions.length ? competitions : (comp.name ? [comp] : []));
  const [competitionEditorOpen, setCompetitionEditorOpen] = useState(false);
  const [competitionDeleteTarget, setCompetitionDeleteTarget] = useState<Competition | null>(null);
  const [settingsEdit, setSettingsEdit] = useState(settings);
  const [newPond, setNewPond] = useState<Partial<Pond>>({ name: '', desc: '', seats: [], open: true });
  const [newPondSeatPrice, setNewPondSeatPrice] = useState(100);
  const [newPondMaxSeats, setNewPondMaxSeats] = useState(30);
  const [pondSaveError, setPondSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bookingFilter, setBookingFilter] = useState<'all' | 'pending' | 'confirmed' | 'rejected'>('all');
  const [checkinRef, setCheckinRef] = useState('');
  const [checkinResult, setCheckinResult] = useState<any>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinDone, setCheckinDone] = useState(false);

  // Competition: per-pond seat active/inactive edits (pondKey -> seatNum -> active)
  const [pondSeatEdits, setPondSeatEdits] = useState<Record<string, Record<number, boolean>>>({});
  const seatDragValue = useRef<boolean | null>(null);

  // Results / Live page state
  const [resultsCompId, setResultsCompId] = useState<string>(comp.id || '');
  const [scoreEntries, setScoreEntries] = useState<ScoreEntry[]>([]);
  const [pendingWeights, setPendingWeights] = useState<Record<string, string>>({});
  const [savingEntry, setSavingEntry] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState({ anglerName: '', pondId: '', seatNum: '', weight: '' });
  const [anglerSuggestOpen, setAnglerSuggestOpen] = useState(false);
  const [prizesCompId, setPrizesCompId] = useState<string>(comp.id || '');

  useEffect(() => {
    if (!resultsCompId && comp.id) setResultsCompId(comp.id);
    else if (!resultsCompId && competitions.length) setResultsCompId(competitions[0].id || '');
  }, [comp.id, competitions]);

  // Sync compEdit when switching competition on prizes page
  useEffect(() => {
    if (page !== 'prizes') return;
    const target = compList.find(c => c.id === prizesCompId) || compList[0];
    if (target) setCompEdit({ ...target });
  }, [prizesCompId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (page !== 'results' || !resultsCompId) return;
    getScoresForCompetition(resultsCompId).then(setScoreEntries);
  }, [page, resultsCompId]);

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
    setPondSaveError(null);

    // 1. Seat count enforcement for polygon view
    const hasPolygon = !settingsEdit.useLegacyPondView && (pond.shape?.length ?? 0) > 2;
    const seatsWithPos = pond.seats.filter(s => s.px !== undefined && s.py !== undefined);
    const target = pond.maxSeats;
    if (hasPolygon && seatsWithPos.length > 0 && target !== undefined && seatsWithPos.length !== target) {
      setPondSaveError(`Letakkan tepat ${target} peg pada peta (kini ${seatsWithPos.length}/${target}).`);
      return;
    }

    // 2. Booking conflict check: any seat being removed that has an active booking?
    const newSeatNums = settingsEdit.useLegacyPondView && target !== undefined
      ? new Set(Array.from({ length: target }, (_, i) => i + 1))  // legacy: 1..maxSeats
      : new Set(pond.seats.map(s => s.num));
    const conflicts = getConflictingRemovedSeats(pond.id, newSeatNums);
    if (conflicts.length > 0) {
      setPondSaveError(`Tidak dapat simpan — peg ${conflicts.join(', ')} masih ada tempahan aktif. Alihkan atau batalkan tempahan tersebut dahulu.`);
      return;
    }

    setSaving(true);
    try {
      const pondDocId = pond._docId || pond.id.toString();
      const safePrice = pond.seats[0]?.price || 100;
      const effectiveMaxSeats = pond.maxSeats ?? pond.seats.length;

      // Build seatLayout: positions + active flag for each seat
      const seatLayout = pond.seats.map(s => ({
        num: s.num,
        px: s.px ?? 50,
        py: s.py ?? 50,
        active: s.active !== false,
      }));

      await updatePondFirestore(pondDocId, {
        name: pond.name,
        description: pond.desc,
        open: pond.open,
        totalSeats: effectiveMaxSeats,
        pricePerSeat: safePrice,
        shape: pond.shape ?? [],
        seatLayout,
      } as any);
      await syncPondSeatsFirestore(pondDocId, effectiveMaxSeats, safePrice);
      await reloadDB();
      setEditingPond(null);
      setPondSaveError(null);
    } catch (err) { console.error('Failed to update pond:', err); }
    setSaving(false);
  };

  const handleCompetitionUpdate = async () => {
    setSaving(true);
    try {
      if (!compEdit.id) { setSaving(false); return; }
      await updateCompetitionFirestore(compEdit.id, compEdit as any);

      // Persist any manually toggled seat active flags back to the ponds
      for (const [pondKey, seatMap] of Object.entries(pondSeatEdits)) {
        if (Object.keys(seatMap).length === 0) continue;
        const pond = ponds.find(p => (p._docId || p.id.toString()) === pondKey);
        if (!pond) continue;
        const seatLayout = pond.seats.map(s => ({
          num:    s.num,
          px:     s.px  ?? 50,
          py:     s.py  ?? 50,
          active: seatMap[s.num] !== undefined ? seatMap[s.num] : s.active !== false,
        }));
        await updatePondFirestore(pondKey, { seatLayout } as any);
      }

      await reloadDB();
      setCompetitionEditorOpen(false);
      setPondSeatEdits({});
    } catch (err) { console.error('Failed to update competition:', err); }
    setSaving(false);
  };

  const handlePrizeSave = async () => {
    setSaving(true);
    try {
      if (!compEdit.id) { setSaving(false); return; }
      await updateCompetitionFirestore(compEdit.id, compEdit as any);
      await reloadDB();
    } catch (err) { console.error('Failed to save prizes:', err); }
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
    if (w) {
      const img = w.document.createElement('img');
      img.src = receiptData;
      img.style.cssText = 'max-width:100%;max-height:100vh;';
      w.document.body.style.cssText = 'margin:0;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh;';
      w.document.body.appendChild(img);
    }
  };

  const handleCheckin = () => {
    const found = bookings.find(b => b.id === checkinRef.trim());
    setCheckinResult(found || null);
    setCheckinDone(false);
  };

  const handlePerformCheckin = async () => {
    if (!checkinResult) return;
    setCheckinLoading(true);
    try {
      await checkInBooking({
        bookingRef: checkinResult.bookingRef || checkinResult.id,
        amount: checkinResult.amount,
        method: 'manual',
      });
      setCheckinDone(true);
      setCheckinResult((prev: any) => ({ ...prev, checkedIn: true }));
    } catch (err) {
      console.error('Check-in failed:', err);
    }
    setCheckinLoading(false);
  };

  const handleContactSettingsSave = async () => {
    setSaving(true);
    try {
      await updateSettingsFirestore({
        phone: settingsEdit.phone || '',
        whatsapp: settingsEdit.whatsapp || '',
        email: settingsEdit.email || '',
        location: settingsEdit.location || '',
        contactTitle: settingsEdit.contactTitle || 'Ada Soalan?',
        contactSubtitle: settingsEdit.contactSubtitle || 'Jangan segan untuk hubungi kami. Kami sedia membantu.',
      });
      await reloadDB();
    } catch (err) {
      console.error('Failed to update contact settings:', err);
    }
    setSaving(false);
  };

  const handlePondViewToggle = async () => {
    const next = !settingsEdit.useLegacyPondView;
    setSettingsEdit(s => ({ ...s, useLegacyPondView: next }));
    try {
      await updateSettingsFirestore({ useLegacyPondView: next });
      await reloadDB();
    } catch (err) {
      console.error('Failed to update pond view setting:', err);
    }
  };

  const handleSaveScore = async (booking: { id: string; userName: string; pondId: number; pondName: string; seats: number[] }) => {
    const weight = parseFloat(pendingWeights[booking.id] || '');
    if (isNaN(weight) || weight < 0) return;
    setSavingEntry(booking.id);
    try {
      await saveScoreEntry({
        competitionId: resultsCompId,
        bookingId: booking.id,
        anglerName: booking.userName,
        pondId: booking.pondId,
        pondName: booking.pondName,
        seatNum: booking.seats[0] || 0,
        weight,
      });
      setScoreEntries(await getScoresForCompetition(resultsCompId));
    } catch (err) { console.error(err); }
    setSavingEntry(null);
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await deleteScoreEntry(id);
      setScoreEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) { console.error(err); }
  };

  const handleManualSave = async () => {
    if (!manualEntry.anglerName || !manualEntry.weight) return;
    setSaving(true);
    try {
      const pond = ponds.find(p => (p._docId || p.id.toString()) === manualEntry.pondId);
      await saveScoreEntry({
        competitionId: resultsCompId,
        anglerName: manualEntry.anglerName,
        pondId: pond?.id || 0,
        pondName: pond?.name || '',
        seatNum: parseInt(manualEntry.seatNum) || 0,
        weight: parseFloat(manualEntry.weight) || 0,
      });
      setScoreEntries(await getScoresForCompetition(resultsCompId));
      setManualEntry({ anglerName: '', pondId: '', seatNum: '', weight: '' });
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  const openCreatePondModal = () => {
    setNewPondSeatPrice(100);
    setNewPondMaxSeats(30);
    setPondSaveError(null);
    setEditingPond({} as any);
  };

  const closePondModal = () => {
    setEditingPond(null);
    setPondSaveError(null);
  };

  /** Returns seat numbers that are in active bookings for this pond and would be removed. */
  const getConflictingRemovedSeats = (pondId: number, newSeatNums: Set<number>) => {
    const conflicts: number[] = [];
    for (const b of bookings) {
      if (b.status === 'rejected') continue;
      if (b.pondId !== pondId) continue;
      for (const sn of b.seats) {
        if (!newSeatNums.has(sn)) conflicts.push(sn);
      }
    }
    return [...new Set(conflicts)].sort((a, b) => a - b);
  };

  const normalizeSeatPrice = (raw: string | number) => {
    const n = typeof raw === 'number' ? raw : parseFloat(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Number(n));
  };

  const applySeatPrice = (price: string | number) => {
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
    { label: 'Admin', items: [
      { id: 'contact-settings' as CMSPage, icon: '☎️', text: 'Contact Us' },
      { id: 'users' as CMSPage, icon: '👥', text: 'Pengguna' },
    ] },
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
                        <td>{ponds.filter((pond) => !competition.activePondIds?.length || competition.activePondIds.includes(pond._docId || pond.id.toString())).reduce((s, p) => {
                          const pondKey = p._docId || p.id.toString();
                          const configured = competition.pondSeats?.[pondKey];
                          const safeConfigured = typeof configured === 'number' ? Math.max(0, Math.min(p.seats.length, Math.floor(configured))) : p.seats.length;
                          return s + safeConfigured;
                        }, 0)}</td>
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
              <div className="page-header">
                <div><div className="page-title">Kolam</div><div className="page-sub">Urus kolam dan tempat duduk</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={!!settingsEdit.useLegacyPondView}
                      onChange={handlePondViewToggle}
                      style={{ accentColor: 'var(--green)', width: '15px', height: '15px', cursor: 'pointer' }}
                    />
                    Paparan kolam lama
                  </label>
                  <button className="btn btn-primary" onClick={openCreatePondModal}>+ Tambah Kolam</button>
                </div>
              </div>
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
              <div className="page-header">
                <div>
                  <div className="page-title">Hadiah &amp; Ranking</div>
                  <div className="page-sub">Tetapan hadiah untuk setiap pertandingan</div>
                </div>
              </div>

              {/* Competition selector */}
              <div className="card" style={{ marginBottom: '16px' }}>
                <div className="card-body" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Pertandingan:</label>
                    <select
                      className="form-input"
                      style={{ maxWidth: '360px', flex: 1 }}
                      value={prizesCompId}
                      onChange={e => setPrizesCompId(e.target.value)}
                    >
                      {compList.map(c => (
                        <option key={c.id || c.name} value={c.id || ''}>{c.name}</option>
                      ))}
                    </select>
                    {compEdit.startDate && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        📅 {new Date(compEdit.startDate).toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Prize editor for selected competition */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Senarai Hadiah — {compEdit.name || '—'}</div>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      const nextRank = compEdit.prizes?.length
                        ? Math.max(...compEdit.prizes.map((p: Prize) => p.rank)) + 1
                        : 1;
                      setCompEdit({ ...compEdit, prizes: [...(compEdit.prizes || []), { rank: nextRank, label: 'Tempat #' + nextRank, prize: '' }] });
                    }}
                  >+ Tambah Tempat</button>
                </div>
                <div className="card-body">
                  <div className="prize-rows">
                    {(compEdit.prizes || []).map((p: Prize, i: number) => (
                      <div key={i} className="prize-row">
                        <div className="prize-rank-badge">{p.rank}</div>
                        <input
                          className="form-input"
                          value={p.label || ''}
                          onChange={e => {
                            const prizes = [...(compEdit.prizes || [])];
                            prizes[i] = { ...prizes[i], label: e.target.value };
                            setCompEdit({ ...compEdit, prizes });
                          }}
                          placeholder="Label (cth: Juara, Naib Juara)"
                        />
                        <input
                          className="form-input"
                          value={p.prize}
                          onChange={e => {
                            const prizes = [...(compEdit.prizes || [])];
                            prizes[i] = { ...prizes[i], prize: e.target.value };
                            setCompEdit({ ...compEdit, prizes });
                          }}
                          placeholder="Hadiah (cth: RM 500)"
                        />
                        <button
                          className="prize-del"
                          onClick={() => setCompEdit({ ...compEdit, prizes: (compEdit.prizes || []).filter((_: Prize, idx: number) => idx !== i) })}
                        >✕</button>
                      </div>
                    ))}
                    {(compEdit.prizes || []).length === 0 && (
                      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        Tiada hadiah ditambah untuk pertandingan ini
                      </div>
                    )}
                  </div>
                  <div className="form-actions" style={{ marginTop: '1rem' }}>
                    <button className="btn btn-primary" disabled={saving} onClick={handlePrizeSave}>
                      {saving ? 'Menyimpan...' : 'Simpan Hadiah'}
                    </button>
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
                      <td className="td-name">
                        {b.userName}
                        {b.createdByStaff && <span style={{ marginLeft: 5, fontSize: '0.68rem', background: 'rgba(250,204,21,0.18)', color: 'var(--gold)', border: '1px solid rgba(250,204,21,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: '0.5px' }}>ADMIN</span>}
                      </td>
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
              <div className="card">
                <div className="card-body" style={{ padding: '2rem' }}>
                  <div style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: '0.75rem' }}>📝</div>
                  <h3 style={{ textAlign: 'center', marginBottom: '0.25rem' }}>Cara Buat Tempahan Manual</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', marginBottom: '1.75rem' }}>
                    Nama dan e-mel pelanggan akan muncul secara automatik apabila anda log masuk sebagai Admin.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 480, margin: '0 auto 2rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', background: 'rgba(200,146,42,0.07)', border: '1px solid rgba(200,146,42,0.2)', borderRadius: 8, padding: '1rem' }}>
                      <div style={{ minWidth: 28, height: 28, borderRadius: '50%', background: 'var(--gold)', color: '#1a0e05', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</div>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Pergi ke Halaman Tempahan</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Klik butang di bawah untuk membuka halaman tempahan awam.</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', background: 'rgba(200,146,42,0.07)', border: '1px solid rgba(200,146,42,0.2)', borderRadius: 8, padding: '1rem' }}>
                      <div style={{ minWidth: 28, height: 28, borderRadius: '50%', background: 'var(--gold)', color: '#1a0e05', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</div>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Isi Nama &amp; E-mel Pelanggan</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Di bahagian atas borang tempahan, masukkan nama penuh dan e-mel pelanggan. Medan ini hanya muncul apabila anda log masuk sebagai Admin.</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', background: 'rgba(200,146,42,0.07)', border: '1px solid rgba(200,146,42,0.2)', borderRadius: 8, padding: '1rem' }}>
                      <div style={{ minWidth: 28, height: 28, borderRadius: '50%', background: 'var(--gold)', color: '#1a0e05', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>3</div>
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Pilih Tempat &amp; Hantar</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Pilih kolam, tempat peserta, muat naik resit, dan hantar tempahan. Tempahan akan ditanda sebagai "Dibuat oleh Admin".</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <button className="btn btn-primary" onClick={() => { onClose(); onGoToBooking?.(); }}>
                      🏊 Pergi ke Halaman Tempahan
                    </button>
                  </div>
                </div>
              </div>
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
                        <td className="td-name">
                          {b.userName}
                          {b.createdByStaff && <span style={{ marginLeft: 5, fontSize: '0.68rem', background: 'rgba(250,204,21,0.18)', color: 'var(--gold)', border: '1px solid rgba(250,204,21,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: '0.5px' }}>ADMIN</span>}
                        </td>
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
                    {checkinResult.status === 'confirmed' && !checkinDone && (
                      <button className="btn btn-green w-full mt-3" onClick={handlePerformCheckin} disabled={checkinLoading}>
                        {checkinLoading ? '⏳ Memproses...' : '✓ Check-In Peserta'}
                      </button>
                    )}
                    {checkinDone && (
                      <div className="btn btn-green w-full mt-3" style={{ textAlign: 'center', cursor: 'default', opacity: 0.8 }}>
                        ✓ Daftar Masuk Berjaya
                      </div>
                    )}
                  </div>
                </div>
              )}
              {checkinRef && !checkinResult && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Tempahan tidak dijumpai.</div>}
            </div>
          )}
          {page === 'results' && (() => {
            const resultsComp = compList.find(c => c.id === resultsCompId) || comp;
            const activePonds = resultsComp.activePondIds?.length
              ? ponds.filter(p => resultsComp.activePondIds!.includes(p._docId || p.id.toString()))
              : ponds;
            const sortedEntries = [...scoreEntries].sort((a, b) => b.weight - a.weight);
            return (
              <div className="page active">
                <div className="page-header">
                  <div>
                    <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="live-dot"></span> Keputusan &amp; Live
                    </div>
                    <div className="page-sub">Input berat peserta &amp; papan markah langsung</div>
                  </div>
                </div>

                {/* Competition Selector */}
                <div className="card" style={{ marginBottom: '16px' }}>
                  <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Pertandingan:</label>
                    <select
                      className="form-input"
                      style={{ flex: '1', minWidth: '200px', maxWidth: '360px' }}
                      value={resultsCompId}
                      onChange={(e) => { setResultsCompId(e.target.value); setScoreEntries([]); setPendingWeights({}); }}
                    >
                      {compList.map(c => <option key={c.id} value={c.id || ''}>{c.name}</option>)}
                    </select>
                    <button className="btn btn-sm" onClick={() => getScoresForCompetition(resultsCompId).then(setScoreEntries)}>🔄 Muat Semula</button>
                  </div>
                </div>

                {/* Manual Entry Form */}
                <div className="card" style={{ marginBottom: '16px' }}>
                  <div className="card-header"><div className="card-title">Tambah Rekod Manual</div></div>
                  <div className="card-body">
                    {(() => {
                      const query = manualEntry.anglerName.toLowerCase();
                      const seen = new Set<string>();
                      const knownAnglers = bookings
                        .filter(b => b.userName)
                        .reduce<{ name: string; email: string; userId: string }[]>((acc, b) => {
                          const key = b.userId || b.userName;
                          if (!seen.has(key)) {
                            seen.add(key);
                            acc.push({ name: b.userName, email: b.userId, userId: b.userId });
                          }
                          return acc;
                        }, []);
                      const suggestions = query.length >= 1
                        ? knownAnglers.filter(a =>
                            a.name.toLowerCase().includes(query) ||
                            a.email.toLowerCase().includes(query)
                          ).slice(0, 8)
                        : [];
                      return (
                        <div className="form-grid">
                          <div className="form-group" style={{ position: 'relative' }}>
                            <label className="form-label">Nama Peserta</label>
                            <input
                              className="form-input"
                              value={manualEntry.anglerName}
                              autoComplete="off"
                              onChange={(e) => { setManualEntry(m => ({ ...m, anglerName: e.target.value })); setAnglerSuggestOpen(true); }}
                              onFocus={() => setAnglerSuggestOpen(true)}
                              onBlur={() => setTimeout(() => setAnglerSuggestOpen(false), 160)}
                              placeholder="Nama Pemancing"
                            />
                            {anglerSuggestOpen && suggestions.length > 0 && (
                              <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                                background: 'var(--white)', border: '1px solid var(--border)',
                                borderRadius: '0 0 8px 8px', boxShadow: '0 8px 24px rgba(0,0,0,.12)',
                                overflow: 'hidden', marginTop: '2px',
                              }}>
                                {suggestions.map(a => (
                                  <div
                                    key={a.userId}
                                    onMouseDown={() => {
                                      setManualEntry(m => ({ ...m, anglerName: a.name }));
                                      setAnglerSuggestOpen(false);
                                    }}
                                    style={{
                                      padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                                      display: 'flex', flexDirection: 'column', gap: '2px',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--gold-pale)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                                  >
                                    <span style={{ fontWeight: 600, fontSize: '0.86rem' }}>{a.name}</span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--fm)' }}>
                                      {a.email}{a.userId !== a.email ? ` · ID: ${a.userId}` : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                      <div className="form-group">
                        <label className="form-label">Kolam</label>
                        <select
                          className="form-input"
                          value={manualEntry.pondId}
                          onChange={(e) => setManualEntry(m => ({ ...m, pondId: e.target.value }))}
                        >
                          <option value="">-- Pilih Kolam --</option>
                          {activePonds.map(p => (
                            <option key={p._docId || p.id} value={p._docId || p.id.toString()}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">No. Peg / Tempat</label>
                        <input
                          className="form-input"
                          type="number" min="1"
                          value={manualEntry.seatNum}
                          onChange={(e) => setManualEntry(m => ({ ...m, seatNum: e.target.value }))}
                          placeholder="1"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Berat (kg)</label>
                        <input
                          className="form-input"
                          type="number" step="0.01" min="0"
                          value={manualEntry.weight}
                          onChange={(e) => setManualEntry(m => ({ ...m, weight: e.target.value }))}
                          placeholder="0.00"
                        />
                      </div>
                        </div>
                      );
                    })()}
                    <div className="form-actions" style={{ marginTop: '12px' }}>
                      <button
                        className="btn btn-primary"
                        disabled={saving || !manualEntry.anglerName || !manualEntry.weight}
                        onClick={handleManualSave}
                      >
                        {saving ? 'Menyimpan...' : '+ Tambah Rekod'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Leaderboard */}
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">Papan Markah Semasa ({scoreEntries.length} rekod)</div>
                  </div>
                  <div className="card-body">
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width: '50px' }}>#</th>
                            <th>Peserta</th>
                            <th>Kolam</th>
                            <th>Peg</th>
                            <th style={{ textAlign: 'right' }}>Berat (kg)</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedEntries.map((e, i) => (
                            <tr key={e.id}>
                              <td>
                                <span className={`result-rank ${i < 3 ? 'rank-' + (i + 1) : ''}`}>
                                  {i < 3 ? ['🥇', '🥈', '🥉'][i] : '#' + (i + 1)}
                                </span>
                              </td>
                              <td className="td-name">{e.anglerName}</td>
                              <td>{e.pondName}</td>
                              <td>{e.seatNum}</td>
                              <td style={{ textAlign: 'right' }}>
                                <span className="w-cell">{e.weight.toFixed(2)}</span> kg
                              </td>
                              <td>
                                <button
                                  className="btn btn-sm"
                                  style={{ color: '#ef4444' }}
                                  onClick={() => e.id && handleDeleteEntry(e.id)}
                                >🗑</button>
                              </td>
                            </tr>
                          ))}
                          {scoreEntries.length === 0 && (
                            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                              Tiada rekod untuk pertandingan ini
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          {page === 'contact-settings' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Contact Us</div><div className="page-sub">Sesuaikan maklumat hubungan yang dipaparkan di laman utama</div></div></div>
              <div className="card">
                <div className="card-header"><div className="card-title">Maklumat Hubungan</div></div>
                <div className="card-body">
                  <div className="form-grid">
                    <div className="form-group"><label className="form-label">Tajuk Seksyen</label><input className="form-input" value={settingsEdit.contactTitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, contactTitle: e.target.value })} placeholder="Ada Soalan?" /></div>
                    <div className="form-group"><label className="form-label">Telefon</label><input className="form-input" value={settingsEdit.phone || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, phone: e.target.value })} placeholder="+60 12-345 6789" /></div>
                    <div className="form-group"><label className="form-label">WhatsApp</label><input className="form-input" value={settingsEdit.whatsapp || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, whatsapp: e.target.value })} placeholder="+60 12-345 6789" /></div>
                    <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={settingsEdit.email || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, email: e.target.value })} placeholder="info@kks.com" /></div>
                    <div className="form-group form-span"><label className="form-label">Alamat</label><input className="form-input" value={settingsEdit.location || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, location: e.target.value })} placeholder="Alor Setar, Kedah" /></div>
                    <div className="form-group form-span"><label className="form-label">Penerangan Ringkas</label><textarea className="form-textarea" value={settingsEdit.contactSubtitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, contactSubtitle: e.target.value })} placeholder="Jangan segan untuk hubungi kami. Kami sedia membantu." /></div>
                  </div>
                  <div className="form-actions" style={{ marginTop: '12px' }}>
                    <button className="btn btn-primary" disabled={saving} onClick={handleContactSettingsSave}>{saving ? 'Menyimpan...' : 'Simpan Contact Us'}</button>
                  </div>
                </div>
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
          <div className="modal-overlay open" onClick={() => { setCompetitionEditorOpen(false); setPondSeatEdits({}); }}>
            <div className="modal" style={{ maxWidth: '760px', width: '95%', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header" style={{ flexShrink: 0 }}>
                <div className="modal-title">Manage Competition</div>
                <button className="modal-close" onClick={() => { setCompetitionEditorOpen(false); setPondSeatEdits({}); }}>×</button>
              </div>
              <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
                <div className="form-grid">
                  <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={compEdit.name || ''} onChange={(e) => setCompEdit({ ...compEdit, name: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Tarikh Mula</label><div className="date-input-wrap"><input className="form-input" type="datetime-local" value={toLocalDatetime(compEdit.startDate)} onChange={(e) => e.target.value && setCompEdit({ ...compEdit, startDate: new Date(e.target.value).toISOString() })} /><button type="button" className="date-picker-btn" onClick={openDatePicker}>📅</button></div></div>
                  <div className="form-group"><label className="form-label">Tarikh Tamat</label><div className="date-input-wrap"><input className="form-input" type="datetime-local" value={toLocalDatetime(compEdit.endDate)} onChange={(e) => e.target.value && setCompEdit({ ...compEdit, endDate: new Date(e.target.value).toISOString() })} /><button type="button" className="date-picker-btn" onClick={openDatePicker}>📅</button></div></div>
                  <div className="form-group"><label className="form-label">Top N</label><input className="form-input" type="number" value={compEdit.topN || 20} onChange={(e) => setCompEdit({ ...compEdit, topN: parseInt(e.target.value) || 20 })} /></div>
                </div>

                <div className="card" style={{ marginTop: '12px' }}>
                  <div className="card-header"><div className="card-title">Active Ponds For This Competition</div></div>
                  <div className="card-body">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {ponds.map((pond) => {
                        const pondKey  = pond._docId || pond.id.toString();
                        const checked  = (compEdit.activePondIds || []).includes(pondKey);
                        const openSeats = Math.max(0, Math.min(pond.seats.length, Math.floor(compEdit.pondSeats?.[pondKey] ?? pond.seats.length)));
                        return (
                          <div key={pondKey} style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px', background: checked ? 'var(--cream)' : 'transparent' }}>
                            {/* Row 1: checkbox + count input */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem', fontWeight: 600, flex: 1, minWidth: 120 }}>
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
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: checked ? 1 : 0.45 }}>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Seat available</label>
                                <input
                                  className="form-input"
                                  type="number"
                                  min={0}
                                  max={pond.seats.length}
                                  disabled={!checked}
                                  style={{ width: '80px', padding: '5px 8px' }}
                                  value={openSeats}
                                  onChange={(e) => {
                                    const raw  = parseInt(e.target.value) || 0;
                                    const safe = Math.max(0, Math.min(pond.seats.length, raw));
                                    setCompEdit({ ...compEdit, pondSeats: { ...(compEdit.pondSeats || {}), [pondKey]: safe } });
                                  }}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/ {pond.seats.length}</span>
                              </div>
                            </div>

                            {/* Row 2: pond SVG seat active/inactive editor */}
                            {pond.seats.length > 0 && (
                              <div style={{ marginTop: '12px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                                  Peg aktif/tidak aktif — klik atau seret untuk tukar:
                                </div>
                                <CMSPondSeatEditor
                                  pond={pond}
                                  seatEdits={pondSeatEdits[pondKey] || {}}
                                  useLegacyView={!!settingsEdit.useLegacyPondView}
                                  onToggle={(num, active) =>
                                    setPondSeatEdits(prev => ({
                                      ...prev,
                                      [pondKey]: { ...(prev[pondKey] || {}), [num]: active },
                                    }))
                                  }
                                />
                                {pondSeatEdits[pondKey] && Object.keys(pondSeatEdits[pondKey]).length > 0 && (
                                  <div className="sag-hint" style={{ marginTop: '5px' }}>
                                    {Object.values(pondSeatEdits[pondKey]).filter(Boolean).length} aktif ·{' '}
                                    {Object.values(pondSeatEdits[pondKey]).filter(v => !v).length} tidak aktif (belum disimpan)
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                      Biarkan semua tidak ditanda untuk benarkan semua kolam. Hijau = peg aktif, kelabu = peg tidak aktif.
                    </div>
                  </div>
                </div>

                <div className="form-actions" style={{ marginTop: '12px' }}>
                  <button className="btn btn-ghost" onClick={() => { setCompetitionEditorOpen(false); setPondSeatEdits({}); }}>Batal</button>
                  <button className="btn btn-primary" onClick={handleCompetitionUpdate} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {editingPond && (() => {
          const isEdit = !!editingPond.id;
          const curMaxSeats = isEdit ? (editingPond.maxSeats ?? editingPond.seats.length ?? 30) : newPondMaxSeats;
          const curSeats = isEdit ? (editingPond.seats ?? []) : (newPond.seats ?? []);
          const curShape = isEdit ? (editingPond.shape ?? []) : ((newPond as any).shape ?? []);
          const isLegacy = !!settingsEdit.useLegacyPondView;
          const seatsPlaced = curSeats.filter(s => s.px !== undefined).length;
          const hasPolygon = !isLegacy && curShape.length > 2;
          const seatCountOk = !hasPolygon || seatsPlaced === 0 || seatsPlaced === curMaxSeats;
          return (
          <div className="modal-overlay open" onClick={closePondModal}>
            <div className="modal" style={{ maxWidth: '860px', width: '95%', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header" style={{ flexShrink: 0 }}>
                <div className="modal-title">{isEdit ? 'Edit Kolam' : 'Tambah Kolam Baru'}</div>
                <button className="modal-close" onClick={closePondModal}>×</button>
              </div>
              <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
                <div className="form-grid">
                  <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={isEdit ? editingPond.name : newPond.name} onChange={e => isEdit ? setEditingPond({ ...editingPond, name: e.target.value }) : setNewPond({ ...newPond, name: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Keterangan</label><input className="form-input" value={isEdit ? editingPond.desc : newPond.desc} onChange={e => isEdit ? setEditingPond({ ...editingPond, desc: e.target.value }) : setNewPond({ ...newPond, desc: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Harga Per Tempat (RM)</label><input className="form-input" type="number" min="0" step="1" value={isEdit ? (editingPond.seats?.[0]?.price || 0) : newPondSeatPrice} onChange={e => applySeatPrice(e.target.value)} /></div>
                  <div className="form-group">
                    <label className="form-label">
                      Bilangan Tempat Duduk Maksimum
                      {!isLegacy && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 6 }}>(mesti sepadan dengan peg diletakkan)</span>}
                    </label>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      max="300"
                      value={curMaxSeats}
                      onChange={e => {
                        const v = Math.max(1, parseInt(e.target.value) || 1);
                        setPondSaveError(null);
                        if (isEdit) setEditingPond({ ...editingPond, maxSeats: v });
                        else setNewPondMaxSeats(v);
                      }}
                    />
                  </div>
                </div>

                {/* ── Pond visual editor (polygon mode only) ── */}
                {isLegacy ? (
                  <div style={{ marginTop: '16px', padding: '12px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    ℹ️ Paparan kapsul lama aktif — bilangan tempat duduk ({curMaxSeats}) digunakan secara automatik. Tukar ke paparan polygon untuk menetapkan susun atur visual.
                  </div>
                ) : (
                  <div style={{ marginTop: '20px' }}>
                    <div className="form-label" style={{ marginBottom: '8px', display: 'block' }}>
                      Reka Bentuk Kolam &amp; Susunan Tempat Duduk
                      {hasPolygon && seatsPlaced > 0 && (
                        <span style={{ marginLeft: 8, fontSize: '0.78rem', color: seatCountOk ? 'var(--green)' : '#facc15' }}>
                          {seatsPlaced}/{curMaxSeats} peg diletakkan{seatCountOk ? ' ✓' : ` — perlu tepat ${curMaxSeats}`}
                        </span>
                      )}
                    </div>
                    <PondEditor
                      shape={curShape}
                      seats={curSeats}
                      maxSeats={curMaxSeats}
                      onChange={(newShape, newSeats) => {
                        setPondSaveError(null);
                        if (isEdit) {
                          setEditingPond({ ...editingPond, shape: newShape, seats: newSeats });
                        } else {
                          setNewPond({ ...newPond, shape: newShape as any, seats: newSeats });
                        }
                      }}
                    />
                  </div>
                )}

                {/* ── Save error ── */}
                {pondSaveError && (
                  <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', color: '#f87171', fontSize: '0.84rem' }}>
                    ⚠ {pondSaveError}
                  </div>
                )}

                <div className="form-actions" style={{ marginTop: '16px' }}>
                  {isEdit ? (<>
                    <button className="btn btn-ghost" onClick={closePondModal}>Batal</button>
                    <button className="btn btn-primary" disabled={saving || !seatCountOk} onClick={() => handlePondUpdate(editingPond)}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
                  </>) : (<>
                    <button className="btn btn-ghost" onClick={closePondModal}>Batal</button>
                    <button className="btn btn-primary" disabled={saving || !seatCountOk} onClick={async () => {
                      if (newPond.name) {
                        // Conflict check for new pond: no existing bookings, so just count check
                        if (!isLegacy && hasPolygon && seatsPlaced > 0 && seatsPlaced !== newPondMaxSeats) {
                          setPondSaveError(`Letakkan tepat ${newPondMaxSeats} peg pada peta (kini ${seatsPlaced}/${newPondMaxSeats}).`);
                          return;
                        }
                        setSaving(true);
                        try {
                          const effectiveMax = isLegacy ? newPondMaxSeats : ((newPond.seats ?? []).length || newPondMaxSeats);
                          const newDocId = await createPondFirestore({ name: newPond.name, desc: newPond.desc || '', open: true, totalSeats: effectiveMax, pricePerSeat: newPondSeatPrice || 100 } as any);
                          // Save shape + seatLayout if present (polygon mode)
                          const shape = (newPond as any).shape ?? [];
                          const seats = newPond.seats ?? [];
                          if (!isLegacy && (shape.length > 0 || seats.length > 0)) {
                            const seatLayout = seats.map((s: any) => ({ num: s.num, px: s.px ?? 50, py: s.py ?? 50, active: s.active !== false }));
                            await updatePondFirestore(newDocId, { shape, seatLayout } as any);
                          }
                          await reloadDB();
                          setNewPond({ name: '', desc: '', seats: [], open: true });
                          setNewPondMaxSeats(30);
                          setEditingPond(null);
                          setPondSaveError(null);
                        } catch (err) { console.error('Failed to add pond:', err); }
                        setSaving(false);
                      }
                    }}>{saving ? 'Menyimpan...' : 'Tambah'}</button>
                  </>)}
                </div>
              </div>
            </div>
          </div>
          );
        })()}

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