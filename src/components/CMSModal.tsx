import React, { useState, useEffect, useRef } from 'react';
import { User, Pond, Competition, Prize, Settings, ScoreEntry, Booking } from '../types';
import { gs } from '../data';
import PondEditor from './PondEditor';
import { checkInBooking, acceptBookingReceipt, rejectBookingReceipt } from '../lib/api';
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
  markBalanceReminderSent,
} from '../lib/firestore';
import { uploadImageToCloudinary } from '../utils/cloudinary';
import { queueBookingApprovedEmail, queueBalanceReminderEmail } from '../lib/email';
import { balanceReminderInfo } from '../utils/booking';
import { getCompetitionPhase } from '../utils/competition';
import ScaleScanModal, { ScaleScanApproved, ScannedBookingFull } from './cms/ScaleScanModal';

type CMSPage = 'dashboard' | 'competitions' | 'ponds' | 'prizes' | 'approvals' | 'manual-booking' | 'all-bookings' | 'checkin' | 'results' | 'contact-settings' | 'landing-content' | 'users';

interface CMSModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToBooking?: () => void;
  user: User | null;
  ponds: Pond[];
  comp: Competition;
  competitions?: Competition[];
  settings: Settings;
  bookings: Booking[];
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
  // Sync settingsEdit when the parent settings prop changes (e.g. after reloadDB)
  useEffect(() => { setSettingsEdit(settings); }, [settings]);
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
  const [scanOpen, setScanOpen] = useState(false);
  const [pendingScan, setPendingScan] = useState<ScaleScanApproved | null>(null);
  const [anglerSuggestOpen, setAnglerSuggestOpen] = useState(false);
  // Tracks the last angler name we auto-filled from pond+seat, so we re-autofill
  // when the seat changes but never overwrite a name the admin typed themselves.
  const autofilledAnglerRef = useRef<string>('');
  const [prizesCompId, setPrizesCompId] = useState<string>(comp.id || '');
  const [pondMapUploading, setPondMapUploading] = useState(false);

  // In-page receipt lightbox (replaces opening a new browser tab).
  const [receiptViewerUrl, setReceiptViewerUrl] = useState<string | null>(null);
  // Dimensions (from <img> onLoad) + byte size (from a HEAD request / data-URL) of
  // the receipt currently shown in the lightbox.
  const [receiptViewerMeta, setReceiptViewerMeta] = useState<{ width: number; height: number; bytes: number | null }>({ width: 0, height: 0, bytes: null });
  // Reusable confirmation dialog for decision actions (accept/reject/check-in/remind).
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    tone: 'danger' | 'primary';
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  // Ticking clock so the balance-reminder countdowns refresh while the page is open.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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

  // Auto-fill the participant name when the admin enters pond + seat first.
  // Never overwrites a name the admin typed (only an empty or previously
  // auto-filled value), and re-runs when the pond/seat changes.
  useEffect(() => {
    if (page !== 'results') return;
    const current = manualEntry.anglerName;
    if (current && current !== autofilledAnglerRef.current) return; // admin typed a name — leave it
    const seatNum = parseInt(manualEntry.seatNum, 10);
    if (!manualEntry.pondId || !seatNum) return;
    const pond = ponds.find(p => (p._docId || p.id.toString()) === manualEntry.pondId);
    if (!pond) return;
    const match = bookings.find(b =>
      b.status !== 'rejected' &&
      b.pondId === pond.id &&
      b.seats.includes(seatNum) &&
      (!resultsCompId || !b.competitionId || b.competitionId === resultsCompId)
    );
    const name = match?.userName || '';
    if (name && name !== current) {
      autofilledAnglerRef.current = name;
      setManualEntry(m => ({ ...m, anglerName: name }));
    }
  }, [manualEntry.pondId, manualEntry.seatNum, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCompEdit(comp);
    setCompList(competitions.length ? competitions : (comp.name ? [comp] : []));
  }, [comp, competitions]);
  useEffect(() => { setSettingsEdit(settings); }, [settings]);

  // Conflict detection: map "pondId-seatNum" → booking IDs that claim it (excluding rejected)
  const seatConflictMap = React.useMemo(() => {
    const map = new Map<string, string[]>();
    bookings.forEach((b) => {
      if (b.status === 'rejected') return;
      (b.seats ?? []).forEach((seatNum) => {
        const key = `${b.pondId}-${seatNum}`;
        map.set(key, [...(map.get(key) ?? []), b.id]);
      });
    });
    return map;
  }, [bookings]);

  const toLocalDatetime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  const getCompetitionStatusMeta = (competition: Partial<Competition>) => {
    const phase = getCompetitionPhase(competition);
    if (phase === 'upcoming') return { label: 'Akan Datang', badgeClass: 'badge-draft' };
    if (phase === 'ended') return { label: 'Tamat', badgeClass: 'badge-completed' };
    return { label: 'Aktif', badgeClass: 'badge-live' };
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
    const start = new Date(compEdit.startDate).getTime();
    const end = new Date(compEdit.endDate || compEdit.startDate).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) {
      window.alert('Tarikh tamat mesti sama atau selepas tarikh mula.');
      return;
    }

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

  const handleRejectBooking = async (bookingId: string) => {
    setSaving(true);
    try { await updateBookingStatusFirestore(bookingId, 'rejected'); await reloadDB(); }
    catch (err) { console.error('Failed to reject booking:', err); }
    setSaving(false);
  };

  // Accept a single payment receipt. The booking is only confirmed (and the
  // approval email fired) once it becomes fully paid — a deposit booking with just
  // the deposit receipt accepted stays pending until the balance receipt is in.
  const handleAcceptReceipt = async (bookingId: string, receiptIndex: number) => {
    const target = bookings.find(b => b.id === bookingId);
    const wasPending = target?.status === 'pending';
    setSaving(true);
    try {
      const result = await acceptBookingReceipt({ bookingId, receiptIndex });
      if (wasPending && result?.fullyPaid && target?.userEmail) {
        await queueBookingApprovedEmail({
          to: target.userEmail,
          bookingId: target.id,
          bookingRef: target.bookingRef ?? target.id,
          pondName: target.pondName,
          pondDate: target.pondDate ?? '',
          seats: target.seats,
        });
      }
      await reloadDB();
    } catch (err) {
      console.error('Failed to accept receipt:', err);
      window.alert(`Gagal mengesahkan resit / Failed to accept receipt: ${err instanceof Error ? err.message : 'Ralat tidak diketahui / Unknown error'}`);
    }
    setSaving(false);
  };

  const handleRejectReceipt = async (bookingId: string, receiptIndex: number) => {
    setSaving(true);
    try { await rejectBookingReceipt({ bookingId, receiptIndex }); await reloadDB(); }
    catch (err) {
      console.error('Failed to reject receipt:', err);
      window.alert(`Gagal menolak resit / Failed to reject receipt: ${err instanceof Error ? err.message : 'Ralat tidak diketahui / Unknown error'}`);
    }
    setSaving(false);
  };

  // Manually email the user a balance-due reminder and reset the 7-day auto-remind clock.
  const handleSendBalanceReminder = async (bookingId: string) => {
    const target = bookings.find(b => b.id === bookingId);
    if (!target) return;
    const recipient = target.userEmail || target.userId;
    if (!recipient || !recipient.includes('@')) {
      window.alert('Tiada alamat email sah untuk tempahan ini. / No valid email address for this booking.');
      return;
    }
    setSaving(true);
    try {
      await queueBalanceReminderEmail({
        to: recipient,
        bookingId: target.id,
        bookingRef: target.bookingRef ?? target.id,
        pondName: target.pondName,
        pondDate: target.pondDate ?? '',
        seats: target.seats,
        balanceDue: target.balanceDue ?? 0,
      });
      await markBalanceReminderSent(bookingId);
      await reloadDB();
    } catch (err) {
      console.error('Failed to send balance reminder:', err);
      window.alert(`Gagal menghantar peringatan / Failed to send reminder: ${err instanceof Error ? err.message : 'Ralat tidak diketahui / Unknown error'}`);
    }
    setSaving(false);
  };

  // ── Confirmation-dialog wrappers ─────────────────────────────────────────
  // Each opens the shared confirm dialog; the real work runs only on confirm.
  const askAcceptReceipt = (bookingId: string, receiptIndex: number) => {
    const target = bookings.find(b => b.id === bookingId);
    const seatClash = target && (target.seats ?? []).some((seatNum) =>
      bookings.some(b => b.id !== bookingId && b.status === 'confirmed' && b.pondId === target.pondId && b.seats.includes(seatNum))
    );
    const amount = target?.receipts?.[receiptIndex]?.amount;
    setConfirmDialog({
      title: 'Sahkan Resit',
      message: `Sahkan resit${amount != null ? ` RM ${amount}` : ''} untuk tempahan ini?${seatClash ? '\n\n⚠ Amaran: salah satu peg ini sudah disahkan pada tempahan lain.' : ''}`,
      confirmLabel: 'Sahkan',
      tone: 'primary',
      onConfirm: () => handleAcceptReceipt(bookingId, receiptIndex),
    });
  };

  const askRejectReceipt = (bookingId: string, receiptIndex: number) => {
    setConfirmDialog({
      title: 'Tolak Resit',
      message: 'Tolak resit ini? Pengguna boleh memuat naik resit baharu selepas ini.',
      confirmLabel: 'Tolak Resit',
      tone: 'danger',
      onConfirm: () => handleRejectReceipt(bookingId, receiptIndex),
    });
  };

  const askRejectBooking = (bookingId: string) => {
    setConfirmDialog({
      title: 'Tolak Tempahan',
      message: 'Tolak keseluruhan tempahan ini? Tempat akan dilepaskan dan tindakan ini tidak boleh diundur dengan mudah.',
      confirmLabel: 'Tolak Tempahan',
      tone: 'danger',
      onConfirm: () => handleRejectBooking(bookingId),
    });
  };

  const askSendReminder = (bookingId: string) => {
    setConfirmDialog({
      title: 'Hantar Peringatan',
      message: 'Hantar e-mel peringatan baki bayaran kepada pengguna sekarang? Kiraan auto-peringat akan ditetapkan semula ke 7 hari.',
      confirmLabel: 'Hantar',
      tone: 'primary',
      onConfirm: () => handleSendBalanceReminder(bookingId),
    });
  };

  // A booking needs staff attention while any of its receipts is pending review.
  const pendingReceiptIndexes = (b: { receipts?: { status: string }[] }) =>
    (b.receipts || []).map((r, i) => (r.status === 'pending' ? i : -1)).filter(i => i >= 0);

  // Human-readable balance-reminder status for a deposit booking awaiting its balance.
  const reminderLabel = (info: ReturnType<typeof balanceReminderInfo>): string => {
    if (info.msUntilRemind <= 0) return 'tertunggak';
    const totalMins = Math.floor(info.msUntilRemind / 60000);
    const days = Math.floor(totalMins / (60 * 24));
    const hours = Math.floor((totalMins % (60 * 24)) / 60);
    if (days > 0) return `${days}h ${hours}j`;
    const mins = totalMins % 60;
    return `${hours}j ${mins}m`;
  };

  const handleViewReceipt = (receiptData: string) => {
    if (!receiptData) return;
    setReceiptViewerUrl(receiptData);
    setReceiptViewerMeta({ width: 0, height: 0, bytes: null });
    // Resolve the file size: derive it from a data-URL directly, otherwise ask
    // the host for Content-Length via a HEAD request (best-effort; ignored on CORS failure).
    if (receiptData.startsWith('data:')) {
      const base64 = receiptData.split(',')[1] || '';
      const padding = (base64.match(/=+$/) || [''])[0].length;
      const bytes = Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
      setReceiptViewerMeta(m => ({ ...m, bytes }));
    } else {
      fetch(receiptData, { method: 'HEAD' })
        .then(r => { const len = r.headers.get('content-length'); if (len) setReceiptViewerMeta(m => ({ ...m, bytes: parseInt(len, 10) })); })
        .catch(() => {});
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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

  const handleLandingContentSave = async () => {
    setSaving(true);
    try {
      await updateSettingsFirestore({
        heroKicker: settingsEdit.heroKicker || '',
        heroTitle: settingsEdit.heroTitle || '',
        heroSubtitle: settingsEdit.heroSubtitle || '',
        heroStats: settingsEdit.heroStats || [],
        introCopy: settingsEdit.introCopy || '',
        rules: settingsEdit.rules || [],
        wazeUrl: settingsEdit.wazeUrl || '',
        googleMapsUrl: settingsEdit.googleMapsUrl || '',
        mapEmbedUrl: settingsEdit.mapEmbedUrl || '',
        ocrUsePreprocess: settingsEdit.ocrUsePreprocess !== false,
        ocrDecimalPlaces: settingsEdit.ocrDecimalPlaces,
      });
      await reloadDB();
    } catch (err) {
      console.error('Failed to update landing content settings:', err);
    }
    setSaving(false);
  };

  const handleOcrPreprocessToggle = async () => {
    const next = !(settingsEdit.ocrUsePreprocess !== false);
    setSettingsEdit(s => ({ ...s, ocrUsePreprocess: next }));
    try {
      await updateSettingsFirestore({ ocrUsePreprocess: next });
      await reloadDB();
    } catch (err) {
      console.error('Failed to update OCR preprocess setting:', err);
    }
  };

  const handleOcrDecimalChange = async (value: string) => {
    let next: 0 | 1 | 2 | 3 | undefined;
    if (value === 'auto') next = undefined;
    else next = parseInt(value, 10) as 0 | 1 | 2 | 3;
    setSettingsEdit(s => ({ ...s, ocrDecimalPlaces: next }));
    try {
      await updateSettingsFirestore({ ocrDecimalPlaces: next });
      await reloadDB();
    } catch (err) {
      console.error('Failed to update OCR decimal-place setting:', err);
    }
  };

  const updateHeroStat = (idx: number, field: 'label' | 'value', val: string) => {
    const stats = [...(settingsEdit.heroStats || [])];
    while (stats.length <= idx) stats.push({ label: '', value: '' });
    stats[idx] = { ...stats[idx], [field]: val };
    setSettingsEdit({ ...settingsEdit, heroStats: stats });
  };

  const updateRule = (idx: number, field: 'title' | 'body', val: string) => {
    const rules = [...(settingsEdit.rules || [])];
    while (rules.length <= idx) rules.push({ title: '', body: '' });
    rules[idx] = { ...rules[idx], [field]: val };
    setSettingsEdit({ ...settingsEdit, rules });
  };

  const addRule = () => {
    const rules = [...(settingsEdit.rules || []), { title: '', body: '' }];
    setSettingsEdit({ ...settingsEdit, rules });
  };

  const removeRule = (idx: number) => {
    const rules = [...(settingsEdit.rules || [])];
    rules.splice(idx, 1);
    setSettingsEdit({ ...settingsEdit, rules });
  };

  const handlePondMapUpload = async (file: File) => {
    setPondMapUploading(true);
    try {
      const url = await uploadImageToCloudinary(file, 'fishing-pond-maps');
      setSettingsEdit(s => ({ ...s, pondMapImg: url }));
      await updateSettingsFirestore({ pondMapImg: url });
      await reloadDB();
    } catch (err) {
      console.error('Failed to upload pond map image:', err);
    }
    setPondMapUploading(false);
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

  /**
   * Resolve a scanned booking id into the full ScannedBookingFull (with seat
   * list) for the modal to handle. Scoped to the currently-selected Results
   * competition so staff can't accidentally score a booking for a different
   * event.
   */
  const toScannedBookingFull = (bookingId: string): ScannedBookingFull | null => {
    const booking = bookings.find((b) => b.id === bookingId || b.bookingRef === bookingId);
    if (!booking) return null;
    const compId = booking.competitionId || '';
    if (resultsCompId && compId && compId !== resultsCompId) return null;
    if (!booking.seats.length) return null;
    const pond = ponds.find((p) => p.id === booking.pondId);
    return {
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      userId: booking.userId,
      anglerName: booking.userName,
      pondId: booking.pondId,
      pondName: pond?.name || booking.pondName,
      seats: [...booking.seats].sort((a, b) => a - b),
      competitionId: booking.competitionId,
      competitionName: booking.competitionName,
    };
  };

  const lookupBookingFullForScan = (bookingId: string) => toScannedBookingFull(bookingId);

  /**
   * Power the manual booking picker: return every booking the staff is allowed
   * to weigh for. Scoped to the currently-selected Results competition.
   */
  const listBookingsForScan = (): ScannedBookingFull[] => {
    return bookings
      .filter((b) => {
        if (!b.seats.length) return false;
        // Exclude rejected bookings — they can't legitimately compete.
        if (b.status === 'rejected') return false;
        const compId = b.competitionId || '';
        if (resultsCompId && compId && compId !== resultsCompId) return false;
        return true;
      })
      .map((b): ScannedBookingFull => {
        const pond = ponds.find((p) => p.id === b.pondId);
        return {
          bookingId: b.id,
          bookingRef: b.bookingRef,
          userId: b.userId,
          anglerName: b.userName,
          pondId: b.pondId,
          pondName: pond?.name || b.pondName,
          seats: [...b.seats].sort((x, y) => x - y),
          competitionId: b.competitionId,
          competitionName: b.competitionName,
        };
      })
      .sort((a, b) => a.anglerName.localeCompare(b.anglerName));
  };

  /**
   * Called when ScaleScanModal has finished both QR + weight scans.
   * Auto-saves directly — no manual form. Staff cannot edit any field at this
   * point, the only escape is "Ambil Semula" inside the modal.
   */
  const handleScanApprove = async (scan: ScaleScanApproved) => {
    setScanOpen(false);
    setSaving(true);
    try {
      const photoUrl = await uploadImageToCloudinary(
        new File([scan.photoBlob], scan.photoFileName, { type: scan.photoBlob.type || 'image/jpeg' }),
        'fishing-pond-weights',
      );
      const sb = scan.scannedBooking;
      await saveScoreEntry({
        competitionId: sb.competitionId || resultsCompId,
        bookingId: sb.bookingId,
        anglerName: sb.anglerName,
        pondId: sb.pondId,
        pondName: sb.pondName,
        seatNum: sb.seatNum,
        weight: scan.weight,
        photoUrl,
        ocrConfidence: scan.ocrConfidence,
        ocrRawText: scan.ocrRawText,
        ocrUserVerified: !scan.userEdited,
        capturedBy: user?.uid || user?.email || 'unknown',
      });
      setScoreEntries(await getScoresForCompetition(resultsCompId));
    } catch (err) {
      console.error('Failed to save scanned weight:', err);
    }
    setSaving(false);
  };

  const handleManualSave = async () => {
    if (!manualEntry.anglerName || !pendingScan) return;
    setSaving(true);
    try {
      const pond = ponds.find(p => (p._docId || p.id.toString()) === manualEntry.pondId);
      const photoUrl = await uploadImageToCloudinary(
        new File([pendingScan.photoBlob], pendingScan.photoFileName, { type: pendingScan.photoBlob.type || 'image/jpeg' }),
        'fishing-pond-weights',
      );
      await saveScoreEntry({
        competitionId: resultsCompId,
        anglerName: manualEntry.anglerName,
        pondId: pond?.id || 0,
        pondName: pond?.name || '',
        seatNum: parseInt(manualEntry.seatNum) || 0,
        weight: pendingScan.weight,
        photoUrl,
        ocrConfidence: pendingScan.ocrConfidence,
        ocrRawText: pendingScan.ocrRawText,
        ocrUserVerified: !pendingScan.userEdited,
        capturedBy: user?.uid || user?.email || 'unknown',
      });
      setScoreEntries(await getScoresForCompetition(resultsCompId));
      setManualEntry({ anglerName: '', pondId: '', seatNum: '', weight: '' });
      setPendingScan(null);
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

  const hasConflict = (b: { pondId: number; seats: number[] }) =>
    (b.seats ?? []).some((n) => (seatConflictMap.get(`${b.pondId}-${n}`) ?? []).length > 1);
  const totalRevenue = bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + b.amount, 0);
  const competitionsForCms = compList.length ? compList : (comp.name ? [comp] : []);
  const competitionForDashboard =
    competitionsForCms.find((c) => getCompetitionPhase(c) === 'live') ||
    competitionsForCms.find((c) => getCompetitionPhase(c) === 'upcoming') ||
    competitionsForCms[0] ||
    null;
  const dashboardStatus = competitionForDashboard ? getCompetitionStatusMeta(competitionForDashboard) : null;

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
      { id: 'landing-content' as CMSPage, icon: '🏡', text: 'Laman Utama' },
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
                    {competitionForDashboard?.name ? (
                      <div style={{ padding: '1rem', background: 'var(--cream)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                          {getCompetitionPhase(competitionForDashboard) === 'live' && <span className="live-dot"></span>}
                          <strong>{competitionForDashboard.name}</strong>
                          {dashboardStatus && <span className={`badge ${dashboardStatus.badgeClass}`}>{dashboardStatus.label}</span>}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          📅 {new Date(competitionForDashboard.startDate).toLocaleDateString('ms-MY')}<br />
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
                    {competitionsForCms.map((competition) => (
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
                        <td>{(() => {
                          const status = getCompetitionStatusMeta(competition);
                          return <span className={`badge ${status.badgeClass}`}>{status.label}</span>;
                        })()}</td>
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

              {/* Pond arrangement overview image */}
              <div className="card" style={{ marginTop: '24px' }}>
                <div className="card-header">
                  <div className="card-title">Gambar Susunan Kolam</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Dipaparkan kepada pengguna semasa membuat tempahan</div>
                </div>
                <div className="card-body">
                  {settingsEdit.pondMapImg ? (
                    <div style={{ marginBottom: '16px' }}>
                      <img
                        src={settingsEdit.pondMapImg}
                        alt="Susunan kolam"
                        style={{ width: '100%', maxHeight: '320px', objectFit: 'contain', borderRadius: '8px', background: 'rgba(0,0,0,0.3)' }}
                      />
                    </div>
                  ) : (
                    <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.12)', marginBottom: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      🖼 Tiada gambar dimuat naik lagi
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <label
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        padding: '8px 16px', borderRadius: '8px', cursor: pondMapUploading ? 'not-allowed' : 'pointer',
                        background: 'var(--green)', color: '#fff', fontSize: '0.85rem', fontWeight: 600,
                        opacity: pondMapUploading ? 0.65 : 1,
                      }}
                    >
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        disabled={pondMapUploading}
                        onChange={e => { const f = e.target.files?.[0]; if (f) handlePondMapUpload(f); e.target.value = ''; }}
                      />
                      {pondMapUploading ? 'Memuat naik...' : (settingsEdit.pondMapImg ? '🔄 Tukar Gambar' : '⬆ Muat Naik Gambar')}
                    </label>
                    {settingsEdit.pondMapImg && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={async () => {
                          setSettingsEdit(s => ({ ...s, pondMapImg: '' }));
                          await updateSettingsFirestore({ pondMapImg: '' });
                          await reloadDB();
                        }}
                      >
                        Padam Gambar
                      </button>
                    )}
                  </div>
                </div>
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
          {page === 'approvals' && (() => {
            const reviewBookings = bookings.filter(b => b.status !== 'rejected' && (b.status === 'pending' || pendingReceiptIndexes(b).length > 0));
            return (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Kelulusan Tempahan</div><div className="page-sub">{reviewBookings.length} tempahan menunggu semakan resit</div></div></div>
              <div className="card"><div className="card-body"><div className="table-wrap"><table>
                <thead><tr><th>Ref</th><th>Pertandingan</th><th>Nama</th><th>Kolam</th><th>Pegs</th><th>Dibayar / Jumlah</th><th>Bayaran</th><th>Resit &amp; Tindakan</th><th></th></tr></thead>
                <tbody>
                  {reviewBookings.map(b => {
                    const receipts = b.receipts && b.receipts.length
                      ? b.receipts
                      : (b.receiptData ? [{ url: b.receiptData, amount: b.amount, status: 'pending' as const, submittedAt: b.createdAt || '' }] : []);
                    const total = b.totalAmount ?? b.amount;
                    const paid = b.paidAmount ?? 0;
                    const balance = b.balanceDue ?? Math.max(0, total - paid);
                    return (
                    <tr key={b.id}>
                      <td className="td-ref">{b.id.slice(0, 10)}</td>
                      <td>{b.competitionName || comp.name || '-'}</td>
                      <td className="td-name">
                        {b.userName}
                        {b.createdByStaff && <span style={{ marginLeft: 5, fontSize: '0.68rem', background: 'rgba(250,204,21,0.18)', color: 'var(--gold)', border: '1px solid rgba(250,204,21,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: '0.5px' }}>ADMIN</span>}
                      </td>
                      <td>{b.pondName}</td>
                      <td>{b.seats.join(', ')}{hasConflict(b) && <span title="Tempat ini juga dituntut oleh tempahan lain" style={{ marginLeft: 4, color: '#f59e0b', fontSize: '0.8rem', cursor: 'help' }}>⚠</span>}</td>
                      <td>
                        RM {paid} / {total}
                        {balance > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--red)', fontWeight: 700 }}>Baki RM {balance}</div>}
                      </td>
                      <td><span className={`badge ${b.paymentType === 'deposit' ? 'badge-deposit' : 'badge-paid'}`}>{b.paymentType === 'deposit' ? 'Deposit' : 'Penuh'}</span></td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 220 }}>
                          {receipts.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Tiada resit</span>}
                          {receipts.map((r, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.78rem', minWidth: 78 }}>#{i + 1} RM {r.amount}</span>
                              {r.url && <button className="btn btn-sm btn-ghost" onClick={() => handleViewReceipt(r.url)}>Lihat</button>}
                              {r.status === 'pending'
                                ? (<>
                                    <button className="btn btn-sm btn-green" disabled={saving} title="Sahkan resit" onClick={() => askAcceptReceipt(b.id, i)}>✓</button>
                                    <button className="btn btn-sm btn-red" disabled={saving} title="Tolak resit" onClick={() => askRejectReceipt(b.id, i)}>✕</button>
                                  </>)
                                : (<span className={`badge badge-${r.status === 'accepted' ? 'approved' : 'rejected'}`} style={{ fontSize: '0.66rem' }}>{r.status === 'accepted' ? 'Disahkan' : 'Ditolak'}</span>)}
                            </div>
                          ))}
                          {(() => {
                            const info = balanceReminderInfo(b, nowTick);
                            if (!info.awaitingBalance) return null;
                            const overdue = info.msUntilRemind <= 0;
                            return (
                              <div style={{ marginTop: 4, padding: '6px 8px', background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  ⏳ Deposit dihantar {info.daysSinceDeposit} hari lalu
                                </span>
                                <span style={{ fontSize: '0.7rem', color: overdue ? 'var(--red)' : 'var(--text-muted)', fontWeight: overdue ? 700 : 400 }}>
                                  📧 Auto-peringat {overdue ? 'tertunggak' : `dalam ${reminderLabel(info)}`}
                                </span>
                                <button className="btn btn-sm btn-ghost" disabled={saving} title="Hantar peringatan baki sekarang" style={{ alignSelf: 'flex-start' }} onClick={() => askSendReminder(b.id)}>Hantar Peringatan</button>
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                      <td><button className="btn btn-sm btn-red" disabled={saving} title="Tolak keseluruhan tempahan" onClick={() => askRejectBooking(b.id)}>Tolak Tempahan</button></td>
                    </tr>
                    );
                  })}
                  {reviewBookings.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada tempahan menunggu</td></tr>}
                </tbody>
              </table></div></div></div>
            </div>
            );
          })()}
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
                        <td>{b.seats.join(', ')}{hasConflict(b) && <span title="Tempat ini juga dituntut oleh tempahan lain" style={{ marginLeft: 4, color: '#f59e0b', fontSize: '0.8rem', cursor: 'help' }}>⚠</span>}</td>
                        <td>
                          RM {b.paidAmount ?? b.amount}{(b.totalAmount ?? b.amount) !== (b.paidAmount ?? b.amount) && <span style={{ color: 'var(--text-muted)' }}> / {b.totalAmount ?? b.amount}</span>}
                          {(b.balanceDue ?? 0) > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--red)', fontWeight: 700 }}>Baki RM {b.balanceDue}</div>}
                        </td>
                        <td><span className={`badge badge-${b.status === 'confirmed' ? 'approved' : b.status}`}>{b.status}</span></td>
                        <td style={{ fontSize: '0.82rem' }}>{b.createdAt ? new Date(b.createdAt).toLocaleDateString('ms-MY') : '-'}</td>
                        <td><div style={{ display: 'flex', gap: '6px' }}>
                          {b.receiptData && <button className="btn btn-sm btn-ghost" onClick={() => handleViewReceipt(b.receiptData)}>Resit</button>}
                          {pendingReceiptIndexes(b).length > 0 && (<button className="btn btn-sm btn-green" disabled={saving} title="Sahkan resit menunggu" onClick={() => askAcceptReceipt(b.id, pendingReceiptIndexes(b)[0])}>✓</button>)}
                          {b.status === 'pending' && (<button className="btn btn-sm btn-red" disabled={saving} onClick={() => askRejectBooking(b.id)}>✕</button>)}
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
                      <button className="btn btn-green w-full mt-3" disabled={checkinLoading} onClick={() => setConfirmDialog({
                        title: 'Check-In Peserta',
                        message: `Sahkan check-in untuk ${checkinResult.userName} (${checkinResult.pondName}, peg ${checkinResult.seats.join(', ')})?`,
                        confirmLabel: 'Check-In',
                        tone: 'primary',
                        onConfirm: handlePerformCheckin,
                      })}>
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
                        {pendingScan ? (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 12px', border: '1px solid var(--border)',
                            borderRadius: 6, background: 'var(--gold-pale, #fefbe8)',
                          }}>
                            <span style={{ fontSize: 22, fontWeight: 700 }}>
                              {pendingScan.weight.toFixed(2)} kg
                            </span>
                            <span style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 999,
                              background: pendingScan.ocrConfidence >= 80 ? '#10b981' : '#f59e0b',
                              color: '#fff', fontWeight: 600,
                            }}>
                              {pendingScan.ocrConfidence}/100
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{ marginLeft: 'auto' }}
                              onClick={() => { setPendingScan(null); setScanOpen(true); }}
                            >🔄 Imbas Semula</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ width: '100%' }}
                            onClick={() => setScanOpen(true)}
                          >📷 Imbas Timbangan</button>
                        )}
                      </div>
                        </div>
                      );
                    })()}
                    <div className="form-actions" style={{ marginTop: '12px' }}>
                      <button
                        className="btn btn-primary"
                        disabled={saving || !manualEntry.anglerName || !pendingScan}
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
          {page === 'landing-content' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Laman Utama</div><div className="page-sub">Edit teks hero, statistik, syarat pertandingan, dan pautan peta</div></div></div>

              <div className="card">
                <div className="card-header"><div className="card-title">Hero</div></div>
                <div className="card-body">
                  <div className="form-grid">
                    <div className="form-group"><label className="form-label">Kicker</label><input className="form-input" value={settingsEdit.heroKicker || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, heroKicker: e.target.value })} placeholder="Tempat Di Mana" /></div>
                    <div className="form-group"><label className="form-label">Tajuk Hero</label><input className="form-input" value={settingsEdit.heroTitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, heroTitle: e.target.value })} placeholder="Juara Dilahirkan" /></div>
                    <div className="form-group form-span"><label className="form-label">Subtitle</label><input className="form-input" value={settingsEdit.heroSubtitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, heroSubtitle: e.target.value })} placeholder="Kolam Keli Sayang - Port Terbaik di Kedah" /></div>
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Statistik Hero (3 item)</div></div>
                <div className="card-body">
                  {[0, 1, 2].map((i) => {
                    const stat = settingsEdit.heroStats?.[i] || { label: '', value: '' };
                    return (
                      <div key={i} className="form-grid" style={{ marginBottom: '10px' }}>
                        <div className="form-group"><label className="form-label">Nilai #{i + 1}</label><input className="form-input" value={stat.value} onChange={(e) => updateHeroStat(i, 'value', e.target.value)} placeholder={i === 0 ? '12' : i === 1 ? '480' : 'Weekly Strike'} /></div>
                        <div className="form-group"><label className="form-label">Label #{i + 1}</label><input className="form-input" value={stat.label} onChange={(e) => updateHeroStat(i, 'label', e.target.value)} placeholder={i === 0 ? 'Lubuk Mega' : i === 1 ? 'Peserta / Kocah' : 'Pertandingan'} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Penerangan Ringkas (Intro)</div></div>
                <div className="card-body">
                  <div className="form-group form-span"><textarea className="form-textarea" rows={4} value={settingsEdit.introCopy || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, introCopy: e.target.value })} placeholder="Kolam Keli Sayang dibuka untuk pertandingan sahaja..." /></div>
                </div>
              </div>

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header">
                  <div className="card-title">Syarat &amp; Peraturan</div>
                  <button className="btn btn-sm" onClick={addRule}>+ Tambah Syarat</button>
                </div>
                <div className="card-body">
                  {(settingsEdit.rules || []).map((rule, i) => (
                    <div key={i} className="form-grid" style={{ marginBottom: '12px', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
                      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ minWidth: '24px' }}>{String(i + 1).padStart(2, '0')}.</strong>
                        <input className="form-input" value={rule.title} onChange={(e) => updateRule(i, 'title', e.target.value)} placeholder="Tajuk syarat" style={{ flex: 1 }} />
                        <button className="btn btn-sm" style={{ color: '#ef4444' }} onClick={() => removeRule(i)} aria-label="Padam syarat">🗑</button>
                      </div>
                      <div className="form-group form-span"><textarea className="form-textarea" rows={2} value={rule.body} onChange={(e) => updateRule(i, 'body', e.target.value)} placeholder="Penerangan syarat" /></div>
                    </div>
                  ))}
                  {(!settingsEdit.rules || settingsEdit.rules.length === 0) && (
                    <div style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Tiada syarat. Klik "Tambah Syarat" untuk mula.</div>
                  )}
                </div>
              </div>

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Lokasi &amp; Peta</div></div>
                <div className="card-body">
                  <div className="form-grid">
                    <div className="form-group form-span"><label className="form-label">Embed URL Peta Google</label><input className="form-input" value={settingsEdit.mapEmbedUrl || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, mapEmbedUrl: e.target.value })} placeholder="https://www.google.com/maps?q=...&output=embed" /></div>
                    <div className="form-group"><label className="form-label">Waze URL</label><input className="form-input" value={settingsEdit.wazeUrl || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, wazeUrl: e.target.value })} placeholder="https://waze.com/ul?ll=..." /></div>
                    <div className="form-group"><label className="form-label">Google Maps URL</label><input className="form-input" value={settingsEdit.googleMapsUrl || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, googleMapsUrl: e.target.value })} placeholder="https://maps.google.com/?q=..." /></div>
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Imbas Timbangan (OCR)</div></div>
                <div className="card-body">
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={settingsEdit.ocrUsePreprocess !== false}
                      onChange={handleOcrPreprocessToggle}
                      style={{ marginTop: '4px', width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>Guna pra-pemprosesan imej OCR</div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.5 }}>
                        Lebih konsisten untuk lampu kurang terang dan paparan LCD berkilau.
                        Tutup untuk imej terus dari kamera (lebih pantas, sesuai jika paparan timbangan sudah jelas).
                      </div>
                    </div>
                  </label>

                  <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--line, #e8edf2)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>Posisi titik perpuluhan</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: 1.5 }}>
                      Model OCR sering terlepas titik perpuluhan pada paparan timbangan.
                      Tetapkan berapa digit selepas titik perpuluhan untuk paksa kedudukannya.
                      Contoh: jika ditetapkan "2 digit" dan OCR baca <code>12345</code>, berat = <strong>123.45 kg</strong>.
                    </div>
                    <select
                      className="form-input"
                      value={settingsEdit.ocrDecimalPlaces === undefined ? 'auto' : String(settingsEdit.ocrDecimalPlaces)}
                      onChange={(e) => handleOcrDecimalChange(e.target.value)}
                      style={{ maxWidth: '320px' }}
                    >
                      <option value="auto">Auto — kesan dari imej (lalai)</option>
                      <option value="0">Tiada perpuluhan — berat sebagai integer</option>
                      <option value="1">1 digit selepas titik — cth. 1234 → 123.4 kg</option>
                      <option value="2">2 digit selepas titik — cth. 12345 → 123.45 kg</option>
                      <option value="3">3 digit selepas titik — cth. 12345 → 12.345 kg</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: '14px' }}>
                <button className="btn btn-primary" disabled={saving} onClick={handleLandingContentSave}>{saving ? 'Menyimpan...' : 'Simpan Laman Utama'}</button>
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
                  <div className="form-group">
                    <label className="form-label">Jumlah Kedudukan Dipaparkan</label>
                    <input className="form-input" type="number" value={compEdit.topN || 20} onChange={(e) => setCompEdit({ ...compEdit, topN: parseInt(e.target.value) || 20 })} />
                    <div style={{ marginTop: '4px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Berapa ramai peserta teratas yang dipaparkan di papan markah.
                    </div>
                  </div>
                </div>

                <div className="card" style={{ marginTop: '12px' }}>
                  <div className="card-header"><div className="card-title">Active Ponds For This Competition</div></div>
                  <div className="card-body">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {ponds.map((pond) => {
                        const pondKey  = pond._docId || pond.id.toString();
                        const checked  = (compEdit.activePondIds || []).includes(pondKey);
                        const edits    = pondSeatEdits[pondKey] || {};
                        const hasUnsavedEdits = Object.keys(edits).length > 0;
                        // Effective active state per seat = unsaved edit if present, else saved flag.
                        const isSeatActive = (s: { num: number; active?: boolean }) =>
                          edits[s.num] !== undefined ? edits[s.num] : s.active !== false;
                        // Seats held by a non-rejected booking can't be deactivated.
                        const heldSeats = pond.seats
                          .filter(s => (seatConflictMap.get(`${pond.id}-${s.num}`)?.length ?? 0) > 0)
                          .map(s => s.num);
                        const heldSet = new Set(heldSeats);
                        const activeCount = pond.seats.filter(isSeatActive).length;
                        const inactiveCount = pond.seats.length - activeCount;
                        // "Seat available" (bookable count) is capped at the active-seat count.
                        const openSeats = Math.max(0, Math.min(activeCount, Math.floor(compEdit.pondSeats?.[pondKey] ?? activeCount)));
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
                                  max={activeCount}
                                  disabled={!checked}
                                  style={{ width: '80px', padding: '5px 8px' }}
                                  value={openSeats}
                                  onChange={(e) => {
                                    const raw  = parseInt(e.target.value) || 0;
                                    const safe = Math.max(0, Math.min(activeCount, raw));
                                    setCompEdit({ ...compEdit, pondSeats: { ...(compEdit.pondSeats || {}), [pondKey]: safe } });
                                  }}
                                />
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/ {activeCount} aktif</span>
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
                                  seatEdits={edits}
                                  useLegacyView={!!settingsEdit.useLegacyPondView}
                                  onToggle={(num, active) => {
                                    // Prevent deactivating a seat that is booked / pending approval.
                                    if (!active && heldSet.has(num)) return;
                                    setPondSeatEdits(prev => {
                                      const nextSeat = { ...(prev[pondKey] || {}), [num]: active };
                                      const nextEdits = { ...prev, [pondKey]: nextSeat };
                                      // Keep the bookable "Seat available" count from exceeding active seats.
                                      const nextActive = pond.seats.filter(s =>
                                        nextSeat[s.num] !== undefined ? nextSeat[s.num] : s.active !== false
                                      ).length;
                                      const cur = compEdit.pondSeats?.[pondKey];
                                      if (typeof cur === 'number' && cur > nextActive) {
                                        setCompEdit(ce => ({ ...ce, pondSeats: { ...(ce.pondSeats || {}), [pondKey]: nextActive } }));
                                      }
                                      return nextEdits;
                                    });
                                  }}
                                />
                                <div className="sag-hint" style={{ marginTop: '5px' }}>
                                  {activeCount} aktif · {inactiveCount} tidak aktif{hasUnsavedEdits ? ' (belum disimpan)' : ''}
                                </div>
                                {heldSeats.length > 0 && (
                                  <div style={{ marginTop: '4px', fontSize: '0.72rem', color: 'var(--red)' }}>
                                    🔒 Peg telah ditempah (tidak boleh dinyahaktifkan) / Booked pegs (cannot be deactivated): {heldSeats.sort((a, b) => a - b).map(n => `#${n}`).join(', ')}
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
      <ScaleScanModal
        isOpen={scanOpen}
        onClose={() => setScanOpen(false)}
        onApprove={handleScanApprove}
        usePreprocess={settingsEdit.ocrUsePreprocess ?? true}
        decimalPlaces={settingsEdit.ocrDecimalPlaces}
        lookupBookingFull={lookupBookingFullForScan}
        listBookings={listBookingsForScan}
      />

      {/* In-page receipt lightbox (replaces opening a new browser tab) */}
      {receiptViewerUrl && (
        <div className="modal-overlay open" style={{ zIndex: 600 }} onClick={() => setReceiptViewerUrl(null)}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setReceiptViewerUrl(null)}
              style={{ position: 'absolute', top: -36, right: 0, color: '#fff', fontSize: '1.8rem' }}
              aria-label="Tutup"
            >×</button>
            <img
              src={receiptViewerUrl}
              alt="Resit"
              onLoad={(e) => setReceiptViewerMeta(m => ({ ...m, width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }))}
              style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, display: 'block', background: '#000' }}
            />
            <div style={{ marginTop: 8, textAlign: 'center', color: '#fff', fontSize: '0.78rem', display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              {receiptViewerMeta.width > 0 && (
                <span>📐 {receiptViewerMeta.width} × {receiptViewerMeta.height} px</span>
              )}
              {receiptViewerMeta.bytes != null && (
                <span>💾 {formatBytes(receiptViewerMeta.bytes)}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reusable confirmation dialog for decision actions */}
      {confirmDialog && (
        <div className="modal-overlay open" style={{ zIndex: 650 }} onClick={() => setConfirmDialog(null)}>
          <div className="modal" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{confirmDialog.title}</div>
              <button className="modal-close" onClick={() => setConfirmDialog(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-muted)', marginBottom: '16px', whiteSpace: 'pre-line' }}>
                {confirmDialog.message}
              </p>
              <div className="form-actions">
                <button className="btn btn-ghost" disabled={saving} onClick={() => setConfirmDialog(null)}>Batal</button>
                <button
                  className={`btn ${confirmDialog.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                  disabled={saving}
                  onClick={async () => {
                    const action = confirmDialog.onConfirm;
                    setConfirmDialog(null);
                    await action();
                  }}
                >
                  {confirmDialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CMSModal;