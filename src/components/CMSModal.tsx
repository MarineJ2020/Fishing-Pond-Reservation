import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useSearchParams } from 'react-router-dom';
import { User, Pond, Competition, Prize, Settings, ScoreEntry, Booking, AuditEntry, LandingSectionKey } from '../types';
import { gs } from '../data';
import PondEditor from './PondEditor';
import { checkInBooking, cancelBookingCheckIn, acceptBookingReceipt, rejectBookingReceipt } from '../lib/api';
import {
  createPond as createPondFirestore,
  deletePond as deletePondFirestore,
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
  approveDepositWithProofDirect,
  getUsersPage,
  logAuditEvent,
  getAuditLog,
  getScoreEntriesPage,
  getBookingsPage,
  addStaffRemark,
  deriveBalanceStage,
} from '../lib/firestore';
import { compressBlobToWebp, compressBlobToJpeg, uploadImageToFirebaseStorage } from '../utils/imageStorage';
import { normalizePdfUrl, uploadPdfToFirebaseStorage } from '../utils/pdfStorage';
import { asset, LANDING_ASSETS } from '../config/landingAssets';
import { LANDING_SECTION_KEYS, LANDING_SECTION_LABELS } from '../config/landingSections';
import { sanitizeLandingHtml } from '../utils/landingHtml';
import { SeoSnippetPreview, SocialCardPreview } from './SeoPreview';
import { requestBalanceReminderEmail } from '../lib/email';
import {
  balanceReminderInfo,
  bookingSeatCheckInTime,
  bookingSeatEntries,
  BookingSeatEntry,
  isBookingSeatCheckedIn,
  receiptBankReference,
} from '../utils/booking';
import { getCompetitionPhase, isCompetitionEnded, isBookingOpen, getCompetitionCmsStatus, getCompetitionCmsStatusMeta, sortCompetitionsLatestFirst } from '../utils/competition';
import { formatWeight } from '../utils/weight';
import { formatSeat, formatSeatList, pondDisplayName } from '../utils/seatLabel';
import { parseQrPayload, buildSeatQrValue, decodeQr, openQrCameraStream } from '../utils/qr';
import { prizeRange, formatDate } from '../utils';
import ScaleScanModal, { ScaleScanApproved, ScannedBookingFull } from './cms/ScaleScanModal';
import DocPreviewModal from './DocPreviewModal';
import ReceiptReviewModal from './cms/ReceiptReviewModal';
import AdminInstructions from './cms/AdminInstructions';
import { updateUserRole, UserRole } from '../lib/users';

// ── Pond alphabet-code helpers (single letter A–Z, unique across ponds) ──
const POND_CODE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
function nextFreePondCode(ponds: Pond[], excludeDocId?: string): string {
  const used = new Set(
    ponds
      .filter((p) => (p._docId || '') !== (excludeDocId || ''))
      .map((p) => (p.code || '').trim().toUpperCase())
      .filter(Boolean),
  );
  return POND_CODE_LETTERS.find((l) => !used.has(l)) || '';
}
function pondCodeError(code: string | undefined, ponds: Pond[], excludeDocId?: string): string | null {
  const c = (code || '').trim().toUpperCase();
  if (!c) return null; // blank is allowed; saved ponds auto-assign the next free letter
  if (!/^[A-Z]$/.test(c)) return 'Kod kolam mesti satu huruf A–Z.';
  if (ponds.some((p) => (p._docId || '') !== (excludeDocId || '') && (p.code || '').trim().toUpperCase() === c))
    return `Kod "${c}" telah digunakan oleh kolam lain.`;
  return null;
}

type CMSPage = 'dashboard' | 'instructions' | 'competitions' | 'ponds' | 'prizes' | 'approvals' | 'manual-booking' | 'all-bookings' | 'checkin' | 'results' | 'all-weigh-ins' | 'contact-settings' | 'landing-content' | 'seo' | 'users' | 'audit-log';

const CMS_PAGES: CMSPage[] = ['dashboard', 'instructions', 'competitions', 'ponds', 'prizes', 'approvals', 'all-bookings', 'manual-booking', 'checkin', 'results', 'all-weigh-ins', 'contact-settings', 'landing-content', 'seo', 'users', 'audit-log'];
const STAFF_CMS_PAGES: CMSPage[] = ['checkin', 'results', 'all-weigh-ins', 'users'];

const resultsCompetitionOptions = (competitions: Competition[]): Competition[] =>
  competitions
    .map((competition, index) => ({ competition, index, phase: getCompetitionPhase(competition) }))
    .filter(({ phase }) => phase === 'live' || phase === 'ended')
    .sort((a, b) => {
      const priority = (phase: 'live' | 'upcoming' | 'ended') => (phase === 'live' ? 0 : 1);
      const phaseOrder = priority(a.phase) - priority(b.phase);
      return phaseOrder || a.index - b.index;
    })
    .map(({ competition }) => competition);

// Blank state for the inline "Tambah Pertandingan" form. Date fields are raw
// datetime-local input strings, converted to ISO merged into a Competition on save.
const EMPTY_COMP_CREATE = {
  name: '',
  startDateTime: '',
  endDateTime: '',
  bookingOpenAt: '',
  bookingCloseAt: '',
  activePondIds: [] as string[],
  pricePerPeg: 100 as number,
  topN: 20 as number,
  status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
};

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

const CMSModal: React.FC<CMSModalProps> = ({ isOpen, onClose, onGoToBooking, user, ponds, comp, competitions = [], settings, bookings, onUpdateData, reloadDB }) => {
  const isAdmin = user?.role === 'ADMIN';
  const isStaff = isAdmin || user?.role === 'STAFF';
  // Active CMS tab is mirrored in the URL (?tab=) so a page refresh stays on the
  // same tab instead of resetting to the dashboard.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as CMSPage | null;
  const requestedPage: CMSPage = tabParam && CMS_PAGES.includes(tabParam) ? tabParam : 'dashboard';
  const page: CMSPage = isAdmin || !isStaff || STAFF_CMS_PAGES.includes(requestedPage) ? requestedPage : 'checkin';
  const setPage = (next: CMSPage) => {
    const allowedPage = isAdmin || !isStaff || STAFF_CMS_PAGES.includes(next) ? next : 'checkin';
    const params = new URLSearchParams(searchParams);
    if (allowedPage === 'dashboard') params.delete('tab');
    else params.set('tab', allowedPage);
    setSearchParams(params);
  };
  useEffect(() => {
    if (isOpen && user?.role === 'STAFF' && requestedPage !== page) setPage(page);
    // setPage intentionally depends on the current URLSearchParams snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user?.role, requestedPage, page]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingPond, setEditingPond] = useState<Pond | null>(null);
  // Inline "Tambah Pertandingan" quick-create form (raw input strings; combined on save).
  const [compCreate, setCompCreate] = useState({ ...EMPTY_COMP_CREATE });
  const [compEdit, setCompEdit] = useState<Competition>(comp);
  const [compList, setCompList] = useState<Competition[]>(competitions.length ? competitions : (comp.name ? [comp] : []));
  const [competitionEditorOpen, setCompetitionEditorOpen] = useState(false);
  // True while the Manage editor is creating a brand-new competition (not yet persisted).
  const [compEditIsNew, setCompEditIsNew] = useState(false);
  const [competitionDeleteTarget, setCompetitionDeleteTarget] = useState<Competition | null>(null);
  const [settingsEdit, setSettingsEdit] = useState(settings);
  const [ocrDecimalSaving, setOcrDecimalSaving] = useState(false);
  const [ocrDecimalError, setOcrDecimalError] = useState<string | null>(null);
  const [landingSaveError, setLandingSaveError] = useState<string | null>(null);
  const previousSettings = useRef(settings);
  // Live decimal updates must not discard unrelated unsaved CMS form edits.
  useEffect(() => {
    const previous = previousSettings.current;
    previousSettings.current = settings;
    const changed = (Object.keys(settings) as (keyof Settings)[])
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(settings[key]));
    if (changed.length) setSettingsEdit((current) => ({
      ...current,
      ...Object.fromEntries(changed.map((key) => [key, settings[key]])),
    }));
  }, [settings]);
  const [newPond, setNewPond] = useState<Partial<Pond>>({ name: '', desc: '', seats: [], open: true });
  const [newPondSeatPrice, setNewPondSeatPrice] = useState(100);
  const [newPondMaxSeats, setNewPondMaxSeats] = useState(30);
  const [pondSaveError, setPondSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Kelulusan (approvals) — pending-only decision queue.
  const [approvalSearch, setApprovalSearch] = useState('');
  const [approvalCompFilter, setApprovalCompFilter] = useState('');
  const [approvalPayFilter, setApprovalPayFilter] = useState<'' | 'deposit' | 'full'>('');
  const [approvalSortField, setApprovalSortField] = useState<'createdAt' | 'userName' | 'totalAmount'>('createdAt');
  const [approvalsSortOrder, setApprovalsSortOrder] = useState<'desc' | 'asc'>('desc');
  const [kelulusanEntries, setKelulusanEntries] = useState<Booking[]>([]);
  const [kelulusanLoading, setKelulusanLoading] = useState(false);
  const [kelulusanCursors, setKelulusanCursors] = useState<any[]>([null]); // stack of startAfter cursors, index 0 = first page
  const [kelulusanPage, setKelulusanPage] = useState(0);
  const [kelulusanHasMore, setKelulusanHasMore] = useState(false);
  const [kelulusanError, setKelulusanError] = useState<string | null>(null);

  // Semua Tempahan — everything already decided (confirmed/rejected).
  const [bookingSearch, setBookingSearch] = useState('');
  const [allStatus, setAllStatus] = useState<'all' | 'review-balance' | 'pending-balance' | 'fully-paid' | 'cancelled'>('all');
  const [allCompFilter, setAllCompFilter] = useState('');
  const [allPayFilter, setAllPayFilter] = useState<'' | 'deposit' | 'full'>('');
  const [allPondFilter, setAllPondFilter] = useState('');
  const [allSortField, setAllSortField] = useState<'createdAt' | 'userName' | 'totalAmount'>('createdAt');
  const [allSortOrder, setAllSortOrder] = useState<'desc' | 'asc'>('desc');
  const [allEntries, setAllEntries] = useState<Booking[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [allCursors, setAllCursors] = useState<any[]>([null]);
  const [allPage, setAllPage] = useState(0);
  const [allHasMore, setAllHasMore] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);

  // Shared receipt-review popup (Kelulusan's first receipt, Semua Tempahan's balance receipt).
  const [reviewTarget, setReviewTarget] = useState<Booking | null>(null);
  const [receiptHistoryBooking, setReceiptHistoryBooking] = useState<Booking | null>(null);

  // Force-cancel-a-confirmed-booking flow: typed confirmation guard.
  const [forceCancelTarget, setForceCancelTarget] = useState<Booking | null>(null);
  const [forceCancelText, setForceCancelText] = useState('');
  const [checkinResult, setCheckinResult] = useState<any>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinCompetitionId, setCheckinCompetitionId] = useState('');
  // Seat number decoded from a scanned per-seat QR (highlights that row); null
  // for legacy QR/manual search where the seat isn't known ahead of time.
  const [checkinScannedSeat, setCheckinScannedSeat] = useState<number | null>(null);
  const [checkinScannedPondId, setCheckinScannedPondId] = useState<number | null>(null);
  const [checkinActiveSeat, setCheckinActiveSeat] = useState<string | null>(null);
  const [checkinLiveScanOn, setCheckinLiveScanOn] = useState(false);
  const [checkinLiveScanBusy, setCheckinLiveScanBusy] = useState(false);
  // Raw text of a scanned QR that didn't match any booking — shown so staff know
  // the scan registered (and can read what it actually contained).
  const [checkinScannedRaw, setCheckinScannedRaw] = useState<string | null>(null);
  // Gates the rAF scan loop synchronously — reading checkinLiveScanOn from state
  // inside the loop closure would see the pre-update value and stop it dead.
  const checkinLiveActiveRef = useRef(false);
  const checkinLiveVideoRef = useRef<HTMLVideoElement | null>(null);
  const checkinLiveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const checkinLiveStreamRef = useRef<MediaStream | null>(null);
  const checkinLiveRafRef = useRef<number | null>(null);
  // Camera-open timestamp — decode attempts are skipped for a brief warm-up
  // window so a scan can't latch onto the first (still-focusing) frames.
  const checkinLiveStartedAtRef = useRef(0);

  // Audit Log page state
  const [auditLogEntries, setAuditLogEntries] = useState<AuditEntry[]>([]);
  const [auditLogSearch, setAuditLogSearch] = useState('');

  // Weigh-in proof photo viewer — shared by "Papan Markah Semasa" and "Semua Timbangan Rekod"
  const [scorePhotoUrl, setScorePhotoUrl] = useState<string | null>(null);

  // Semua Timbangan Rekod (all-competition weigh-in log) page state — cursor
  // paginated so it stays fast once weigh-ins number in the thousands.
  const [allWeighEntries, setAllWeighEntries] = useState<ScoreEntry[]>([]);
  const [allWeighLoading, setAllWeighLoading] = useState(false);
  const [allWeighError, setAllWeighError] = useState<string | null>(null);
  const [allWeighCursors, setAllWeighCursors] = useState<any[]>([null]);
  const [allWeighPage, setAllWeighPage] = useState(0);
  const [allWeighHasMore, setAllWeighHasMore] = useState(false);
  const [allWeighCompId, setAllWeighCompId] = useState<string>('');
  const [allWeighPond, setAllWeighPond] = useState<string>('');
  const [allWeighAngler, setAllWeighAngler] = useState('');

  // Results / Live page state
  const [resultsCompId, setResultsCompId] = useState<string>(comp.id || '');
  const [scoreEntries, setScoreEntries] = useState<ScoreEntry[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [prizesCompId, setPrizesCompId] = useState<string>(comp.id || '');
  const [prizesEditMode, setPrizesEditMode] = useState(false);
  const [pondMapUploading, setPondMapUploading] = useState(false);
  const [qrImgUploading, setQrImgUploading] = useState(false);
  const [rulesPdfUploading, setRulesPdfUploading] = useState(false);
  const [landingImageUploading, setLandingImageUploading] = useState<Partial<Record<keyof typeof LANDING_ASSETS, boolean>>>({});
  const [ogImageUploading, setOgImageUploading] = useState<string | null>(null);
  // Users page search query (narrows the currently-loaded page only).
  const [userSearch, setUserSearch] = useState('');
  // Registered accounts (admin-managed, staff-readable), cursor-paginated so
  // this stays fast once accounts number in the thousands.
  const [userSortOrder, setUserSortOrder] = useState<'asc' | 'desc'>('asc');
  const [userEntries, setUserEntries] = useState<User[]>([]);
  const [userLoading, setUserLoading] = useState(false);
  const [userCursors, setUserCursors] = useState<any[]>([null]);
  const [userPage, setUserPage] = useState(0);
  const [userHasMore, setUserHasMore] = useState(false);
  const [roleUpdatingUid, setRoleUpdatingUid] = useState<string | null>(null);
  const [roleMessage, setRoleMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const fetchUsersPage = async (cursor: any, pageIndex: number) => {
    setUserLoading(true);
    try {
      const result = await getUsersPage({ sortDir: userSortOrder, pageSize: 50, cursor });
      setUserEntries(result.items);
      setUserHasMore(result.hasMore);
      setUserCursors((prev) => {
        const next = [...prev];
        next[pageIndex + 1] = result.lastDoc;
        return next;
      });
    } catch (err) {
      console.error('Failed to load Pengguna page:', err);
    }
    setUserLoading(false);
  };
  const handleUserSort = () => setUserSortOrder((d) => (d === 'asc' ? 'desc' : 'asc'));
  const handleUserNext = () => {
    if (!userHasMore) return;
    const nextPage = userPage + 1;
    setUserPage(nextPage);
    fetchUsersPage(userCursors[nextPage] ?? null, nextPage);
  };
  const handleUserPrev = () => {
    if (userPage === 0) return;
    const prevPage = userPage - 1;
    setUserPage(prevPage);
    fetchUsersPage(userCursors[prevPage] ?? null, prevPage);
  };
  useEffect(() => {
    if (!isOpen || page !== 'users') return;
    setUserPage(0);
    setUserCursors([null]);
    fetchUsersPage(null, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, page, userSortOrder]);

  // Reorder state for the ponds CMS.
  const [pondReordering, setPondReordering] = useState(false);

  // In-page receipt lightbox (replaces opening a new browser tab).
  const [receiptViewerUrl, setReceiptViewerUrl] = useState<string | null>(null);
  // Dimensions (from <img> onLoad) + byte size (from a HEAD request / data-URL) of
  // the receipt currently shown in the lightbox.
  const [receiptViewerMeta, setReceiptViewerMeta] = useState<{ width: number; height: number; bytes: number | null }>({ width: 0, height: 0, bytes: null });
  // QR viewer for Semua Tempahan: grid of per-seat QR codes for one booking, plus
  // a second, higher-stacked overlay for the single enlarged QR the admin clicked.
  const [qrPreviewBooking, setQrPreviewBooking] = useState<Booking | null>(null);
  const [enlargedQrSeat, setEnlargedQrSeat] = useState<BookingSeatEntry | null>(null);
  const closeQrPreview = () => { setQrPreviewBooking(null); setEnlargedQrSeat(null); };
  // Reusable confirmation dialog for decision actions (accept/reject/check-in/remind).
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    tone: 'danger' | 'primary';
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const requestRoleChange = (target: User, nextRole: UserRole) => {
    if (!isAdmin || !target.uid || target.role === 'ADMIN' || target.uid === user?.uid || target.role === nextRole) return;
    const previousRole = target.role || 'CLIENT';
    setRoleMessage(null);
    setConfirmDialog({
      title: 'Tukar Peranan Pengguna',
      message: `Tukar peranan ${target.name || target.email} daripada ${previousRole} kepada ${nextRole}?`,
      confirmLabel: 'Tukar Peranan',
      tone: nextRole === 'ADMIN' ? 'danger' : 'primary',
      onConfirm: async () => {
        setRoleUpdatingUid(target.uid!);
        try {
          const result = await updateUserRole(target.uid!, nextRole);
          setUserEntries((entries) => entries.map((entry) => entry.uid === result.uid ? { ...entry, role: result.role } : entry));
          setRoleMessage({ tone: 'success', text: `Peranan ${target.name || target.email} berjaya ditukar kepada ${result.role}.` });
        } catch (error) {
          console.error('Failed to update user role:', error);
          const message = error instanceof Error ? error.message : 'Peranan pengguna tidak dapat ditukar.';
          setRoleMessage({ tone: 'error', text: message });
        } finally {
          setRoleUpdatingUid(null);
        }
      },
    });
  };
  // Ticking clock so the balance-reminder countdowns refresh while the page is open.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (isOpen && page === 'checkin') return;
    if (checkinLiveRafRef.current) {
      window.cancelAnimationFrame(checkinLiveRafRef.current);
      checkinLiveRafRef.current = null;
    }
    if (checkinLiveStreamRef.current) {
      checkinLiveStreamRef.current.getTracks().forEach((t) => t.stop());
      checkinLiveStreamRef.current = null;
    }
    const video = checkinLiveVideoRef.current;
    if (video) video.srcObject = null;
    checkinLiveActiveRef.current = false;
    setCheckinLiveScanOn(false);
  }, [isOpen, page]);

  useEffect(() => {
    if (page !== 'results') return;
    const available = competitions.length ? competitions : (comp.id ? [comp] : []);
    const options = resultsCompetitionOptions(available);
    const current = options.find((competition) => competition.id === resultsCompId);
    const fallback = current || options[0];
    setResultsCompId(fallback?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, competitions, comp]);

  useEffect(() => {
    if (page !== 'checkin') return;
    const available = competitions.length ? competitions : (comp.id ? [comp] : []);
    const nearestUpcoming = available
      .filter((competition) => getCompetitionPhase(competition) === 'upcoming')
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())[0];
    const live = available.find((competition) => getCompetitionPhase(competition) === 'live');
    const fallback = live || nearestUpcoming || available[0];
    if (fallback?.id) setCheckinCompetitionId(fallback.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Sync compEdit when switching competition on prizes page
  useEffect(() => {
    if (page !== 'prizes') return;
    const target = compList.find(c => c.id === prizesCompId) || compList[0];
    if (target) {
      setCompEdit({ ...target });
      setPrizesEditMode(false);
    }
  }, [prizesCompId, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hadiah & Ranking hides ended competitions — if the selected one just ended
  // (or isn't set), fall back to the first non-ended competition instead.
  useEffect(() => {
    if (page !== 'prizes') return;
    const current = compList.find(c => c.id === prizesCompId);
    if (current && getCompetitionPhase(current) !== 'ended') return;
    const fallback = compList.find(c => getCompetitionPhase(c) !== 'ended');
    if (fallback?.id) setPrizesCompId(fallback.id);
  }, [page, prizesCompId, compList]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (page !== 'results' || !resultsCompId) return;
    getScoresForCompetition(resultsCompId).then(setScoreEntries);
  }, [page, resultsCompId]);

  useEffect(() => {
    if (page !== 'audit-log') return;
    getAuditLog().then(setAuditLogEntries);
  }, [page]);

  useEffect(() => {
    setCompList(competitions.length ? competitions : (comp.name ? [comp] : []));
    // Only re-seed the working copy when no competition editor is open. reloadDB()
    // hands back fresh comp/competitions references, so resetting unconditionally
    // would re-point compEdit (id included) at the active competition mid-edit —
    // a subsequent Save would then overwrite the wrong competition document.
    if (!competitionEditorOpen) setCompEdit(comp);
  }, [comp, competitions, competitionEditorOpen]);

  // Conflict detection: map "competitionId-pondId-seatNum" → booking IDs that claim it
  // (excluding rejected). Keyed by competition so the same pond+seat reused in a
  // different competition is never flagged as a conflict.
  const seatConflictMap = React.useMemo(() => {
    const map = new Map<string, string[]>();
    bookings.forEach((b) => {
      if (b.status === 'rejected') return;
      const compId = b.competitionId || '';
      const selections = b.pondSelections?.length ? b.pondSelections : [{ pondId: b.pondId, seats: b.seats ?? [] }];
      selections.forEach((selection) => {
        selection.seats.forEach((seatNum) => {
          const key = `${compId}-${selection.pondId}-${seatNum}`;
          map.set(key, [...(map.get(key) ?? []), b.id]);
        });
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
    return getCompetitionCmsStatusMeta(competition, nowTick);
  };

  const openDatePicker = (event: React.MouseEvent<HTMLElement>) => {
    const wrap = event.currentTarget.closest('.date-input-wrap') as HTMLElement | null;
    const input = wrap?.querySelector('input[type="date"], input[type="datetime-local"]') as HTMLInputElement | null;
    if (!input) return;
    input.focus();
    if (typeof (input as any).showPicker === 'function') {
      (input as any).showPicker();
    }
  };

  if (!isOpen) return null;

  const handlePondUpdate = async (pond: Pond) => {
    setPondSaveError(null);

    // 1. Seat count enforcement for polygon view
    // Kolam always uses the legacy pond view now (toggle removed).
    const hasPolygon = false && (pond.shape?.length ?? 0) > 2;
    const seatsWithPos = pond.seats.filter(s => s.px !== undefined && s.py !== undefined);
    const target = pond.maxSeats;
    if (hasPolygon && seatsWithPos.length > 0 && target !== undefined && seatsWithPos.length !== target) {
      setPondSaveError(`Letakkan tepat ${target} pancang pada peta (kini ${seatsWithPos.length}/${target}).`);
      return;
    }

    // 2. Booking conflict check: any seat being removed that has an active booking?
    const newSeatNums = target !== undefined
      ? new Set(Array.from({ length: target }, (_, i) => i + 1))  // legacy: 1..maxSeats
      : new Set(pond.seats.map(s => s.num));
    const conflicts = getConflictingRemovedSeats(pond.id, newSeatNums);
    if (conflicts.length > 0) {
      setPondSaveError(`Tidak dapat simpan — pancang ${conflicts.join(', ')} masih ada tempahan aktif. Alihkan atau batalkan tempahan tersebut dahulu.`);
      return;
    }

    const codeErr = pondCodeError(pond.code, ponds, pond._docId || pond.id.toString());
    if (codeErr) { setPondSaveError(codeErr); return; }

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
        code: (pond.code || '').trim().toUpperCase() || nextFreePondCode(ponds, pondDocId),
        description: pond.desc,
        open: pond.open,
        totalSeats: effectiveMaxSeats,
        pricePerSeat: safePrice,
        shape: pond.shape ?? [],
        seatLayout,
      } as any);
      await syncPondSeatsFirestore(pondDocId, effectiveMaxSeats, safePrice);
      await reloadDB();
      await logAuditEvent({
        action: 'pond.edit', actionLabel: 'Edit Kolam', entityType: 'pond',
        entityId: pondDocId, entityLabel: pond.code ? `${pond.code} — ${pond.name}` : pond.name,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
      setEditingPond(null);
      setPondSaveError(null);
    } catch (err) { console.error('Failed to update pond:', err); }
    setSaving(false);
  };

  const handleCompetitionUpdate = async () => {
    if (!compEdit.name?.trim()) { window.alert('Sila masukkan nama pertandingan.'); return; }
    if (!compEdit.startDate) { window.alert('Sila pilih tarikh & masa mula pertandingan.'); return; }
    if (!compEdit.endDate) { window.alert('Sila pilih tarikh & masa tamat pertandingan.'); return; }
    if (!compEdit.bookingOpenAt) { window.alert('Sila pilih tarikh & masa buka tempahan.'); return; }
    if (!compEdit.bookingCloseAt) { window.alert('Sila pilih tarikh & masa tutup tempahan.'); return; }
    if (!Number.isFinite(compEdit.pricePerPeg) || (compEdit.pricePerPeg ?? 0) <= 0) { window.alert('Sila masukkan Harga Pancang yang sah.'); return; }
    if (!Number.isFinite(compEdit.topN) || (compEdit.topN ?? 0) <= 0) { window.alert('Sila masukkan Jumlah Kedudukan Dipaparkan yang sah.'); return; }
    if (!(compEdit.activePondIds?.length)) { window.alert('Sila pilih sekurang-kurangnya satu kolam.'); return; }
    const start = new Date(compEdit.startDate).getTime();
    const end = new Date(compEdit.endDate || compEdit.startDate).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) {
      window.alert('Tarikh tamat mesti sama atau selepas tarikh mula.');
      return;
    }
    const bookingOpen = new Date(compEdit.bookingOpenAt).getTime();
    const bookingClose = new Date(compEdit.bookingCloseAt).getTime();
    if (bookingClose < bookingOpen) {
      window.alert('Tarikh tutup tempahan mesti selepas tarikh buka tempahan.');
      return;
    }

    setSaving(true);
    try {
      // A brand-new competition is only persisted here, on Save — clicking
      // "Tambah Pertandingan" merely opens a blank editor.
      const isNew = compEditIsNew || !compEdit.id;
      let competitionId = compEdit.id;
      if (isNew) {
        competitionId = await createCompetitionFirestore(compEdit as any);
      } else {
        await updateCompetitionFirestore(compEdit.id!, compEdit as any);
      }
      await logAuditEvent({
        action: isNew ? 'competition.create' : 'competition.edit',
        actionLabel: isNew ? 'Cipta Pertandingan' : 'Edit Pertandingan',
        entityType: 'competition', entityId: competitionId, entityLabel: compEdit.name,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });

      await reloadDB();
      setCompetitionEditorOpen(false);
      setCompEditIsNew(false);
    } catch (err) { console.error('Failed to save competition:', err); }
    setSaving(false);
  };

  const handlePrizeSave = async () => {
    setSaving(true);
    try {
      if (!compEdit.id) { setSaving(false); return; }
      // Normalise prize ranges before persisting: keep `rank` in sync with
      // `rankFrom` (back-compat) and ensure from<=to.
      const normalizedPrizes = (compEdit.prizes || []).map((p: Prize) => {
        const [from, to] = prizeRange(p);
        return { ...p, rank: from, rankFrom: from, rankTo: to };
      });
      await updateCompetitionFirestore(compEdit.id, { ...compEdit, prizes: normalizedPrizes } as any);
      await reloadDB();
      await logAuditEvent({
        action: 'prize.save', actionLabel: 'Kemaskini Hadiah', entityType: 'prize',
        entityId: compEdit.id, entityLabel: compEdit.name,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) { console.error('Failed to save prizes:', err); }
    setSaving(false);
  };

  // Save the inline quick-create form as a new competition. Detailed per-pond seat
  // tuning stays in the Manage modal; this form just captures the prototype fields.
  const handleSaveNewCompetition = async () => {
    if (!compCreate.name.trim()) { window.alert('Sila masukkan nama pertandingan.'); return; }
    if (!compCreate.startDateTime) { window.alert('Sila pilih tarikh & masa mula pertandingan.'); return; }
    if (!compCreate.endDateTime) { window.alert('Sila pilih tarikh & masa tamat pertandingan.'); return; }
    if (!compCreate.bookingOpenAt) { window.alert('Sila pilih tarikh & masa buka tempahan.'); return; }
    if (!compCreate.bookingCloseAt) { window.alert('Sila pilih tarikh & masa tutup tempahan.'); return; }
    if (!Number.isFinite(compCreate.pricePerPeg) || compCreate.pricePerPeg <= 0) { window.alert('Sila masukkan Harga Pancang yang sah.'); return; }
    if (!Number.isFinite(compCreate.topN) || compCreate.topN <= 0) { window.alert('Sila masukkan Jumlah Kedudukan Dipaparkan yang sah.'); return; }
    if (!compCreate.activePondIds.length) { window.alert('Sila pilih sekurang-kurangnya satu kolam.'); return; }
    const startIso = new Date(compCreate.startDateTime).toISOString();
    const endIso = new Date(compCreate.endDateTime).toISOString();
    if (new Date(endIso) < new Date(startIso)) {
      window.alert('Tarikh & masa tamat mesti selepas tarikh & masa mula.');
      return;
    }
    const bookingOpenAt = new Date(compCreate.bookingOpenAt).toISOString();
    const bookingCloseAt = new Date(compCreate.bookingCloseAt).toISOString();
    if (bookingOpenAt && bookingCloseAt && new Date(bookingCloseAt) < new Date(bookingOpenAt)) {
      window.alert('Tarikh tutup tempahan mesti selepas tarikh buka.');
      return;
    }
    setSaving(true);
    try {
      const newId = await createCompetitionFirestore({
        name: compCreate.name.trim(),
        startDate: startIso,
        endDate: endIso,
        topN: compCreate.topN,
        prizes: [],
        pricePerPeg: Number.isFinite(compCreate.pricePerPeg) ? compCreate.pricePerPeg : 100,
        activePondIds: compCreate.activePondIds,
        bookingOpenAt,
        bookingCloseAt,
        status: compCreate.status,
      } as any);
      await reloadDB();
      await logAuditEvent({
        action: 'competition.create', actionLabel: 'Cipta Pertandingan', entityType: 'competition',
        entityId: newId, entityLabel: compCreate.name.trim(),
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
      setCompCreate({ ...EMPTY_COMP_CREATE });
    } catch (err) {
      console.error('Failed to create competition:', err);
      window.alert('Gagal menyimpan pertandingan.');
    }
    setSaving(false);
  };

  const handleDeleteCompetition = async () => {
    if (!competitionDeleteTarget?.id) return;
    setSaving(true);
    try {
      await deleteCompetitionFirestore(competitionDeleteTarget.id);
      await reloadDB();
      await logAuditEvent({
        action: 'competition.delete', actionLabel: 'Padam Pertandingan', entityType: 'competition',
        entityId: competitionDeleteTarget.id, entityLabel: competitionDeleteTarget.name,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
      setCompetitionDeleteTarget(null);
      setCompetitionEditorOpen(false);
    } catch (err) {
      console.error('Failed to delete competition:', err);
    }
    setSaving(false);
  };

  const handleDeletePond = async (pond: Pond) => {
    const pondDocId = pond._docId || pond.id.toString();
    const pondKeys = new Set([pondDocId, pond.id.toString()]);
    const label = pondDisplayName(pond);
    if (!window.confirm(`Padam kolam "${label}" secara kekal? Semua pancang kolam ini akan turut dipadam dan ia akan dikeluarkan daripada semua pertandingan. Tindakan ini tidak boleh dibatalkan.`)) return;
    setSaving(true);
    try {
      // Strip the pond from every competition that references it, so no dangling
      // ids remain in activePondIds / pondSeats after the pond doc is gone. Both
      // document IDs and legacy numeric IDs may exist in older competitions.
      const affected = compList.filter(
        (c): c is Competition & { id: string } => !!c.id && (
          (c.activePondIds || []).some((id) => pondKeys.has(id)) ||
          Object.keys(c.pondSeats || {}).some((id) => pondKeys.has(id))
        )
      );
      await Promise.all(
        affected.map((c) => {
          const activePondIds = (c.activePondIds || []).filter((id) => !pondKeys.has(id));
          const pondSeats = { ...(c.pondSeats || {}) };
          pondKeys.forEach((id) => delete pondSeats[id]);
          return updateCompetitionFirestore(c.id, { activePondIds, pondSeats });
        })
      );
      await deletePondFirestore(pondDocId);
      await reloadDB();
      await logAuditEvent({
        action: 'pond.delete', actionLabel: 'Padam Kolam', entityType: 'pond',
        entityId: pondDocId, entityLabel: label,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
      setEditingPond(null);
      setPondSaveError(null);
    } catch (err) {
      console.error('Failed to delete pond:', err);
      window.alert('Gagal memadam kolam.');
    }
    setSaving(false);
  };

  // Accept a single payment receipt. The server-side booking status trigger owns
  // approval-email creation, so delivery does not depend on this browser staying open.
  const handleAcceptReceipt = async (bookingId: string, receiptIndex: number) => {
    const target = bookings.find(b => b.id === bookingId);
    setSaving(true);
    try {
      await acceptBookingReceipt({ bookingId, receiptIndex });
      await refetchCurrentBookingList();
      await logAuditEvent({
        action: 'booking.receipt_accept', actionLabel: 'Sahkan Resit', entityType: 'booking',
        entityId: bookingId, entityLabel: target?.bookingRef || bookingId,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
      setReviewTarget(null);
    } catch (err) {
      console.error('Failed to accept receipt:', err);
      window.alert(`Gagal mengesahkan resit / Failed to accept receipt: ${err instanceof Error ? err.message : 'Ralat tidak diketahui / Unknown error'}`);
    }
    setSaving(false);
  };

  const handleRejectReceipt = async (bookingId: string, receiptIndex: number) => {
    setSaving(true);
    try {
      await rejectBookingReceipt({ bookingId, receiptIndex });
      await refetchCurrentBookingList();
      await logAuditEvent({
        action: 'booking.receipt_reject', actionLabel: 'Tolak Resit', entityType: 'booking',
        entityId: bookingId, entityLabel: bookings.find(b => b.id === bookingId)?.bookingRef || bookingId,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
      setReviewTarget(null);
    }
    catch (err) {
      console.error('Failed to reject receipt:', err);
      window.alert(`Gagal menolak resit / Failed to reject receipt: ${err instanceof Error ? err.message : 'Ralat tidak diketahui / Unknown error'}`);
    }
    setSaving(false);
  };

  // Request a server-rendered balance reminder. The 7-day clock resets only after
  // the email extension confirms delivery to the booking recipient.
  // Takes the row's Booking, not just its id: "Semua Tempahan" renders the
  // server-paginated `allEntries`, so looking the booking up in the `bookings`
  // prop used to miss and abandon the send silently.
  const handleSendBalanceReminder = async (target: Booking) => {
    setSaving(true);
    try {
      await requestBalanceReminderEmail(target.id);
      await refetchCurrentBookingList();
      await logAuditEvent({
        action: 'booking.balance_reminder', actionLabel: 'Hantar Peringatan Baki', entityType: 'booking',
        entityId: target.id, entityLabel: target.bookingRef || target.id,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to send balance reminder:', err);
      window.alert(`Gagal menghantar peringatan / Failed to send reminder: ${err instanceof Error ? err.message : 'Ralat tidak diketahui / Unknown error'}`);
    }
    setSaving(false);
  };

  // Force-cancel a CONFIRMED booking. Frees its seats (status → rejected). Guarded
  // by a first confirm dialog AND a typed "DELETE BOOKING" confirmation.
  const handleForceCancel = async () => {
    if (!forceCancelTarget) return;
    setSaving(true);
    try {
      await updateBookingStatusFirestore(forceCancelTarget.id, 'rejected');
      await refetchCurrentBookingList();
      await logAuditEvent({
        action: 'booking.force_cancel', actionLabel: 'Batal Paksa Tempahan', entityType: 'booking',
        entityId: forceCancelTarget.id, entityLabel: forceCancelTarget.bookingRef || forceCancelTarget.id,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
      setForceCancelTarget(null);
      setForceCancelText('');
    } catch (err) {
      console.error('Failed to force-cancel booking:', err);
      window.alert(`Gagal membatalkan tempahan / Failed to cancel booking: ${err instanceof Error ? err.message : 'Ralat tidak diketahui / Unknown error'}`);
    }
    setSaving(false);
  };

  // ── Confirmation-dialog wrappers ─────────────────────────────────────────
  // Each opens the shared confirm dialog; the real work runs only on confirm.
  const askSendReminder = (booking: Booking) => {
    setConfirmDialog({
      title: 'Hantar Peringatan',
      message: 'Hantar e-mel peringatan baki bayaran kepada pengguna sekarang? Kiraan auto-peringat akan ditetapkan semula ke 7 hari.',
      confirmLabel: 'Hantar',
      tone: 'primary',
      onConfirm: () => handleSendBalanceReminder(booking),
    });
  };

  // First gate for force-cancelling a confirmed booking; the typed-confirmation
  // modal (DELETE BOOKING) is the second gate.
  const askForceCancel = (booking: Booking) => {
    setConfirmDialog({
      title: 'Batal Paksa Tempahan / Force Cancel',
      message: `Tindakan ini akan MEMBATALKAN tempahan yang telah DISAHKAN untuk ${booking.userName} (${booking.pondName}, peg ${bookingSeatList(booking)}) dan melepaskan tempatnya.\n\nThis will CANCEL a CONFIRMED booking and release its seats. Continue?`,
      confirmLabel: 'Teruskan / Continue',
      tone: 'danger',
      onConfirm: () => { setForceCancelText(''); setForceCancelTarget(booking); },
    });
  };

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
    const normalizedUrl = normalizePdfUrl(receiptData);
    setReceiptViewerUrl(normalizedUrl);
    setReceiptViewerMeta({ width: 0, height: 0, bytes: null });
    // Resolve the file size: derive it from a data-URL directly, otherwise ask
    // the host for Content-Length via a HEAD request (best-effort; ignored on CORS failure).
    if (normalizedUrl.startsWith('data:')) {
      const base64 = normalizedUrl.split(',')[1] || '';
      const padding = (base64.match(/=+$/) || [''])[0].length;
      const bytes = Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
      setReceiptViewerMeta(m => ({ ...m, bytes }));
    } else {
      fetch(normalizedUrl, { method: 'HEAD' })
        .then(r => { const len = r.headers.get('content-length'); if (len) setReceiptViewerMeta(m => ({ ...m, bytes: parseInt(len, 10) })); })
        .catch(() => {});
    }
  };

  // ── Kelulusan (pending-only) paginated fetch ────────────────────────────
  // competitionId/paymentType are applied client-side over the loaded page
  // (see filteredEntries below) — only status/balanceStage are server
  // where-clauses, matching the fixed set of composite indexes in
  // firestore.indexes.json.
  const fetchKelulusanPage = async (cursor: any, pageIndex: number) => {
    setKelulusanLoading(true);
    setKelulusanError(null);
    try {
      const result = await getBookingsPage({
        statuses: ['PENDING_APPROVAL'],
        sortField: approvalSortField,
        sortDir: approvalsSortOrder,
        pageSize: 50,
        cursor,
        competitions,
      });
      setKelulusanEntries(result.items);
      setKelulusanHasMore(result.hasMore);
      setKelulusanCursors((prev) => {
        const next = [...prev];
        next[pageIndex + 1] = result.lastDoc;
        return next;
      });
    } catch (err) {
      console.error('Failed to load Kelulusan page:', err);
      setKelulusanError(err instanceof Error ? err.message : 'Gagal memuatkan senarai Kelulusan.');
    }
    setKelulusanLoading(false);
  };

  const handleKelulusanSort = (field: string) => {
    if (field === approvalSortField) setApprovalsSortOrder((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setApprovalSortField(field as any); setApprovalsSortOrder('desc'); }
  };

  const handleKelulusanNext = () => {
    if (!kelulusanHasMore) return;
    const nextPage = kelulusanPage + 1;
    setKelulusanPage(nextPage);
    fetchKelulusanPage(kelulusanCursors[nextPage] ?? null, nextPage);
  };
  const handleKelulusanPrev = () => {
    if (kelulusanPage === 0) return;
    const prevPage = kelulusanPage - 1;
    setKelulusanPage(prevPage);
    fetchKelulusanPage(kelulusanCursors[prevPage] ?? null, prevPage);
  };

  useEffect(() => {
    if (page !== 'approvals') return;
    setKelulusanPage(0);
    setKelulusanCursors([null]);
    fetchKelulusanPage(null, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, approvalSortField, approvalsSortOrder]);

  // ── Semua Tempahan (decided: confirmed/rejected) paginated fetch ────────
  // Same competitionId/paymentType-stay-client-side reasoning as Kelulusan.
  const fetchAllTempahanPage = async (cursor: any, pageIndex: number) => {
    setAllLoading(true);
    setAllError(null);
    try {
      const statuses = allStatus === 'cancelled'
        ? ['REJECTED']
        : allStatus === 'all'
        ? ['APPROVED', 'CONFIRMED', 'REJECTED']
        : ['APPROVED', 'CONFIRMED'];
      const balanceStage = (allStatus === 'all' || allStatus === 'cancelled') ? undefined : allStatus;
      const result = await getBookingsPage({
        statuses,
        balanceStage,
        sortField: allSortField,
        sortDir: allSortOrder,
        pageSize: 50,
        cursor,
        competitions,
      });
      setAllEntries(result.items);
      setAllHasMore(result.hasMore);
      setAllCursors((prev) => {
        const next = [...prev];
        next[pageIndex + 1] = result.lastDoc;
        return next;
      });
    } catch (err) {
      console.error('Failed to load Semua Tempahan page:', err);
      setAllError(err instanceof Error ? err.message : 'Gagal memuatkan senarai Semua Tempahan.');
    }
    setAllLoading(false);
  };

  const handleAllSort = (field: string) => {
    if (field === allSortField) setAllSortOrder((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setAllSortField(field as any); setAllSortOrder('desc'); }
  };

  const handleAllNext = () => {
    if (!allHasMore) return;
    const nextPage = allPage + 1;
    setAllPage(nextPage);
    fetchAllTempahanPage(allCursors[nextPage] ?? null, nextPage);
  };
  const handleAllPrev = () => {
    if (allPage === 0) return;
    const prevPage = allPage - 1;
    setAllPage(prevPage);
    fetchAllTempahanPage(allCursors[prevPage] ?? null, prevPage);
  };

  useEffect(() => {
    if (page !== 'all-bookings') return;
    setAllPage(0);
    setAllCursors([null]);
    fetchAllTempahanPage(null, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, allStatus, allSortField, allSortOrder]);

  // Refetch whichever list is currently on-screen after a mutation — the
  // OTHER list (if the booking just moved between them) picks up the change
  // naturally next time the admin navigates to it (see the filter/page effects).
  const refetchCurrentBookingList = async () => {
    if (page === 'approvals') await fetchKelulusanPage(kelulusanCursors[kelulusanPage] ?? null, kelulusanPage);
    else if (page === 'all-bookings') await fetchAllTempahanPage(allCursors[allPage] ?? null, allPage);
  };

  const handleReviewApproveManual = async (booking: Booking, file: File, amount: number) => {
    setSaving(true);
    try {
      const webp = await compressBlobToWebp(file, file.name);
      const proofUrl = await uploadImageToFirebaseStorage(webp, 'fishing-pond-receipts', webp.name);
      await approveDepositWithProofDirect(booking.id, proofUrl, amount);
      await refetchCurrentBookingList();
      await logAuditEvent({
        action: 'booking.deposit_manual_approve', actionLabel: 'Sahkan Bayaran + Bukti', entityType: 'booking',
        entityId: booking.id, entityLabel: booking.bookingRef || booking.id,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
      setReviewTarget(null);
      window.alert('Bayaran disahkan secara manual dan bukti telah disimpan.');
    } catch (err) {
      console.error('Manual approval failed:', err);
      window.alert(`Gagal sahkan bayaran: ${err instanceof Error ? err.message : 'Ralat tidak diketahui.'}`);
    }
    setSaving(false);
  };

  const handleAddRemark = async (bookingId: string, text: string) => {
    if (!text.trim()) return;
    try {
      await addStaffRemark(bookingId, text, user?.name);
      // Reflect the new note immediately in the open modal without a full refetch.
      setReviewTarget((prev) => prev && prev.id === bookingId
        ? { ...prev, staffRemarks: [...(prev.staffRemarks || []), { text: text.trim(), byName: user?.name, at: new Date().toISOString() }] }
        : prev);
    } catch (err) {
      console.error('Failed to add remark:', err);
      window.alert('Gagal menyimpan catatan.');
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const stopCheckinLiveScan = () => {
    checkinLiveActiveRef.current = false;
    if (checkinLiveRafRef.current) {
      window.cancelAnimationFrame(checkinLiveRafRef.current);
      checkinLiveRafRef.current = null;
    }
    if (checkinLiveStreamRef.current) {
      checkinLiveStreamRef.current.getTracks().forEach((t) => t.stop());
      checkinLiveStreamRef.current = null;
    }
    const video = checkinLiveVideoRef.current;
    if (video) video.srcObject = null;
    setCheckinLiveScanOn(false);
  };

  const runCheckinLiveFrame = () => {
    const video = checkinLiveVideoRef.current;
    const canvas = checkinLiveCanvasRef.current;
    if (!video || !canvas || !checkinLiveActiveRef.current) return;
    if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
      checkinLiveRafRef.current = window.requestAnimationFrame(runCheckinLiveFrame);
      return;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      checkinLiveRafRef.current = window.requestAnimationFrame(runCheckinLiveFrame);
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      checkinLiveRafRef.current = window.requestAnimationFrame(runCheckinLiveFrame);
      return;
    }
    // Skip decoding during the warm-up window right after the camera opens —
    // autofocus/auto-exposure haven't settled yet, so these frames are soft.
    if (performance.now() - checkinLiveStartedAtRef.current < 350) {
      checkinLiveRafRef.current = window.requestAnimationFrame(runCheckinLiveFrame);
      return;
    }
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const decoded = decodeQr(imageData.data, imageData.width, imageData.height);
    if (decoded) {
      // Stop the camera the instant ANY QR is read, then show the result — a
      // matching booking, or the raw scanned text when nothing matches.
      stopCheckinLiveScan();
      const parsed = parseQrPayload(decoded);
      const found = parsed ? bookings.find(b => b.id === parsed.bookingId || b.bookingRef === parsed.bookingId) : null;
      if (found) {
        setCheckinResult(found);
        setCheckinScannedSeat(parsed?.seatNum ?? null);
        setCheckinScannedPondId(parsed?.pondId ?? null);
        setCheckinScannedRaw(null);
      } else {
        setCheckinResult(null);
        setCheckinScannedSeat(null);
        setCheckinScannedPondId(null);
        setCheckinScannedRaw(decoded);
      }
      return;
    }
    checkinLiveRafRef.current = window.requestAnimationFrame(runCheckinLiveFrame);
  };

  const startCheckinLiveScan = async () => {
    setCheckinLiveScanBusy(true);
    setCheckinScannedRaw(null);
    try {
      const stream = await openQrCameraStream();
      checkinLiveStreamRef.current = stream;
      const video = checkinLiveVideoRef.current;
      if (!video) throw new Error('Elemen video tidak tersedia.');
      video.srcObject = stream;
      await video.play();
      checkinLiveActiveRef.current = true;
      checkinLiveStartedAtRef.current = performance.now();
      setCheckinLiveScanOn(true);
      checkinLiveRafRef.current = window.requestAnimationFrame(runCheckinLiveFrame);
    } catch (err) {
      console.error('Failed to start live check-in scan:', err);
      window.alert('Tidak dapat membuka kamera untuk imbas QR.');
      stopCheckinLiveScan();
    }
    setCheckinLiveScanBusy(false);
  };

  const handleCheckinQrFile = async (file: File) => {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = decodeQr(imageData.data, imageData.width, imageData.height);
      const parsed = decoded ? parseQrPayload(decoded) : null;
      const found = parsed ? bookings.find(b => b.id === parsed.bookingId || b.bookingRef === parsed.bookingId) : null;
      if (!found) {
        // Show what was scanned (if anything) rather than a disappearing alert.
        setCheckinResult(null);
        setCheckinScannedSeat(null);
        setCheckinScannedPondId(null);
        setCheckinScannedRaw(decoded || '(tiada QR dikesan dalam imej)');
        return;
      }
      setCheckinResult(found);
      setCheckinScannedSeat(parsed?.seatNum ?? null);
      setCheckinScannedPondId(parsed?.pondId ?? null);
      setCheckinScannedRaw(null);
    } catch (err) {
      console.error('Failed to scan check-in QR:', err);
      window.alert('Imbas QR gagal. Sila cuba lagi.');
    }
  };

  // Checks in one specific pond/seat entry. Omitting it falls
  // back to checking in every seat at once (legacy path — kept for safety, the
  // UI always passes a specific seat now).
  const handlePerformCheckin = async (entry?: BookingSeatEntry) => {
    if (!checkinResult) return;
    setCheckinActiveSeat(entry?.key ?? null);
    setCheckinLoading(true);
    try {
      const result = await checkInBooking({
        bookingId: checkinResult.id,
        bookingRef: checkinResult.bookingRef || checkinResult.id,
        amount: checkinResult.amount,
        method: 'manual',
        seatNum: entry?.seatNum,
        pondId: entry?.pondId,
      });
      setCheckinResult((prev: Booking | null) => prev ? { ...prev, ...result } : prev);
      await reloadDB();
      const bookingRef = checkinResult.bookingRef || checkinResult.id;
      await logAuditEvent({
        action: 'booking.checkin', actionLabel: 'Check-In Peserta', entityType: 'booking',
        entityId: checkinResult.id,
        entityLabel: entry ? `${bookingRef} · peg ${formatSeat(entry.pondCode, entry.seatNum)}` : bookingRef,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Check-in failed:', err);
      window.alert(`Check-in gagal: ${err instanceof Error ? err.message : 'Ralat tidak diketahui.'}`);
    }
    setCheckinLoading(false);
    setCheckinActiveSeat(null);
  };

  const handleCancelCheckin = async (booking: Booking, entry: BookingSeatEntry) => {
    setCheckinLoading(true);
    try {
      const result = await cancelBookingCheckIn({ bookingId: booking.id, seatNum: entry.seatNum, pondId: entry.pondId });
      await reloadDB();
      if (checkinResult?.id === booking.id) {
        setCheckinResult((prev: Booking | null) => prev ? {
          ...prev,
          ...result,
        } : prev);
      }
      await logAuditEvent({
        action: 'booking.checkin_cancel', actionLabel: 'Batalkan Check-In', entityType: 'booking',
        entityId: booking.id, entityLabel: `${booking.bookingRef || booking.id} · peg ${formatSeat(entry.pondCode, entry.seatNum)}`,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to cancel check-in:', err);
      window.alert(`Gagal membatalkan check-in: ${err instanceof Error ? err.message : 'Ralat tidak diketahui.'}`);
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
        qrBank: settingsEdit.qrBank || '',
        qrName: settingsEdit.qrName || '',
        qrAccNo: settingsEdit.qrAccNo || '',
      });
      await reloadDB();
      await logAuditEvent({
        action: 'settings.contact', actionLabel: 'Kemaskini Contact Us', entityType: 'settings',
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to update contact settings:', err);
    }
    setSaving(false);
  };

  const handleLandingContentSave = async () => {
    setLandingSaveError(null);
    const sanitizedLandingSections = { ...settingsEdit.landingSections };
    for (const key of LANDING_SECTION_KEYS) {
      const section = settingsEdit.landingSections[key];
      const sanitized = sanitizeLandingHtml(section.html);
      if (section.mode === 'html' && !sanitized.trim()) {
        setLandingSaveError(`Masukkan HTML yang sah untuk seksyen ${LANDING_SECTION_LABELS[key]} sebelum menyimpan.`);
        return;
      }
      sanitizedLandingSections[key] = { ...section, html: sanitized };
    }

    setSaving(true);
    try {
      await updateSettingsFirestore({
        heroKicker: settingsEdit.heroKicker || '',
        heroTitle: settingsEdit.heroTitle || '',
        heroSubtitle: settingsEdit.heroSubtitle || '',
        heroStats: settingsEdit.heroStats || [],
        heroCtaLabel: settingsEdit.heroCtaLabel || '',
        introCopy: settingsEdit.introCopy || '',
        aboutEyebrow: settingsEdit.aboutEyebrow || '',
        aboutTitle: settingsEdit.aboutTitle || '',
        aboutCtaLabel: settingsEdit.aboutCtaLabel || '',
        features: settingsEdit.features || [],
        competitionsEyebrow: settingsEdit.competitionsEyebrow || '',
        competitionsTitle: settingsEdit.competitionsTitle || '',
        weeklyCardTitle: settingsEdit.weeklyCardTitle || '',
        weeklyCardBody: settingsEdit.weeklyCardBody || '',
        weeklyCardTag1: settingsEdit.weeklyCardTag1 || '',
        weeklyCardTag2: settingsEdit.weeklyCardTag2 || '',
        stepsEyebrow: settingsEdit.stepsEyebrow || '',
        stepsTitle: settingsEdit.stepsTitle || '',
        stepsSubtitle: settingsEdit.stepsSubtitle || '',
        stepsCtaLabel: settingsEdit.stepsCtaLabel || '',
        steps: settingsEdit.steps || [],
        rulesEyebrow: settingsEdit.rulesEyebrow || '',
        rulesTitle: settingsEdit.rulesTitle || '',
        rulesCtaLabel: settingsEdit.rulesCtaLabel || '',
        rules: settingsEdit.rules || [],
        rulesPdfUrl: settingsEdit.rulesPdfUrl || '',
        lokasiEyebrow: settingsEdit.lokasiEyebrow || '',
        lokasiTitle: settingsEdit.lokasiTitle || '',
        contactName: settingsEdit.contactName || '',
        footerTagline: settingsEdit.footerTagline || '',
        landingSections: sanitizedLandingSections,
        wazeUrl: settingsEdit.wazeUrl || '',
        googleMapsUrl: settingsEdit.googleMapsUrl || '',
        mapEmbedUrl: settingsEdit.mapEmbedUrl || '',
        ocrUsePreprocess: settingsEdit.ocrUsePreprocess !== false,
        ocrDecimalPlaces: settingsEdit.ocrDecimalPlaces,
      });
      setSettingsEdit(s => ({ ...s, landingSections: sanitizedLandingSections }));
      await reloadDB();
      await logAuditEvent({
        action: 'settings.landing', actionLabel: 'Kemaskini Laman Utama', entityType: 'settings',
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
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
      await logAuditEvent({
        action: 'settings.ocr_preprocess', actionLabel: 'Tukar Pra-pemprosesan OCR', entityType: 'settings',
        details: next ? 'Dihidupkan' : 'Dimatikan',
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to update OCR preprocess setting:', err);
    }
  };

  const handleOcrDecimalChange = async (value: string) => {
    if (ocrDecimalSaving) return;
    const previous = settings.ocrDecimalPlaces;
    setOcrDecimalSaving(true);
    setOcrDecimalError(null);
    let next: 0 | 1 | 2 | 3 | undefined;
    if (value === 'auto') next = undefined;
    else next = parseInt(value, 10) as 0 | 1 | 2 | 3;
    setSettingsEdit(s => ({ ...s, ocrDecimalPlaces: next }));
    try {
      await updateSettingsFirestore({ ocrDecimalPlaces: next });
      await reloadDB();
      await logAuditEvent({
        action: 'settings.ocr_decimal', actionLabel: 'Tukar Tetapan Perpuluhan OCR', entityType: 'settings',
        details: value,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to update OCR decimal-place setting:', err);
      setSettingsEdit(s => ({ ...s, ocrDecimalPlaces: previous }));
      setOcrDecimalError('Gagal menyimpan tetapan perpuluhan. Sila cuba lagi.');
    } finally {
      setOcrDecimalSaving(false);
    }
  };

  const updateHeroStat = (idx: number, field: 'label' | 'value', val: string) => {
    const stats = [...(settingsEdit.heroStats || [])];
    while (stats.length <= idx) stats.push({ label: '', value: '' });
    stats[idx] = { ...stats[idx], [field]: val };
    setSettingsEdit({ ...settingsEdit, heroStats: stats });
  };

  const updateFeature = (idx: number, field: 'icon' | 'title' | 'body', val: string) => {
    const features = [...(settingsEdit.features || [])];
    while (features.length <= idx) features.push({ icon: '', title: '', body: '' });
    features[idx] = { ...features[idx], [field]: val };
    setSettingsEdit({ ...settingsEdit, features });
  };

  const updateStep = (idx: number, field: 'icon' | 'title' | 'body', val: string) => {
    const steps = [...(settingsEdit.steps || [])];
    while (steps.length <= idx) steps.push({ icon: '', title: '', body: '' });
    steps[idx] = { ...steps[idx], [field]: val };
    setSettingsEdit({ ...settingsEdit, steps });
  };

  const updateLandingSectionMode = (key: LandingSectionKey, mode: 'fields' | 'html') => {
    setLandingSaveError(null);
    setSettingsEdit(s => ({
      ...s,
      landingSections: {
        ...s.landingSections,
        [key]: { ...s.landingSections[key], mode },
      },
    }));
  };

  const updateLandingSectionHtml = (key: LandingSectionKey, html: string) => {
    setLandingSaveError(null);
    setSettingsEdit(s => ({
      ...s,
      landingSections: {
        ...s.landingSections,
        [key]: { ...s.landingSections[key], html },
      },
    }));
  };

  const renderLandingSectionModeEditor = (key: LandingSectionKey) => {
    const section = settingsEdit.landingSections[key];
    return (
      <div style={{ marginBottom: section.mode === 'html' ? '16px' : '18px' }}>
        <div
          role="radiogroup"
          aria-label={`Mod kandungan ${LANDING_SECTION_LABELS[key]}`}
          style={{ display: 'inline-flex', gap: '4px', padding: '4px', borderRadius: '10px', background: 'var(--surface2)', marginBottom: section.mode === 'html' ? '14px' : 0 }}
        >
          {([
            ['fields', 'Guna Input Biasa'],
            ['html', 'Guna Custom HTML'],
          ] as const).map(([mode, label]) => (
            <label
              key={mode}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '8px 12px', borderRadius: '7px', cursor: 'pointer',
                background: section.mode === mode ? 'var(--green)' : 'transparent',
                color: section.mode === mode ? '#fff' : 'var(--text)', fontSize: '13px', fontWeight: 600,
              }}
            >
              <input
                type="radio"
                name={`landing-mode-${key}`}
                value={mode}
                checked={section.mode === mode}
                onChange={() => updateLandingSectionMode(key, mode)}
                style={{ margin: 0 }}
              />
              {label}
            </label>
          ))}
        </div>
        {section.mode === 'html' && (
          <div className="form-group form-span">
            <label className="form-label">Custom HTML — {LANDING_SECTION_LABELS[key]}</label>
            <textarea
              className="form-textarea"
              rows={12}
              spellCheck={false}
              value={section.html}
              onChange={(e) => updateLandingSectionHtml(key, e.target.value)}
              placeholder={`<div>Custom HTML untuk ${LANDING_SECTION_LABELS[key]}</div>`}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: 1.55 }}
            />
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '7px', lineHeight: 1.5 }}>
              HTML statik sahaja. Skrip, event handler, borang, iframe dan URL berbahaya akan dibuang semasa simpan.
              Pautan biasa seperti <code>/book</code> dan <code>#rules</code> dibenarkan.
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleLandingImageUpload = async (key: keyof typeof LANDING_ASSETS, file: File) => {
    setLandingImageUploading(s => ({ ...s, [key]: true }));
    try {
      const webp = await compressBlobToWebp(file, file.name);
      const url = await uploadImageToFirebaseStorage(webp, 'fishing-pond-landing', webp.name);
      const landingImages = { ...(settingsEdit.landingImages || {}), [key]: url };
      setSettingsEdit(s => ({ ...s, landingImages }));
      await updateSettingsFirestore({ landingImages });
      await reloadDB();
      await logAuditEvent({
        action: 'settings.landing_image', actionLabel: `Muat Naik Imej Laman Utama (${key})`, entityType: 'settings',
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to upload landing image:', err);
    }
    setLandingImageUploading(s => ({ ...s, [key]: false }));
  };

  const handleLandingImageReset = async (key: keyof typeof LANDING_ASSETS) => {
    const landingImages = { ...(settingsEdit.landingImages || {}), [key]: '' };
    setSettingsEdit(s => ({ ...s, landingImages }));
    try {
      await updateSettingsFirestore({ landingImages });
      await reloadDB();
    } catch (err) {
      console.error('Failed to reset landing image:', err);
    }
  };

  // ── SEO tab ──────────────────────────────────────────────────────────────
  const updateSeoGeneral = (field: 'siteUrl' | 'siteName' | 'defaultOgImage', val: string) => {
    setSettingsEdit(s => ({ ...s, seo: { ...(s.seo as any), [field]: val } }));
  };

  const updateSeoGeoCoord = (field: 'latitude' | 'longitude', val: string) => {
    const num = val.trim() === '' ? undefined : Number(val);
    setSettingsEdit(s => ({ ...s, seo: { ...(s.seo as any), [field]: Number.isFinite(num) ? num : undefined } }));
  };

  const updateSeoPage = (key: 'home' | 'book' | 'live', field: 'title' | 'description' | 'ogImage', val: string) => {
    setSettingsEdit(s => ({
      ...s,
      seo: {
        ...(s.seo as any),
        pages: { ...(s.seo?.pages as any), [key]: { ...(s.seo?.pages?.[key] as any), [field]: val } },
      },
    }));
  };

  const handleSeoSave = async () => {
    setSaving(true);
    try {
      await updateSettingsFirestore({ seo: settingsEdit.seo });
      await reloadDB();
      await logAuditEvent({
        action: 'settings.seo', actionLabel: 'Kemaskini SEO', entityType: 'settings',
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to update SEO settings:', err);
    }
    setSaving(false);
  };

  const handleOgImageUpload = async (target: 'default' | 'home' | 'book' | 'live', file: File) => {
    setOgImageUploading(target);
    try {
      const jpeg = await compressBlobToJpeg(file, file.name);
      const url = await uploadImageToFirebaseStorage(jpeg, 'fishing-pond-seo', jpeg.name);
      const nextSeo = target === 'default'
        ? { ...(settingsEdit.seo as any), defaultOgImage: url }
        : { ...(settingsEdit.seo as any), pages: { ...settingsEdit.seo?.pages, [target]: { ...settingsEdit.seo?.pages?.[target], ogImage: url } } };
      setSettingsEdit(s => ({ ...s, seo: nextSeo }));
      await updateSettingsFirestore({ seo: nextSeo });
      await reloadDB();
      await logAuditEvent({
        action: 'settings.seo_image', actionLabel: `Muat Naik Imej OG (${target})`, entityType: 'settings',
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to upload OG image:', err);
    }
    setOgImageUploading(null);
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

  const handleRulesPdfUpload = async (file: File) => {
    setRulesPdfUploading(true);
    try {
      const url = await uploadPdfToFirebaseStorage(file, 'fishing-pond-rules', file.name);
      setSettingsEdit(s => ({ ...s, rulesPdfUrl: url }));
      await updateSettingsFirestore({ rulesPdfUrl: url });
      await reloadDB();
      await logAuditEvent({
        action: 'settings.rules_pdf', actionLabel: 'Muat Naik Syarat & Peraturan', entityType: 'settings',
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to upload rules PDF:', err);
    }
    setRulesPdfUploading(false);
  };

  const handlePondMapUpload = async (file: File) => {
    setPondMapUploading(true);
    try {
      const webp = await compressBlobToWebp(file, file.name);
      const url = await uploadImageToFirebaseStorage(webp, 'fishing-pond-maps', webp.name);
      setSettingsEdit(s => ({ ...s, pondMapImg: url }));
      await updateSettingsFirestore({ pondMapImg: url });
      await reloadDB();
      await logAuditEvent({
        action: 'settings.pond_map', actionLabel: 'Muat Naik Peta Kolam', entityType: 'settings',
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to upload pond map image:', err);
    }
    setPondMapUploading(false);
  };

  const handleQrImgUpload = async (file: File) => {
    setQrImgUploading(true);
    try {
      const webp = await compressBlobToWebp(file, file.name);
      const url = await uploadImageToFirebaseStorage(webp, 'fishing-pond-payment-qr', webp.name);
      setSettingsEdit(s => ({ ...s, qrImg: url }));
      await updateSettingsFirestore({ qrImg: url });
      await reloadDB();
      await logAuditEvent({
        action: 'settings.payment_qr', actionLabel: 'Muat Naik QR Pembayaran', entityType: 'settings',
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) {
      console.error('Failed to upload payment QR image:', err);
    }
    setQrImgUploading(false);
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      const entry = scoreEntries.find(e => e.id === id);
      await deleteScoreEntry(id);
      setScoreEntries(prev => prev.filter(e => e.id !== id));
      await logAuditEvent({
        action: 'score.delete', actionLabel: 'Padam Rekod Keputusan', entityType: 'score',
        entityId: id, entityLabel: entry ? `${entry.anglerName} · ${entry.pondName} peg ${entry.seatNum} · ${entry.weight}kg` : id,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
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
      pondCode: pond?.code || booking.pondCode,
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
          pondCode: pond?.code || b.pondCode,
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
    let savedAnglerName = '';
    try {
      // OCR/seven-segment recognition already ran on the original frame in
      // ScaleScanModal; only the stored copy is WebP-compressed here.
      const webp = await compressBlobToWebp(scan.photoBlob, scan.photoFileName);
      const photoUrl = await uploadImageToFirebaseStorage(webp, 'fishing-pond-weights', webp.name);
      const sb = scan.scannedBooking;
      savedAnglerName = sb.anglerName;
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
        scanMethod: scan.method,
        capturedBy: user?.uid || user?.email || 'unknown',
      });
      setScoreEntries(await getScoresForCompetition(resultsCompId));
    } catch (err) {
      console.error('Failed to save scanned weight:', err);
    }
    setSaving(false);
    if (savedAnglerName) {
      const continueForSameAngler = window.confirm(
        `Berjaya simpan timbang untuk ${savedAnglerName}. Hantar satu lagi rekod untuk pemancing sama?`,
      );
      if (continueForSameAngler) {
        setScanOpen(true);
      }
    }
  };

  const openCreatePondModal = () => {
    setNewPondSeatPrice(100);
    setNewPondMaxSeats(30);
    setPondSaveError(null);
    setNewPond((p) => ({ ...p, code: p.code || nextFreePondCode(ponds) }));
    setEditingPond({} as any);
  };

  // Adjust pond arrangement: swap a pond with its neighbour and persist the new
  // order to every pond so the order is stable across booking + CMS views.
  const handleMovePond = async (pond: Pond, dir: 'up' | 'down') => {
    const ordered = [...ponds];
    const idx = ordered.findIndex(p => (p._docId || p.id) === (pond._docId || pond.id));
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= ordered.length) return;
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    setPondReordering(true);
    try {
      await Promise.all(ordered.map((p, i) => updatePondFirestore(p._docId || p.id.toString(), { order: i } as any)));
      await reloadDB();
      await logAuditEvent({
        action: 'pond.reorder', actionLabel: 'Susun Semula Kolam', entityType: 'pond',
        entityId: pond._docId || pond.id.toString(), entityLabel: pond.code ? `${pond.code} — ${pond.name}` : pond.name,
        details: `Alih ${dir === 'up' ? 'ke atas' : 'ke bawah'}`,
        actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
      });
    } catch (err) { console.error('Failed to reorder ponds:', err); }
    setPondReordering(false);
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

  const pendingCount = bookings.filter(b => b.status === 'pending').length;
  const confirmedCount = bookings.filter(b => b.status === 'confirmed').length;

  const hasConflict = (b: Booking) => {
    const selections = b.pondSelections?.length ? b.pondSelections : [{ pondId: b.pondId, seats: b.seats ?? [] }];
    return selections.some((selection) => selection.seats.some(
      (seatNum) => (seatConflictMap.get(`${b.competitionId || ''}-${selection.pondId}-${seatNum}`) ?? []).length > 1,
    ));
  };
  const totalRevenue = bookings.filter(b => b.status === 'confirmed').reduce((s, b) => s + b.amount, 0);
  const competitionsForCms = compList.length ? compList : (comp.name ? [comp] : []);
  const dashboardCompetitions = competitionsForCms
    .filter((competition) => {
      const phase = getCompetitionPhase(competition);
      return phase === 'live' || phase === 'upcoming';
    })
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  // Competitions ordered with ended ("tamat") events pushed to the bottom — used
  // by the keputusan/live & prize selectors.
  const compsEndedLast = [...competitionsForCms].sort((a, b) =>
    (getCompetitionPhase(a) === 'ended' ? 1 : 0) - (getCompetitionPhase(b) === 'ended' ? 1 : 0),
  );
  const resultsCompsLiveFirst = resultsCompetitionOptions(competitionsForCms);
  const compOptionLabel = (c: Competition) =>
    `${c.name}${getCompetitionPhase(c) === 'ended' ? ' (tamat)' : ''}`;
  // Hadiah & Ranking only deals with competitions that haven't ended yet.
  const compsNotEnded = competitionsForCms.filter(c => getCompetitionPhase(c) !== 'ended');

  // Semua Timbangan Rekod: default to the live competition, or (since an
  // upcoming one has no weigh-ins yet) the most recently *ended* one instead.
  useEffect(() => {
    if (page !== 'all-weigh-ins' || allWeighCompId || competitionsForCms.length === 0) return;
    const live = competitionsForCms.find((c) => getCompetitionPhase(c) === 'live');
    const mostRecentEnded = competitionsForCms
      .filter((c) => getCompetitionPhase(c) === 'ended')
      .sort((a, b) => new Date(b.endDate || b.startDate).getTime() - new Date(a.endDate || a.startDate).getTime())[0];
    const fallback = live || mostRecentEnded || competitionsForCms[0];
    if (fallback?.id) setAllWeighCompId(fallback.id);
  }, [page, competitionsForCms, allWeighCompId]);

  const fetchWeighPage = async (cursor: any, pageIndex: number) => {
    setAllWeighLoading(true);
    setAllWeighError(null);
    try {
      const result = await getScoreEntriesPage({
        competitionId: allWeighCompId || undefined,
        pondName: allWeighPond || undefined,
        pageSize: 50,
        cursor,
      });
      setAllWeighEntries(result.items);
      setAllWeighHasMore(result.hasMore);
      setAllWeighCursors((prev) => {
        const next = [...prev];
        next[pageIndex + 1] = result.lastDoc;
        return next;
      });
    } catch (err) {
      console.error('Failed to load Semua Timbangan Rekod page:', err);
      setAllWeighError(err instanceof Error ? err.message : 'Gagal memuatkan Semua Timbangan Rekod.');
    }
    setAllWeighLoading(false);
  };
  const handleWeighNext = () => {
    if (!allWeighHasMore) return;
    const nextPage = allWeighPage + 1;
    setAllWeighPage(nextPage);
    fetchWeighPage(allWeighCursors[nextPage] ?? null, nextPage);
  };
  const handleWeighPrev = () => {
    if (allWeighPage === 0) return;
    const prevPage = allWeighPage - 1;
    setAllWeighPage(prevPage);
    fetchWeighPage(allWeighCursors[prevPage] ?? null, prevPage);
  };
  useEffect(() => {
    if (page !== 'all-weigh-ins') return;
    setAllWeighPage(0);
    setAllWeighCursors([null]);
    fetchWeighPage(null, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, allWeighCompId, allWeighPond]);

  // Staff/admin gate. MUST stay below every hook above — an early return placed
  // among the hooks changes the hook count between renders (e.g. when the user's
  // role resolves from an optimistic 'CLIENT' to 'ADMIN' after the profile loads),
  // which crashes React with "rendered more hooks than during the previous render".
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

  // ── Unsaved-changes guard ────────────────────────────────────────────────
  const compSig = (c?: Partial<Competition>) => c ? JSON.stringify({
    name: c.name || '', startDate: c.startDate || '', endDate: c.endDate || '',
    bookingOpenAt: c.bookingOpenAt || '', bookingCloseAt: c.bookingCloseAt || '', topN: c.topN || 0,
    pricePerPeg: c.pricePerPeg ?? null,
    prizes: c.prizes || [], activePondIds: [...(c.activePondIds || [])].sort(), pondSeats: c.pondSeats || {},
  }) : '';
  const settingsDirty = JSON.stringify(settingsEdit) !== JSON.stringify(settings);
  const prizeSource = competitionsForCms.find(c => c.id === prizesCompId);
  const prizesDirty = page === 'prizes' && !!prizeSource
    && JSON.stringify(prizeSource.prizes || []) !== JSON.stringify(compEdit.prizes || []);
  const pageDirty =
    ((page === 'contact-settings' || page === 'landing-content' || page === 'seo') && settingsDirty)
    || prizesDirty;
  const guardLeave = (proceed: () => void) => {
    if (!pageDirty) { proceed(); return; }
    setConfirmDialog({
      title: 'Perubahan belum disimpan',
      message: 'Anda ada perubahan yang belum disimpan di halaman ini. Tinggalkan tanpa simpan?\n\nYou have unsaved changes here. Leave without saving?',
      confirmLabel: 'Tinggalkan / Leave',
      tone: 'danger',
      onConfirm: () => {
        setSettingsEdit(settings);
        if (prizeSource) setCompEdit({ ...prizeSource });
        proceed();
      },
    });
  };
  const guardedSetPage = (next: CMSPage) => { if (next !== page) guardLeave(() => setPage(next)); };
  const guardedClose = () => guardLeave(() => onClose());

  // Competition Manage editor unsaved guard.
  const competitionEditorSource = competitionsForCms.find(c => c.id === compEdit.id);
  const competitionEditorDirty = competitionEditorOpen && (compEditIsNew
    ? (!!compEdit.name?.trim() || (compEdit.activePondIds?.length ?? 0) > 0)
    : (!!competitionEditorSource && compSig(competitionEditorSource) !== compSig(compEdit)));
  const closeCompetitionEditor = () => {
    const doClose = () => { setCompetitionEditorOpen(false); setCompEditIsNew(false); };
    if (!competitionEditorDirty) { doClose(); return; }
    setConfirmDialog({
      title: 'Perubahan belum disimpan',
      message: 'Tetapan pertandingan belum disimpan. Tutup tanpa simpan?\n\nCompetition settings are unsaved. Close without saving?',
      confirmLabel: 'Tutup / Close',
      tone: 'danger',
      onConfirm: doClose,
    });
  };

  const adminNavSections = [
    { label: 'Utama', items: [
      { id: 'dashboard' as CMSPage, icon: '📊', text: 'Dashboard' },
      { id: 'instructions' as CMSPage, icon: '📖', text: 'Arahan' },
    ] },
    { label: 'Pengurusan', items: [
      { id: 'competitions' as CMSPage, icon: '🏆', text: 'Pertandingan' },
      { id: 'ponds' as CMSPage, icon: '🏊', text: 'Kolam' },
      { id: 'prizes' as CMSPage, icon: '🥇', text: 'Hadiah & Ranking' },
    ]},
    { label: 'Tempahan', items: [
      { id: 'approvals' as CMSPage, icon: '✅', text: 'Kelulusan', badge: pendingCount },
      { id: 'all-bookings' as CMSPage, icon: '📋', text: 'Semua Tempahan' },
      { id: 'manual-booking' as CMSPage, icon: '➕', text: 'Tempahan Manual' },
    ]},
    { label: 'Hari Pertandingan', items: [
      { id: 'checkin' as CMSPage, icon: '📲', text: 'Check-In' },
      { id: 'results' as CMSPage, icon: '⚖️', text: 'Keputusan & Live' },
      { id: 'all-weigh-ins' as CMSPage, icon: '📜', text: 'Semua Timbangan' },
    ]},
    { label: 'Admin', items: [
      { id: 'landing-content' as CMSPage, icon: '🏡', text: 'Laman Utama' },
      { id: 'seo' as CMSPage, icon: '🔍', text: 'SEO' },
      { id: 'contact-settings' as CMSPage, icon: '☎️', text: 'Contact Us' },
      { id: 'users' as CMSPage, icon: '👥', text: 'Pengguna' },
      { id: 'audit-log' as CMSPage, icon: '🗒️', text: 'Log Audit' },
    ] },
  ];
  const navSections = isAdmin ? adminNavSections : [
    { label: 'Hari Pertandingan', items: adminNavSections.flatMap((section) => section.items).filter((item) => ['checkin', 'results', 'all-weigh-ins'].includes(item.id)) },
    { label: 'Rujukan', items: adminNavSections.flatMap((section) => section.items).filter((item) => item.id === 'users') },
  ];

  const pageTitle = navSections.flatMap(s => s.items).find(i => i.id === page)?.text || 'Dashboard';

  // Seat list for a booking, using the pond's alphabet code (e.g. "A-1, A-23").
  const bookingSeatList = (b: Booking) => {
    const selections = b.pondSelections?.length ? b.pondSelections : [{ pondId: b.pondId, pondCode: b.pondCode, seats: b.seats }];
    return selections.map((selection) => formatSeatList(
      selection.pondCode || ponds.find((pond) => pond.id === selection.pondId)?.code,
      selection.seats,
    )).filter(Boolean).join(', ');
  };
  const bookingPondList = (b: Booking) => b.pondSelections?.length
    ? Array.from(new Set(b.pondSelections.map((selection) => selection.pondName))).join(', ')
    : b.pondName;

  // Clickable, sortable <th> — used by Kelulusan/Semua Tempahan. Clicking
  // toggles asc/desc on the same field, or switches field (defaulting desc).
  const sortableTh = (
    label: string,
    field: string,
    activeField: string,
    dir: 'asc' | 'desc',
    onSort: (field: string) => void,
    style?: React.CSSProperties,
  ) => (
    <th style={{ cursor: 'pointer', userSelect: 'none', ...style }} onClick={() => onSort(field)}>
      {label}{activeField === field && (dir === 'asc' ? ' ▲' : ' ▼')}
    </th>
  );

  return (
    <div className="cms-page cms-v5" style={{ position: 'fixed', inset: 0, zIndex: 500 }}>
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
                  onClick={() => { guardedSetPage(item.id); setSidebarOpen(false); }}>
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
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                guardedClose();
              }}
              style={{ fontSize: '0.85rem', color: 'var(--gold)', cursor: 'pointer', fontWeight: 600 }}
            >
              🌐 Laman Web
            </a>
          </div>
        </div>

        <div className="cms-content">
          {page === 'instructions' && (
            <AdminInstructions onNavigate={guardedSetPage} />
          )}
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
                        <thead><tr><th>Ref</th><th>Pertandingan</th><th>Nama</th><th>Jumlah</th><th>Status</th></tr></thead>
                        <tbody>
                          {bookings.slice(0, 5).map(b => (
                            <tr key={b.id}>
                              <td className="td-ref">{b.bookingRef || b.id.slice(0, 10)}</td>
                              <td>{b.competitionName || comp.name || '-'}</td>
                              <td className="td-name">{b.userName}</td>
                              <td>RM {b.amount}</td>
                              <td>
                                <span className={`badge badge-${b.status === 'confirmed' ? 'approved' : b.status}`}>
                                  {b.status === 'confirmed' ? 'Disahkan' : b.status === 'rejected' ? 'Dibatalkan' : 'Menunggu Semakan'}
                                </span>
                              </td>
                            </tr>
                          ))}
                          {bookings.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Tiada tempahan</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="card-header"><div className="card-title">Pertandingan Aktif</div></div>
                  <div className="card-body">
                    {dashboardCompetitions.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {dashboardCompetitions.map((competition) => {
                          const status = getCompetitionStatusMeta(competition);
                          return (
                            <div key={competition.id || competition.name} style={{ padding: '1rem', background: 'var(--cream)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                                {getCompetitionPhase(competition) === 'live' && <span className="live-dot"></span>}
                                <strong>{competition.name}</strong>
                                <span className={`badge ${status.badgeClass}`}>{status.label}</span>
                              </div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                📅 {formatDate(competition.startDate, { time: true })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Tiada pertandingan aktif atau akan datang</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {page === 'competitions' && (() => {
            const pondKeyOf = (p: Pond) => p._docId || p.id.toString();
            const pondNames = (c: Competition) => {
              const ids = c.activePondIds || [];
              if (!ids.length) return 'Semua kolam';
              const names = ponds.filter(p => ids.includes(pondKeyOf(p))).map(p => pondDisplayName(p));
              return names.length ? names.join(', ') : 'Semua kolam';
            };
            const fmtDateTime = (iso?: string) => formatDate(iso, { time: true }) || '-';
            const statAktif = competitionsForCms.filter(c => getCompetitionCmsStatus(c, nowTick) === 'active').length;
            const statJualan = competitionsForCms.filter(c => isBookingOpen(c, nowTick) && !isCompetitionEnded(c, nowTick)).length;
            const statTamat = competitionsForCms.filter(c => isCompetitionEnded(c, nowTick)).length;
            const toggleCreatePond = (key: string) => setCompCreate(s => ({ ...s, activePondIds: s.activePondIds.includes(key) ? s.activePondIds.filter(k => k !== key) : [...s.activePondIds, key] }));
            const allPondsSelected = ponds.length > 0 && ponds.every((pond) => compCreate.activePondIds.includes(pondKeyOf(pond)));
            const toggleAllCreatePonds = () => setCompCreate((current) => ({
              ...current,
              activePondIds: allPondsSelected ? [] : ponds.map(pondKeyOf),
            }));
            const compCreateComplete = Boolean(
              compCreate.name.trim()
              && compCreate.startDateTime
              && compCreate.endDateTime
              && compCreate.bookingOpenAt
              && compCreate.bookingCloseAt
              && Number.isFinite(compCreate.pricePerPeg)
              && compCreate.pricePerPeg > 0
              && Number.isFinite(compCreate.topN)
              && compCreate.topN > 0
              && compCreate.activePondIds.length > 0
            );
            return (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Pertandingan</div><div className="page-sub">Tambah dan urus pertandingan</div></div></div>

              <div className="stats-grid">
                <div className="stat-card stat-accent"><div className="stat-label">Pertandingan Aktif</div><div className="stat-value">{statAktif}</div><div className="stat-change">Dipapar di website</div></div>
                <div className="stat-card stat-accent"><div className="stat-label">Tempahan Dibuka</div><div className="stat-value">{statJualan}</div><div className="stat-change">Tempahan buka</div></div>
                <div className="stat-card stat-accent"><div className="stat-label">Tamat</div><div className="stat-value">{statTamat}</div><div className="stat-change">Pertandingan selesai</div></div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header"><div className="card-title">Tambah Pertandingan</div><button className="btn btn-primary" onClick={handleSaveNewCompetition} disabled={saving || !compCreateComplete}>{saving ? 'Menyimpan...' : 'Simpan Pertandingan'}</button></div>
                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                    <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={compCreate.name} onChange={e => setCompCreate({ ...compCreate, name: e.target.value })} placeholder="Contoh: Pertandingan Apex" /></div>
                    <div className="form-group"><label className="form-label">Tarikh &amp; Masa Mula</label><div className="date-input-wrap" onClick={openDatePicker}><input className="form-input" type="datetime-local" value={compCreate.startDateTime} onChange={e => setCompCreate({ ...compCreate, startDateTime: e.target.value })} /><span className="date-picker-btn" aria-hidden="true">📅</span></div></div>
                    <div className="form-group">
                      <label className="form-label">Tarikh &amp; Masa Tamat</label>
                      <div className="date-input-wrap" onClick={openDatePicker}><input className="form-input" type="datetime-local" value={compCreate.endDateTime} onChange={e => setCompCreate({ ...compCreate, endDateTime: e.target.value })} /><span className="date-picker-btn" aria-hidden="true">📅</span></div>
                    </div>
                    <div className="form-group"><label className="form-label">Tarikh &amp; Masa Buka Tempahan</label><div className="date-input-wrap" onClick={openDatePicker}><input className="form-input" type="datetime-local" value={compCreate.bookingOpenAt} onChange={e => setCompCreate({ ...compCreate, bookingOpenAt: e.target.value })} /><span className="date-picker-btn" aria-hidden="true">📅</span></div></div>
                    <div className="form-group"><label className="form-label">Tarikh &amp; Masa Tutup Tempahan</label><div className="date-input-wrap" onClick={openDatePicker}><input className="form-input" type="datetime-local" value={compCreate.bookingCloseAt} onChange={e => setCompCreate({ ...compCreate, bookingCloseAt: e.target.value })} /><span className="date-picker-btn" aria-hidden="true">📅</span></div></div>
                    <div className="form-group"><label className="form-label">Harga Pancang (RM)</label><input className="form-input" type="number" min="1" value={compCreate.pricePerPeg} onChange={e => setCompCreate({ ...compCreate, pricePerPeg: Number(e.target.value) })} /></div>
                    <div className="form-group"><label className="form-label">Jumlah Kedudukan Dipaparkan</label><input className="form-input" type="number" min="1" value={compCreate.topN} onChange={e => setCompCreate({ ...compCreate, topN: Number(e.target.value) })} /></div>
                  </div>
                  <div className="form-group" style={{ marginTop: 14 }}>
                    <label className="form-label">Kolam Terbuka</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                      {ponds.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Tiada kolam. Tambah kolam dahulu di tab Kolam.</span>}
                      {ponds.length > 0 && (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontWeight: 800 }}>
                          <input type="checkbox" checked={allPondsSelected} onChange={toggleAllCreatePonds} style={{ accentColor: 'var(--green)' }} />
                          Pilih Semua
                        </label>
                      )}
                      {ponds.map(pond => {
                        const key = pondKeyOf(pond);
                        const checked = compCreate.activePondIds.includes(key);
                        return (
                          <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
                            <input type="checkbox" checked={checked} onChange={() => toggleCreatePond(key)} style={{ accentColor: 'var(--green)' }} />
                            {pond.code && <span className="cms-pond-code">{pond.code}</span>} {pondDisplayName(pond)}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>Semua medan wajib diisi dan sekurang-kurangnya satu Kolam Terbuka mesti dipilih. Status pertandingan ditentukan secara automatik mengikut tarikh.</p>
                </div>
              </div>

              <div className="card">
                <div className="card-header"><div className="card-title">Senarai Pertandingan</div></div>
                <div className="card-body"><div className="table-wrap"><table>
                  <thead><tr><th>Nama Pertandingan</th><th>Tarikh &amp; Masa Mula</th><th>Tarikh &amp; Masa Tamat</th><th>Tarikh &amp; Masa Buka Tempahan</th><th>Tarikh &amp; Masa Tutup Tempahan</th><th>Kolam Terbuka</th><th>Harga Pancang</th><th>Status</th><th>Tindakan</th></tr></thead>
                  <tbody>
                    {sortCompetitionsLatestFirst(competitionsForCms).map((competition) => (
                      <tr key={competition.id || competition.name}>
                        <td className="td-name">{competition.name}</td>
                        <td>{fmtDateTime(competition.startDate)}</td>
                        <td>{fmtDateTime(competition.endDate)}</td>
                        <td>{fmtDateTime(competition.bookingOpenAt)}</td>
                        <td>{fmtDateTime(competition.bookingCloseAt)}</td>
                        <td>{pondNames(competition)}</td>
                        <td>{competition.pricePerPeg != null ? `RM ${competition.pricePerPeg}` : '-'}</td>
                        <td>{(() => { const meta = getCompetitionCmsStatusMeta(competition, nowTick); return <span className={`badge ${meta.badgeClass}`}>{meta.label}</span>; })()}</td>
                        <td>
                          <button className="btn btn-sm btn-ghost" onClick={() => { setCompEditIsNew(false); setCompEdit({ ...competition }); setCompetitionEditorOpen(true); }}>Urus</button>
                        </td>
                      </tr>
                    ))}
                    {competitionsForCms.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada pertandingan lagi.</td></tr>}
                  </tbody>
                </table></div></div>
              </div>
            </div>
            );
          })()}
          {page === 'ponds' && (
            <div className="page active">
              <div className="page-header">
                <div><div className="page-title">Kolam</div><div className="page-sub">Urus kolam dan pancang</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button className="btn btn-primary" onClick={openCreatePondModal}>+ Tambah Kolam</button>
                </div>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                Guna anak panah ▲▼ untuk laraskan susunan kolam (tertib dipaparkan di halaman tempahan).
              </div>
              <div className="three-col">
                {ponds.map((pond, pondIdx) => {
                  const pondKey = pond._docId || pond.id.toString();
                  return (
                    <div key={pondKey} className="card">
                      <div className="card-header">
                        <div className="card-title">{pondDisplayName(pond)}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button className="btn btn-sm btn-ghost" title="Naik" disabled={pondIdx === 0 || pondReordering} onClick={() => handleMovePond(pond, 'up')} style={{ padding: '2px 8px' }}>▲</button>
                          <button className="btn btn-sm btn-ghost" title="Turun" disabled={pondIdx === ponds.length - 1 || pondReordering} onClick={() => handleMovePond(pond, 'down')} style={{ padding: '2px 8px' }}>▼</button>
                        </div>
                      </div>
                      <div className="card-body">
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Jumlah Pancang: <strong>{pond.seats.length}</strong></div>
                        <button className="btn btn-sm btn-ghost" style={{ width: '100%', marginTop: '0.75rem' }} onClick={() => setEditingPond(pond)}>Edit</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pond arrangement overview image */}
              <div className="card" style={{ marginTop: '24px' }}>
                <div className="card-header">
                  <div className="card-title">Peta Kolam</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Dipaparkan kepada pengguna semasa membuat tempahan</div>
                </div>
                <div className="card-body">
                  {settingsEdit.pondMapImg ? (
                    <div style={{ marginBottom: '16px' }}>
                      <img
                        src={settingsEdit.pondMapImg}
                        alt="Peta kolam"
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
          {page === 'prizes' && (() => {
            const prizes: Prize[] = compEdit.prizes || [];
            // Overlap detection across ranges (for the audit coverage column).
            const overlap = new Set<number>();
            const ranges = prizes.map((p) => prizeRange(p));
            for (let a = 0; a < ranges.length; a++) {
              for (let b = a + 1; b < ranges.length; b++) {
                if (ranges[a][0] <= ranges[b][1] && ranges[b][0] <= ranges[a][1]) { overlap.add(a); overlap.add(b); }
              }
            }
            const setPrizes = (next: Prize[]) => setCompEdit({ ...compEdit, prizes: next });
            const updatePrize = (i: number, patch: Partial<Prize>) => {
              const next = [...prizes];
              next[i] = { ...next[i], ...patch };
              setPrizes(next);
            };
            const addRange = () => {
              const maxTo = prizes.reduce((m, p) => Math.max(m, prizeRange(p)[1]), 0);
              const from = maxTo + 1;
              setPrizes([...prizes, { rank: from, rankFrom: from, rankTo: from, label: 'Hadiah ' + from, prize: '' }]);
            };
            // Sources to duplicate a full prize table FROM: any other non-ended
            // competition that already has prizes set up.
            const duplicateSources = compsNotEnded.filter(c => (c.id || '') !== prizesCompId && (c.prizes || []).length > 0);
            const duplicateFromCompetition = (srcId: string) => {
              const src = compsNotEnded.find(c => (c.id || '') === srcId);
              if (!src) return;
              setPrizes((src.prizes || []).map(p => ({ ...p })));
            };
            return (
            <div className="page active">
              <div className="page-header">
                <div>
                  <div className="page-title">Hadiah &amp; Ranking</div>
                  <div className="page-sub">Pilih game dahulu, kemudian set hadiah ikut julat ranking. Ranking pemenang dikira ikut seat no.</div>
                </div>
              </div>

              {/* Competition selector */}
              <div className="card" style={{ marginBottom: '16px' }}>
                <div className="card-body" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <label style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Pilih Game:</label>
                    <select
                      className="form-input"
                      style={{ maxWidth: '360px', flex: 1 }}
                      value={prizesCompId}
                      onChange={e => setPrizesCompId(e.target.value)}
                    >
                      {compsNotEnded.map(c => (
                        <option key={c.id || c.name} value={c.id || ''}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {compEdit.startDate && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        📅 {formatDate(compEdit.startDate)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Prize tiers (ranges) */}
              <div className="card" style={{ marginBottom: '16px' }}>
                <div className="card-header">
                  <div>
                    <div className="card-title">Tetapan Prize Tiers — {compEdit.name || '—'}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Set satu hadiah untuk satu rank atau satu julat rank seperti 11 hingga 20.</div>
                  </div>
                  {prizesEditMode ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => {
                        const target = compList.find(c => c.id === prizesCompId) || compList[0];
                        if (target) setCompEdit({ ...target });
                        setPrizesEditMode(false);
                      }}>Batal</button>
                      <select
                        className="btn btn-sm btn-ghost"
                        style={{ maxWidth: 220 }}
                        value=""
                        disabled={duplicateSources.length === 0}
                        title={duplicateSources.length === 0 ? 'Tiada pertandingan lain dengan hadiah untuk diduplikasi' : 'Duplikasi hadiah dari pertandingan lain'}
                        onChange={e => { if (e.target.value) duplicateFromCompetition(e.target.value); }}
                      >
                        <option value="">Duplicate Previous...</option>
                        {duplicateSources.map(c => (
                          <option key={c.id || c.name} value={c.id || ''}>{c.name}</option>
                        ))}
                      </select>
                      <button className="btn btn-sm btn-primary" onClick={addRange}>+ Add Range</button>
                    </div>
                  ) : (
                    <button className="btn btn-sm btn-primary" onClick={() => setPrizesEditMode(true)}>Edit</button>
                  )}
                </div>
                <div className="card-body">
                  <div className="cms-prize-list">
                    {prizes.map((p: Prize, i: number) => {
                      const [from, to] = prizeRange(p);
                      return (
                        <div key={i} className="cms-prize-row">
                          {prizesEditMode ? (
                            <>
                              <input className="form-input cms-rank-input" type="number" min={1} value={p.rankFrom ?? p.rank}
                                onChange={e => { const v = parseInt(e.target.value) || 0; updatePrize(i, { rankFrom: v, rank: v }); }} title="Rank dari" />
                              <span className="cms-rank-sep">–</span>
                              <input className="form-input cms-rank-input" type="number" min={1} value={p.rankTo ?? p.rank}
                                onChange={e => updatePrize(i, { rankTo: parseInt(e.target.value) || 0 })} title="Rank hingga" />
                              <input className="form-input" value={p.label || ''} placeholder="Label (cth: Juara)"
                                onChange={e => updatePrize(i, { label: e.target.value })} />
                              <input className="form-input" value={p.prize} placeholder="Hadiah (cth: RM 5,000)"
                                onChange={e => updatePrize(i, { prize: e.target.value })} />
                              <button className="prize-del" title="Buang" onClick={() => setPrizes(prizes.filter((_, idx) => idx !== i))}>✕</button>
                            </>
                          ) : (
                            <>
                              <span className="cms-rank-chip">{from}</span>
                              <span className="cms-rank-chip">{to}</span>
                              <div className="cms-prize-meta">
                                <strong>{p.label || '-'}</strong>
                                <span className="subtext">{p.prize || '-'}{to > from ? ' setiap pemenang' : ''}</span>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                    {prizes.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Tiada hadiah ditambah untuk pertandingan ini</div>
                    )}
                  </div>
                  {prizesEditMode && (
                    <div className="form-actions" style={{ marginTop: '1rem' }}>
                      <button className="btn btn-primary" disabled={saving} onClick={async () => { await handlePrizeSave(); setPrizesEditMode(false); }}>
                        {saving ? 'Menyimpan...' : 'Simpan'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Audit prize structure */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">Audit Prize Structure</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Jadual ini bantu staff semak jika ada julat bertindih atau tertinggal.</div>
                  </div>
                </div>
                <div className="card-body"><div className="table-wrap"><table>
                  <thead><tr><th>Rank From</th><th>Rank To</th><th>Label</th><th>Prize Amount</th><th>Coverage</th></tr></thead>
                  <tbody>
                    {prizes.map((p: Prize, i: number) => {
                      const [from, to] = prizeRange(p);
                      const invalid = from < 1 || to < from;
                      const winners = to - from + 1;
                      let badge = <span className="badge badge-open">Valid</span>;
                      if (invalid) badge = <span className="badge badge-live">Julat tidak sah</span>;
                      else if (overlap.has(i)) badge = <span className="badge badge-live">Bertindih</span>;
                      else if (winners > 1) badge = <span className="badge badge-deposit">{winners} pemenang</span>;
                      return (
                        <tr key={i}>
                          <td>{from}</td>
                          <td>{to}</td>
                          <td>{p.label || '-'}</td>
                          <td>{p.prize || '-'}</td>
                          <td>{badge}</td>
                        </tr>
                      );
                    })}
                    {prizes.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>Tiada julat hadiah</td></tr>}
                  </tbody>
                </table></div></div>
              </div>
            </div>
            );
          })()}
          {page === 'approvals' && (() => {
            const aq = approvalSearch.trim().toLowerCase();
            // Server query only scopes status===pending; competition/payment
            // filters and search narrow the currently-loaded page client-side.
            const filteredEntries = kelulusanEntries
              .filter((b) => !approvalCompFilter || (b.competitionId || '') === approvalCompFilter)
              .filter((b) => !approvalPayFilter || (approvalPayFilter === 'deposit' ? b.paymentType === 'deposit' : b.paymentType !== 'deposit'))
              .filter((b) => {
                if (!aq) return true;
                const hay = [b.id, b.bookingRef, b.userName, b.userEmail, b.userPhone, b.bookingPhone, b.pondName, b.competitionName].filter(Boolean).join(' ').toLowerCase();
                return hay.includes(aq);
              });
            return (
            <div className="page active">
              <div className="page-header">
                <div>
                  <div className="page-title">Kelulusan Tempahan</div>
                  <div className="page-sub">Semakan tempahan baru &amp; pembayaran pertama — belum dibuat keputusan</div>
                </div>
              </div>

              {kelulusanError && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: 'var(--red, #c0152a)', fontSize: '0.85rem' }}>
                  ⚠ {kelulusanError}
                </div>
              )}

              <div className="cms-notice-bar">
                <div>
                  <h4>Peranan halaman ini</h4>
                  <p>Halaman ini memaparkan tempahan yang <strong>belum dibuat sebarang keputusan</strong>. Sebaik sahaja resit pertama disahkan/ditolak, tempahan berpindah ke <strong>Semua Tempahan</strong>.</p>
                </div>
              </div>

              <div className="cms-filter-row">
                <div className="field"><label>Carian</label><input className="form-input" type="search" placeholder="Ref, nama, no resit..." value={approvalSearch} onChange={e => setApprovalSearch(e.target.value)} /></div>
                <div className="field"><label>Pertandingan</label><select className="form-input" value={approvalCompFilter} onChange={e => setApprovalCompFilter(e.target.value)}><option value="">Semua pertandingan</option>{competitions.map(c => <option key={c.id || c.name} value={c.id || ''}>{c.name}</option>)}</select></div>
                <div className="field"><label>Bayaran</label><select className="form-input" value={approvalPayFilter} onChange={e => setApprovalPayFilter(e.target.value as any)}><option value="">Semua bayaran</option><option value="deposit">Deposit</option><option value="full">Full</option></select></div>
                <div className="cms-filter-actions"><button className="btn btn-ghost btn-sm" onClick={() => { setApprovalSearch(''); setApprovalCompFilter(''); setApprovalPayFilter(''); }}>Reset</button></div>
              </div>

              <div className="card"><div className="card-body"><div className="table-wrap"><table>
                <thead><tr>
                  <th>Ref</th>
                  {sortableTh('Tarikh Tempahan', 'createdAt', approvalSortField, approvalsSortOrder, handleKelulusanSort)}
                  <th>Pertandingan</th>
                  {sortableTh('Nama', 'userName', approvalSortField, approvalsSortOrder, handleKelulusanSort)}
                  <th>No. Telefon</th>
                  <th>Kolam</th>
                  <th>Pegs</th>
                  {sortableTh('Dibayar / Jumlah', 'totalAmount', approvalSortField, approvalsSortOrder, handleKelulusanSort)}
                  <th>Bayaran</th>
                  <th>Tindakan</th>
                </tr></thead>
                <tbody>
                  {kelulusanLoading && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Memuat...</td></tr>}
                  {!kelulusanLoading && filteredEntries.map((b) => {
                    const total = b.totalAmount ?? b.amount;
                    const paid = b.paidAmount ?? 0;
                    const balance = b.balanceDue ?? Math.max(0, total - paid);
                    return (
                    <tr key={b.id}>
                      <td className="td-ref">{b.bookingRef || b.id.slice(0, 10)}</td>
                      <td style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{b.createdAt ? formatDate(b.createdAt, { time: true }) : '-'}</td>
                      <td>{b.competitionName || comp.name || '-'}</td>
                      <td className="td-name">
                        {b.userName}
                        {b.createdByStaff && <span style={{ marginLeft: 5, fontSize: '0.68rem', background: 'rgba(250,204,21,0.18)', color: 'var(--gold)', border: '1px solid rgba(250,204,21,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: '0.5px' }}>(Ditempah oleh Admin)</span>}
                      </td>
                      <td>
                        {b.userPhone || '—'}
                        {b.bookingPhone && b.bookingPhone !== b.userPhone && (
                          <div style={{ fontSize: '0.7rem', color: '#b45309', marginTop: '2px' }} title="Nombor telefon dimasukkan untuk tempahan ini">📱 {b.bookingPhone}</div>
                        )}
                      </td>
                      <td>{bookingPondList(b)}</td>
                      <td>{bookingSeatList(b)}{hasConflict(b) && <span title="Tempat ini juga dituntut oleh tempahan lain" style={{ marginLeft: 4, color: '#f59e0b', fontSize: '0.8rem', cursor: 'help' }}>⚠</span>}</td>
                      <td>
                        RM {paid} / {total}
                        {balance > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--red)', fontWeight: 700 }}>Baki RM {balance}</div>}
                      </td>
                      <td><span className={`badge ${b.paymentType === 'deposit' ? 'badge-deposit' : 'badge-paid'}`}>{b.paymentType === 'deposit' ? 'Deposit' : b.paymentType === 'baki' ? 'Baki' : 'Penuh'}</span></td>
                      <td>
                        <div className="action-cell">
                          <button className="btn btn-sm btn-primary" onClick={() => setReviewTarget(b)}>Review</button>
                          {(b.staffRemarks?.length ?? 0) > 0 && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>📝 {b.staffRemarks!.length}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {!kelulusanLoading && filteredEntries.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada tempahan menunggu keputusan</td></tr>}
                </tbody>
              </table></div></div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 4px 4px' }}>
                <button className="btn btn-sm btn-ghost" disabled={kelulusanPage === 0} onClick={handleKelulusanPrev}>← Sebelum</button>
                <button className="btn btn-sm btn-ghost" disabled={!kelulusanHasMore} onClick={handleKelulusanNext}>Seterus →</button>
              </div>
              </div>
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
          {page === 'all-bookings' && (() => {
            const q = bookingSearch.trim().toLowerCase();
            // Server query scopes status confirmed/rejected + the selected
            // balance bucket; competition/payment/pond filters and search
            // narrow the currently-loaded page client-side.
            const filteredEntries = allEntries
              .filter(b => !allCompFilter || (b.competitionId || '') === allCompFilter)
              .filter(b => !allPayFilter || (allPayFilter === 'deposit' ? b.paymentType === 'deposit' : b.paymentType !== 'deposit'))
              .filter(b => !allPondFilter || ((ponds.find(p => p.id === b.pondId)?.code || '').toUpperCase() === allPondFilter.toUpperCase()))
              .filter(b => {
                if (!q) return true;
                const haystack = [
                  b.id, b.bookingRef, b.userName, b.userId, b.userEmail, b.userPhone, b.bookingPhone,
                  b.pondName, b.competitionName, bookingSeatList(b),
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(q);
              });
            const pondCodes = Array.from(new Set(ponds.map(p => p.code).filter(Boolean))) as string[];
            const stageLabel: Record<string, string> = { 'review-balance': 'Menunggu Semak (Baki)', 'pending-balance': 'Baki Belum Dibayar', 'fully-paid': 'Selesai Bayar' };
            return (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Semua Tempahan</div><div className="page-sub">Tempahan yang telah dibuat keputusan — disahkan atau ditolak</div></div></div>

              {allError && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: 'var(--red, #c0152a)', fontSize: '0.85rem' }}>
                  ⚠ {allError}
                </div>
              )}

              <div className="cms-notice-bar">
                <div>
                  <h4>Peranan halaman ini</h4>
                  <p>Halaman ini memaparkan tempahan yang <strong>sudah dibuat keputusan</strong> (disahkan/ditolak). Susulan baki bayaran, peringatan e-mel dan Batal Paksa diuruskan di sini.</p>
                </div>
              </div>

              <div className="cms-queue-toolbar">
                <span className="cms-queue-counter">{filteredEntries.length} rekod dipaparkan</span>
                <div className="cms-queue-groups">
                  <div className="cms-filter-block">
                    <span className="cms-filter-label">Status</span>
                    <div className="cms-segmented">
                      {([['all','Semua'],['review-balance','Menunggu Semak (Baki)'],['pending-balance','Baki Belum Dibayar'],['fully-paid','Selesai Dibayar'],['cancelled','Dibatalkan']] as const).map(([v,label]) => (
                        <button key={v} type="button" className={`btn btn-pill ${allStatus === v ? 'active' : ''}`} onClick={() => setAllStatus(v)}>{label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="cms-filter-row">
                <div className="field"><label>Carian</label><input className="form-input" type="search" placeholder="Ref, nama, email, nombor seat..." value={bookingSearch} onChange={e => setBookingSearch(e.target.value)} /></div>
                <div className="field"><label>Pertandingan</label><select className="form-input" value={allCompFilter} onChange={e => setAllCompFilter(e.target.value)}><option value="">Semua pertandingan</option>{competitions.map(c => <option key={c.id || c.name} value={c.id || ''}>{c.name}</option>)}</select></div>
                <div className="field"><label>Bayaran</label><select className="form-input" value={allPayFilter} onChange={e => setAllPayFilter(e.target.value as any)}><option value="">Semua bayaran</option><option value="deposit">Deposit</option><option value="full">Full</option></select></div>
                <div className="field"><label>Kolam</label><select className="form-input" value={allPondFilter} onChange={e => setAllPondFilter(e.target.value)}><option value="">Semua kolam</option>{pondCodes.map(code => <option key={code} value={code}>Kolam {code}</option>)}</select></div>
                <div className="cms-filter-actions"><button className="btn btn-ghost btn-sm" onClick={() => { setAllStatus('all'); setBookingSearch(''); setAllCompFilter(''); setAllPayFilter(''); setAllPondFilter(''); }}>Reset</button></div>
              </div>

              <div className="card">
                <div className="card-body"><div className="table-wrap"><table>
                  <thead><tr>
                    <th>Ref</th>
                    {sortableTh('Tarikh Tempahan', 'createdAt', allSortField, allSortOrder, handleAllSort)}
                    <th>Pertandingan</th>
                    {sortableTh('Info Peserta', 'userName', allSortField, allSortOrder, handleAllSort)}
                    <th>No. Pancang</th>
                    {sortableTh('Jumlah Bayar', 'totalAmount', allSortField, allSortOrder, handleAllSort)}
                    <th>Status</th>
                    <th>Tindakan</th>
                  </tr></thead>
                  <tbody>
                    {allLoading && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Memuat...</td></tr>}
                    {!allLoading && filteredEntries.map(b => (
                      <tr key={b.id}>
                        <td className="td-ref">{b.bookingRef || b.id.slice(0, 10)}</td>
                        <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{b.createdAt ? formatDate(b.createdAt, { time: true }) : '-'}</td>
                        <td>{b.competitionName || comp.name || '-'}</td>
                        <td className="td-name">
                          {b.userName}
                          {b.createdByStaff && <span style={{ marginLeft: 5, fontSize: '0.68rem', background: 'rgba(250,204,21,0.18)', color: 'var(--gold)', border: '1px solid rgba(250,204,21,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: '0.5px' }}>(Ditempah oleh Admin)</span>}
                          {/* Participant email — for admin-proxy bookings userEmail/userId already
                              hold the participant's address, not the admin's, so this is correct. */}
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px', fontWeight: 400 }}>{b.userEmail || b.userId || '-'}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px', fontWeight: 400 }}>{b.userPhone || '—'}</div>
                          {b.bookingPhone && b.bookingPhone !== b.userPhone && (
                            <div style={{ fontSize: '0.7rem', color: '#b45309', marginTop: '2px' }} title="Nombor telefon dimasukkan untuk tempahan ini">📱 {b.bookingPhone}</div>
                          )}
                        </td>
                        <td>
                          <div>{bookingSeatList(b)}{hasConflict(b) && <span title="Pancang ini juga dituntut oleh tempahan lain" style={{ marginLeft: 4, color: '#f59e0b', fontSize: '0.8rem', cursor: 'help' }}>⚠</span>}</div>
                          {b.status === 'confirmed' && <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} onClick={() => setQrPreviewBooking(b)}>QR</button>}
                        </td>
                        <td>
                          RM {b.paidAmount ?? b.amount}{(b.totalAmount ?? b.amount) !== (b.paidAmount ?? b.amount) && <span style={{ color: 'var(--text-muted)' }}> / {b.totalAmount ?? b.amount}</span>}
                          {(b.balanceDue ?? 0) > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--red)', fontWeight: 700 }}>Baki RM {b.balanceDue}</div>}
                          {(b.receipts?.some(receipt => receipt.url) || b.receiptData) && (
                            <div style={{ display: 'block', marginTop: 6 }}>
                              <button className="btn btn-sm btn-ghost" onClick={() => setReceiptHistoryBooking(b)}>Receipt</button>
                            </div>
                          )}
                        </td>
                        <td>
                          {b.status === 'rejected'
                            ? <span className="badge badge-rejected">Dibatalkan</span>
                            : <span className={`badge badge-${deriveBalanceStage(b) === 'fully-paid' ? 'approved' : 'pending'}`}>{stageLabel[deriveBalanceStage(b)]}</span>}
                        </td>
                        <td>
                          <div className="action-cell">
                            <button className="btn btn-sm btn-primary" onClick={() => setReviewTarget(b)}>Semak</button>
                            {b.status === 'confirmed' && (<button className="btn btn-sm btn-danger" disabled={saving} title="Batal paksa tempahan disahkan" onClick={() => askForceCancel(b)}>Batal Paksa</button>)}
                            {(b.staffRemarks?.length ?? 0) > 0 && (<span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>📝 {b.staffRemarks!.length}</span>)}
                          </div>
                          {(() => {
                            const info = balanceReminderInfo(b, nowTick);
                            if (!info.awaitingBalance) return null;
                            const overdue = info.msUntilRemind <= 0;
                            return (
                              <div style={{ marginTop: 6, padding: '6px 8px', background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  ⏳ Deposit dihantar {info.daysSinceDeposit} hari lalu
                                </span>
                                <span style={{ fontSize: '0.7rem', color: overdue ? 'var(--red)' : 'var(--text-muted)', fontWeight: overdue ? 700 : 400 }}>
                                  📧 Auto-peringat {overdue ? 'tertunggak' : `dalam ${reminderLabel(info)}`}
                                </span>
                                <button className="btn btn-sm btn-ghost" disabled={saving} title="Hantar peringatan baki sekarang" style={{ alignSelf: 'flex-start' }} onClick={() => askSendReminder(b)}>Hantar Peringatan</button>
                              </div>
                            );
                          })()}
                          {Object.entries(b.emailDelivery || {}).map(([kind, delivery]) => {
                            const label = kind === 'booking_approved'
                              ? 'Pengesahan'
                              : kind === 'booking_received'
                                ? 'Diterima'
                                : kind === 'balance_reminder'
                                  ? 'Peringatan baki'
                                  : kind;
                            const delivered = delivery.state === 'SUCCESS' && delivery.recipientAccepted;
                            const failed = delivery.state === 'ERROR' || (delivery.state === 'SUCCESS' && !delivery.recipientAccepted);
                            return (
                              <div
                                key={kind}
                                title={delivery.error || `Percubaan: ${delivery.attempts}`}
                                style={{ marginTop: 4, fontSize: '0.68rem', color: delivered ? 'var(--green)' : failed ? 'var(--red)' : 'var(--text-muted)' }}
                              >
                                Email {label}: {delivered ? 'Dihantar' : failed ? 'Gagal' : delivery.state || 'Menunggu'}
                              </div>
                            );
                          })}
                        </td>
                      </tr>
                    ))}
                    {!allLoading && filteredEntries.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada tempahan sepadan</td></tr>}
                  </tbody>
                </table></div></div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 4px 4px' }}>
                  <button className="btn btn-sm btn-ghost" disabled={allPage === 0} onClick={handleAllPrev}>← Sebelum</button>
                  <button className="btn btn-sm btn-ghost" disabled={!allHasMore} onClick={handleAllNext}>Seterus →</button>
                </div>
              </div>
            </div>
            );
          })()}
          {page === 'checkin' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Check-In Peserta</div><div className="page-sub">Imbas QR tempahan untuk sahkan kehadiran</div></div></div>
              <div className="checkin-search">
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📲</div>
                <h3 style={{ marginBottom: '0.25rem' }}>Imbas QR Tempahan</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Imbas QR secara live dengan kamera, atau muat naik gambar QR tempahan.</p>
                <div style={{ margin: '0 auto 10px', maxWidth: 420, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)', background: '#0f172a', display: checkinLiveScanOn ? 'block' : 'none' }}>
                  <video ref={checkinLiveVideoRef} playsInline muted style={{ width: '100%', maxHeight: 260, objectFit: 'cover', display: 'block' }} />
                  <canvas ref={checkinLiveCanvasRef} style={{ display: 'none' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', color: '#fff', fontSize: 12 }}>
                    <span>Arahkan kamera ke QR tempahan</span>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.35)' }} onClick={stopCheckinLiveScan}>Tutup Kamera</button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" disabled={checkinLiveScanBusy || checkinLiveScanOn} onClick={startCheckinLiveScan}>
                    {checkinLiveScanBusy ? 'Membuka Kamera...' : (checkinLiveScanOn ? 'Kamera Aktif' : '🎥 Imbas QR Secara Live')}
                  </button>
                  <label className="btn btn-ghost" style={{ display: 'inline-flex', cursor: 'pointer' }}>
                    📷 Muat Naik QR
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleCheckinQrFile(f); e.target.value = ''; }} />
                  </label>
                </div>
                {checkinScannedRaw && !checkinResult && (
                  <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, color: 'var(--red, #c0152a)', marginBottom: 4 }}>⚠️ Tempahan tidak dijumpai</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>QR diimbas tetapi tidak sepadan dengan mana-mana tempahan.</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6, wordBreak: 'break-all', fontFamily: 'var(--fm, monospace)' }}>Kandungan QR: {checkinScannedRaw}</div>
                  </div>
                )}
              </div>
              {checkinResult && (() => {
                const allSeatEntries = bookingSeatEntries(checkinResult);
                const allDone = allSeatEntries.length > 0
                  && allSeatEntries.every((entry) => isBookingSeatCheckedIn(checkinResult, entry));
                return (
                  <div className="checkin-result">
                    <div className="checkin-result-header"><h3>✓ Tempahan Dijumpai</h3><span className={`badge badge-${checkinResult.status === 'confirmed' ? 'approved' : checkinResult.status}`}>{checkinResult.status}</span></div>
                    <div className="checkin-result-body">
                      <div className="checkin-detail-row"><span className="checkin-detail-key">Rujukan</span><span className="checkin-detail-val">{checkinResult.bookingRef || checkinResult.id}</span></div>
                      <div className="checkin-detail-row"><span className="checkin-detail-key">Nama</span><span className="checkin-detail-val">{checkinResult.userName}</span></div>
                      <div className="checkin-detail-row"><span className="checkin-detail-key">Kolam</span><span className="checkin-detail-val">{bookingPondList(checkinResult)}</span></div>
                      <div className="checkin-detail-row"><span className="checkin-detail-key">Tempat</span><span className="checkin-detail-val">{bookingSeatList(checkinResult)}</span></div>
                      <div className="checkin-detail-row"><span className="checkin-detail-key">Jumlah</span><span className="checkin-detail-val">RM {checkinResult.amount}</span></div>
                      {checkinResult.status !== 'confirmed' && <div className="warning-banner">⚠️ Tempahan ini belum disahkan.</div>}
                      {checkinResult.status === 'confirmed' && (
                        <div style={{ marginTop: 12 }}>
                          <div className="checkin-detail-key" style={{ marginBottom: 6 }}>Check-In Setiap Peg</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {allSeatEntries.map((entry) => {
                              const seatCheckedIn = isBookingSeatCheckedIn(checkinResult, entry);
                              const isScanned = checkinScannedSeat === entry.seatNum
                                && (checkinScannedPondId == null || checkinScannedPondId === entry.pondId);
                              const seatLabel = formatSeat(entry.pondCode, entry.seatNum);
                              return (
                                <div
                                  key={entry.key}
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                                    padding: '10px 12px', borderRadius: 8,
                                    border: isScanned ? '2px solid var(--gold)' : '1px solid var(--border)',
                                    background: seatCheckedIn ? 'var(--green-pale, #eafaf0)' : 'var(--white)',
                                  }}
                                >
                                  <span style={{ fontWeight: 700 }}>{entry.pondName} · {seatLabel}</span>
                                  {seatCheckedIn ? (
                                    <span style={{ color: 'var(--green-dark, #16a34a)', fontWeight: 700, fontSize: '0.85rem' }}>✓ Checked-in</span>
                                  ) : (
                                    <button
                                      className="btn btn-sm btn-green"
                                      disabled={checkinLoading}
                                      onClick={() => setConfirmDialog({
                                        title: 'Check-In Peserta',
                                        message: `Sahkan check-in untuk ${checkinResult.userName} (${pondDisplayName({ name: entry.pondName, code: entry.pondCode } as any)}, peg ${seatLabel})?`,
                                        confirmLabel: 'Check-In',
                                        tone: 'primary',
                                        onConfirm: () => handlePerformCheckin(entry),
                                      })}
                                    >
                                      {checkinLoading && checkinActiveSeat === entry.key ? '⏳ Memproses...' : 'Check-In'}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {allDone && (
                            <div className="btn btn-green w-full mt-3" style={{ textAlign: 'center', cursor: 'default', opacity: 0.8 }}>
                              ✓ Semua Peg Sudah Check-In
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div className="card" style={{ marginTop: 18 }}>
                <div className="card-header"><div className="card-title">Senarai Check in</div></div>
                <div className="card-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    <label className="form-label" style={{ margin: 0 }}>Pilih Pertandingan</label>
                    <select
                      className="form-input"
                      style={{ maxWidth: 360 }}
                      value={checkinCompetitionId}
                      onChange={(event) => setCheckinCompetitionId(event.target.value)}
                    >
                      {(competitions.length ? competitions : [comp]).map((competition) => (
                        <option key={competition.id || competition.name} value={competition.id || ''}>{competition.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Info Peserta</th><th>No. Pancang</th><th>Masa Check in</th><th>Status</th><th>Tindakan</th></tr></thead>
                      <tbody>
                        {bookings
                          .filter((booking) =>
                            booking.status === 'confirmed'
                            && (!checkinCompetitionId || (booking.competitionId || comp.id || '') === checkinCompetitionId))
                          .flatMap((booking) => bookingSeatEntries(booking).map((entry) => ({ booking, entry })))
                          .map(({ booking, entry }) => {
                            const checked = isBookingSeatCheckedIn(booking, entry);
                            const checkedAt = bookingSeatCheckInTime(booking, entry);
                            return (
                              <tr key={`${booking.id}-${entry.key}`}>
                                <td className="td-name">
                                  {booking.userName}
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{booking.userEmail || booking.userId || '-'}</div>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{booking.bookingPhone || booking.userPhone || '-'}</div>
                                </td>
                                <td>{formatSeat(entry.pondCode, entry.seatNum)}</td>
                                <td>{checkedAt ? formatDate(checkedAt, { time: true }) : '-'}</td>
                                <td><span className={`badge badge-${checked ? 'approved' : 'pending'}`}>{checked ? 'Checked in' : 'Pending'}</span></td>
                                <td>
                                  {checked
                                    ? (
                                      <button
                                        className="btn btn-sm btn-danger"
                                        disabled={checkinLoading}
                                        onClick={() => setConfirmDialog({
                                          title: 'Batalkan Check in',
                                          message: `Batalkan check in untuk ${booking.userName}, pancang ${formatSeat(entry.pondCode, entry.seatNum)}?`,
                                          confirmLabel: 'Batalkan Check in',
                                          tone: 'danger',
                                          onConfirm: () => handleCancelCheckin(booking, entry),
                                        })}
                                      >
                                        Batalkan Check in
                                      </button>
                                    )
                                    : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>-</span>}
                                </td>
                              </tr>
                            );
                          })}
                        {bookings.filter((booking) =>
                          booking.status === 'confirmed'
                          && (!checkinCompetitionId || (booking.competitionId || comp.id || '') === checkinCompetitionId)).length === 0 && (
                          <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 22 }}>Tiada peserta untuk pertandingan ini.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
          {page === 'results' && (() => {
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
                      onChange={(e) => { setResultsCompId(e.target.value); setScoreEntries([]); }}
                    >
                      {resultsCompsLiveFirst.map(c => (
                        <option key={c.id || c.name} value={c.id || ''} style={{ color: getCompetitionPhase(c) === 'ended' ? '#9aa3ad' : undefined }}>
                          {compOptionLabel(c)}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-sm" onClick={() => getScoresForCompetition(resultsCompId).then(setScoreEntries)}>🔄 Muat Semula</button>
                  </div>
                </div>

                {/* The scan flow identifies the participant, derives pond/peg, and saves. */}
                <div className="card" style={{ marginBottom: '16px' }}>
                  <div className="card-header"><div className="card-title">Tambah Rekod Manual</div></div>
                  <div className="card-body">
                      <div className="form-group">
                        <label className="form-label">Berat (kg)</label>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ width: '100%' }}
                          onClick={() => setScanOpen(true)}
                        >📷 Imbas Timbangan</button>
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
                            <th>Waktu</th>
                            <th>Peserta</th>
                            <th>Kolam</th>
                            <th>Peg</th>
                            <th style={{ textAlign: 'right' }}>Berat (kg)</th>
                            <th>Bukti</th>
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
                              <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.capturedAt, { time: true }) || '-'}</td>
                              <td className="td-name">{e.anglerName}</td>
                              <td>{e.pondName}</td>
                              <td>{e.seatNum}</td>
                              <td style={{ textAlign: 'right' }}>
                                <span className="w-cell">{formatWeight(e.weight, settings.ocrDecimalPlaces)}</span> kg
                              </td>
                              <td>
                                {e.photoUrl ? (
                                  <button className="btn btn-sm btn-ghost" onClick={() => setScorePhotoUrl(e.photoUrl!)}>👁 Bukti</button>
                                ) : '—'}
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
                            <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
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
          {page === 'all-weigh-ins' && (() => {
            const fmtDateTime = (iso?: string) => formatDate(iso, { time: true }) || '-';
            const compNameById = new Map(competitionsForCms.map((c) => [c.id || '', c.name]));
            const methodBadge = (m?: string) => {
              const meta = m === 'onnx' ? { label: 'ONNX (AI)', bg: '#374151' }
                : m === 'sevenseg' ? { label: 'Sandaran (tanpa AI)', bg: '#7c3aed' }
                : m === 'manual' ? { label: 'Manual', bg: '#b45309' }
                : null;
              if (!meta) return '—';
              return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: '#fff', background: meta.bg }}>{meta.label}</span>;
            };
            // Pond dropdown is sourced from the global ponds list (stable, complete)
            // rather than the current page's entries (which only cover what's loaded).
            const pondOptions = Array.from(new Set(ponds.map((p) => p.name).filter(Boolean))).sort();
            // Competition/pond are now server-side filters (see fetchWeighPage); only
            // the free-text angler search narrows the currently-loaded page.
            const anglerQ = allWeighAngler.trim().toLowerCase();
            const filtered = allWeighEntries.filter((e) => !anglerQ || e.anglerName.toLowerCase().includes(anglerQ));
            return (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Semua Timbangan Rekod</div><div className="page-sub">Sejarah timbangan merentas semua pertandingan</div></div></div>

              {allWeighError && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: 'var(--red, #c0152a)', fontSize: '0.85rem' }}>
                  ⚠ {allWeighError}
                </div>
              )}

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="form-group" style={{ minWidth: 200 }}>
                    <label className="form-label">Pertandingan</label>
                    <select className="form-input" value={allWeighCompId} onChange={(e) => setAllWeighCompId(e.target.value)}>
                      <option value="">— Semua Pertandingan —</option>
                      {compsEndedLast.map((c) => (
                        <option key={c.id || c.name} value={c.id || ''}>{compOptionLabel(c)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ minWidth: 160 }}>
                    <label className="form-label">Kolam</label>
                    <select className="form-input" value={allWeighPond} onChange={(e) => setAllWeighPond(e.target.value)}>
                      <option value="">— Semua Kolam —</option>
                      {pondOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="form-group" style={{ minWidth: 200, flex: 1 }}>
                    <label className="form-label">Peserta</label>
                    <input className="form-input" placeholder="Cari nama peserta…" value={allWeighAngler} onChange={(e) => setAllWeighAngler(e.target.value)} />
                  </div>
                  <button className="btn btn-sm" onClick={() => fetchWeighPage(allWeighCursors[allWeighPage] ?? null, allWeighPage)}>🔄 Muat Semula</button>
                </div>
              </div>

              <div className="card">
                <div className="card-header"><div className="card-title">{filtered.length} rekod</div></div>
                <div className="card-body"><div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Waktu</th>
                        <th>Peserta</th>
                        <th>Pertandingan</th>
                        <th>Kolam</th>
                        <th>Peg</th>
                        <th style={{ textAlign: 'right' }}>Berat (kg)</th>
                        <th>Kaedah</th>
                        <th>Bukti</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allWeighLoading && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Memuat...</td></tr>}
                      {!allWeighLoading && filtered.map((e) => (
                        <tr key={e.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.capturedAt)}</td>
                          <td className="td-name">{e.anglerName}</td>
                          <td>{compNameById.get(e.competitionId || '') || '—'}</td>
                          <td>{e.pondName}</td>
                          <td>{e.seatNum}</td>
                          <td style={{ textAlign: 'right' }}><span className="w-cell">{formatWeight(e.weight, settings.ocrDecimalPlaces)}</span> kg</td>
                          <td>{methodBadge(e.scanMethod)}</td>
                          <td>
                            {e.photoUrl ? (
                              <button className="btn btn-sm btn-ghost" onClick={() => setScorePhotoUrl(e.photoUrl!)}>👁 Bukti</button>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                      {!allWeighLoading && filtered.length === 0 && (
                        <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                          {allWeighEntries.length === 0 ? 'Tiada rekod timbangan lagi' : 'Tiada rekod sepadan dengan tapisan'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div></div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 4px 4px' }}>
                  <button className="btn btn-sm btn-ghost" disabled={allWeighPage === 0} onClick={handleWeighPrev}>← Sebelum</button>
                  <button className="btn btn-sm btn-ghost" disabled={!allWeighHasMore} onClick={handleWeighNext}>Seterus →</button>
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

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Maklumat Bank &amp; QR Pembayaran</div></div>
                <div className="card-body">
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
                    Dipaparkan kepada pelanggan di borang tempahan, antara jumlah bayaran dan muat naik resit.
                  </div>
                  <div className="form-grid">
                    <div className="form-group"><label className="form-label">Bank</label><input className="form-input" value={settingsEdit.qrBank || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, qrBank: e.target.value })} placeholder="Maybank / DuitNow" /></div>
                    <div className="form-group"><label className="form-label">Nama Akaun</label><input className="form-input" value={settingsEdit.qrName || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, qrName: e.target.value })} placeholder="Kolam Keli Sayang Sdn Bhd" /></div>
                    <div className="form-group form-span"><label className="form-label">Nombor Akaun</label><input className="form-input" value={settingsEdit.qrAccNo || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, qrAccNo: e.target.value })} placeholder="1234-5678-9012" /></div>
                  </div>
                  <div className="form-actions" style={{ marginTop: '12px' }}>
                    <button className="btn btn-primary" disabled={saving} onClick={handleContactSettingsSave}>{saving ? 'Menyimpan...' : 'Simpan Maklumat Bank'}</button>
                  </div>

                  <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--line, #e8edf2)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Gambar QR Kod Pembayaran (DuitNow/bank transfer)
                    </div>
                    {settingsEdit.qrImg && (
                      <img
                        src={settingsEdit.qrImg}
                        alt="QR Pembayaran"
                        style={{ width: 160, height: 160, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--line, #e8edf2)', marginBottom: 10, display: 'block' }}
                      />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <label
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '8px',
                          padding: '8px 16px', borderRadius: '8px', cursor: qrImgUploading ? 'not-allowed' : 'pointer',
                          background: 'var(--green)', color: '#fff', fontSize: '0.85rem', fontWeight: 600,
                          opacity: qrImgUploading ? 0.65 : 1,
                        }}
                      >
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          disabled={qrImgUploading}
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleQrImgUpload(f); e.target.value = ''; }}
                        />
                        {qrImgUploading ? 'Memuat naik...' : (settingsEdit.qrImg ? '🔄 Tukar Gambar' : '⬆ Muat Naik Gambar')}
                      </label>
                      {settingsEdit.qrImg && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={async () => {
                            setSettingsEdit(s => ({ ...s, qrImg: '' }));
                            await updateSettingsFirestore({ qrImg: '' });
                            await reloadDB();
                          }}
                        >Padam Gambar</button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {page === 'landing-content' && (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Laman Utama</div><div className="page-sub">Edit setiap seksyen halaman utama — teks, kad, imej dan pautan</div></div></div>

              {landingSaveError && (
                <div role="alert" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', color: '#b91c1c', borderRadius: '8px', padding: '11px 14px', marginBottom: '12px', fontSize: '13px', fontWeight: 600 }}>
                  {landingSaveError}
                </div>
              )}

              <div className="card">
                <div className="card-header"><div className="card-title">Hero</div></div>
                <div className="card-body">
                  {renderLandingSectionModeEditor('hero')}
                  {settingsEdit.landingSections.hero.mode === 'fields' && <div className="form-grid">
                    <div className="form-group"><label className="form-label">Kicker</label><input className="form-input" value={settingsEdit.heroKicker || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, heroKicker: e.target.value })} placeholder="Tempat Di Mana" /></div>
                    <div className="form-group"><label className="form-label">Tajuk Hero</label><textarea className="form-textarea" rows={2} value={settingsEdit.heroTitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, heroTitle: e.target.value })} placeholder="Juara Dilahirkan" /></div>
                    <div className="form-group form-span"><label className="form-label">Subtitle</label><textarea className="form-textarea" rows={3} value={settingsEdit.heroSubtitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, heroSubtitle: e.target.value })} placeholder="Kolam Keli Sayang - Port Terbaik di Kedah" /></div>
                    <div className="form-group form-span"><label className="form-label">Label Butang CTA</label><input className="form-input" value={settingsEdit.heroCtaLabel || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, heroCtaLabel: e.target.value })} placeholder="Book Slot Sekarang!" /></div>
                  </div>}
                </div>
              </div>

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Imej Laman Utama</div></div>
                <div className="card-body">
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '14px', lineHeight: 1.5 }}>
                    Muat naik imej untuk gantikan latar/logo lalai. Jika tiada imej dimuat naik, laman akan guna imej asal.
                  </div>
                  {([
                    ['logo', 'Logo (Navigasi)'],
                    ['footerLogo', 'Logo (Footer)'],
                    ['heroBg', 'Latar Belakang Hero'],
                    ['pondBg', 'Latar Belakang Kolam'],
                    ['bookingBg', 'Latar Belakang Cara Tempah'],
                  ] as [keyof typeof LANDING_ASSETS, string][]).map(([key, label]) => {
                    const hasCustom = !!settingsEdit.landingImages?.[key];
                    const uploading = !!landingImageUploading[key];
                    return (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                        <img
                          src={asset(key, settingsEdit)}
                          alt={label}
                          style={{ width: '96px', height: '64px', objectFit: 'cover', borderRadius: '6px', background: 'rgba(0,0,0,0.15)' }}
                        />
                        <div style={{ flex: 1, minWidth: '160px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{label}</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{hasCustom ? 'Imej CMS digunakan' : 'Imej asal digunakan (lalai)'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <label
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '8px',
                              padding: '8px 14px', borderRadius: '8px', cursor: uploading ? 'not-allowed' : 'pointer',
                              background: 'var(--green)', color: '#fff', fontSize: '0.82rem', fontWeight: 600,
                              opacity: uploading ? 0.65 : 1,
                            }}
                          >
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              disabled={uploading}
                              onChange={e => { const f = e.target.files?.[0]; if (f) handleLandingImageUpload(key, f); e.target.value = ''; }}
                            />
                            {uploading ? 'Memuat naik...' : (hasCustom ? '🔄 Tukar' : '⬆ Muat Naik')}
                          </label>
                          {hasCustom && (
                            <button className="btn btn-sm btn-ghost" onClick={() => handleLandingImageReset(key)}>Guna imej asal</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {settingsEdit.landingSections.hero.mode === 'fields' && <div className="card" style={{ marginTop: '12px' }}>
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
              </div>}

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Seksyen "Tentang Kami"</div></div>
                <div className="card-body">
                  {renderLandingSectionModeEditor('about')}
                  {settingsEdit.landingSections.about.mode === 'fields' && <>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                    Guna <code>*perkataan*</code> dalam tajuk untuk warna aksen — cth. <code>Bukan *Kolam* Biasa</code>.
                  </div>
                  <div className="form-grid">
                    <div className="form-group"><label className="form-label">Eyebrow</label><input className="form-input" value={settingsEdit.aboutEyebrow || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, aboutEyebrow: e.target.value })} placeholder="Kolam Keli Sayang" /></div>
                    <div className="form-group"><label className="form-label">Tajuk</label><textarea className="form-textarea" rows={2} value={settingsEdit.aboutTitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, aboutTitle: e.target.value })} placeholder="Bukan *Kolam* Biasa" /></div>
                    <div className="form-group form-span"><label className="form-label">Penerangan Ringkas (Intro)</label><textarea className="form-textarea" rows={4} value={settingsEdit.introCopy || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, introCopy: e.target.value })} placeholder="Kolam Keli Sayang dibuka untuk pertandingan sahaja..." /></div>
                    <div className="form-group"><label className="form-label">Label Butang CTA</label><input className="form-input" value={settingsEdit.aboutCtaLabel || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, aboutCtaLabel: e.target.value })} placeholder="Semak Layout Kolam" /></div>
                  </div>
                  </>}
                </div>
              </div>

              {settingsEdit.landingSections.about.mode === 'fields' && <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Kad Kelebihan (4)</div></div>
                <div className="card-body">
                  {[0, 1, 2, 3].map((i) => {
                    const f = settingsEdit.features?.[i] || { icon: '', title: '', body: '' };
                    return (
                      <div key={i} className="form-grid" style={{ marginBottom: '12px', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
                        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <i className={f.icon} style={{ width: '20px', textAlign: 'center', color: 'var(--text-muted)' }}></i>
                          <input className="form-input" value={f.icon} onChange={(e) => updateFeature(i, 'icon', e.target.value)} placeholder="fa-solid fa-flag-checkered" style={{ flex: 1 }} />
                        </div>
                        <div className="form-group"><textarea className="form-textarea" rows={2} value={f.title} onChange={(e) => updateFeature(i, 'title', e.target.value)} placeholder="Tajuk kad" /></div>
                        <div className="form-group form-span"><textarea className="form-textarea" rows={2} value={f.body} onChange={(e) => updateFeature(i, 'body', e.target.value)} placeholder="Penerangan kad" /></div>
                      </div>
                    );
                  })}
                </div>
              </div>}

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Seksyen "Pertandingan"</div></div>
                <div className="card-body">
                  {renderLandingSectionModeEditor('competitions')}
                  {settingsEdit.landingSections.competitions.mode === 'fields' && <>
                  <div className="form-grid">
                    <div className="form-group"><label className="form-label">Eyebrow</label><input className="form-input" value={settingsEdit.competitionsEyebrow || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, competitionsEyebrow: e.target.value })} placeholder="Pertandingan" /></div>
                    <div className="form-group"><label className="form-label">Tajuk</label><textarea className="form-textarea" rows={2} value={settingsEdit.competitionsTitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, competitionsTitle: e.target.value })} placeholder="Sertai & *Menang* Besar" /></div>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '14px 0 8px' }}>Kad mini "Weekly Strike"</div>
                  <div className="form-grid">
                    <div className="form-group"><label className="form-label">Tajuk Kad</label><textarea className="form-textarea" rows={2} value={settingsEdit.weeklyCardTitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, weeklyCardTitle: e.target.value })} placeholder="Weekly Strike" /></div>
                    <div className="form-group form-span"><label className="form-label">Penerangan Kad</label><textarea className="form-textarea" rows={3} value={settingsEdit.weeklyCardBody || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, weeklyCardBody: e.target.value })} placeholder="Format kompetitif mingguan..." /></div>
                    <div className="form-group"><label className="form-label">Tag #1</label><input className="form-input" value={settingsEdit.weeklyCardTag1 || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, weeklyCardTag1: e.target.value })} placeholder="Setiap Minggu" /></div>
                    <div className="form-group"><label className="form-label">Tag #2</label><input className="form-input" value={settingsEdit.weeklyCardTag2 || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, weeklyCardTag2: e.target.value })} placeholder="Slot Terhad" /></div>
                  </div>
                  </>}
                </div>
              </div>

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Seksyen "Cara Tempah"</div></div>
                <div className="card-body">
                  {renderLandingSectionModeEditor('steps')}
                  {settingsEdit.landingSections.steps.mode === 'fields' && <div className="form-grid">
                    <div className="form-group"><label className="form-label">Eyebrow</label><input className="form-input" value={settingsEdit.stepsEyebrow || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, stepsEyebrow: e.target.value })} placeholder="Cara Tempah" /></div>
                    <div className="form-group"><label className="form-label">Tajuk</label><textarea className="form-textarea" rows={2} value={settingsEdit.stepsTitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, stepsTitle: e.target.value })} placeholder="Langkah Tempah *Yang Mudah*" /></div>
                    <div className="form-group form-span"><label className="form-label">Subtitle</label><textarea className="form-textarea" rows={3} value={settingsEdit.stepsSubtitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, stepsSubtitle: e.target.value })} placeholder="Proses tempahan yang simple dan cepat..." /></div>
                    <div className="form-group"><label className="form-label">Label Butang CTA</label><input className="form-input" value={settingsEdit.stepsCtaLabel || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, stepsCtaLabel: e.target.value })} placeholder="Pilih Pertandingan" /></div>
                  </div>}
                </div>
              </div>

              {settingsEdit.landingSections.steps.mode === 'fields' && <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Langkah Tempah (4)</div></div>
                <div className="card-body">
                  {[0, 1, 2, 3].map((i) => {
                    const s = settingsEdit.steps?.[i] || { icon: '', title: '', body: '' };
                    return (
                      <div key={i} className="form-grid" style={{ marginBottom: '12px', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
                        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ minWidth: '20px' }}>{String(i + 1).padStart(2, '0')}</strong>
                          <i className={s.icon} style={{ width: '20px', textAlign: 'center', color: 'var(--text-muted)' }}></i>
                          <input className="form-input" value={s.icon} onChange={(e) => updateStep(i, 'icon', e.target.value)} placeholder="fa-solid fa-trophy" style={{ flex: 1 }} />
                        </div>
                        <div className="form-group"><textarea className="form-textarea" rows={2} value={s.title} onChange={(e) => updateStep(i, 'title', e.target.value)} placeholder="Tajuk langkah" /></div>
                        <div className="form-group form-span"><textarea className="form-textarea" rows={2} value={s.body} onChange={(e) => updateStep(i, 'body', e.target.value)} placeholder="Penerangan langkah" /></div>
                      </div>
                    );
                  })}
                </div>
              </div>}

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header">
                  <div className="card-title">Syarat &amp; Peraturan</div>
                  {settingsEdit.landingSections.rules.mode === 'fields' && <button className="btn btn-sm" onClick={addRule}>+ Tambah Syarat</button>}
                </div>
                <div className="card-body">
                  {renderLandingSectionModeEditor('rules')}
                  {settingsEdit.landingSections.rules.mode === 'fields' && <>
                  <div className="form-grid" style={{ marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px solid var(--line)' }}>
                    <div className="form-group"><label className="form-label">Eyebrow</label><input className="form-input" value={settingsEdit.rulesEyebrow || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, rulesEyebrow: e.target.value })} placeholder="Format Bertanding" /></div>
                    <div className="form-group"><label className="form-label">Tajuk</label><textarea className="form-textarea" rows={2} value={settingsEdit.rulesTitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, rulesTitle: e.target.value })} placeholder="Macam Mana *Ia Berjalan?*" /></div>
                    <div className="form-group form-span"><label className="form-label">Label Butang</label><input className="form-input" value={settingsEdit.rulesCtaLabel || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, rulesCtaLabel: e.target.value })} placeholder="SEMAK SYARAT & PERATURAN" /></div>
                  </div>
                  {(settingsEdit.rules || []).map((rule, i) => (
                    <div key={i} className="form-grid" style={{ marginBottom: '12px', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>
                      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ minWidth: '24px' }}>{String(i + 1).padStart(2, '0')}.</strong>
                        <textarea className="form-textarea" rows={2} value={rule.title} onChange={(e) => updateRule(i, 'title', e.target.value)} placeholder="Tajuk syarat" style={{ flex: 1 }} />
                        <button className="btn btn-sm" style={{ color: '#ef4444' }} onClick={() => removeRule(i)} aria-label="Padam syarat">🗑</button>
                      </div>
                      <div className="form-group form-span"><textarea className="form-textarea" rows={2} value={rule.body} onChange={(e) => updateRule(i, 'body', e.target.value)} placeholder="Penerangan syarat" /></div>
                    </div>
                  ))}
                  {(!settingsEdit.rules || settingsEdit.rules.length === 0) && (
                    <div style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Tiada syarat. Klik "Tambah Syarat" untuk mula.</div>
                  )}

                  <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--line)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      PDF Syarat &amp; Peraturan (digunakan di halaman utama dan borang tempahan)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <label
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '8px',
                          padding: '8px 16px', borderRadius: '8px', cursor: rulesPdfUploading ? 'not-allowed' : 'pointer',
                          background: 'var(--green)', color: '#fff', fontSize: '0.85rem', fontWeight: 600,
                          opacity: rulesPdfUploading ? 0.65 : 1,
                        }}
                      >
                        <input
                          type="file"
                          accept="application/pdf"
                          style={{ display: 'none' }}
                          disabled={rulesPdfUploading}
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleRulesPdfUpload(f); e.target.value = ''; }}
                        />
                        {rulesPdfUploading ? 'Memuat naik...' : (settingsEdit.rulesPdfUrl ? '🔄 Tukar PDF' : '⬆ Muat Naik PDF')}
                      </label>
                      {settingsEdit.rulesPdfUrl && (
                        <>
                          <a className="btn btn-sm btn-ghost" href={normalizePdfUrl(settingsEdit.rulesPdfUrl)} target="_blank" rel="noopener noreferrer">Buka PDF</a>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={async () => {
                              setSettingsEdit(s => ({ ...s, rulesPdfUrl: '' }));
                              await updateSettingsFirestore({ rulesPdfUrl: '' });
                              await reloadDB();
                            }}
                          >Padam PDF</button>
                        </>
                      )}
                    </div>
                  </div>
                  </>}
                </div>
              </div>

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Lokasi &amp; Peta</div></div>
                <div className="card-body">
                  {renderLandingSectionModeEditor('location')}
                  {settingsEdit.landingSections.location.mode === 'fields' && <div className="form-grid">
                    <div className="form-group"><label className="form-label">Eyebrow</label><input className="form-input" value={settingsEdit.lokasiEyebrow || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, lokasiEyebrow: e.target.value })} placeholder="Lokasi KKS" /></div>
                    <div className="form-group"><label className="form-label">Tajuk</label><textarea className="form-textarea" rows={2} value={settingsEdit.lokasiTitle || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, lokasiTitle: e.target.value })} placeholder="Jumpa Kami *Di Sini*" /></div>
                    <div className="form-group"><label className="form-label">Nama dalam Kotak Hubungan</label><input className="form-input" value={settingsEdit.contactName || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, contactName: e.target.value })} placeholder="Kolam Keli Sayang" /></div>
                    <div className="form-group form-span"><label className="form-label">Embed URL Peta Google</label><input className="form-input" value={settingsEdit.mapEmbedUrl || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, mapEmbedUrl: e.target.value })} placeholder="https://www.google.com/maps?q=...&output=embed" /></div>
                    <div className="form-group"><label className="form-label">Waze URL</label><input className="form-input" value={settingsEdit.wazeUrl || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, wazeUrl: e.target.value })} placeholder="https://waze.com/ul?ll=..." /></div>
                    <div className="form-group"><label className="form-label">Google Maps URL</label><input className="form-input" value={settingsEdit.googleMapsUrl || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, googleMapsUrl: e.target.value })} placeholder="https://maps.google.com/?q=..." /></div>
                  </div>}
                </div>
              </div>

              <div className="card" style={{ marginTop: '12px' }}>
                <div className="card-header"><div className="card-title">Footer</div></div>
                <div className="card-body">
                  {renderLandingSectionModeEditor('footer')}
                  {settingsEdit.landingSections.footer.mode === 'fields' && (
                    <div className="form-group form-span"><label className="form-label">Tagline Footer</label><textarea className="form-textarea" rows={3} value={settingsEdit.footerTagline || ''} onChange={(e) => setSettingsEdit({ ...settingsEdit, footerTagline: e.target.value })} placeholder="Arena pertandingan memancing keli yang adil..." /></div>
                  )}
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
                      disabled={ocrDecimalSaving}
                      onChange={(e) => handleOcrDecimalChange(e.target.value)}
                      style={{ maxWidth: '320px' }}
                    >
                      <option value="auto">Auto — kesan dari imej (lalai)</option>
                      <option value="0">Tiada perpuluhan — berat sebagai integer</option>
                      <option value="1">1 digit selepas titik — cth. 1234 → 123.4 kg</option>
                      <option value="2">2 digit selepas titik — cth. 12345 → 123.45 kg</option>
                      <option value="3">3 digit selepas titik — cth. 12345 → 12.345 kg</option>
                    </select>
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>
                      Tetapan ini juga menentukan bilangan perpuluhan semua rekod berat di CMS dan laman awam. Auto mengekalkan ketepatan nilai tersimpan.
                    </div>
                    {ocrDecimalError && <div role="alert" style={{ color: '#b91c1c', marginTop: '8px' }}>{ocrDecimalError}</div>}
                  </div>
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: '14px' }}>
                <button className="btn btn-primary" disabled={saving} onClick={handleLandingContentSave}>{saving ? 'Menyimpan...' : 'Simpan Laman Utama'}</button>
              </div>
            </div>
          )}
          {page === 'seo' && (() => {
            const seo = settingsEdit.seo;
            const siteUrl = (seo?.siteUrl || '').replace(/\/$/, '');
            const pageMeta: { key: 'home' | 'book' | 'live'; label: string; path: string }[] = [
              { key: 'home', label: 'Laman Utama', path: '/' },
              { key: 'book', label: 'Tempah', path: '/book' },
              { key: 'live', label: 'Live', path: '/live' },
            ];
            return (
              <div className="page active">
                <div className="page-header"><div><div className="page-title">SEO</div><div className="page-sub">Tajuk, penerangan, imej perkongsian dan data berstruktur untuk enjin carian &amp; pratonton media sosial</div></div></div>

                <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: 'var(--text)' }}>
                  ℹ️ Perubahan SEO disiarkan melalui cache CDN — boleh ambil masa sehingga <strong>~10 minit</strong> untuk kelihatan pada Google/WhatsApp selepas disimpan.
                </div>

                <div className="card">
                  <div className="card-header"><div className="card-title">Tetapan Umum</div></div>
                  <div className="card-body">
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label">Site URL</label><input className="form-input" value={seo?.siteUrl || ''} onChange={(e) => updateSeoGeneral('siteUrl', e.target.value)} placeholder="https://kolamkelisayang.com.my" /></div>
                      <div className="form-group"><label className="form-label">Nama Laman</label><input className="form-input" value={seo?.siteName || ''} onChange={(e) => updateSeoGeneral('siteName', e.target.value)} placeholder="Kolam Keli Sayang" /></div>
                      <div className="form-group"><label className="form-label">Latitud (pilihan)</label><input className="form-input" type="number" value={seo?.latitude ?? ''} onChange={(e) => updateSeoGeoCoord('latitude', e.target.value)} placeholder="6.146" /></div>
                      <div className="form-group"><label className="form-label">Longitud (pilihan)</label><input className="form-input" type="number" value={seo?.longitude ?? ''} onChange={(e) => updateSeoGeoCoord('longitude', e.target.value)} placeholder="100.369" /></div>
                    </div>
                    <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--line)' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Imej Perkongsian Lalai (Open Graph)</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>JPEG, 1200×630 disyorkan. Digunakan bila sesuatu halaman tiada imej sendiri.</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                        {seo?.defaultOgImage && (
                          <img src={seo.defaultOgImage} alt="Imej OG lalai" style={{ width: '160px', aspectRatio: '1.91/1', objectFit: 'cover', borderRadius: '6px', background: 'rgba(0,0,0,0.15)' }} />
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <label
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '8px',
                              padding: '8px 16px', borderRadius: '8px', cursor: ogImageUploading === 'default' ? 'not-allowed' : 'pointer',
                              background: 'var(--green)', color: '#fff', fontSize: '0.85rem', fontWeight: 600,
                              opacity: ogImageUploading === 'default' ? 0.65 : 1,
                            }}
                          >
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              disabled={ogImageUploading === 'default'}
                              onChange={e => { const f = e.target.files?.[0]; if (f) handleOgImageUpload('default', f); e.target.value = ''; }}
                            />
                            {ogImageUploading === 'default' ? 'Memuat naik...' : (seo?.defaultOgImage ? '🔄 Tukar Imej' : '⬆ Muat Naik Imej')}
                          </label>
                          {seo?.defaultOgImage && (
                            <button className="btn btn-sm btn-ghost" onClick={() => updateSeoGeneral('defaultOgImage', '')}>Padam</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {pageMeta.map(({ key, label, path }) => {
                  const meta = seo?.pages?.[key];
                  const title = meta?.title || '';
                  const description = meta?.description || '';
                  const previewImage = meta?.ogImage || seo?.defaultOgImage || '';
                  return (
                    <div key={key} className="card" style={{ marginTop: '12px' }}>
                      <div className="card-header"><div className="card-title">{label} <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.8rem' }}>({path})</span></div></div>
                      <div className="card-body">
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1.3fr) minmax(240px, 1fr)', gap: '20px' }}>
                          <div>
                            <div className="form-group form-span">
                              <label className="form-label">Tajuk Meta <span style={{ color: title.length > 60 ? '#ef4444' : 'var(--text-muted)' }}>({title.length}/60)</span></label>
                              <input className="form-input" value={title} onChange={(e) => updateSeoPage(key, 'title', e.target.value)} placeholder="Tajuk halaman untuk Google" />
                            </div>
                            <div className="form-group form-span" style={{ marginTop: '10px' }}>
                              <label className="form-label">Penerangan Meta <span style={{ color: description.length > 160 ? '#ef4444' : 'var(--text-muted)' }}>({description.length}/160)</span></label>
                              <textarea className="form-textarea" rows={3} value={description} onChange={(e) => updateSeoPage(key, 'description', e.target.value)} placeholder="Penerangan ringkas halaman untuk hasil carian" />
                            </div>
                            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                              <label
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '8px',
                                  padding: '6px 14px', borderRadius: '8px', cursor: ogImageUploading === key ? 'not-allowed' : 'pointer',
                                  background: 'var(--navy, #1e3a5f)', color: '#fff', fontSize: '0.8rem', fontWeight: 600,
                                  opacity: ogImageUploading === key ? 0.65 : 1,
                                }}
                              >
                                <input
                                  type="file"
                                  accept="image/*"
                                  style={{ display: 'none' }}
                                  disabled={ogImageUploading === key}
                                  onChange={e => { const f = e.target.files?.[0]; if (f) handleOgImageUpload(key, f); e.target.value = ''; }}
                                />
                                {ogImageUploading === key ? 'Memuat naik...' : (meta?.ogImage ? '🔄 Tukar Imej OG' : '⬆ Imej OG Khusus')}
                              </label>
                              {meta?.ogImage && (
                                <button className="btn btn-sm btn-ghost" onClick={() => updateSeoPage(key, 'ogImage', '')}>Guna imej lalai</button>
                              )}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <SeoSnippetPreview url={`${siteUrl}${path}`} title={title} description={description} />
                            <SocialCardPreview url={`${siteUrl}${path}`} title={title} description={description} image={previewImage} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div className="form-actions" style={{ marginTop: '14px' }}>
                  <button className="btn btn-primary" disabled={saving} onClick={handleSeoSave}>{saving ? 'Menyimpan...' : 'Simpan SEO'}</button>
                </div>
              </div>
            );
          })()}
          {page === 'users' && (() => {
            // Derive the real email: self-service bookings store the Firebase UID in
            // userId (not human-readable), so prefer userEmail and fall back to a
            // userId only when it looks like an email.
            const emailOf = (b: Booking) =>
              b.userEmail || (b.userId && b.userId.includes('@') ? b.userId : '');
            const q = userSearch.trim().toLowerCase();
            // Accounts table is server-paginated; search narrows the loaded page only.
            const filteredAccounts = userEntries.filter(u =>
              !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
            // Booking counts per account, computed in-memory from the already-loaded
            // global bookings list (no extra Firestore reads). Staff-created proxy
            // bookings (no linked account) are counted separately below instead.
            const bookingCountByEmail = new Map<string, number>();
            bookings.forEach(b => {
              if (b.createdByStaff) return;
              const email = emailOf(b).toLowerCase();
              if (!email) return;
              bookingCountByEmail.set(email, (bookingCountByEmail.get(email) || 0) + 1);
            });
            const roleBadge = (role: User['role']) =>
              role === 'ADMIN' ? <span className="badge badge-live">Admin</span>
              : role === 'STAFF' ? <span className="badge badge-deposit">Staf</span>
              : <span className="badge badge-open">Pengguna</span>;

            // Staff-created manual/proxy bookings have no linked account (userId is
            // a typed email, not a Firebase UID) — grouped separately by name+email.
            type GuestRow = { name: string; email: string; phone: string; count: number };
            const guestMap = new Map<string, GuestRow>();
            bookings.filter(b => b.createdByStaff).forEach(b => {
              const email = emailOf(b);
              const key = (email || b.userName || b.id).toLowerCase();
              const existing = guestMap.get(key);
              if (existing) existing.count += 1;
              else guestMap.set(key, { name: b.userName || '—', email: email || '—', phone: b.userPhone || '—', count: 1 });
            });
            const guestRows = Array.from(guestMap.values())
              .filter(g => !q || g.name.toLowerCase().includes(q) || g.email.toLowerCase().includes(q))
              .sort((a, b) => a.name.localeCompare(b.name));

            return (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Pengguna</div><div className="page-sub">Akaun berdaftar &amp; tempahan manual tanpa akaun</div></div></div>
              {roleMessage && (
                <div
                  role="status"
                  style={{
                    marginBottom: 12,
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: `1px solid ${roleMessage.tone === 'success' ? 'rgba(22,163,74,.35)' : 'rgba(220,38,38,.35)'}`,
                    background: roleMessage.tone === 'success' ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.08)',
                    color: roleMessage.tone === 'success' ? '#15803d' : '#b91c1c',
                  }}
                >
                  {roleMessage.text}
                </div>
              )}
              <div className="card">
                <div className="card-header" style={{ justifyContent: 'flex-end' }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="form-input"
                      style={{ width: '280px', maxWidth: '60vw', padding: '6px 28px 6px 10px' }}
                      placeholder="Cari nama atau email…"
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                    />
                    {userSearch && (
                      <button onClick={() => setUserSearch('')} title="Kosongkan" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem' }}>×</button>
                    )}
                  </div>
                </div>
                <div className="card-body"><div className="table-wrap"><table>
                <thead><tr><th></th>{sortableTh('Nama', 'name', 'name', userSortOrder, handleUserSort)}<th>Email</th><th>Peranan</th><th>Tempahan</th>{isAdmin && <th>Tindakan</th>}</tr></thead>
                <tbody>
                  {userLoading && <tr><td colSpan={isAdmin ? 6 : 5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Memuat...</td></tr>}
                  {!userLoading && filteredAccounts.map(u => (
                    <tr key={u.uid || u.email}>
                      <td><span className="user-avatar-sm">{(u.name || 'U')[0].toUpperCase()}</span></td>
                      <td className="td-name">{u.name || '—'}</td>
                      <td>{u.email || '—'}</td>
                      <td>{roleBadge(u.role)}</td>
                      <td>{bookingCountByEmail.get(u.email.toLowerCase()) || 0}</td>
                      {isAdmin && (
                        <td>
                          {u.role === 'ADMIN' || u.uid === user?.uid ? (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Dikunci</span>
                          ) : (
                            <select
                              className="form-input"
                              aria-label={`Tukar peranan ${u.name || u.email}`}
                              value={u.role || 'CLIENT'}
                              disabled={!u.uid || roleUpdatingUid === u.uid}
                              onChange={(event) => requestRoleChange(u, event.target.value as UserRole)}
                              style={{ minWidth: 120, padding: '6px 8px' }}
                            >
                              <option value="CLIENT">Pengguna</option>
                              <option value="STAFF">Staf</option>
                              <option value="ADMIN">Admin</option>
                            </select>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                  {!userLoading && filteredAccounts.length === 0 && <tr><td colSpan={isAdmin ? 6 : 5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada akaun sepadan</td></tr>}
                </tbody>
              </table></div></div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 4px 4px' }}>
                  <button className="btn btn-sm btn-ghost" disabled={userPage === 0} onClick={handleUserPrev}>← Sebelum</button>
                  <button className="btn btn-sm btn-ghost" disabled={!userHasMore} onClick={handleUserNext}>Seterus →</button>
                </div>
              </div>

              <div className="card" style={{ marginTop: '16px' }}>
                <div className="card-header"><div className="card-title">Tempahan Manual Tanpa Akaun</div></div>
                <div className="card-body"><div className="table-wrap"><table>
                  <thead><tr><th>Nama</th><th>Email / Rujukan</th><th>Telefon</th><th>Tempahan</th></tr></thead>
                  <tbody>
                    {guestRows.map(g => (
                      <tr key={g.email + g.name}>
                        <td className="td-name">{g.name}</td>
                        <td>{g.email}</td>
                        <td>{g.phone}</td>
                        <td>{g.count}</td>
                      </tr>
                    ))}
                    {guestRows.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Tiada tempahan manual</td></tr>}
                  </tbody>
                </table></div></div>
              </div>
            </div>
            );
          })()}
          {page === 'audit-log' && (() => {
            const fmtDateTime = (iso?: string) => formatDate(iso, { time: true }) || '-';
            const q = auditLogSearch.trim().toLowerCase();
            const filtered = auditLogEntries.filter(e => !q
              || e.actionLabel.toLowerCase().includes(q)
              || (e.actorName || '').toLowerCase().includes(q)
              || (e.actorEmail || '').toLowerCase().includes(q)
              || (e.entityLabel || '').toLowerCase().includes(q));
            return (
            <div className="page active">
              <div className="page-header"><div><div className="page-title">Log Audit</div><div className="page-sub">Sejarah tindakan staf/admin dalam CMS (200 terkini)</div></div></div>
              <div className="card">
                <div className="card-header" style={{ justifyContent: 'flex-end' }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="form-input"
                      style={{ width: '280px', maxWidth: '60vw', padding: '6px 28px 6px 10px' }}
                      placeholder="Cari staf atau tindakan…"
                      value={auditLogSearch}
                      onChange={e => setAuditLogSearch(e.target.value)}
                    />
                    {auditLogSearch && (
                      <button onClick={() => setAuditLogSearch('')} title="Kosongkan" style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem' }}>×</button>
                    )}
                  </div>
                </div>
                <div className="card-body"><div className="table-wrap"><table>
                  <thead><tr><th>Waktu</th><th>Staf</th><th>Tindakan</th><th>Butiran</th></tr></thead>
                  <tbody>
                    {filtered.map(e => (
                      <tr key={e.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                        <td className="td-name">{e.actorName || e.actorEmail || e.actorUid || '—'}</td>
                        <td>{e.actionLabel}</td>
                        <td>{[e.entityLabel, e.details].filter(Boolean).join(' — ') || '—'}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>{auditLogEntries.length === 0 ? 'Tiada log lagi' : 'Tiada log sepadan dengan carian'}</td></tr>}
                  </tbody>
                </table></div></div>
              </div>
            </div>
            );
          })()}
        </div>

        {competitionEditorOpen && (
          <div className="modal-overlay open" onClick={closeCompetitionEditor}>
            <div className="modal" style={{ maxWidth: '760px', width: '95%', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header" style={{ flexShrink: 0 }}>
                <div className="modal-title">{compEditIsNew ? 'Tambah Pertandingan' : 'Info Pertandingan'}</div>
                <button className="modal-close" onClick={closeCompetitionEditor}>×</button>
              </div>
              <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
                <div className="form-grid">
                  <div className="form-group"><label className="form-label">Nama Pertandingan</label><input className="form-input" value={compEdit.name || ''} onChange={(e) => setCompEdit({ ...compEdit, name: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">Tarikh &amp; Masa Mula</label><div className="date-input-wrap" onClick={openDatePicker}><input className="form-input" type="datetime-local" value={toLocalDatetime(compEdit.startDate)} onChange={(e) => e.target.value && setCompEdit({ ...compEdit, startDate: new Date(e.target.value).toISOString() })} /><span className="date-picker-btn" aria-hidden="true">📅</span></div></div>
                  <div className="form-group"><label className="form-label">Tarikh &amp; Masa Tamat</label><div className="date-input-wrap" onClick={openDatePicker}><input className="form-input" type="datetime-local" value={toLocalDatetime(compEdit.endDate)} onChange={(e) => e.target.value && setCompEdit({ ...compEdit, endDate: new Date(e.target.value).toISOString() })} /><span className="date-picker-btn" aria-hidden="true">📅</span></div></div>
                  <div className="form-group"><label className="form-label">Tarikh &amp; Masa Buka Tempahan</label><div className="date-input-wrap" onClick={openDatePicker}><input className="form-input" type="datetime-local" value={toLocalDatetime(compEdit.bookingOpenAt || '')} onChange={(e) => setCompEdit({ ...compEdit, bookingOpenAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /><span className="date-picker-btn" aria-hidden="true">📅</span></div></div>
                  <div className="form-group"><label className="form-label">Tarikh &amp; Masa Tutup Tempahan</label><div className="date-input-wrap" onClick={openDatePicker}><input className="form-input" type="datetime-local" value={toLocalDatetime(compEdit.bookingCloseAt || '')} onChange={(e) => setCompEdit({ ...compEdit, bookingCloseAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /><span className="date-picker-btn" aria-hidden="true">📅</span></div></div>
                  <div className="form-group">
                    <label className="form-label">Harga Pancang (RM)</label>
                    <input className="form-input" type="number" min="1" step="1" value={compEdit.pricePerPeg ?? 100} onChange={(e) => setCompEdit({ ...compEdit, pricePerPeg: Math.max(0, parseInt(e.target.value) || 0) })} />
                    <div style={{ marginTop: '4px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>Semua kolam dalam pertandingan ini berkongsi harga pancang yang sama.</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Jumlah Kedudukan Dipaparkan</label>
                    <input className="form-input" type="number" min="1" value={compEdit.topN || 20} onChange={(e) => setCompEdit({ ...compEdit, topN: parseInt(e.target.value) || 0 })} />
                    <div style={{ marginTop: '4px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>Bilangan peserta teratas yang dipaparkan di papan markah.</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Status</label>
                    <div style={{ padding: '10px 0' }}>{(() => { const meta = getCompetitionCmsStatusMeta(compEdit, nowTick); return <span className={`badge ${meta.badgeClass}`}>{meta.label}</span>; })()}</div>
                    <div style={{ marginTop: '4px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Ditentukan automatik ikut tarikh — Coming soon (belum buka tempahan), Aktif (dari buka tempahan hingga pertandingan tamat, termasuk selepas tempahan ditutup), Tamat (pertandingan sudah selesai).
                    </div>
                  </div>
                </div>

                <div className="card" style={{ marginTop: '12px' }}>
                  <div className="card-header">
                    <div className="card-title">Kolam Dipilih</div>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{compEdit.activePondIds?.length || 0} kolam dipilih</span>
                  </div>
                  <div className="card-body">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {ponds.map((pond) => {
                        const pondKey = pond._docId || pond.id.toString();
                        const checked = (compEdit.activePondIds || []).includes(pondKey);
                        return (
                          <label key={pondKey} style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', background: checked ? 'var(--cream)' : 'transparent', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 700 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const next = new Set(compEdit.activePondIds || []);
                                if (event.target.checked) next.add(pondKey);
                                else next.delete(pondKey);
                                setCompEdit({ ...compEdit, activePondIds: Array.from(next) });
                              }}
                            />
                            {pondDisplayName(pond)}
                          </label>
                        );
                      })}
                      {ponds.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Tiada kolam tersedia.</span>}
                    </div>
                  </div>
                </div>

                <div className="form-actions" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {!compEditIsNew && compEdit.id && (
                    <button className="btn btn-danger" onClick={() => setCompetitionDeleteTarget(compEdit as Competition)} style={{ marginRight: 'auto' }}>Padam Pertandingan</button>
                  )}
                  <button className="btn btn-ghost" onClick={closeCompetitionEditor}>Batal</button>
                  <button className="btn btn-primary" onClick={handleCompetitionUpdate} disabled={saving || !compEdit.name?.trim() || !compEdit.startDate || !compEdit.endDate || !compEdit.bookingOpenAt || !compEdit.bookingCloseAt || !compEdit.pricePerPeg || !compEdit.topN || !(compEdit.activePondIds?.length)}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
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
          // Kolam always uses the legacy pond view now (toggle removed).
          const isLegacy = true;
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
                  <div className="form-group">
                    <label className="form-label">Kod Kolam (A–Z)</label>
                    <input
                      className="form-input"
                      maxLength={1}
                      style={{ textTransform: 'uppercase', maxWidth: '120px' }}
                      placeholder={nextFreePondCode(ponds, isEdit ? (editingPond._docId || '') : '')}
                      value={(isEdit ? editingPond.code : newPond.code) || ''}
                      onChange={e => {
                        const v = e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 1);
                        if (isEdit) setEditingPond({ ...editingPond, code: v }); else setNewPond({ ...newPond, code: v });
                      }}
                    />
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Digunakan sebagai awalan nombor pancang, cth. {(isEdit ? editingPond.code : newPond.code) || nextFreePondCode(ponds, isEdit ? (editingPond._docId || '') : '') || 'A'}-23. Nama kosong akan papar sebagai “Kolam {(isEdit ? editingPond.code : newPond.code) || '?'}”.</div>
                  </div>
                  <div className="form-group"><label className="form-label">Keterangan</label><input className="form-input" value={isEdit ? editingPond.desc : newPond.desc} onChange={e => isEdit ? setEditingPond({ ...editingPond, desc: e.target.value }) : setNewPond({ ...newPond, desc: e.target.value })} /></div>
                  <div className="form-group form-span" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingTop: '6px' }}>
                    Harga Pancang diuruskan di menu <strong>Pertandingan</strong>, bukan di Kolam.
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      Bilangan Pancang Maksimum
                      {!isLegacy && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 6 }}>(mesti sepadan dengan pancang diletakkan)</span>}
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
                {!isLegacy && (
                  <div style={{ marginTop: '20px' }}>
                    <div className="form-label" style={{ marginBottom: '8px', display: 'block' }}>
                      Reka Bentuk Kolam &amp; Susunan Pancang
                      {hasPolygon && seatsPlaced > 0 && (
                        <span style={{ marginLeft: 8, fontSize: '0.78rem', color: seatCountOk ? 'var(--green)' : '#facc15' }}>
                          {seatsPlaced}/{curMaxSeats} pancang diletakkan{seatCountOk ? ' ✓' : ` — perlu tepat ${curMaxSeats}`}
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
                    <button type="button" className="btn btn-danger" style={{ marginRight: 'auto' }} disabled={saving} onClick={() => handleDeletePond(editingPond)}>Padam Kolam</button>
                    <button className="btn btn-ghost" onClick={closePondModal}>Batal</button>
                    <button className="btn btn-primary" disabled={saving || !seatCountOk} onClick={() => handlePondUpdate(editingPond)}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
                  </>) : (<>
                    <button className="btn btn-ghost" onClick={closePondModal}>Batal</button>
                    <button className="btn btn-primary" disabled={saving || !seatCountOk} onClick={async () => {
                      if (newPond.name) {
                        // Conflict check for new pond: no existing bookings, so just count check
                        if (!isLegacy && hasPolygon && seatsPlaced > 0 && seatsPlaced !== newPondMaxSeats) {
                          setPondSaveError(`Letakkan tepat ${newPondMaxSeats} pancang pada peta (kini ${seatsPlaced}/${newPondMaxSeats}).`);
                          return;
                        }
                        const newCodeErr = pondCodeError(newPond.code, ponds);
                        if (newCodeErr) { setPondSaveError(newCodeErr); return; }
                        const newCode = (newPond.code || '').trim().toUpperCase() || nextFreePondCode(ponds);
                        setSaving(true);
                        try {
                          const effectiveMax = isLegacy ? newPondMaxSeats : ((newPond.seats ?? []).length || newPondMaxSeats);
                          const newDocId = await createPondFirestore({ name: newPond.name, code: newCode, desc: newPond.desc || '', open: true, totalSeats: effectiveMax, pricePerSeat: 100 } as any);
                          // Save shape + seatLayout if present (polygon mode)
                          const shape = (newPond as any).shape ?? [];
                          const seats = newPond.seats ?? [];
                          if (!isLegacy && (shape.length > 0 || seats.length > 0)) {
                            const seatLayout = seats.map((s: any) => ({ num: s.num, px: s.px ?? 50, py: s.py ?? 50, active: s.active !== false }));
                            await updatePondFirestore(newDocId, { shape, seatLayout } as any);
                          }
                          await reloadDB();
                          await logAuditEvent({
                            action: 'pond.create', actionLabel: 'Cipta Kolam', entityType: 'pond',
                            entityId: newDocId, entityLabel: newCode ? `${newCode} — ${newPond.name}` : newPond.name,
                            actorUid: user?.uid, actorEmail: user?.email, actorName: user?.name,
                          });
                          setNewPond({ name: '', desc: '', seats: [], open: true, code: '' });
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

      <DocPreviewModal url={scorePhotoUrl} title="Bukti Timbangan" onClose={() => setScorePhotoUrl(null)} />

      <ReceiptReviewModal
        booking={reviewTarget}
        saving={saving}
        hasConflict={!!reviewTarget && hasConflict(reviewTarget)}
        onViewReceipt={handleViewReceipt}
        onApprove={handleAcceptReceipt}
        onReject={handleRejectReceipt}
        onApproveManual={handleReviewApproveManual}
        onAddRemark={handleAddRemark}
        onClose={() => setReviewTarget(null)}
      />

      {receiptHistoryBooking && (() => {
        const receipts = receiptHistoryBooking.receipts?.length
          ? receiptHistoryBooking.receipts
          : (receiptHistoryBooking.receiptData
              ? [{
                  url: receiptHistoryBooking.receiptData,
                  amount: receiptHistoryBooking.amount,
                  status: 'pending' as const,
                  submittedAt: receiptHistoryBooking.createdAt || '',
                }]
              : []);
        return (
          <div className="modal-overlay open" style={{ zIndex: 1080 }} onClick={() => setReceiptHistoryBooking(null)}>
            <div className="modal" style={{ maxWidth: 620, width: '94%' }} onClick={(event) => event.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Receipt — {receiptHistoryBooking.bookingRef || receiptHistoryBooking.id.slice(0, 10)}</div>
                <button className="modal-close" onClick={() => setReceiptHistoryBooking(null)}>×</button>
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {receipts.map((receipt, index) => (
                    <div key={`${receipt.url}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--cream)' }}>
                      <div>
                        <strong>Receipt #{index + 1}</strong>
                        <div style={{ marginTop: 4, fontSize: '0.78rem', color: 'var(--text-muted)' }}>Tarikh diterima: {receipt.submittedAt ? formatDate(receipt.submittedAt, { time: true }) : '-'}</div>
                        <div style={{ marginTop: 2, fontSize: '0.78rem', color: 'var(--text-muted)' }}>RM {receipt.amount} · {receipt.status === 'accepted' ? 'Disahkan' : receipt.status === 'rejected' ? 'Ditolak' : 'Menunggu Semakan'}</div>
                        <div style={{ marginTop: 2, fontSize: '0.78rem', color: 'var(--text-muted)' }}>No. Rujukan Bank: <strong style={{ fontFamily: 'monospace' }}>{receiptBankReference(receiptHistoryBooking, receipt, index) || '-'}</strong></div>
                      </div>
                      {receipt.url && <button className="btn btn-sm btn-primary" onClick={() => handleViewReceipt(receipt.url)}>Lihat Receipt</button>}
                    </div>
                  ))}
                  {receipts.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Tiada receipt diterima.</div>}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* In-page receipt lightbox (replaces opening a new browser tab) */}
      {receiptViewerUrl && (() => {
        const isPdf = /\.pdf($|\?)/i.test(receiptViewerUrl) || receiptViewerUrl.startsWith('data:application/pdf');
        return (
        <div className="modal-overlay open" style={{ zIndex: 1100 }} onClick={() => setReceiptViewerUrl(null)}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setReceiptViewerUrl(null)}
              style={{ position: 'absolute', top: -36, right: 0, color: '#fff', fontSize: '1.8rem' }}
              aria-label="Tutup"
            >×</button>
            {isPdf ? (
              <iframe
                title="Resit PDF"
                src={receiptViewerUrl}
                style={{ width: '90vw', height: '85vh', border: 'none', borderRadius: 8, background: '#fff', display: 'block' }}
              />
            ) : (
              <img
                src={receiptViewerUrl}
                alt="Resit"
                onLoad={(e) => { const w = e.currentTarget.naturalWidth; const h = e.currentTarget.naturalHeight; setReceiptViewerMeta(m => ({ ...m, width: w, height: h })); }}
                style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, display: 'block', background: '#000' }}
              />
            )}
            <div style={{ marginTop: 8, textAlign: 'center', color: '#fff', fontSize: '0.78rem', display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              {isPdf && <span>📄 PDF</span>}
              {!isPdf && receiptViewerMeta.width > 0 && (
                <span>📐 {receiptViewerMeta.width} × {receiptViewerMeta.height} px</span>
              )}
              {receiptViewerMeta.bytes != null && (
                <span>💾 {formatBytes(receiptViewerMeta.bytes)}</span>
              )}
              <a href={receiptViewerUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold, #f5c542)' }}>Buka dalam tab baharu / Open in new tab ↗</a>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Reusable confirmation dialog for decision actions */}
      {confirmDialog && createPortal(
        <div className="modal-overlay open" style={{ zIndex: 1200 }} onClick={() => setConfirmDialog(null)}>
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
        </div>,
        document.body,
      )}

      {/* Force-cancel typed confirmation (second gate) */}
      {forceCancelTarget && createPortal(
        <div className="modal-overlay open" style={{ zIndex: 1210 }} onClick={() => { setForceCancelTarget(null); setForceCancelText(''); }}>
          <div className="modal" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Pengesahan Akhir / Final Confirmation</div>
              <button className="modal-close" onClick={() => { setForceCancelTarget(null); setForceCancelText(''); }}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-muted)', marginBottom: '12px', fontSize: '0.85rem' }}>
                Untuk membatalkan tempahan <strong>{forceCancelTarget.bookingRef || forceCancelTarget.id.slice(0, 10)}</strong> ({forceCancelTarget.userName}),
                taip <strong style={{ color: 'var(--red)' }}>DELETE BOOKING</strong> di bawah.
                <br /><br />
                <em>To cancel this confirmed booking, type <strong style={{ color: 'var(--red)' }}>DELETE BOOKING</strong> below. This cannot be undone easily.</em>
              </p>
              <input
                className="form-input"
                style={{ width: '100%', marginBottom: '14px' }}
                placeholder="DELETE BOOKING"
                value={forceCancelText}
                onChange={(e) => setForceCancelText(e.target.value)}
                autoFocus
              />
              <div className="form-actions">
                <button className="btn btn-ghost" disabled={saving} onClick={() => { setForceCancelTarget(null); setForceCancelText(''); }}>Batal / Cancel</button>
                <button
                  className="btn btn-danger"
                  disabled={saving || forceCancelText !== 'DELETE BOOKING'}
                  onClick={handleForceCancel}
                >
                  {saving ? 'Membatalkan… / Cancelling…' : 'Batalkan Tempahan / Cancel Booking'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* QR viewer grid for one booking (Semua Tempahan) */}
      {qrPreviewBooking && createPortal(
        <div className="modal-overlay open" style={{ zIndex: 1300 }} onClick={closeQrPreview}>
          {/* flex column + a scrollable body: a booking with many pegs renders more
              QR tiles than fit in the 92vh-capped .modal (which is overflow:hidden). */}
          <div className="modal" style={{ maxWidth: '520px', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ flex: '0 0 auto' }}>
              <div className="modal-title">QR Tempahan — {qrPreviewBooking.bookingRef || qrPreviewBooking.id.slice(0, 10)}</div>
              <button className="modal-close" onClick={closeQrPreview}>×</button>
            </div>
            <div className="modal-body" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '14px' }}>
                {bookingSeatEntries(qrPreviewBooking).map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setEnlargedQrSeat(entry)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', background: '#fff', padding: '12px', borderRadius: '10px', border: '1px solid var(--line)', cursor: 'zoom-in' }}
                  >
                    <QRCodeSVG value={buildSeatQrValue(qrPreviewBooking.id, entry.seatNum, entry.pondId)} size={120} level="M" marginSize={2} bgColor="#ffffff" fgColor="#112a41" />
                    <span className="seat-pill">{formatSeat(entry.pondCode, entry.seatNum)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Enlarged single QR — stacks above the grid, click anywhere to close back to the grid */}
      {qrPreviewBooking && enlargedQrSeat && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)', cursor: 'zoom-out' }}
          onClick={() => setEnlargedQrSeat(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', background: '#fff', padding: '28px', borderRadius: '18px' }}>
            <QRCodeSVG value={buildSeatQrValue(qrPreviewBooking.id, enlargedQrSeat.seatNum, enlargedQrSeat.pondId)} size={280} level="M" marginSize={2} bgColor="#ffffff" fgColor="#112a41" />
            <span className="seat-pill">{formatSeat(enlargedQrSeat.pondCode, enlargedQrSeat.seatNum)}</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default CMSModal;
