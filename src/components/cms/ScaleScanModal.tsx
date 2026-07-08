import React, { useEffect, useMemo, useRef, useState } from 'react';
import CropRectOverlay, { NormRect } from './CropRectOverlay';
import { scanWeight, prewarmOcr, ScanResult, formatScannedWeight } from '../../utils/scaleOcr';
import { sevenSegmentScan } from '../../utils/sevenSegmentFallback';
import { formatSeat, formatSeatList } from '../../utils/seatLabel';
import { parseQrPayload, decodeQr, openQrCameraStream } from '../../utils/qr';

/**
 * A booking as the CMS sees it during the weigh-in scan flow. Carries the
 * full seat list so the modal can prompt the staff to pick the correct peg
 * after identifying the booking (either via QR or manual selection).
 */
export interface ScannedBookingFull {
  bookingId: string;
  bookingRef?: string;
  userId: string;
  anglerName: string;
  pondId: number;
  pondName: string;
  pondCode?: string;
  competitionId?: string;
  competitionName?: string;
  seats: number[];
}

/** Final shape passed to the CMS once seat is chosen. */
export interface ScannedBookingLite {
  bookingId: string;
  bookingRef?: string;
  userId: string;
  anglerName: string;
  pondId: number;
  pondName: string;
  pondCode?: string;
  seatNum: number;
  competitionId?: string;
  competitionName?: string;
}

/** How the saved weight was obtained, in escalation order. */
export type ReadingSource = 'onnx' | 'sevenseg' | 'manual';

export interface ScaleScanApproved {
  weight: number;
  ocrConfidence: number;
  ocrRawText: string;
  /** True only when staff typed the weight by hand (the final failsafe). */
  userEdited: boolean;
  /** Which scanner/entry produced the weight. */
  method: ReadingSource;
  photoBlob: Blob;
  photoFileName: string;
  scannedBooking: ScannedBookingLite;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApprove: (result: ScaleScanApproved) => void;
  usePreprocess?: boolean;
  decimalPlaces?: 0 | 1 | 2 | 3;
  /** Resolve a scanned booking id into the full booking (with seat list). */
  lookupBookingFull: (bookingId: string) => ScannedBookingFull | null;
  /**
   * Return all bookings the staff is allowed to weigh for right now — usually
   * scoped to the currently-selected Results competition. Powers the manual
   * picker as a fallback to QR scanning.
   */
  listBookings: () => ScannedBookingFull[];
}

type Step =
  | 'identify'         // initial: choose between scan QR or manual pick
  | 'qr-processing'    // decoding scanned QR
  | 'manual-picker'    // searchable list of bookings
  | 'pick-seat'        // choose which peg (only when the booking/QR didn't specify one)
  | 'capture'          // weight photo capture
  | 'crop'             // crop the weight photo
  | 'processing'       // running OCR
  | 'verify';          // show OCR result + confirm or retake

const MAX_LONG_EDGE = 1600;
const DEFAULT_CROP: NormRect = { x: 0.25, y: 0.42, w: 0.5, h: 0.18 };

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (ctx) ctx.drawImage(src, 0, 0);
  return out;
}

function renderHighlightedPreview(result: ScanResult): HTMLCanvasElement {
  const src = result.preprocessedCanvas;
  const display = document.createElement('canvas');
  display.width = src.width;
  display.height = src.height;
  const ctx = display.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0);

  const seg = result.sevenSegByPolarity[result.pickedPolarity];
  if (!seg) return display;

  const stroke = Math.max(2, Math.round(display.height * 0.012));
  const fontPx = Math.max(14, Math.round(display.height * 0.20));

  ctx.lineWidth = Math.max(1, Math.round(stroke * 0.6));
  ctx.strokeStyle = 'rgba(120, 120, 120, 0.7)';
  ctx.setLineDash([4, 3]);
  for (const b of seg.rejectedBboxes) {
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  }
  ctx.setLineDash([]);

  ctx.lineWidth = stroke;
  ctx.font = `bold ${fontPx}px sans-serif`;
  ctx.textBaseline = 'top';

  const sevenSegRead = seg.digits.length === seg.digitBboxes.length && seg.weight !== null;

  for (let i = 0; i < seg.digitBboxes.length; i++) {
    const b = seg.digitBboxes[i];
    const value = seg.digits[i];
    const hasValue = value !== undefined && sevenSegRead;
    const color = hasValue ? '#22c55e' : '#ef4444';

    ctx.strokeStyle = color;
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);

    const label = hasValue ? String(value) : '?';
    const padX = 6;
    const labelW = ctx.measureText(label).width + padX * 2;
    const labelH = fontPx + 6;
    const labelY = Math.max(0, b.y0 - labelH - 2);
    ctx.fillStyle = color;
    ctx.fillRect(b.x0, labelY, labelW, labelH);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, b.x0 + padX, labelY + 3);
  }

  if (seg.decimalBbox) {
    const b = seg.decimalBbox;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = Math.max(2, Math.round(display.height * 0.015));
    ctx.strokeRect(b.x0 - 2, b.y0 - 2, (b.x1 - b.x0) + 4, (b.y1 - b.y0) + 4);
  }

  return display;
}

async function decodeQrFromFile(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1024;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const decoded = decodeQr(imageData.data, imageData.width, imageData.height);
  if (decoded) return decoded;
  if (scale < 1) {
    const fc = document.createElement('canvas');
    fc.width = bitmap.width;
    fc.height = bitmap.height;
    const fctx = fc.getContext('2d', { willReadFrequently: true });
    if (fctx) {
      fctx.drawImage(bitmap, 0, 0);
      const big = fctx.getImageData(0, 0, fc.width, fc.height);
      const decodedBig = decodeQr(big.data, big.width, big.height);
      if (decodedBig) return decodedBig;
    }
  }
  return null;
}

function toLite(full: ScannedBookingFull, seatNum: number): ScannedBookingLite {
  return {
    bookingId: full.bookingId,
    bookingRef: full.bookingRef,
    userId: full.userId,
    anglerName: full.anglerName,
    pondId: full.pondId,
    pondName: full.pondName,
    pondCode: full.pondCode,
    seatNum,
    competitionId: full.competitionId,
    competitionName: full.competitionName,
  };
}

const ScaleScanModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onApprove,
  usePreprocess,
  decimalPlaces,
  lookupBookingFull,
  listBookings,
}) => {
  const [step, setStep] = useState<Step>('identify');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string>('scale.jpg');
  const [cropRect, setCropRect] = useState<NormRect>(DEFAULT_CROP);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Unified reading consumed by handleApprove — set by ONNX, the no-AI fallback,
  // or manual entry. weight=null means "no usable reading yet".
  const [activeReading, setActiveReading] = useState<{ source: ReadingSource; weight: number | null; displayText: string; rawText: string } | null>(null);
  const [fallbackBusy, setFallbackBusy] = useState(false);
  // Final failsafe: staff types the weight and attaches a FRESH proof photo.
  const [manualMode, setManualMode] = useState(false);
  const [manualWeightInput, setManualWeightInput] = useState('');
  const [manualPhotoBlob, setManualPhotoBlob] = useState<Blob | null>(null);
  const [manualPhotoUrl, setManualPhotoUrl] = useState<string | null>(null);
  const [manualPhotoFileName, setManualPhotoFileName] = useState<string>('manual-scale.jpg');
  const manualPhotoInputRef = useRef<HTMLInputElement>(null);
  // Throttles the "QR tidak sah" banner so a foreign QR held in front of the
  // camera doesn't re-trigger setError on every animation frame.
  const lastInvalidQrRef = useRef<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<ScannedBookingLite | null>(null);
  // Held only while on the 'pick-seat' step — the booking is known but which
  // peg is being weighed isn't (legacy QR / manual pick with 2+ seats).
  const [pendingFullBooking, setPendingFullBooking] = useState<ScannedBookingFull | null>(null);
  const [manualSearch, setManualSearch] = useState('');
  const [liveQrActive, setLiveQrActive] = useState(false);
  const [liveQrBusy, setLiveQrBusy] = useState(false);
  const qrFileInputRef = useRef<HTMLInputElement>(null);
  const weightFileInputRef = useRef<HTMLInputElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const liveQrVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveQrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveQrStreamRef = useRef<MediaStream | null>(null);
  const liveQrRafRef = useRef<number | null>(null);
  // Mirrors liveQrActive synchronously — the rAF loop reads this instead of
  // the state, since a state read inside a callback scheduled the instant
  // setLiveQrActive(true) is called closes over the PRE-update value (the
  // render carrying `true` hasn't happened yet), which made every frame bail
  // out immediately and silently stop scanning forever.
  const liveQrActiveRef = useRef(false);
  // Camera-open timestamp — decode attempts are skipped for a brief warm-up
  // window so a scan can't latch onto the first (still-focusing) frames.
  const liveQrStartedAtRef = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      if (liveQrRafRef.current) {
        window.cancelAnimationFrame(liveQrRafRef.current);
        liveQrRafRef.current = null;
      }
      if (liveQrStreamRef.current) {
        liveQrStreamRef.current.getTracks().forEach((t) => t.stop());
        liveQrStreamRef.current = null;
      }
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      if (manualPhotoUrl) URL.revokeObjectURL(manualPhotoUrl);
      setStep('identify');
      setPhotoUrl(null);
      setPhotoBlob(null);
      setCropRect(DEFAULT_CROP);
      setResult(null);
      setActiveReading(null);
      setFallbackBusy(false);
      setManualMode(false);
      setManualWeightInput('');
      setManualPhotoBlob(null);
      setManualPhotoUrl(null);
      setError(null);
      setProgress('');
      setConfirmedBooking(null);
      setPendingFullBooking(null);
      setManualSearch('');
      lastInvalidQrRef.current = null;
      liveQrActiveRef.current = false;
      setLiveQrActive(false);
      setLiveQrBusy(false);
    } else {
      prewarmOcr();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (step !== 'verify' || !result || !previewBoxRef.current) return;
    const box = previewBoxRef.current;
    box.innerHTML = '';
    const canvas = renderHighlightedPreview(result);
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    canvas.style.background = '#fff';
    canvas.style.borderRadius = '6px';
    box.appendChild(canvas);
  }, [step, result]);

  const bookingsForPicker = useMemo(() => {
    if (step !== 'manual-picker') return [];
    return listBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step === 'identify') return;
    if (liveQrRafRef.current) {
      window.cancelAnimationFrame(liveQrRafRef.current);
      liveQrRafRef.current = null;
    }
    if (liveQrStreamRef.current) {
      liveQrStreamRef.current.getTracks().forEach((t) => t.stop());
      liveQrStreamRef.current = null;
      liveQrActiveRef.current = false;
      setLiveQrActive(false);
    }
  }, [step]);

  const filteredBookings = useMemo(() => {
    const q = manualSearch.trim().toLowerCase();
    if (!q) return bookingsForPicker;
    return bookingsForPicker.filter((b) =>
      b.anglerName.toLowerCase().includes(q)
      || b.bookingId.toLowerCase().includes(q)
      || (b.bookingRef && b.bookingRef.toLowerCase().includes(q))
      || b.pondName.toLowerCase().includes(q),
    );
  }, [bookingsForPicker, manualSearch]);

  if (!isOpen) return null;

  /**
   * After we have a booking (from QR or manual pick), decide the peg:
   *   • per-seat QR already told us which peg → go straight to capture.
   *   • no seat known and the booking has 2+ pegs → ask staff to pick one.
   *   • single-peg booking → that's the only choice, no need to ask.
   */
  const onBookingResolved = (full: ScannedBookingFull, seatNum?: number) => {
    setError(null);
    if (seatNum != null) {
      setConfirmedBooking(toLite(full, seatNum));
      setStep('capture');
      return;
    }
    if (full.seats.length > 1) {
      setPendingFullBooking(full);
      setStep('pick-seat');
      return;
    }
    setConfirmedBooking(toLite(full, full.seats[0] ?? 0));
    setStep('capture');
  };

  const handleSeatPicked = (seatNum: number) => {
    if (!pendingFullBooking) return;
    setConfirmedBooking(toLite(pendingFullBooking, seatNum));
    setPendingFullBooking(null);
    setStep('capture');
  };

  const stopLiveQrScan = () => {
    if (liveQrRafRef.current) {
      window.cancelAnimationFrame(liveQrRafRef.current);
      liveQrRafRef.current = null;
    }
    if (liveQrStreamRef.current) {
      liveQrStreamRef.current.getTracks().forEach((t) => t.stop());
      liveQrStreamRef.current = null;
    }
    const video = liveQrVideoRef.current;
    if (video) video.srcObject = null;
    liveQrActiveRef.current = false;
    setLiveQrActive(false);
  };

  const runLiveQrFrame = () => {
    const video = liveQrVideoRef.current;
    const canvas = liveQrCanvasRef.current;
    if (!video || !canvas || !liveQrActiveRef.current) return;
    if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
      liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
      return;
    }

    // Skip decoding during the warm-up window right after the camera opens —
    // autofocus/auto-exposure haven't settled yet, so these frames are soft.
    if (performance.now() - liveQrStartedAtRef.current < 350) {
      liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
      return;
    }

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const decoded = decodeQr(imageData.data, imageData.width, imageData.height);
    if (decoded) {
      const parsed = parseQrPayload(decoded);
      const booking = parsed ? lookupBookingFull(parsed.bookingId) : null;
      if (booking) {
        // Valid booking QR → auto-close the camera and proceed.
        lastInvalidQrRef.current = null;
        stopLiveQrScan();
        onBookingResolved(booking, parsed?.seatNum);
        return;
      }
      // A QR was decoded but it isn't a booking for this competition. Surface a
      // "tidak sah" hint once per distinct payload and keep scanning.
      if (lastInvalidQrRef.current !== decoded) {
        lastInvalidQrRef.current = decoded;
        setError('QR tidak sah / tidak dijumpai untuk pertandingan ini. Cuba QR tempahan yang betul.');
      }
    }
    liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
  };

  const startLiveQrScan = async () => {
    setError(null);
    setLiveQrBusy(true);
    try {
      const stream = await openQrCameraStream();
      liveQrStreamRef.current = stream;
      const video = liveQrVideoRef.current;
      if (!video) throw new Error('Elemen video tidak tersedia.');
      video.srcObject = stream;
      await video.play();
      liveQrActiveRef.current = true;
      liveQrStartedAtRef.current = performance.now();
      setLiveQrActive(true);
      liveQrRafRef.current = window.requestAnimationFrame(runLiveQrFrame);
    } catch (err: any) {
      console.error('Live QR start failed:', err);
      setError(err?.message || 'Tidak dapat mengakses kamera. Semak kebenaran browser/peranti.');
      stopLiveQrScan();
    } finally {
      setLiveQrBusy(false);
    }
  };

  const handleQrChosen = async (file: File) => {
    setError(null);
    setStep('qr-processing');
    setProgress('Mengesan kod QR…');
    try {
      const decoded = await decodeQrFromFile(file);
      if (!decoded) {
        setError('QR tidak dapat dikesan dalam gambar. Pastikan QR berada di tengah dan jelas.');
        setStep('identify');
        return;
      }
      const parsed = parseQrPayload(decoded);
      if (!parsed) {
        setError(`QR dikesan tetapi format tidak sah: ${decoded.slice(0, 80)}`);
        setStep('identify');
        return;
      }
      const booking = lookupBookingFull(parsed.bookingId);
      if (!booking) {
        setError('Tempahan tidak dijumpai untuk QR ini. Pastikan QR untuk pertandingan semasa.');
        setStep('identify');
        return;
      }
      onBookingResolved(booking, parsed.seatNum);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Imbasan QR gagal. Sila cuba lagi.');
      setStep('identify');
    }
  };

  const handleManualPick = (booking: ScannedBookingFull) => {
    onBookingResolved(booking);
  };

  const handleWeightFileChosen = async (file: File) => {
    setError(null);
    setPhotoFileName(file.name || 'scale.jpg');
    setPhotoBlob(file);
    const url = URL.createObjectURL(file);
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(url);
    setStep('crop');
  };

  const buildCropCanvas = async (): Promise<HTMLCanvasElement> => {
    if (!photoBlob) throw new Error('Tiada gambar');
    const bitmap = await createImageBitmap(photoBlob);
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const fullW = Math.round(bitmap.width * scale);
    const fullH = Math.round(bitmap.height * scale);

    const cx = Math.round(cropRect.x * fullW);
    const cy = Math.round(cropRect.y * fullH);
    const cw = Math.round(cropRect.w * fullW);
    const ch = Math.round(cropRect.h * fullH);
    if (cw < 20 || ch < 20) throw new Error('Kawasan terlalu kecil');

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas tidak disokong');
    const srcScale = 1 / scale;
    ctx.drawImage(
      bitmap,
      cx * srcScale, cy * srcScale, cw * srcScale, ch * srcScale,
      0, 0, cw, ch,
    );
    return canvas;
  };

  const handleScan = async () => {
    if (!photoBlob) return;
    setStep('processing');
    setProgress('Memproses imej…');
    try {
      const cropCanvas = await buildCropCanvas();
      setProgress('Imbas paparan…');
      const r = await scanWeight(cloneCanvas(cropCanvas), undefined, { usePreprocess, decimalPlaces });
      setResult(r);
      setActiveReading({
        source: 'onnx',
        weight: r.weight,
        displayText: formatScannedWeight(r.rawText, decimalPlaces),
        rawText: r.rawText,
      });
      setManualMode(false);
      setStep('verify');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Imbasan gagal. Sila cuba lagi.');
      setStep('crop');
    }
  };

  // Failsafe #1: deterministic no-ML 7-segment scan of the SAME crop, run when
  // staff decide the ONNX read isn't worth retrying.
  const handleFallbackScan = async () => {
    if (!photoBlob) return;
    setFallbackBusy(true);
    setError(null);
    try {
      const cropCanvas = await buildCropCanvas();
      const fb = sevenSegmentScan(cloneCanvas(cropCanvas));
      const displayText = formatScannedWeight(fb.text, decimalPlaces);
      const num = parseFloat(displayText);
      setActiveReading({
        source: 'sevenseg',
        weight: displayText && Number.isFinite(num) && num > 0 ? num : null,
        displayText,
        rawText: fb.text,
      });
      setManualMode(false);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Imbasan sandaran gagal.');
    } finally {
      setFallbackBusy(false);
    }
  };

  const handleManualPhotoChosen = (file: File) => {
    setManualPhotoFileName(file.name || 'manual-scale.jpg');
    setManualPhotoBlob(file);
    if (manualPhotoUrl) URL.revokeObjectURL(manualPhotoUrl);
    setManualPhotoUrl(URL.createObjectURL(file));
  };

  // Keep activeReading in sync while staff type a manual weight.
  const handleManualWeightChange = (raw: string) => {
    setManualWeightInput(raw);
    const num = parseFloat(raw);
    setActiveReading({
      source: 'manual',
      weight: Number.isFinite(num) && num > 0 ? num : null,
      displayText: raw,
      rawText: raw,
    });
  };

  const handleRetakeWeight = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (manualPhotoUrl) URL.revokeObjectURL(manualPhotoUrl);
    setPhotoUrl(null);
    setPhotoBlob(null);
    setResult(null);
    setActiveReading(null);
    setManualMode(false);
    setManualWeightInput('');
    setManualPhotoBlob(null);
    setManualPhotoUrl(null);
    setError(null);
    setStep('capture');
    setTimeout(() => weightFileInputRef.current?.click(), 50);
  };

  const handleResetIdentify = () => {
    setError(null);
    lastInvalidQrRef.current = null;
    setConfirmedBooking(null);
    setPendingFullBooking(null);
    setManualSearch('');
    setStep('identify');
  };

  const handleApprove = () => {
    if (!activeReading || activeReading.weight === null || !confirmedBooking) return;
    const isManual = activeReading.source === 'manual';
    // Manual entry requires a freshly-captured proof photo; the scanners reuse
    // the captured weight photo.
    const proofBlob = isManual ? manualPhotoBlob : photoBlob;
    const proofName = isManual ? manualPhotoFileName : photoFileName;
    if (!proofBlob) return;
    onApprove({
      weight: activeReading.weight,
      // ONNX reports its own confidence; the deterministic fallback and manual
      // entry don't have a model confidence, so report 0 (the method tag carries
      // the provenance instead).
      ocrConfidence: activeReading.source === 'onnx' && result ? result.confidence : 0,
      ocrRawText: activeReading.rawText,
      userEdited: isManual,
      method: activeReading.source,
      photoBlob: proofBlob,
      photoFileName: proofName,
      scannedBooking: confirmedBooking,
    });
  };

  const approveDisabled =
    !activeReading || activeReading.weight === null ||
    (activeReading.source === 'manual' && !manualPhotoBlob);

  const showBookingChip =
    confirmedBooking
    && step !== 'identify'
    && step !== 'qr-processing'
    && step !== 'manual-picker';

  return (
    <div
      className="modal-overlay open"
      onClick={onClose}
      style={{ zIndex: 9000 }}
    >
      <div
        className="modal"
        style={{ maxWidth: 760, width: '95%', maxHeight: '92vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">
            {(step === 'identify' || step === 'qr-processing' || step === 'manual-picker' || step === 'pick-seat')
              ? '📱 Kenal Pasti Pemancing'
              : '📷 Imbas Timbangan'}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Tutup">×</button>
        </div>
        <div className="modal-body" style={{ padding: '16px' }}>
          {showBookingChip && confirmedBooking && (
            <div style={{
              background: '#ecfdf5', color: '#065f46', padding: '8px 12px',
              borderRadius: 6, marginBottom: 12, fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              <span>✓</span>
              <strong>{confirmedBooking.anglerName}</strong>
              <span style={{ opacity: 0.7 }}>·</span>
              <span>{confirmedBooking.pondName} · {confirmedBooking.pondCode ? formatSeat(confirmedBooking.pondCode, confirmedBooking.seatNum) : `Peg #${confirmedBooking.seatNum}`}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleResetIdentify}
                style={{ marginLeft: 'auto', fontSize: 11 }}
                title="Pilih pemancing lain"
              >
                Tukar
              </button>
            </div>
          )}

          {error && (
            <div style={{
              background: '#fee2e2', color: '#991b1b', padding: '10px 12px',
              borderRadius: 6, marginBottom: 12, fontSize: 14,
            }}>{error}</div>
          )}

          {/* STEP: identify (choose QR scan or manual pick) */}
          {step === 'identify' && (
            <div style={{ padding: '8px 4px' }}>
              <p style={{ marginBottom: 18, color: 'var(--text-muted)', fontSize: 14 }}>
                Pilih cara untuk mengenal pasti pemancing yang sedang ditimbang.
              </p>
              <div style={{ marginBottom: 14, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: '#0f172a', display: liveQrActive ? 'block' : 'none' }}>
                  <video ref={liveQrVideoRef} playsInline muted style={{ width: '100%', maxHeight: 260, objectFit: 'cover', display: 'block' }} />
                  <canvas ref={liveQrCanvasRef} style={{ display: 'none' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', color: '#fff', fontSize: 12 }}>
                    <span>Arahkan kamera ke QR tempahan</span>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.35)' }} onClick={stopLiveQrScan}>Tutup Kamera</button>
                  </div>
                </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{
                  border: '1px solid var(--line)', borderRadius: 12, padding: 22,
                  textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s',
                  background: '#fafbfc',
                }}
                  onClick={() => { if (!liveQrActive) startLiveQrScan(); }}
                >
                  <div style={{ fontSize: 48, marginBottom: 10 }}>📱</div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{liveQrBusy ? 'Membuka Kamera...' : (liveQrActive ? 'Kamera Aktif' : 'Imbas QR Live')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Imbas terus dari kamera peranti
                  </div>
                </div>
                <div style={{
                  border: '1px solid var(--line)', borderRadius: 12, padding: 22,
                  textAlign: 'center', cursor: 'pointer', transition: 'border-color .15s',
                  background: '#fafbfc',
                }}
                  onClick={() => setStep('manual-picker')}
                >
                  <div style={{ fontSize: 48, marginBottom: 10 }}>📋</div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Pilih Manual</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Cari & pilih dari senarai tempahan
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, textAlign: 'center' }}>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => qrFileInputRef.current?.click()}>
                  Atau muat naik gambar QR
                </button>
              </div>
              <input
                ref={qrFileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleQrChosen(f);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {step === 'qr-processing' && (
            <div style={{ textAlign: 'center', padding: '48px 12px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
              <div style={{ fontSize: 16 }}>{progress || 'Mengesan QR…'}</div>
            </div>
          )}

          {/* STEP: manual picker — searchable booking list */}
          {step === 'manual-picker' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Cari nama / ID tempahan / kolam…"
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={handleResetIdentify}>← Kembali</button>
              </div>
              <div style={{
                maxHeight: 380, overflowY: 'auto',
                border: '1px solid var(--line)', borderRadius: 8,
              }}>
                {filteredBookings.length === 0 ? (
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {bookingsForPicker.length === 0
                      ? 'Tiada tempahan untuk pertandingan ini.'
                      : 'Tiada padanan untuk carian.'}
                  </div>
                ) : (
                  filteredBookings.map((b) => (
                    <div
                      key={b.bookingId}
                      onClick={() => handleManualPick(b)}
                      style={{
                        padding: '12px 14px',
                        borderBottom: '1px solid var(--line)',
                        cursor: 'pointer',
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{b.anglerName}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {b.pondName} · {b.pondCode ? formatSeatList(b.pondCode, b.seats) : `Peg ${b.seats.map((s) => `#${s}`).join(', ')}`}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {b.bookingRef || b.bookingId.slice(0, 8)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* STEP: pick which peg — only reached when the booking has 2+ seats
              and we don't already know which one (legacy QR / manual pick). */}
          {step === 'pick-seat' && pendingFullBooking && (
            <div>
              <p style={{ marginBottom: 14, color: 'var(--text-muted)', fontSize: 14 }}>
                <strong>{pendingFullBooking.anglerName}</strong> · {pendingFullBooking.pondName} — pilih peg yang sedang ditimbang.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 10 }}>
                {pendingFullBooking.seats.map((seat) => (
                  <button
                    key={seat}
                    type="button"
                    className="btn"
                    onClick={() => handleSeatPicked(seat)}
                    style={{ padding: '14px 8px', fontWeight: 700 }}
                  >
                    {pendingFullBooking.pondCode ? formatSeat(pendingFullBooking.pondCode, seat) : `#${seat}`}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-ghost btn-sm" onClick={handleResetIdentify}>← Kembali</button>
              </div>
            </div>
          )}

          {/* STEP: capture weight photo */}
          {step === 'capture' && (
            <div style={{ textAlign: 'center', padding: '24px 12px' }}>
              <div style={{ fontSize: 64, marginBottom: 12 }}>📷</div>
              <p style={{ marginBottom: 16, color: 'var(--text-muted)' }}>
                Ambil gambar paparan timbangan digital dengan jelas. Pastikan nombor kelihatan penuh.
              </p>
              <input
                ref={weightFileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleWeightFileChosen(f);
                  e.target.value = '';
                }}
              />
              <button className="btn btn-primary" onClick={() => weightFileInputRef.current?.click()}>
                Ambil / Pilih Gambar Timbangan
              </button>
            </div>
          )}

          {step === 'crop' && photoUrl && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                Seret kotak kuning untuk meliputi <strong>HANYA baris angka pada paparan</strong>.
                <br />
                • <strong>Jangan</strong> masukkan bingkai/bezel hitam di sekeliling.
                <br />
                • <strong>Jangan</strong> masukkan label seperti "TARE", "WEIGHT", "UNIT PRICE".
                <br />
                • Boleh sertakan "kg" jika berdekatan.
                <br />
                • <strong>Cubit</strong> atau guna butang <strong>+ / −</strong> untuk zoom sebelum melaraskan kotak.
              </p>
              <div style={{ textAlign: 'center' }}>
                <CropRectOverlay imageUrl={photoUrl} initial={cropRect} onChange={setCropRect} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn" onClick={handleRetakeWeight}>🔄 Ambil Semula</button>
                <button className="btn btn-primary" onClick={handleScan}>Imbas Kawasan Ini</button>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div style={{ textAlign: 'center', padding: '48px 12px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
              <div style={{ fontSize: 16 }}>{progress || 'Memproses…'}</div>
            </div>
          )}

          {step === 'verify' && result && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Imej diproses
                  </div>
                  <div ref={previewBoxRef} style={{
                    background: '#222', padding: 6, borderRadius: 8, minHeight: 80,
                  }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                      background: result.pickedPolarity === 'invert' ? '#1e40af' : '#374151',
                      color: '#fff',
                    }}>
                      🔄 {result.pickedPolarity}{usePreprocess === false ? ' (raw)' : ''}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      ONNX: {result.rawText ? JSON.stringify(result.rawText) : '(kosong)'}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                    Bacaan untuk disimpan
                    {activeReading && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: '#fff',
                        background: activeReading.source === 'onnx' ? '#374151' : activeReading.source === 'sevenseg' ? '#7c3aed' : '#b45309',
                      }}>
                        {activeReading.source === 'onnx' ? 'ONNX (AI)' : activeReading.source === 'sevenseg' ? 'Sandaran (tanpa AI)' : 'Manual'}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const ok = !!activeReading && activeReading.weight !== null;
                    return (
                      <div style={{
                        display: 'inline-flex', alignItems: 'baseline', gap: 8,
                        padding: '8px 14px', borderRadius: 8,
                        background: ok ? '#f0fdf4' : '#fef2f2',
                        border: `2px solid ${ok ? '#86efac' : '#fca5a5'}`,
                      }}>
                        <span style={{
                          fontSize: 44, fontWeight: 800, lineHeight: 1.1,
                          color: ok ? '#15803d' : '#991b1b',
                          fontFamily: 'var(--font-heading, monospace)',
                        }}>
                          {activeReading?.displayText || '—'}
                        </span>
                        <span style={{ fontSize: 20, fontWeight: 500 }}>kg</span>
                      </div>
                    );
                  })()}
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    Bandingkan dengan paparan timbangan sebenar sebelum simpan.
                  </div>
                </div>
              </div>

              <div style={{
                marginTop: 12, padding: 10, borderRadius: 6,
                background: '#eff6ff', color: '#1e3a8a', fontSize: 13,
              }}>
                ℹ️ Tidak tepat? <strong>Ambil Semula</strong> untuk cuba AI lagi. Jika AI gagal,
                cuba <strong>Imbas Tanpa AI</strong>. Jika masih gagal, <strong>Masukkan Manual</strong>
                {' '}berat sambil melampirkan gambar bukti baharu.
              </div>

              {manualMode && (
                <div style={{ marginTop: 12, padding: 12, border: '1px dashed #b45309', borderRadius: 8, background: '#fffbeb' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>
                    ✍️ Kemasukan Manual — wajib lampirkan gambar bukti baharu
                  </div>
                  <label style={{ fontSize: 12, color: '#92400e' }}>Berat (kg)</label>
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0"
                    value={manualWeightInput}
                    onChange={(e) => handleManualWeightChange(e.target.value)}
                    placeholder="cth: 3.45"
                    style={{ width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #d6bd8e', margin: '4px 0 10px' }}
                  />
                  <input
                    ref={manualPhotoInputRef}
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleManualPhotoChosen(f); e.currentTarget.value = ''; }}
                  />
                  <button className="btn" onClick={() => manualPhotoInputRef.current?.click()}>
                    📷 {manualPhotoBlob ? 'Tukar Gambar Bukti' : 'Ambil Gambar Bukti'}
                  </button>
                  {manualPhotoUrl && (
                    <img src={manualPhotoUrl} alt="bukti" style={{ display: 'block', marginTop: 8, maxWidth: '100%', maxHeight: 160, borderRadius: 6, border: '1px solid var(--line)' }} />
                  )}
                  {!manualPhotoBlob && (
                    <div style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>Gambar bukti diperlukan sebelum simpan.</div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
                <button className="btn" onClick={handleRetakeWeight}>🔄 Ambil Semula</button>
                <button className="btn" disabled={!photoBlob} onClick={handleScan}>🤖 Imbas AI Semula</button>
                <button className="btn" disabled={fallbackBusy || !photoBlob} onClick={handleFallbackScan}>
                  {fallbackBusy ? 'Mengimbas…' : '🔢 Imbas Tanpa AI'}
                </button>
                <button className="btn" onClick={() => setManualMode((m) => !m)}>
                  ✍️ Masukkan Manual
                </button>
                <button
                  className="btn btn-primary"
                  disabled={approveDisabled}
                  onClick={handleApprove}
                  style={approveDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                >
                  ✅ Sahkan &amp; Simpan
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScaleScanModal;
