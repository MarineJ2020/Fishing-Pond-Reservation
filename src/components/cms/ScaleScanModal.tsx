import React, { useEffect, useRef, useState } from 'react';
import CropRectOverlay, { NormRect } from './CropRectOverlay';
import { scanWeight, confidenceTier, prewarmOcr, ScanResult } from '../../utils/scaleOcr';

export interface ScaleScanApproved {
  weight: number;
  ocrConfidence: number;
  ocrRawText: string;
  photoBlob: Blob;
  photoFileName: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApprove: (result: ScaleScanApproved) => void;
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
// what segmentation kept and what it threw out:
//   • Gray box: component the digit-shape filter REJECTED (bezel, label, noise,
//     wrong-polarity giant blob). Lets the user see why a scan failed.
//   • Green box + value: digit-shape blob that the 7-seg recognizer classified.
//   • Red box + "?": digit-shape blob that 7-seg couldn't classify.
//   • Yellow box: detected decimal point.
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

  // 1. Gray rejected boxes first (so digit boxes draw on top).
  ctx.lineWidth = Math.max(1, Math.round(stroke * 0.6));
  ctx.strokeStyle = 'rgba(120, 120, 120, 0.7)';
  ctx.setLineDash([4, 3]);
  for (const b of seg.rejectedBboxes) {
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  }
  ctx.setLineDash([]);

  // 2. Accepted digit boxes + value labels.
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

  // 3. Decimal point marker.
  if (seg.decimalBbox) {
    const b = seg.decimalBbox;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = Math.max(2, Math.round(display.height * 0.015));
    ctx.strokeRect(b.x0 - 2, b.y0 - 2, (b.x1 - b.x0) + 4, (b.y1 - b.y0) + 4);
  }

  return display;
}

const ScaleScanModal: React.FC<Props> = ({ isOpen, onClose, onApprove }) => {
  const [step, setStep] = useState<Step>('capture');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string>('scale.jpg');
  const [cropRect, setCropRect] = useState<NormRect>(DEFAULT_CROP);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      const r = await scanWeight(cloneCanvas(cropCanvas));
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
    setStep('capture');
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

  const handleApprove = () => {
    if (!result || result.weight === null || !photoBlob) return;
    const tier = confidenceTier(result.confidence, result.weight);
    if (tier === 'LOW') return;
    onApprove({
      weight: result.weight,
      ocrConfidence: result.confidence,
      ocrRawText: result.rawText,
      photoBlob,
      photoFileName,
    });
  };

  const tier = result ? confidenceTier(result.confidence, result.weight) : 'LOW';
  const tierColors: Record<string, { bg: string; fg: string; label: string }> = {
    HIGH:   { bg: '#10b981', fg: '#fff', label: 'Yakin Tinggi' },
    MEDIUM: { bg: '#f59e0b', fg: '#fff', label: 'Sila Sahkan' },
    LOW:    { bg: '#ef4444', fg: '#fff', label: 'Tidak Jelas — Ambil Semula' },
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
                      🔄 Auto → {result.pickedPolarity}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {result.rawText ? JSON.stringify(result.rawText) : '(kosong)'}
                    </span>
                  </div>
                  {/* Polarity selection summary: shows the digit counts that drove the auto-pick. */}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
                    {(() => {
                      const parts = Object.entries(result.polarityScores).map(([pol, s]) =>
                        `${pol}=${s.digitCount}d${s.rejectedCount > 0 ? `/${s.rejectedCount}r` : ''}`
                      );
                      return `7-seg blobs: ${parts.join(' | ')} → picked ${result.pickedPolarity}`;
                    })()}
                  </div>
                  {result.debug && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>
                        Debug ({result.debug.length} runs, {result.votes}/{result.totalRuns} agreed)
                      </summary>
                      <pre style={{ fontSize: 10, margin: 0, padding: 6, background: '#1118', color: '#fff', borderRadius: 4, overflow: 'auto', lineHeight: 1.35 }}>
{Object.entries(result.sevenSegByPolarity).map(([pol, s]) => {
  const status = s.weight !== null
    ? `✓ [${s.digits.join('')}]${s.decimalIndex !== null ? ` dec@${s.decimalIndex}` : ''} → ${s.weight}`
    : `✗ unreadable (${s.digitBboxes.length} digit blobs found)`;
  const patterns = s.segmentPatterns.length > 0 ? ` patterns=${s.segmentPatterns.join(',')}` : '';
  return `7-SEG   ${pol.padEnd(6)} ${status}${patterns}`;
}).join('\n')}

{Object.entries(result.structureByPolarity).map(([pol, s]) =>
  `STRUCT  ${pol.padEnd(6)} digits=${s.digitCount}  decimalAt=${s.decimalIndex === null ? '—' : s.decimalIndex}`
).join('\n')}

{result.debug.map(r => {
  const tag = `${r.polarity.padEnd(6)} ${r.engine.padEnd(13)} PSM${r.psm}`;
  const isWinner = r.pick === result.weight && result.weight !== null;
  const winnerMark = isWinner ? ' ←' : '';
  const native = r.nativePick === null ? 'null' : r.nativePick;
  const pick = r.pick === null ? 'null' : r.pick;
  return `OCR     ${tag} conf ${String(r.conf).padStart(3)}  native=${String(native).padEnd(6)} reconstructed=${pick}  ${JSON.stringify(r.text)}${winnerMark}`;
}).join('\n')}
                      </pre>
                    </details>
                  )}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Bacaan dikesan
                  </div>
                  <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>
                    {result.weight !== null ? result.weight.toFixed(2) : '—'}
                    {result.weight !== null && <span style={{ fontSize: 22, fontWeight: 500, marginLeft: 6 }}>kg</span>}
                  </div>
                  <div style={{
                    display: 'inline-block', marginTop: 8, padding: '4px 10px',
                    borderRadius: 999, fontSize: 12, fontWeight: 600,
                    background: tierColors[tier].bg, color: tierColors[tier].fg,
                  }}>
                    {tierColors[tier].label} · {result.confidence}/100
                  </div>
                </div>
              </div>

              {tier === 'LOW' && (
                <div style={{
                  marginTop: 12, padding: 10, borderRadius: 6,
                  background: '#fef2f2', color: '#7f1d1d', fontSize: 13,
                }}>
                  Bacaan tidak jelas atau di luar julat berat yang munasabah.
                  Sila ambil gambar semula dengan paparan yang lebih jelas.
                </div>
              )}
              {tier === 'MEDIUM' && (
                <div style={{
                  marginTop: 12, padding: 10, borderRadius: 6,
                  background: '#fffbeb', color: '#78350f', fontSize: 13,
                }}>
                  Sila sahkan bacaan ini sepadan dengan paparan timbangan sebelum simpan.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn" onClick={handleRetake}>🔄 Ambil Semula</button>
                <button
                  className="btn btn-primary"
                  disabled={tier === 'LOW'}
                  onClick={handleApprove}
                  style={tier === 'LOW' ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
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
