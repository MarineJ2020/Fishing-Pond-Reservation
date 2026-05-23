// Pure-function primitives for the scale-OCR pre-processing pipeline.
// All functions operate on a 2D canvas context's ImageData, in place.

// Apply a Gaussian blur to a canvas using the browser's native CSS filter.
// Returns a NEW canvas so the original is not mutated. radius=0 returns the
// original canvas unchanged. Used before grayscale/threshold so it softens
// noise and bridges thin broken strokes on 7-segment displays.
export function gaussianBlur(canvas: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  if (radius <= 0) return canvas;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';
  return out;
}

export function toGrayscale(img: ImageData): ImageData {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  return img;
}

// Stretch histogram to full 0-255 range, clipping `clipPct` of pixels at each
// end (defends against glare specks and dead-dark zones).
export function autoContrast(img: ImageData, clipPct = 0.02): ImageData {
  const d = img.data;
  const hist = new Uint32Array(256);
  const pixels = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;

  const clip = Math.floor(pixels * clipPct);
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > clip) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > clip) { hi = v; break; } }

  if (hi <= lo) return img;
  const scale = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i];
    let n = (v - lo) * scale;
    if (n < 0) n = 0; else if (n > 255) n = 255;
    d[i] = d[i + 1] = d[i + 2] = n | 0;
  }
  return img;
}

// Otsu's method: pick the global threshold that minimises intra-class
// variance. Robust against low-contrast and uneven exposure.
export function otsuThreshold(img: ImageData): number {
  const d = img.data;
  const hist = new Uint32Array(256);
  const total = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; threshold = t; }
  }
  return threshold;
}

export function binarize(img: ImageData, threshold: number): ImageData {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] >= threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return img;
}

export function invert(img: ImageData): ImageData {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  return img;
}

export function meanLuminance(img: ImageData): number {
  const d = img.data;
  let sum = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) sum += d[i];
  return sum / n;
}

// 3x3 morphological dilate / erode on a binarised single-channel-in-RGBA image.
// Operates on the red channel; copies result back to all channels.
function morph(img: ImageData, op: 'dilate' | 'erode'): ImageData {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) src[j] = d[i];

  const dst = new Uint8ClampedArray(w * h);
  const target = op === 'dilate' ? 255 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = false;
      outer: for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (src[yy * w + xx] === target) { hit = true; break outer; }
        }
      }
      dst[y * w + x] = hit ? target : (target === 255 ? 0 : 255);
    }
  }

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    d[i] = d[i + 1] = d[i + 2] = dst[j];
  }
  return img;
}

export const dilate = (img: ImageData) => morph(img, 'dilate');
export const erode  = (img: ImageData) => morph(img, 'erode');

// Morphological close: `iterations` passes of dilate followed by the same of
// erode. iterations=1 → effective 3x3 kernel, iterations=2 → effective 5x5.
export function morphClose(img: ImageData, iterations = 1): ImageData {
  for (let i = 0; i < iterations; i++) dilate(img);
  for (let i = 0; i < iterations; i++) erode(img);
  return img;
}

interface ComponentBBox { x0: number; y0: number; x1: number; y1: number; size: number; touchesBorder: boolean }

// Two-pass connected-component labelling on the red channel.
// "Foreground" = dark pixels (digits after polarity normalisation).
function labelComponents(img: ImageData): { labels: Int32Array; bboxes: ComponentBBox[] } {
  const { width: w, height: h, data: d } = img;
  const N = w * h;
  const fg = new Uint8Array(N);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) fg[j] = d[i] < 128 ? 1 : 0;

  const labels = new Int32Array(N);
  const stack = new Int32Array(N);
  let nextLabel = 1;
  const bboxes: ComponentBBox[] = [{ x0: 0, y0: 0, x1: 0, y1: 0, size: 0, touchesBorder: false }];

  for (let p = 0; p < N; p++) {
    if (!fg[p] || labels[p]) continue;
    const label = nextLabel++;
    let top = 0;
    stack[top++] = p;
    let x0 = p % w, y0 = (p / w) | 0, x1 = x0, y1 = y0, size = 0;
    let touchesBorder = false;
    while (top > 0) {
      const q = stack[--top];
      if (labels[q] || !fg[q]) continue;
      labels[q] = label;
      size++;
      const qx = q % w, qy = (q / w) | 0;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
      if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      if (qx === 0 || qx === w - 1 || qy === 0 || qy === h - 1) touchesBorder = true;
      if (qx > 0)     stack[top++] = q - 1;
      if (qx < w - 1) stack[top++] = q + 1;
      if (qy > 0)     stack[top++] = q - w;
      if (qy < h - 1) stack[top++] = q + w;
    }
    bboxes.push({ x0, y0, x1, y1, size, touchesBorder });
  }
  return { labels, bboxes };
}

function eraseLabels(img: ImageData, labels: Int32Array, kill: (b: ComponentBBox) => boolean, bboxes: ComponentBBox[]) {
  const d = img.data;
  for (let p = 0; p < labels.length; p++) {
    const lab = labels[p];
    if (lab && kill(bboxes[lab])) {
      const i = p * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
    }
  }
}

// Erase any component whose pixel-count is below `minAreaFrac × image.area`.
// Use AFTER morphClose so seven-segment digits have been merged into single
// connected components — otherwise each isolated stroke can fall under the
// threshold and the digits vanish.
export function removeSmallComponents(img: ImageData, minAreaFrac = 0.005): ImageData {
  const { labels, bboxes } = labelComponents(img);
  const minArea = Math.max(1, Math.floor(img.width * img.height * minAreaFrac));
  eraseLabels(img, labels, b => b.size < minArea, bboxes);
  return img;
}

// Erase any component whose bounding-box height is below `minHeightFrac × image.height`.
// Height-based is more reliable than area for seven-segment digits — digits are
// tall but thin-stroked, so an area filter risks killing them while keeping
// shorter labels like "TARE" that have wider strokes.
export function removeShortComponents(img: ImageData, minHeightFrac = 0.3): ImageData {
  const { labels, bboxes } = labelComponents(img);
  const minH = Math.max(2, Math.floor(img.height * minHeightFrac));
  eraseLabels(img, labels, b => (b.y1 - b.y0 + 1) < minH, bboxes);
  return img;
}

// Erase any component that touches the image border. Kills LCD bezels / frame
// artifacts that survive thresholding because the user cropped the whole LCD.
export function removeBorderComponents(img: ImageData): ImageData {
  const { labels, bboxes } = labelComponents(img);
  eraseLabels(img, labels, b => b.touchesBorder, bboxes);
  return img;
}

export interface DigitStructure {
  digitCount: number;
  decimalIndex: number | null; // 0-based: 1 means decimal sits after the first digit (X.XXX)
}

// Positive filter for "looks like a 7-segment digit" components.
//
// We define what a real digit looks like and accept only matches, instead of
// trying to enumerate every kind of bad blob to reject. A digit on a digital
// scale display has very predictable proportions:
//
//   • height: 40-95% of image height (tall enough to be a real character,
//     not full-frame which would mean we caught the whole LCD)
//   • width:  4-45% of image width (handles narrow "1"s through to wide "0/8"s,
//     but rules out anything spanning most of the LCD)
//   • aspect ratio w/h: 0.10-1.10 (1s are skinny, 0s/8s approach square but
//     never exceed it on a 7-segment display)
//   • fill density (size / bboxArea): 12-55% (just the segment strokes — a
//     solid blob like the LCD interior under wrong polarity is far denser)
//
// A blob that fails ANY of these is not a digit. Bezels (hollow → low fill),
// LCD interiors (dense + huge → fails fill+width), thin vertical voids
// (wrong aspect ratio) all get rejected here.
function isDigitShapedBlob(b: ComponentBBox, W: number, H: number): boolean {
  const bH = b.y1 - b.y0 + 1;
  const bW = b.x1 - b.x0 + 1;
  if (bH < 0.40 * H || bH > 0.95 * H) return false;
  if (bW < 0.04 * W || bW > 0.45 * W) return false;
  const ar = bW / Math.max(1, bH);
  if (ar < 0.10 || ar > 1.10) return false;
  const fill = b.size / Math.max(1, bW * bH);
  if (fill < 0.12 || fill > 0.55) return false;
  return true;
}

// Inspect a binarised image (dark = foreground) and report how many digit-
// shaped components are present and where, if anywhere, a small dot sits
// between two digits in the lower half of the image. Purely geometric — no
// OCR — so it gives us a trustworthy *structure* even when Tesseract butchers
// the values. Result is also used to score polarity choice in scaleOcr.
export function detectDigitStructure(img: ImageData): DigitStructure {
  const { labels, bboxes } = labelComponents(img);
  const W = img.width;
  const H = img.height;

  // Positive digit-shape filter — see isDigitShapedBlob comment above.
  const digits = bboxes
    .map((b, i) => ({ b, i }))
    .slice(1)
    .filter(({ b }) => isDigitShapedBlob(b, W, H))
    .sort((a, b) => a.b.x0 - b.b.x0);

  // Candidate decimal points: small, roughly square dot sitting in the lower
  // half of the image. 7-segment decimal points are always at the bottom-right
  // of a digit cell, so we look for blobs that are:
  //   • shorter than 25% of image height (rules out digits and tall noise)
  //   • at least 2px tall (rules out single-pixel speckles)
  //   • vertically centred in the lower 50% of the image
  //   • aspect ratio 0.35–2.5 (roughly square; rules out horizontal lines)
  const punctMaxH = 0.25 * H;
  const decimals = bboxes
    .slice(1)
    .filter(b => {
      const h = b.y1 - b.y0 + 1;
      const w = b.x1 - b.x0 + 1;
      const cy = (b.y0 + b.y1) / 2;
      if (h > punctMaxH) return false;
      if (h < 2) return false;
      // Centre must be in the lower half of the image — decimal dots on
      // 7-segment displays always sit below the digit midline.
      if (cy < 0.5 * H) return false;
      const ar = w / Math.max(1, h);
      return ar >= 0.35 && ar <= 2.5;
    })
    .sort((a, b) => a.x0 - b.x0);

  // Find the leftmost decimal candidate that sits horizontally BETWEEN two
  // adjacent digit components. Its position gives us decimalIndex.
  let decimalIndex: number | null = null;
  for (let i = 0; i < digits.length - 1; i++) {
    const leftRight = digits[i].b.x1;
    const rightLeft = digits[i + 1].b.x0;
    if (rightLeft <= leftRight) continue;
    const dot = decimals.find(d => d.x0 >= leftRight && d.x1 <= rightLeft);
    if (dot) { decimalIndex = i + 1; break; }
  }

  // Sanity: refuse to report if we found nothing plausible.
  if (digits.length === 0 || digits.length > 8) {
    return { digitCount: 0, decimalIndex: null };
  }
  return { digitCount: digits.length, decimalIndex };
}

// ─── 7-Segment Geometric Recognition ─────────────────────────────────────────
//
// Port of the PyImageSearch method (pyimagesearch.com/2017/02/13/…):
// for each digit blob in the binarised image, divide its bounding box into the
// seven canonical segment regions and measure the dark-pixel fill ratio of each
// region to determine which segments are "on". A static lookup table maps the
// 7-bit on/off pattern to the digit value 0-9. No OCR model required.
//
// Segment index order (matches PyImageSearch code & Wikipedia Figure 2):
//   0 = top          ─────
//   1 = top-left    |
//   2 = top-right        |
//   3 = center       ─────
//   4 = bottom-left |
//   5 = bottom-right     |
//   6 = bottom       ─────
//
// After the pipeline runs gaussianBlur → binarize → morphClose, digits are
// dark (< 128) on a white background for BOTH polarities (the invert step
// ensures that). countDarkInRect therefore always counts digit pixels.

export interface Bbox { x0: number; y0: number; x1: number; y1: number }

export interface SevenSegResult {
  /** Recognised digits, left-to-right. Empty when recognition failed. */
  digits: number[];
  /** Bounding boxes of each accepted digit blob, in source-canvas pixel coords. */
  digitBboxes: Bbox[];
  /** Bounding boxes of components that were considered but failed the
   *  digit-shape filter. Drawn in gray in the overlay so staff can see WHY
   *  segmentation rejected something (e.g. bezel, label, polarity-mismatch blob). */
  rejectedBboxes: Bbox[];
  /** 0-based position after which the decimal sits (same as DigitStructure). */
  decimalIndex: number | null;
  /** Bbox of the detected decimal point, or null if none found. */
  decimalBbox: Bbox | null;
  /** Reconstructed numeric weight, or null when out of range / unreadable. */
  weight: number | null;
  /** Per-digit segment-on pattern (7-char "1010101" string). For debug overlay. */
  segmentPatterns: string[];
}

// Lookup: join([seg0..seg6]) → digit 0-9.
// Derived from the standard 7-segment truth table; verified against all ten digits.
const SEG_LOOKUP: Readonly<Record<string, number>> = {
  '1110111': 0,
  '0010010': 1,
  '1011101': 2,
  '1011011': 3,
  '0111010': 4,
  '1101011': 5,
  '1101111': 6,
  '1010010': 7,
  '1111111': 8,
  '1111011': 9,
};

// We attempt recognition at several "segment on" thresholds and accept the
// first one that resolves every digit to a valid pattern. Wider-stroke fonts
// need a higher threshold (segments are filled more solidly); thin or partly
// broken strokes need a lower threshold. Ordering puts the most common case
// (well-formed segments around 50% fill) first.
const SEG_ON_THRESHOLDS = [0.45, 0.35, 0.55, 0.28];

/** Count dark (< 128) pixels in an axis-aligned rectangle of an ImageData. */
function countDarkInRect(
  d: Uint8ClampedArray, imgW: number, imgH: number,
  x0: number, y0: number, x1: number, y1: number,
): { count: number; area: number } {
  const ax0 = Math.max(0, x0 | 0);
  const ay0 = Math.max(0, y0 | 0);
  const ax1 = Math.min(imgW, x1 | 0);
  const ay1 = Math.min(imgH, y1 | 0);
  let count = 0;
  for (let y = ay0; y < ay1; y++) {
    const row = y * imgW;
    for (let x = ax0; x < ax1; x++) {
      if (d[(row + x) * 4] < 128) count++;
    }
  }
  return { count, area: Math.max(1, (ax1 - ax0) * (ay1 - ay0)) };
}

// Classify one digit blob into 0-9 at a given segment-on threshold.
// Returns { digit, hammingDist, pattern } or null if no good match.
function classifyDigit(
  d: Uint8ClampedArray, W: number, H: number, b: ComponentBBox, threshold: number,
): { digit: number; dist: number; pattern: string } | null {
  const bW = b.x1 - b.x0 + 1;
  const bH = b.y1 - b.y0 + 1;
  const dW  = Math.max(2, Math.round(bW * 0.25));
  const dH  = Math.max(2, Math.round(bH * 0.15));
  const dHC = Math.max(1, Math.round(bH * 0.05));
  const mid = Math.round(bH / 2);

  const segs: Array<[number, number, number, number]> = [
    [0,       0,          bW,     dH        ],  // 0 top
    [0,       0,          dW,     mid       ],  // 1 top-left
    [bW - dW, 0,          bW,     mid       ],  // 2 top-right
    [0,       mid - dHC,  bW,     mid + dHC ],  // 3 center
    [0,       mid,        dW,     bH        ],  // 4 bottom-left
    [bW - dW, mid,        bW,     bH        ],  // 5 bottom-right
    [0,       bH - dH,    bW,     bH        ],  // 6 bottom
  ];

  const on = segs.map(([rx0, ry0, rx1, ry1]) => {
    const { count, area } = countDarkInRect(
      d, W, H, b.x0 + rx0, b.y0 + ry0, b.x0 + rx1, b.y0 + ry1,
    );
    return (count / area) > threshold ? 1 : 0;
  });

  const key = on.join('');
  const exact = SEG_LOOKUP[key];
  if (exact !== undefined) return { digit: exact, dist: 0, pattern: key };

  // Fuzzy match with Hamming distance ≤ 1 — one segment misclassified.
  let bestDist = 8;
  let bestDigit = -1;
  for (const [k, v] of Object.entries(SEG_LOOKUP)) {
    let dist = 0;
    for (let i = 0; i < 7; i++) if (k[i] !== key[i]) dist++;
    if (dist < bestDist) { bestDist = dist; bestDigit = v; }
  }
  return bestDist <= 1 ? { digit: bestDigit, dist: bestDist, pattern: key } : null;
}

/**
 * Recognise digits in a binarised ImageData using the 7-segment geometric
 * method (PyImageSearch, 2017). Tries multiple on-thresholds and picks the
 * first one that resolves every digit. Returns bboxes so the UI can highlight
 * exactly what was read.
 */
export function sevenSegmentRecognize(img: ImageData): SevenSegResult {
  const { width: W, height: H, data: d } = img;
  const { bboxes } = labelComponents(img);

  const toBbox = (b: ComponentBBox): Bbox => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });

  // Partition components: digit-shaped (accepted) vs everything else (rejected,
  // surfaced for debug overlay). Skip the placeholder at index 0.
  const accepted: ComponentBBox[] = [];
  const rejected: Bbox[] = [];
  for (let i = 1; i < bboxes.length; i++) {
    const b = bboxes[i];
    if (isDigitShapedBlob(b, W, H)) accepted.push(b);
    else rejected.push(toBbox(b));
  }
  const digitBlobs = accepted.sort((a, b) => a.x0 - b.x0);

  const empty: SevenSegResult = {
    digits: [], digitBboxes: [], rejectedBboxes: rejected,
    decimalIndex: null, decimalBbox: null,
    weight: null, segmentPatterns: [],
  };

  if (digitBlobs.length === 0 || digitBlobs.length > 8) return empty;

  const digitBboxes = digitBlobs.map(toBbox);

  // ── Decimal-point detection (improved) ──────────────────────────────────────
  // A 7-segment decimal point sits at the bottom-right of a digit cell. Its
  // bbox can either fit fully in the gap between two digits, OR overlap into
  // the right edge of a digit cell (common when morphClose merges digits with
  // their own decimal stub). We score candidates and pick the most likely one.
  const punctMaxH = 0.30 * H;
  const dotCandidates = bboxes.slice(1).filter(b => {
    const bh = b.y1 - b.y0 + 1;
    const bw = b.x1 - b.x0 + 1;
    const cy = (b.y0 + b.y1) / 2;
    if (bh > punctMaxH || bh < 2) return false;
    if (cy < 0.55 * H) return false; // must be in lower 45%
    const ar = bw / Math.max(1, bh);
    return ar >= 0.35 && ar <= 2.5;
  });

  let decimalIndex: number | null = null;
  let decimalBbox: Bbox | null = null;
  // For each adjacent digit pair, find the strongest dot candidate in the
  // "decimal zone" — right 30% of left digit through left 30% of right digit.
  for (let i = 0; i < digitBlobs.length - 1; i++) {
    const left = digitBlobs[i];
    const right = digitBlobs[i + 1];
    const lW = left.x1 - left.x0;
    const rW = right.x1 - right.x0;
    const zoneL = left.x0 + lW * 0.7;
    const zoneR = right.x0 + rW * 0.3;
    let bestSize = 0;
    let bestDot: ComponentBBox | null = null;
    for (const dot of dotCandidates) {
      const cx = (dot.x0 + dot.x1) / 2;
      if (cx < zoneL || cx > zoneR) continue;
      if (dot.size > bestSize) { bestSize = dot.size; bestDot = dot; }
    }
    if (bestDot) {
      decimalIndex = i + 1;
      decimalBbox = toBbox(bestDot);
      break;
    }
  }

  // ── Digit recognition: try thresholds until every digit resolves ────────────
  let recognizedDigits: number[] = [];
  let segmentPatterns: string[] = [];
  for (const threshold of SEG_ON_THRESHOLDS) {
    const tryDigits: number[] = [];
    const tryPatterns: string[] = [];
    let allResolved = true;
    for (const b of digitBlobs) {
      const r = classifyDigit(d, W, H, b, threshold);
      if (!r) { allResolved = false; break; }
      tryDigits.push(r.digit);
      tryPatterns.push(r.pattern);
    }
    if (allResolved) {
      recognizedDigits = tryDigits;
      segmentPatterns = tryPatterns;
      break;
    }
  }
  if (recognizedDigits.length === 0) {
    return { ...empty, digitBboxes, decimalBbox, decimalIndex };
  }

  // ── Reconstruct numeric weight ──────────────────────────────────────────────
  let weight: number | null = null;
  let str = recognizedDigits.join('');
  if (decimalIndex !== null && decimalIndex > 0 && decimalIndex < str.length) {
    str = str.slice(0, decimalIndex) + '.' + str.slice(decimalIndex);
  }
  const num = parseFloat(str);
  if (isFinite(num) && num >= 0.01 && num <= 50.0) weight = num;

  return {
    digits: recognizedDigits, digitBboxes,
    rejectedBboxes: rejected,
    decimalIndex, decimalBbox, weight, segmentPatterns,
  };
}

// Nearest-neighbour upscale to a target height (preserves edge sharpness on
// binarised content — crucial for seven-segment glyphs).
export function upscaleToHeight(canvas: HTMLCanvasElement, targetH: number): HTMLCanvasElement {
  if (canvas.height >= targetH) return canvas;
  const factor = targetH / canvas.height;
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * factor);
  out.height = Math.round(canvas.height * factor);
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}
