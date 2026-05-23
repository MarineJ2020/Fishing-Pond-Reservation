// Orchestrates the scale-OCR pipeline.
//
// Per scan, we now:
//   1. Preprocess the crop under BOTH polarities (cheap, all canvas ops).
//   2. Run the 7-seg geometric recognizer + structure detector on each.
//   3. SCORE each polarity by how many digit-shaped blobs were found,
//      and pick the higher-scoring one (ties broken by fewer rejected blobs).
//   4. Run Tesseract (dual engine × multi PSM) on the chosen polarity only.
//   5. Vote — but reject 1-digit 7-seg reads as suspicious (almost always a
//      polarity-mismatch giant blob that survived the digit-shape filter).
//   6. Compute confidence based on 7-seg ↔ Tesseract agreement.
//
// vs. previous behaviour: we used to bracket BOTH polarities through every
// downstream stage, which doubled OCR cost and made wrong-polarity
// hallucinations (the "fake 8" case) compete on equal footing with correct
// reads. Directed selection cuts both problems in one go.

import {
  gaussianBlur,
  toGrayscale,
  autoContrast,
  otsuThreshold,
  binarize,
  invert,
  morphClose,
  removeSmallComponents,
  removeBorderComponents,
  upscaleToHeight,
  detectDigitStructure,
  sevenSegmentRecognize,
  SevenSegResult,
  DigitStructure,
} from './imageProcessing';

export type Polarity = 'auto' | 'normal' | 'invert';
export type Engine   = 'letsgodigital' | 'eng';

export interface OcrParams {
  contrastClip: number;
  blurRadius: number;
  minAreaFrac: number;
  morphIterations: number;
  upscaleHeight: number;
  polarity: Polarity;
}

export const DEFAULT_PARAMS: OcrParams = {
  contrastClip: 0.02,
  blurRadius: 0,
  minAreaFrac: 0,
  morphIterations: 1,
  upscaleHeight: 200,
  polarity: 'auto',
};

export interface DebugRun {
  polarity: 'normal' | 'invert';
  engine: Engine;
  psm: number;
  text: string;
  conf: number;
  pick: number | null;       // structure-aware reconstructed value
  nativePick: number | null; // regex-only pick from raw text, for comparison
}

export interface PolarityScore {
  digitCount: number;        // digit-shaped blobs from detectDigitStructure
  rejectedCount: number;     // non-digit-shaped blobs (for tie-breaking)
  sevenSegWeight: number | null; // the 7-seg recognizer's reading
  sevenSegDigits: number;    // how many digits the recognizer accepted
}

export interface ScanResult {
  weight: number | null;
  confidence: number;          // 0-100; high when multiple runs agree
  rawText: string;
  preprocessedCanvas: HTMLCanvasElement;
  pickedPolarity: 'normal' | 'invert';
  structureByPolarity: Record<string, DigitStructure>;
  sevenSegByPolarity: Record<string, SevenSegResult>; // geometric 7-seg reads
  polarityScores: Record<string, PolarityScore>;      // for the debug summary line
  votes: number;               // weighted votes for the winning value
  totalRuns: number;
  debug?: DebugRun[];
}

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export function confidenceTier(score: number, parsed: number | null): ConfidenceTier {
  if (parsed === null) return 'LOW';
  if (score >= 80) return 'HIGH';
  if (score >= 60) return 'MEDIUM';
  return 'LOW';
}

// Letters that the `eng` model often spits out instead of seven-segment digits.
const LETTER_TO_DIGIT: Record<string, string> = {
  T: '7', t: '7',
  I: '1', i: '1', l: '1', '|': '1', '!': '1',
  O: '0', o: '0', Q: '0', D: '0', U: '0',
  B: '8',
  S: '5', s: '5',
  Z: '2', z: '2',
  G: '6', b: '6',
  q: '9', g: '9',
  A: '4',
};

function normaliseDigits(text: string): string {
  let out = '';
  for (const c of text) {
    if (c >= '0' && c <= '9') out += c;
    else if (LETTER_TO_DIGIT[c]) out += LETTER_TO_DIGIT[c];
  }
  return out;
}

const WEIGHT_FIND = /(\d{1,2})(?:[.,](\d{1,3}))?/g;

function nativeCandidate(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(WEIGHT_FIND)) {
    const intPart = m[1];
    const fracPart = m[2] || '';
    const num = parseFloat(fracPart ? `${intPart}.${fracPart}` : intPart);
    if (!isFinite(num) || num < 0.01 || num > 50.0) continue;
    if (best === null || num > best) best = num;
  }
  return best;
}

function reconstructWeight(rawText: string, structure: DigitStructure | null): number | null {
  if (!structure || structure.digitCount === 0) return nativeCandidate(rawText);

  const digits = normaliseDigits(rawText);
  if (digits.length === 0) return nativeCandidate(rawText);

  let useDigits = digits;
  if (digits.length > structure.digitCount) {
    useDigits = digits.slice(0, structure.digitCount);
  } else if (digits.length < structure.digitCount) {
    return nativeCandidate(rawText);
  }

  let formatted: string;
  if (
    structure.decimalIndex !== null
    && structure.decimalIndex > 0
    && structure.decimalIndex < useDigits.length
  ) {
    formatted = useDigits.slice(0, structure.decimalIndex) + '.' + useDigits.slice(structure.decimalIndex);
  } else {
    formatted = useDigits;
  }

  const num = parseFloat(formatted);
  if (!isFinite(num) || num < 0.01 || num > 50.0) return nativeCandidate(rawText);
  return num;
}

function preprocess(crop: HTMLCanvasElement, params: OcrParams, polarity: 'normal' | 'invert'): HTMLCanvasElement {
  const working = gaussianBlur(crop, params.blurRadius);

  const ctx = working.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const img = ctx.getImageData(0, 0, working.width, working.height);

  toGrayscale(img);
  autoContrast(img, params.contrastClip);
  const t = otsuThreshold(img);
  binarize(img, t);
  if (polarity === 'invert') invert(img);
  // Strip the bezel BEFORE morphology — otherwise dilate will fuse the
  // outermost digit strokes into the bezel, producing one giant blob that
  // the digit-shape filter rejects → zero digits found.
  removeBorderComponents(img);
  if (params.morphIterations > 0) morphClose(img, params.morphIterations);
  if (params.minAreaFrac > 0) removeSmallComponents(img, params.minAreaFrac);

  ctx.putImageData(img, 0, 0);
  return params.upscaleHeight > working.height ? upscaleToHeight(working, params.upscaleHeight) : working;
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (ctx) ctx.drawImage(src, 0, 0);
  return out;
}

const workerPromises: Partial<Record<Engine, Promise<any>>> = {};

async function getWorker(engine: Engine) {
  if (!workerPromises[engine]) {
    workerPromises[engine] = (async () => {
      const Tesseract = await import('tesseract.js');
      const worker = await Tesseract.createWorker(engine, 1, {
        langPath: `${window.location.origin}/tessdata`,
        gzip: false,
      });
      return worker;
    })();
  }
  return workerPromises[engine]!;
}

export function prewarmOcr() {
  getWorker('letsgodigital').catch(() => { delete workerPromises.letsgodigital; });
  getWorker('eng').catch(() => { delete workerPromises.eng; });
}

const PSM_MODES = [7, 6, 11] as const;
const ENGINES: Engine[] = ['letsgodigital', 'eng'];

// 7-seg reads with FEWER than this many digits are treated as suspicious and
// contribute zero votes. A 1-digit "8" is almost always the wrong-polarity
// LCD-interior blob slipping past the shape filter; real scale readings
// reliably have 2+ digits visible.
const SEG_MIN_DIGITS = 2;

// Vote weight per accepted 7-seg digit. A clean 4-digit read gets 4×2=8 votes,
// dwarfing typical Tesseract noise contributions.
const SEG_VOTE_BASE = 2;

export async function scanWeight(
  crop: HTMLCanvasElement,
  params: OcrParams = DEFAULT_PARAMS,
): Promise<ScanResult> {
  // Polarities we ATTEMPT (for structure scoring). If polarity is forced,
  // there's only one candidate; auto evaluates both then picks.
  const candidatePolarities: Array<'normal' | 'invert'> =
    params.polarity === 'auto' ? ['normal', 'invert'] : [params.polarity];

  // ── Step 1: Preprocess + geometric analysis for EVERY candidate polarity. ──
  //   This is cheap (all canvas ops). Tesseract is the expensive part and
  //   will only run on the chosen polarity below.
  const preByPolarity: Record<string, HTMLCanvasElement> = {};
  const structureByPolarity: Record<string, DigitStructure> = {};
  const sevenSegByPolarity: Record<string, SevenSegResult> = {};
  const polarityScores: Record<string, PolarityScore> = {};

  for (const pol of candidatePolarities) {
    const pre = preprocess(cloneCanvas(crop), params, pol);
    preByPolarity[pol] = pre;
    const ctx = pre.getContext('2d', { willReadFrequently: true })!;
    const imgData = ctx.getImageData(0, 0, pre.width, pre.height);
    const structure = detectDigitStructure(imgData);
    const sevenSeg = sevenSegmentRecognize(imgData);
    structureByPolarity[pol] = structure;
    sevenSegByPolarity[pol] = sevenSeg;
    polarityScores[pol] = {
      digitCount: structure.digitCount,
      rejectedCount: sevenSeg.rejectedBboxes.length,
      sevenSegWeight: sevenSeg.weight,
      sevenSegDigits: sevenSeg.digits.length,
    };
  }

  // ── Step 2: Directed polarity selection. ──
  // Pick the polarity with the most digit-shaped blobs. Ties → fewer rejects.
  // (If params.polarity was forced, the candidate list has only one entry
  // and this picks it trivially.)
  const pickedPolarity = candidatePolarities.slice().sort((a, b) => {
    const sa = polarityScores[a];
    const sb = polarityScores[b];
    if (sb.digitCount !== sa.digitCount) return sb.digitCount - sa.digitCount;
    return sa.rejectedCount - sb.rejectedCount;
  })[0];

  const preChosen = preByPolarity[pickedPolarity];
  const structureChosen = structureByPolarity[pickedPolarity];
  const sevenSegChosen = sevenSegByPolarity[pickedPolarity];

  // ── Step 3: Tesseract on the chosen polarity only. ──
  const allRuns: DebugRun[] = [];
  for (const engine of ENGINES) {
    const worker = await getWorker(engine);
    for (const psm of PSM_MODES) {
      await worker.setParameters({ tessedit_pageseg_mode: String(psm) as any });
      const { data } = await worker.recognize(preChosen);
      const text = (data.text ?? '').trim();
      const conf = typeof data.confidence === 'number' ? data.confidence : 0;
      const pick = reconstructWeight(text, structureChosen);
      const nativePick = nativeCandidate(text);
      allRuns.push({ polarity: pickedPolarity, engine, psm, text, conf, pick, nativePick });
    }
  }

  // ── Step 4: Vote tally. ──
  // - 7-seg with ≥ SEG_MIN_DIGITS digits → digit-weighted vote.
  // - 7-seg with < SEG_MIN_DIGITS digits → REJECTED (0 votes). Most likely a
  //   wrong-polarity giant blob that sneaked past the shape filter.
  // - Tesseract runs → 1 vote each.
  const votes = new Map<number, number>();

  if (
    sevenSegChosen.weight !== null
    && sevenSegChosen.digits.length >= SEG_MIN_DIGITS
  ) {
    const w = SEG_VOTE_BASE * sevenSegChosen.digits.length;
    votes.set(sevenSegChosen.weight, (votes.get(sevenSegChosen.weight) ?? 0) + w);
  }
  for (const r of allRuns) {
    if (r.pick !== null) votes.set(r.pick, (votes.get(r.pick) ?? 0) + 1);
  }

  let winner: number | null = null;
  let topVotes = 0;
  for (const [val, count] of votes) {
    if (count > topVotes) { topVotes = count; winner = val; }
  }

  // ── Step 5: Confidence calibration ────────────────────────────────────────
  // We've halved the OCR budget (one polarity instead of two), so the
  // max-achievable vote totals are lower. Re-tune:
  const sevenSegContributes =
    sevenSegChosen.weight === winner
    && winner !== null
    && sevenSegChosen.digits.length >= SEG_MIN_DIGITS;
  const tessAgreement = sevenSegContributes
    ? topVotes - SEG_VOTE_BASE * sevenSegChosen.digits.length
    : topVotes;

  let confidence: number;
  if (winner === null) {
    confidence = 0;
  } else if (sevenSegContributes && sevenSegChosen.digits.length >= 3 && tessAgreement >= 2) {
    confidence = 95; // 7-seg with ≥3 digits + Tesseract cross-validation
  } else if (sevenSegContributes && sevenSegChosen.digits.length >= 2) {
    confidence = 80; // 7-seg with ≥2 digits, with or without Tesseract help
  } else if (tessAgreement >= 3) {
    confidence = 70; // No 7-seg signal but Tesseract agrees strongly
  } else if (topVotes >= 2) {
    confidence = 55;
  } else {
    confidence = 40;
  }

  const totalRuns =
    allRuns.length
    + (sevenSegContributes ? SEG_VOTE_BASE * sevenSegChosen.digits.length : 0);

  // ── Step 6: Build the result. ─────────────────────────────────────────────
  const repr = allRuns
    .filter(r => r.pick === winner && winner !== null)
    .sort((a, b) => b.conf - a.conf)[0]
    ?? allRuns[0];

  return {
    weight: winner,
    confidence,
    rawText: repr?.text ?? '',
    preprocessedCanvas: preChosen,
    pickedPolarity,
    structureByPolarity,
    sevenSegByPolarity,
    polarityScores,
    votes: topVotes,
    totalRuns,
    debug: allRuns.map(r => ({ ...r, conf: Math.round(r.conf) })),
  };
}
