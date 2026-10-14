// Finds the row of seven-segment digits on a scale photo so the weigh-in crop
// box can be pre-placed. Pure classical image processing on the phone: no
// network, no model, a few milliseconds. It only *suggests* a box — staff still
// confirm it, and a null result falls back to the last-used / default box.

export interface DetectedRect { x: number; y: number; w: number; h: number }

interface Blob { x0: number; y0: number; x1: number; y1: number; cy: number; h: number; w: number }

const MIN_DIGITS = 3;

/** Local-contrast mask: 1 where a pixel is darker/brighter than its surroundings. */
function localMask(gray: Uint8ClampedArray, w: number, h: number, light: boolean): Uint8Array {
  // Integral image for an O(1) local mean.
  const iw = w + 1;
  const integral = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      integral[(y + 1) * iw + x + 1] = integral[y * iw + x + 1] + row;
    }
  }
  const win = Math.max(15, Math.round(Math.max(w, h) / 12)) | 1;
  const half = win >> 1;
  const offset = 10;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
      const sum = integral[y1 * iw + x1] - integral[y0 * iw + x1] - integral[y1 * iw + x0] + integral[y0 * iw + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x];
      mask[y * w + x] = (light ? v > mean + offset : v < mean - offset) ? 1 : 0;
    }
  }
  return mask;
}

/**
 * Separable box dilation so the separate strokes of one digit fuse together.
 * Taller reach vertically: the gap between a "1"'s two strokes is wider than
 * the gaps inside other digits, and rows sit far apart so it rarely merges them.
 */
function dilate(mask: Uint8Array, w: number, h: number, rx: number, ry: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    // Forward then backward pass marks every pixel within r of a set pixel.
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) last = x;
      if (x - last <= rx) tmp[y * w + x] = 1;
    }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) last = x;
      if (last - x <= rx) tmp[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= ry) out[y * w + x] = 1;
    }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= ry) out[y * w + x] = 1;
    }
  }
  return out;
}

/** Digit-shaped connected components of the fused mask. */
function digitBlobs(mask: Uint8Array, w: number, h: number, shrinkX: number, shrinkY: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs: Blob[] = [];
  for (let p = 0; p < w * h; p++) {
    if (!mask[p] || seen[p]) continue;
    let top = 0;
    stack[top++] = p;
    seen[p] = 1;
    let x0 = p % w, x1 = x0, y0 = (p / w) | 0, y1 = y0, area = 0;
    while (top > 0) {
      const q = stack[--top];
      area++;
      const qx = q % w, qy = (q / w) | 0;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
      if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      if (qx > 0 && mask[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[top++] = q - 1; }
      if (qx < w - 1 && mask[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[top++] = q + 1; }
      if (qy > 0 && mask[q - w] && !seen[q - w]) { seen[q - w] = 1; stack[top++] = q - w; }
      if (qy < h - 1 && mask[q + w] && !seen[q + w]) { seen[q + w] = 1; stack[top++] = q + w; }
    }
    // Undo the dilation growth so the box hugs the real strokes.
    const bx0 = x0 + shrinkX, bx1 = x1 - shrinkX, by0 = y0 + shrinkY, by1 = y1 - shrinkY;
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    if (bw < 2 || bh < 2) continue;
    if (bh < 0.03 * h || bh > 0.6 * h) continue;      // too small to read / far too big
    const aspect = bw / bh;
    if (aspect < 0.12 || aspect > 1.05) continue;       // "1" is skinny, 0/8 near square
    if (area / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.2) continue; // hollow frames / noise
    blobs.push({ x0: bx0, y0: by0, x1: bx1, y1: by1, cy: (by0 + by1) / 2, h: bh, w: bw });
  }
  return blobs;
}

/** Best left-to-right chain of similar, aligned, closely spaced digit blobs. */
function bestRow(blobs: Blob[]): { row: Blob[]; score: number } | null {
  let best: { row: Blob[]; score: number } | null = null;
  const all: { row: Blob[]; score: number }[] = [];
  for (const seed of blobs) {
    const mates = blobs
      .filter((b) => Math.abs(b.cy - seed.cy) < 0.35 * seed.h && b.h > 0.7 * seed.h && b.h < 1.43 * seed.h)
      .sort((a, b) => a.x0 - b.x0);
    // Split into runs wherever the gap is wider than a digit-and-a-bit.
    let run: Blob[] = [];
    const flush = () => {
      if (run.length >= MIN_DIGITS && run.includes(seed)) {
        const avgH = run.reduce((s, b) => s + b.h, 0) / run.length;
        const score = run.length * avgH;
        all.push({ row: run, score });
        if (!best || score > best.score) best = { row: run, score };
      }
      run = [];
    };
    for (const b of mates) {
      const prev = run[run.length - 1];
      if (prev && b.x0 - prev.x1 > 0.9 * seed.h) flush();
      run.push(b);
    }
    flush();
  }
  const top = best as { row: Blob[]; score: number } | null;
  if (!top) return null;
  // Price scales show weight | unit price | total side by side in the same size, and the
  // weight is always the leftmost. Prefer the leftmost row that sits level with the best one.
  const avgH = (r: Blob[]) => r.reduce((s, b) => s + b.h, 0) / r.length;
  const midY = (r: Blob[]) => r.reduce((s, b) => s + b.cy, 0) / r.length;
  const bh = avgH(top.row), by = midY(top.row);
  const peers = all.filter((c) => avgH(c.row) >= 0.75 * bh && avgH(c.row) <= 1.33 * bh && Math.abs(midY(c.row) - by) < 0.6 * bh);
  peers.sort((a, b) => a.row[0].x0 - b.row[0].x0);
  return peers[0] ? { row: peers[0].row, score: top.score } : top;
}

/**
 * Locate the digit row in a grayscale image. Returns a normalised rect (0–1)
 * padded a little around the digits, or null when no convincing row of digits
 * is found. Tries both polarities (dark digits on LCD, lit digits on LED).
 */
export function detectDisplayRect(gray: Uint8ClampedArray, w: number, h: number): DetectedRect | null {
  const rx = 2, ry = 4;
  let best: { row: Blob[]; score: number } | null = null;
  for (const light of [false, true]) {
    const mask = dilate(localMask(gray, w, h, light), w, h, rx, ry);
    const found = bestRow(digitBlobs(mask, w, h, rx, ry));
    if (found && (!best || found.score > best.score)) best = found;
  }
  if (!best) return null;

  const row = best.row;
  const digitH = row.reduce((s, b) => s + b.h, 0) / row.length;
  const x0 = Math.min(...row.map((b) => b.x0)) - 0.3 * digitH;
  const x1 = Math.max(...row.map((b) => b.x1)) + 0.3 * digitH;
  const y0 = Math.min(...row.map((b) => b.y0)) - 0.2 * digitH;
  const y1 = Math.max(...row.map((b) => b.y1)) + 0.2 * digitH;
  const nx0 = Math.max(0, x0 / w), ny0 = Math.max(0, y0 / h);
  const nx1 = Math.min(1, x1 / w), ny1 = Math.min(1, y1 / h);
  return { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 };
}

/**
 * Price-scale LCDs are a bright green panel with dark digits. Finding that panel
 * gives a tight, reliable box (just the digits' own display, no labels or neighbours).
 * Several panels sit in a row (weight | unit price | total): the leftmost is the weight.
 */
function detectGreenPanel(rgba: Uint8ClampedArray, w: number, h: number, minG = 130, minDiff = 35, adaptive = false): DetectedRect | null {
  const mask = new Uint8Array(w * h);
  if (adaptive) {
    // Dark rooms wash the LCD out to a pale green, so absolute thresholds fail. Instead keep
    // what is clearly green relative to the greenest things in THIS photo (the LCD is one of them).
    const score = new Uint8Array(w * h);
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; p < w * h; i += 4, p++) {
      // Hue-based, so yellow-green or cyan-green LCDs (phone cameras differ: iPhones tend to
      // render them yellower) score just like pure green. Score = saturation x brightness.
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      let v = 0;
      if (g === mx && mx - mn > 8) {
        const hue = 60 * (2 + (b - r) / (mx - mn)); // 0-360, green sector is 120
        if (hue >= 70 && hue <= 190) v = Math.round(((mx - mn) / mx) * mx);
      }
      score[p] = v;
      hist[v]++;
    }
    let acc = 0, top = 255;
    // The panel can be tiny in a dark wide shot (well under 1% of the frame), so anchor on the greenest 0.3%.
    const keep = Math.max(1, Math.round(w * h * 0.003));
    for (; top > 0; top--) { acc += hist[top]; if (acc >= keep) break; }
    if (top < 12) return null; // nothing green in the photo
    const cut = Math.max(10, Math.round(top * 0.5));
    for (let p = 0; p < w * h; p++) if (score[p] >= cut) mask[p] = 1;
  } else {
    for (let i = 0, p = 0; p < w * h; i += 4, p++) {
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (g >= minG && g - r >= minDiff && g - b >= minDiff) mask[p] = 1;
    }
  }
  // Close the gaps left by the dark digit strokes so the panel is one blob.
  const fused = dilate(mask, w, h, Math.max(3, Math.round(w / 90)), Math.max(3, Math.round(h / 90)));
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const panels: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];
  for (let p = 0; p < w * h; p++) {
    if (!fused[p] || seen[p]) continue;
    let top = 0;
    stack[top++] = p; seen[p] = 1;
    let x0 = p % w, x1 = x0, y0 = (p / w) | 0, y1 = y0, area = 0;
    while (top > 0) {
      const q = stack[--top];
      const qx = q % w, qy = (q / w) | 0;
      if (mask[q]) area++;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx;
      if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      if (qx > 0 && fused[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[top++] = q - 1; }
      if (qx < w - 1 && fused[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[top++] = q + 1; }
      if (qy > 0 && fused[q - w] && !seen[q - w]) { seen[q - w] = 1; stack[top++] = q - w; }
      if (qy < h - 1 && fused[q + w] && !seen[q + w]) { seen[q + w] = 1; stack[top++] = q + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const aspect = bw / bh;
    if (bh < 0.025 * h || bw < 0.05 * w || aspect < 1.3 || aspect > 9) continue;
    if (area / (bw * bh) < 0.3) continue;
    panels.push({ x0, y0, x1, y1, area });
  }
  if (!panels.length) return null;
  const big = panels.reduce((a, b) => (b.area > a.area ? b : a));
  const bigH = big.y1 - big.y0 + 1, bigY = (big.y0 + big.y1) / 2;
  const peers = panels
    .filter((c) => c.area >= 0.4 * big.area && Math.abs((c.y0 + c.y1) / 2 - bigY) < 0.6 * bigH)
    .sort((a, b) => a.x0 - b.x0);
  const pick = peers[0] ?? big;
  // Undo the dilation growth so the box hugs the panel.
  const sx = Math.max(3, Math.round(w / 90)), sy = Math.max(3, Math.round(h / 90));
  const x0 = pick.x0 + sx, x1 = pick.x1 - sx, y0 = pick.y0 + sy, y1 = pick.y1 - sy;
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
}

/** Canvas wrapper: downsizes the photo, then runs the detector. */
export function detectDisplayInBitmap(bitmap: ImageBitmap): DetectedRect | null {
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
  }
  // Green LCD panel first (tightest, works even when the digit blobs are hard to separate).
  // Dark/washed-out photos: the panel is only relative-green, so find it adaptively. Tried after the
  // strict pass, before the digit-row detector (which struggles when contrast is poor).
  return detectGreenPanel(rgba, w, h) ?? detectGreenPanel(rgba, w, h, 0, 0, true) ?? detectDisplayRect(gray, w, h);
}
