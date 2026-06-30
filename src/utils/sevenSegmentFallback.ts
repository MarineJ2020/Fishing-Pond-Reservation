// No-ML 7-segment OCR fallback.
//
// A faithful TypeScript port of the scanning algorithm in the supplied Python
// script `seven_segment_scale_ui_fixed.py` (tkinter UI omitted). It is used as a
// deterministic safety net when the ONNX model (`scaleOcr.ts`) cannot read a
// scale display: staff trigger it on the verify step.
//
// It operates on the already-cropped HTMLCanvasElement that ScaleScanModal
// builds (the staff has drawn a tight box around the display), so the Python
// full-frame ROI hunt (find_candidate_rois / rotation / roi_angle) is dropped.
// We keep the per-crop pipeline plus the polarity × threshold SWEEP with
// consensus scoring — that sweep is the part that makes it robust.
//
// Mask convention here mirrors OpenCV: a LIT digit pixel = 255 (red channel),
// background = 0. This matches the Python segment-fill math (np.count_nonzero).
// Because the repo's other primitives treat dark(<128) as foreground, every
// connected-component call below passes `foreground: 'light'`.

import {
  gaussianBlur,
  toGrayscale,
  otsuThreshold,
  binarize,
  invert,
  dilate,
  erode,
  morphClose,
  labelComponentsStats,
} from './imageProcessing';

// Segment order (matches the Python DIGITS table / Wikipedia):
//   0=top 1=upper-left 2=upper-right 3=middle 4=lower-left 5=lower-right 6=bottom
const DIGITS: Record<string, string> = {
  '1110111': '0',
  '0010010': '1',
  '1011101': '2',
  '1011011': '3',
  '0111010': '4',
  '1101011': '5',
  '1101111': '6',
  '1010010': '7',
  '1111111': '8',
  '1111011': '9',
};

const RETRY_THRESHOLDS = [0.12, 0.15, 0.18, 0.22, 0.26, 0.3, 0.35];
const MIN_SCORE = 1.5;

type Polarity = 'bright' | 'dark';
interface Box { x: number; y: number; w: number; h: number }

export interface SevenSegFallbackResult {
  text: string;
  weight: number | null;
  score: number;
}

// ─── small numeric helpers (numpy equivalents) ──────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Read a binary mask's red channel as a fast 0/1 (lit) array.
function maskBits(img: ImageData): Uint8Array {
  const d = img.data;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = d[i] >= 128 ? 1 : 0;
  return out;
}

// Count lit pixels inside a sub-rectangle of a mask (clamped to bounds).
function litFill(bits: Uint8Array, W: number, H: number, rx: number, ry: number, rw: number, rh: number): number {
  const x1 = Math.max(0, rx), y1 = Math.max(0, ry);
  const x2 = Math.min(W, rx + rw), y2 = Math.min(H, ry + rh);
  if (x2 <= x1 || y2 <= y1) return -1; // signal empty
  let lit = 0;
  for (let y = y1; y < y2; y++) {
    const row = y * W;
    for (let x = x1; x < x2; x++) lit += bits[row + x];
  }
  const area = (x2 - x1) * (y2 - y1);
  return area > 0 ? lit / area : 0;
}

// ─── mask building / cleaning ───────────────────────────────────────────────

// Drop ring-like / corner / border-spanning blobs that a loose crop catches.
// Port of Python remove_frame_components.
function removeFrameComponents(img: ImageData): void {
  const { width: w, height: h, data: d } = img;
  const { stats, labels } = labelComponentsStats(img, { foreground: 'light' });
  const kill = new Uint8Array(stats.length + 1); // 1-based labels
  for (let i = 0; i < stats.length; i++) {
    const { x, y, w: cw, h: ch, area } = stats[i];
    const touchLeft = x === 0;
    const touchTop = y === 0;
    const touchRight = x + cw >= w;
    const touchBottom = y + ch >= h;
    const touches = (touchLeft ? 1 : 0) + (touchTop ? 1 : 0) + (touchRight ? 1 : 0) + (touchBottom ? 1 : 0);
    const spans = cw >= 0.9 * w && ch >= 0.9 * h;
    const corner = (touchLeft || touchRight) && (touchTop || touchBottom) && area >= 0.02 * w * h;
    if (touches >= 3 || spans || corner) kill[i + 1] = 1;
  }
  for (let p = 0; p < labels.length; p++) {
    if (kill[labels[p]]) {
      const idx = p * 4;
      d[idx] = d[idx + 1] = d[idx + 2] = 0;
    }
  }
}

// erode→dilate (morphological opening) on a lit=255 mask.
function morphOpen(img: ImageData): void {
  erode(img);
  dilate(img);
}

// Preprocess the crop into a binary mask under the requested polarity.
// Port of Python preprocess_display (auto polarity handled by the outer sweep).
function preprocessDisplay(crop: HTMLCanvasElement, polarity: Polarity): ImageData {
  const blurred = gaussianBlur(crop, 2); // ≈ GaussianBlur 5x5
  const ctx = blurred.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const img = ctx.getImageData(0, 0, blurred.width, blurred.height);

  toGrayscale(img);
  const t = otsuThreshold(img);
  binarize(img, t);              // bright pixels → 255 (THRESH_BINARY + OTSU)
  if (polarity === 'dark') invert(img); // dark pixels → 255 (THRESH_BINARY_INV + OTSU)

  removeFrameComponents(img);
  morphOpen(img);
  return img;
}

// ─── shear (italic) correction ──────────────────────────────────────────────

// Find the horizontal shear that sharpens the column projection of the lit
// strokes. Port of Python estimate_shear.
function estimateShear(img: ImageData): number {
  const { width: w, height: h } = img;
  const bits = maskBits(img);
  const xs: number[] = [];
  const yc: number[] = [];
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (bits[row + x]) { xs.push(x); yc.push(y - h / 2); }
    }
  }
  if (h < 10 || xs.length < 50) return 0;

  let bestSkew = 0;
  let bestScore = -1;
  let zeroScore = 0;
  for (let i = 0; i < 19; i++) {
    const skew = -0.45 + i * (0.9 / 18); // np.linspace(-0.45, 0.45, 19)
    let min = Infinity;
    const sheared = new Int32Array(xs.length);
    for (let k = 0; k < xs.length; k++) {
      const v = Math.round(xs[k] - skew * yc[k]);
      sheared[k] = v;
      if (v < min) min = v;
    }
    let max = 0;
    for (let k = 0; k < sheared.length; k++) { sheared[k] -= min; if (sheared[k] > max) max = sheared[k]; }
    const hist = new Float64Array(max + 1);
    for (let k = 0; k < sheared.length; k++) hist[sheared[k]]++;
    let score = 0;
    for (let b = 0; b < hist.length; b++) score += hist[b] * hist[b];
    if (Math.abs(skew) < 1e-9) zeroScore = score;
    if (score > bestScore) { bestScore = score; bestSkew = skew; }
  }

  if (Math.abs(bestSkew) < 0.05 || bestScore < zeroScore * 1.15) return 0;
  return bestSkew;
}

// Apply the shear with nearest-neighbour sampling (a manual remap — using a
// canvas transform would re-antialias and break the binary mask). Forward map
// x' = x - skew*y + 0.5*skew*h, so we inverse-sample srcX = x + skew*y - 0.5*skew*h.
function applyShear(img: ImageData, skew: number): ImageData {
  const { width: w, height: h, data: src } = img;
  const out = new ImageData(w, h);
  const dst = out.data;
  const bias = 0.5 * skew * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.round(x + skew * y - bias);
      const di = (y * w + x) * 4;
      let v = 0;
      if (sx >= 0 && sx < w) v = src[(y * w + sx) * 4];
      dst[di] = dst[di + 1] = dst[di + 2] = v;
      dst[di + 3] = 255;
    }
  }
  return out;
}

// ─── digit boxes ─────────────────────────────────────────────────────────────

// Separable rectangular dilation (max filter), kernel kx×ky centred. Used to
// merge a digit's strokes into one blob before bounding it (Python uses
// getStructuringElement(MORPH_RECT,(kx,ky)) + dilate).
function dilateRect(img: ImageData, kx: number, ky: number): ImageData {
  const { width: w, height: h } = img;
  const rx = kx >> 1, ry = ky >> 1;
  const a = maskBits(img);
  const b = new Uint8Array(w * h);
  // horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dx = -rx; dx <= rx && !on; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && a[row + xx]) on = 1;
      }
      b[row + x] = on;
    }
  }
  // vertical pass
  const out = new ImageData(w, h);
  const od = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -ry; dy <= ry && !on; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h && b[yy * w + x]) on = 1;
      }
      const di = (y * w + x) * 4;
      const v = on ? 255 : 0;
      od[di] = od[di + 1] = od[di + 2] = v;
      od[di + 3] = 255;
    }
  }
  return out;
}

// Port of Python find_digit_boxes.
function findDigitBoxes(img: ImageData): Box[] {
  const { width: w, height: h } = img;
  const bits = maskBits(img);

  const kx = Math.max(3, Math.floor(w / 80));
  const ky = Math.max(5, Math.floor(h / 12));
  const grouped = dilateRect(img, kx, ky);
  const { stats } = labelComponentsStats(grouped, { foreground: 'light' });

  const raw: Box[] = [];
  for (const c of stats) {
    if (c.w * c.h < w * h * 0.0015) continue;
    // Tighten the (inflated) group box to the lit pixels of the ORIGINAL mask.
    let minx = Infinity, miny = Infinity, maxx = -1, maxy = -1;
    for (let y = c.y; y < c.y + c.h; y++) {
      const row = y * w;
      for (let x = c.x; x < c.x + c.w; x++) {
        if (bits[row + x]) {
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
      }
    }
    if (maxx < 0) continue;
    const tx = minx, ty = miny, tw = maxx - minx + 1, th = maxy - miny + 1;

    const aspect = tw / th;
    if (aspect < 0.12 || aspect > 1.2) continue;
    if (th < h * 0.12) continue;

    // Count lit pixels inside the tightened box for the fill check.
    let lit = 0;
    for (let y = ty; y < ty + th; y++) {
      const row = y * w;
      for (let x = tx; x < tx + tw; x++) lit += bits[row + x];
    }
    const fill = lit / Math.max(tw * th, 1);
    if (fill > 0.85 && aspect > 0.35) continue;

    raw.push({ x: tx, y: ty, w: tw, h: th });
  }

  if (raw.length === 0) return [];
  const maxBh = Math.max(...raw.map(b => b.h));
  return raw.filter(b => b.h >= 0.55 * maxBh).sort((a, b) => a.x - b.x);
}

// A narrow box that is mostly one tall vertical bar → a "1".
function looksLikeOne(bits: Uint8Array, W: number, box: Box): boolean {
  const { x, y, w, h } = box;
  if (w * h === 0) return false;
  let lit = 0;
  let firstRow = -1, lastRow = -1;
  for (let yy = y; yy < y + h; yy++) {
    let rowLit = 0;
    const row = yy * W;
    for (let xx = x; xx < x + w; xx++) rowLit += bits[row + xx];
    if (rowLit > 0) { if (firstRow < 0) firstRow = yy; lastRow = yy; }
    lit += rowLit;
  }
  if (lit === 0) return false;
  const fill = lit / (w * h);
  if (fill < 0.25) return false;
  const span = (lastRow - firstRow + 1) / h;
  return span >= 0.55;
}

// Port of Python classify_digit. Returns the matched digit ("?" on failure),
// and the Hamming distance to the matched pattern (0 = exact, null = no match).
function classifyDigit(
  bits: Uint8Array, W: number, H: number, box: Box, onThreshold: number, refWidth: number | null,
): { digit: string; distance: number | null } {
  const { x, y, w, h } = box;
  const originalAspect = w / Math.max(h, 1);
  const narrow = refWidth ? w < 0.55 * refWidth : originalAspect < 0.3;
  if (narrow && looksLikeOne(bits, W, box)) return { digit: '1', distance: 0 };

  const padX = Math.floor(w * 0.08);
  const padY = Math.floor(h * 0.05);
  const x1 = Math.max(0, x - padX);
  const y1 = Math.max(0, y - padY);
  const x2 = Math.min(W, x + w + padX);
  const y2 = Math.min(H, y + h + padY);
  const roiW = x2 - x1;
  const roiH = y2 - y1;
  if (roiW <= 0 || roiH <= 0) return { digit: '?', distance: null };

  // Segment zones (fractions of the padded ROI). Side zones avoid the
  // horizontal strokes' y-bands so their ends don't bleed in.
  const segments = [
    [0.20, 0.00, 0.80, 0.20],
    [0.00, 0.18, 0.30, 0.45],
    [0.70, 0.18, 1.00, 0.45],
    [0.20, 0.42, 0.80, 0.60],
    [0.00, 0.55, 0.30, 0.82],
    [0.70, 0.55, 1.00, 0.82],
    [0.20, 0.80, 0.80, 1.00],
  ];
  const fills: number[] = [];
  for (const [sx1, sy1, sx2, sy2] of segments) {
    const ax1 = x1 + Math.floor(sx1 * roiW);
    const ay1 = y1 + Math.floor(sy1 * roiH);
    const aw = Math.floor(sx2 * roiW) - Math.floor(sx1 * roiW);
    const ah = Math.floor(sy2 * roiH) - Math.floor(sy1 * roiH);
    const f = litFill(bits, W, H, ax1, ay1, aw, ah);
    fills.push(f < 0 ? 0 : f);
  }

  const onCut = Math.max(onThreshold, 0.4 * Math.max(...fills));
  const pattern = fills.map(f => (f > onCut ? 1 : 0)).join('');
  if (DIGITS[pattern]) return { digit: DIGITS[pattern], distance: 0 };

  // Unique-winner fuzzy match.
  const distances = Object.entries(DIGITS)
    .map(([known, digit]) => {
      let dist = 0;
      for (let i = 0; i < 7; i++) if (pattern[i] !== known[i]) dist++;
      return { dist, digit };
    })
    .sort((a, b) => a.dist - b.dist);
  const best = distances[0];
  const second = distances[1];
  if (best.dist <= 2 && second.dist > best.dist) return { digit: best.digit, distance: best.dist };
  return { digit: '?', distance: null };
}

// ─── decimal point detection ─────────────────────────────────────────────────

// Port of Python find_decimal_points.
function findDecimalPoints(img: ImageData, digitBoxes: Box[]): Box[] {
  if (digitBoxes.length === 0) return [];
  const { width: w, height: h } = img;

  const medH = median(digitBoxes.map(b => b.h));
  const medW = median(digitBoxes.map(b => b.w));
  const minDot = Math.max(1.5, medH * 0.025);
  const maxDot = Math.max(4.0, medH * 0.22);

  // MORPH_CLOSE on a copy to consolidate the dot.
  const copy = new ImageData(new Uint8ClampedArray(img.data), w, h);
  morphClose(copy, 1);
  const { stats } = labelComponentsStats(copy, { foreground: 'light' });

  const digitTop = Math.min(...digitBoxes.map(b => b.y));
  const digitBottom = Math.max(...digitBoxes.map(b => b.y + b.h));
  const lowerLimit = digitTop + (digitBottom - digitTop) * 0.55;

  const candidates: Box[] = [];
  for (const c of stats) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    if (cy < lowerLimit) continue;
    if (c.w < minDot || c.h < minDot) continue;
    if (c.w > maxDot || c.h > maxDot) continue;
    const aspect = c.w / Math.max(c.h, 1);
    if (aspect < 0.35 || aspect > 2.8) continue;
    const fill = c.area / Math.max(c.w * c.h, 1);
    if (fill < 0.12) continue;
    // Reject dots that sit inside the upper/middle body of a digit.
    let rejected = false;
    for (const d of digitBoxes) {
      const insideX = d.x <= cx && cx <= d.x + d.w;
      const insideY = d.y <= cy && cy <= d.y + d.h;
      if (insideX && insideY && cy < d.y + d.h * 0.82) { rejected = true; break; }
    }
    if (!rejected) candidates.push({ x: c.x, y: c.y, w: c.w, h: c.h });
  }

  // Keep dots horizontally between digits or just after the last digit.
  const sortedDigits = [...digitBoxes].sort((a, b) => a.x - b.x);
  const filtered: Box[] = [];
  for (const dot of candidates.sort((a, b) => a.x - b.x)) {
    const cx = dot.x + dot.w / 2;
    let near = false;
    for (let i = 0; i < sortedDigits.length; i++) {
      const right = sortedDigits[i].x + sortedDigits[i].w;
      const nextLeft = i + 1 < sortedDigits.length ? sortedDigits[i + 1].x : null;
      if (nextLeft !== null) {
        if (right - medW * 0.25 <= cx && cx <= nextLeft + medW * 0.25) { near = true; break; }
      } else {
        if (right - medW * 0.2 <= cx && cx <= right + medW * 0.95) { near = true; break; }
      }
    }
    if (near) filtered.push(dot);
  }
  return filtered;
}

// Port of Python insert_decimal_digits.
function insertDecimalDigits(digitResults: { box: Box; digit: string }[], decimalBoxes: Box[]): string {
  if (decimalBoxes.length === 0) return digitResults.map(d => d.digit).join('');
  let output = '';
  const used = new Set<number>();
  for (let i = 0; i < digitResults.length; i++) {
    const { box, digit } = digitResults[i];
    output += digit;
    const currentRight = box.x + box.w;
    const nextLeft = i + 1 < digitResults.length ? digitResults[i + 1].box.x : null;
    for (let di = 0; di < decimalBoxes.length; di++) {
      if (used.has(di)) continue;
      const dotX = decimalBoxes[di].x + decimalBoxes[di].w / 2;
      if (nextLeft !== null) {
        if (currentRight <= dotX && dotX <= nextLeft) { output += '.'; used.add(di); }
      } else if (currentRight <= dotX && dotX <= currentRight + box.w * 0.8) {
        output += '.'; used.add(di);
      }
    }
  }
  return output;
}

// Port of Python score_scan.
function scoreScan(digitInfos: { digit: string; distance: number | null }[], text: string): number {
  let score = 0;
  for (const { digit, distance } of digitInfos) {
    if (digit === '?') score -= 0.5;
    else if (distance === 0) score += 1.0;
    else if (distance === 1) score += 0.6;
    else score += 0.3;
  }
  const digitsOnly = text.replace(/\./g, '');
  if (/^\d+(\.\d+)?$/.test(text) && digitsOnly.length >= 2 && digitsOnly.length <= 6) {
    score += 1.0;
    if (text.includes('.')) score += 0.3;
  }
  if (digitsOnly.length < 2) score -= 1.0;
  return score;
}

// Port of Python detect_weight for a single polarity + threshold.
function detectWeight(crop: HTMLCanvasElement, polarity: Polarity, onThreshold: number): { text: string; score: number } {
  let mask = preprocessDisplay(crop, polarity);
  const skew = estimateShear(mask);
  if (skew) {
    mask = applyShear(mask, skew);
    morphClose(mask, 1); // heal ragged strokes after the NN warp
  }

  const { width: W, height: H } = mask;
  const bits = maskBits(mask);
  const boxes = findDigitBoxes(mask);

  const wideWidths = boxes.filter(b => b.w / Math.max(b.h, 1) >= 0.42).map(b => b.w);
  const refWidth = wideWidths.length ? median(wideWidths) : null;

  const digitResults: { box: Box; digit: string }[] = [];
  const digitInfos: { digit: string; distance: number | null }[] = [];
  for (const box of boxes) {
    const { digit, distance } = classifyDigit(bits, W, H, box, onThreshold, refWidth);
    digitResults.push({ box, digit });
    digitInfos.push({ digit, distance });
  }

  const decimalBoxes = findDecimalPoints(mask, boxes);
  const text = insertDecimalDigits(digitResults, decimalBoxes);
  let score = scoreScan(digitInfos, text);

  // Structural bonus: stroke-built digits (mid fill) beat solid blobs.
  for (const { box } of digitResults) {
    const f = litFill(bits, W, H, box.x, box.y, box.w, box.h);
    if (f >= 0.2 && f <= 0.72) score += 0.02;
  }
  return { text, score };
}

// ─── public entry point (reduced auto_scan) ─────────────────────────────────

// Sweep bright/dark polarity × thresholds on the cropped display, score each
// attempt, add a consensus bonus for readings that recur, and return the best.
export function sevenSegmentScan(crop: HTMLCanvasElement): SevenSegFallbackResult {
  const results: { text: string; score: number }[] = [];
  for (const polarity of ['bright', 'dark'] as Polarity[]) {
    for (const threshold of RETRY_THRESHOLDS) {
      let r: { text: string; score: number };
      try {
        r = detectWeight(crop, polarity, threshold);
      } catch {
        continue;
      }
      if (!r.text || r.text.includes('?') || r.score < MIN_SCORE) continue;
      results.push(r);
    }
  }
  if (results.length === 0) return { text: '', weight: null, score: -Infinity };

  // Consensus: a true reading recurs across thresholds/polarities; a misread
  // (one segment off) usually appears only once or twice.
  const votes = new Map<string, number>();
  for (const r of results) votes.set(r.text, (votes.get(r.text) || 0) + 1);
  const boosted = results.map(r => ({
    text: r.text,
    score: r.score + Math.min(1.0, 0.2 * ((votes.get(r.text) || 1) - 1)),
  }));
  boosted.sort((a, b) => b.score - a.score);

  // Dedupe by text, keep the best.
  const best = boosted[0];
  const num = parseFloat(best.text);
  const weight = Number.isFinite(num) && num > 0 ? num : null;
  return { text: best.text, weight, score: best.score };
}
