import React, { useEffect, useMemo, useRef, useState } from 'react';
import CropRectOverlay, { NormRect } from './CropRectOverlay';
import { scanWeight, prewarmOcr, ScanResult, formatScannedWeight } from '../../utils/scaleOcr';

export interface ScaleScanApproved {
  weight: number;
  /**
   * Sentinel from the ONNX backend: 100 when the model produced a parseable
   * weight, 0 when not. The HIGH/MEDIUM/LOW tier UI has been removed in favour
   * of mandatory staff confirmation — see `userEdited` for whether the saved
   * weight matches the OCR output.
   */
  ocrConfidence: number;
  ocrRawText: string;
  /** True when staff edited the auto-filled weight before saving. */
  userEdited: boolean;
  photoBlob: Blob;
  photoFileName: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApprove: (result: ScaleScanApproved) => void;
  /** Toggleable via CMS Settings (`db.settings.ocrUsePreprocess`). */
  usePreprocess?: boolean;
  /**
   * Force decimal-point position in the OCR output. Undefined = auto-detect
   * from image structure. See `db.settings.ocrDecimalPlaces`.
   */
  decimalPlaces?: 0 | 1 | 2 | 3;
}

type Step = 'capture' | 'crop' | 'processing' | 'verify';

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

// Render the preview canvas with bbox overlays so staff can visually confirm
// what segmentation kept and what it threw out. Only meaningful when
// preprocessing is enabled; with preprocessing off, the rejected/accepted bbox
// arrays are empty and only the raw image is drawn.
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

const ScaleScanModal: React.FC<Props> = ({ isOpen, onClose, onApprove, usePreprocess, decimalPlaces }) => {
  const [step, setStep] = useState<Step>('capture');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string>('scale.jpg');
  const [cropRect, setCropRect] = useState<NormRect>(DEFAULT_CROP);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Editable weight string the staff confirms before save. Pre-filled from the
   * OCR result when one arrives. The Approve button is disabled until this
   * parses to a valid finite positive number.
   */
  const [confirmedWeight, setConfirmedWeight] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      setStep('capture');
      setPhotoUrl(null);
      setPhotoBlob(null);
      setCropRect(DEFAULT_CROP);
      setResult(null);
      setError(null);
      setProgress('');
      setConfirmedWeight('');
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

  // Pre-fill the confirm input directly from the ONNX raw text + decimal-place
  // rule. Going through result.weight (a parsed number then re-formatted with
  // toFixed) caused the displayed value to drift from the actual OCR reading —
  // we now mirror the raw model output exactly.
  useEffect(() => {
    if (!result) return;
    setConfirmedWeight(formatScannedWeight(result.rawText, decimalPlaces));
  }, [result, decimalPlaces]);

  const parsedConfirmed = useMemo(() => {
    const n = parseFloat(confirmedWeight.replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
  }, [confirmedWeight]);

  if (!isOpen) return null;

  const handleFileChosen = async (file: File) => {
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
      setStep('verify');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Imbasan gagal. Sila cuba lagi.');
      setStep('crop');
    }
  };

  const handleRetake = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoBlob(null);
    setResult(null);
    setError(null);
    setConfirmedWeight('');
    setStep('capture');
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

  const handleApprove = () => {
    if (!result || parsedConfirmed === null || !photoBlob) return;
    // userEdited compares the input STRING to what we pre-filled (the canonical
    // ONNX-derived string), not the numeric weight. Avoids false positives from
    // formatting differences (e.g. "123.45" vs "123.450").
    const prefill = formatScannedWeight(result.rawText, decimalPlaces);
    const userEdited = confirmedWeight.trim() !== prefill;
    onApprove({
      weight: parsedConfirmed,
      ocrConfidence: result.confidence,
      ocrRawText: result.rawText,
      userEdited,
      photoBlob,
      photoFileName,
    });
  };

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
          <div className="modal-title">📷 Imbas Timbangan</div>
          <button className="modal-close" onClick={onClose} aria-label="Tutup">×</button>
        </div>
        <div className="modal-body" style={{ padding: '16px' }}>
          {error && (
            <div style={{
              background: '#fee2e2', color: '#991b1b', padding: '10px 12px',
              borderRadius: 6, marginBottom: 12, fontSize: 14,
            }}>{error}</div>
          )}

          {step === 'capture' && (
            <div style={{ textAlign: 'center', padding: '24px 12px' }}>
              <div style={{ fontSize: 64, marginBottom: 12 }}>📷</div>
              <p style={{ marginBottom: 16, color: 'var(--text-muted)' }}>
                Ambil gambar paparan timbangan digital dengan jelas. Pastikan nombor kelihatan penuh.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileChosen(f);
                  e.target.value = '';
                }}
              />
              <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                Ambil / Pilih Gambar
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
              </p>
              <div style={{ textAlign: 'center' }}>
                <CropRectOverlay imageUrl={photoUrl} initial={cropRect} onChange={setCropRect} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn" onClick={handleRetake}>🔄 Ambil Semula</button>
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
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Bacaan dikesan (sahkan / ubah suai)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={confirmedWeight}
                      onChange={(e) => setConfirmedWeight(e.target.value)}
                      placeholder="0.000"
                      style={{
                        fontSize: 44, fontWeight: 700, lineHeight: 1.1, width: '6ch',
                        textAlign: 'right', border: '2px solid var(--border, #e8edf2)',
                        borderRadius: 8, padding: '6px 10px', background: '#fff',
                        color: 'var(--text, #112a41)',
                      }}
                    />
                    <span style={{ fontSize: 22, fontWeight: 500 }}>kg</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    {result.rawText
                      ? `OCR baca ${JSON.stringify(result.rawText)} — boleh edit jika perlu`
                      : 'OCR tidak dapat membaca — masukkan berat secara manual'}
                  </div>
                </div>
              </div>

              <div style={{
                marginTop: 12, padding: 10, borderRadius: 6,
                background: '#eff6ff', color: '#1e3a8a', fontSize: 13,
              }}>
                ℹ️ Bandingkan bacaan di atas dengan paparan timbangan sebenar. Edit jika tidak sepadan, kemudian klik Sahkan &amp; Simpan.
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn" onClick={handleRetake}>🔄 Ambil Semula</button>
                <button
                  className="btn btn-primary"
                  disabled={parsedConfirmed === null}
                  onClick={handleApprove}
                  style={parsedConfirmed === null ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
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
