// Orchestrates the scale-OCR pipeline.
//
// V2: Tesseract has been replaced with a CNN+BiGRU+CTC ONNX model
// (seven-segment-ocr-WEB by MarineJ2020), run client-side via onnxruntime-web.
// One forward pass replaces the previous 6-way Tesseract voting.
//
// Per scan we:
//   1. (Optional) Preprocess the crop under BOTH polarities and pick the better
//      one via the existing geometric digit-shape filter. The chosen pre-canvas
//      and structure metadata feed both the ONNX model and the verify-step
//      debug overlay. Toggle via `opts.usePreprocess`.
//   2. Feed the chosen canvas (preprocessed OR raw crop) to the ONNX session.
//   3. Parse the ONNX string into a numeric weight, using the structure-aware
//      reconstruction helpers if available.
//
// The exported ScanResult shape is preserved so ScaleScanModal compiles
// unchanged. Fields specific to the old multi-engine pipeline (votes,
// totalRuns, debug) are now sentinel values — the verify UI gates on staff
// confirmation, not on OCR confidence.

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
import { getOcrSession } from '../lib/sevenSegmentOcr';

export type Polarity = 'auto' | 'normal' | 'invert';
export type Engine   = 'letsgodigital' | 'eng'; // kept for legacy DebugRun typing

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
  pick: number | null;
  nativePick: number | null;
}

export interface PolarityScore {
  digitCount: number;
  rejectedCount: number;
  sevenSegWeight: number | null;
  sevenSegDigits: number;
}

export interface ScanResult {
  weight: number | null;
  confidence: number;
  rawText: string;
  preprocessedCanvas: HTMLCanvasElement;
  pickedPolarity: 'normal' | 'invert';
  structureByPolarity: Record<string, DigitStructure>;
  sevenSegByPolarity: Record<string, SevenSegResult>;
  polarityScores: Record<string, PolarityScore>;
  votes: number;
  totalRuns: number;
  debug?: DebugRun[];
}

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * @deprecated Kept for backwards-compat with ScaleScanModal during the
 * transition. The new verify-flow requires explicit staff confirmation
 * regardless of confidence, so this collapses to a binary "do we have a
 * parseable weight or not" check.
 */
export function confidenceTier(_score: number, parsed: number | null): ConfidenceTier {
  return parsed === null ? 'LOW' : 'HIGH';
}

/**
 * Format the ONNX raw text into the canonical weight string. This is the
 * single source of truth — the displayed pre-fill in the verify dialog and
 * the numeric `weight` field of ScanResult are both derived from this.
 *
 * Behaviour:
 *   • Strip everything except 0-9 and "." from the raw text.
 *   • If `decimalPlacesOverride` is set, IGNORE any dot the model emitted and
 *     inject the decimal so the last N digits sit after it. Empty string if
 *     there are no digits at all.
 *   • Otherwise (auto), respect the model's own dot. If it emitted multiple
 *     dots, keep only the first.
 */
export function formatScannedWeight(rawText: string, decimalPlacesOverride?: number): string {
  const digits = rawText.replace(/[^0-9]/g, '');
  if (digits.length === 0) return '';

  if (decimalPlacesOverride !== undefined) {
    const n = decimalPlacesOverride;
    if (n === 0 || digits.length <= n) return digits;
    return digits.slice(0, digits.length - n) + '.' + digits.slice(digits.length - n);
  }

  // Auto: keep the model's first dot if any.
  const cleaned = rawText.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot < 0) return digits;
  const before = cleaned.slice(0, firstDot).replace(/\./g, '');
  const after = cleaned.slice(firstDot + 1).replace(/\./g, '');
  if (after.length === 0) return before || digits;
  return (before || '0') + '.' + after;
}

function reconstructWeight(rawText: string, decimalPlacesOverride?: number): number | null {
  const formatted = formatScannedWeight(rawText, decimalPlacesOverride);
  if (!formatted) return null;
  const num = parseFloat(formatted);
  return Number.isFinite(num) ? num : null;
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

interface PolarityPick {
  canvas: HTMLCanvasElement;
  polarity: 'normal' | 'invert';
  structure: DigitStructure;
  sevenSeg: SevenSegResult;
  preByPolarity: Record<string, HTMLCanvasElement>;
  structureByPolarity: Record<string, DigitStructure>;
  sevenSegByPolarity: Record<string, SevenSegResult>;
  polarityScores: Record<string, PolarityScore>;
}

function preprocessAndPickBestPolarity(crop: HTMLCanvasElement, params: OcrParams): PolarityPick {
  const candidatePolarities: Array<'normal' | 'invert'> =
    params.polarity === 'auto' ? ['normal', 'invert'] : [params.polarity];

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

  const pickedPolarity = candidatePolarities.slice().sort((a, b) => {
    const sa = polarityScores[a];
    const sb = polarityScores[b];
    if (sb.digitCount !== sa.digitCount) return sb.digitCount - sa.digitCount;
    return sa.rejectedCount - sb.rejectedCount;
  })[0];

  return {
    canvas: preByPolarity[pickedPolarity],
    polarity: pickedPolarity,
    structure: structureByPolarity[pickedPolarity],
    sevenSeg: sevenSegByPolarity[pickedPolarity],
    preByPolarity,
    structureByPolarity,
    sevenSegByPolarity,
    polarityScores,
  };
}

/**
 * Pre-warm the ONNX OCR session so the first scan in a CMS modal doesn't pay
 * the ~1.5 s model-load latency. Safe to call repeatedly.
 */
export function prewarmOcr(): void {
  getOcrSession().catch(() => { /* swallow — re-thrown on real scan attempt */ });
}

const EMPTY_SEVEN_SEG: SevenSegResult = {
  digits: [],
  digitBboxes: [],
  rejectedBboxes: [],
  decimalIndex: null,
  decimalBbox: null,
  weight: null,
  segmentPatterns: [],
};
const EMPTY_STRUCTURE: DigitStructure = { digitCount: 0, decimalIndex: null };

export interface ScanWeightOpts {
  /**
   * When true (default), the crop runs through the historic dual-polarity
   * preprocessing pipeline and the chosen preprocessed canvas is fed to the
   * ONNX model. When false, the raw crop is fed directly to the model.
   * Toggleable from CMS Settings (`db.settings.ocrUsePreprocess`).
   */
  usePreprocess?: boolean;
  /**
   * Force the decimal-point position in the ONNX digit string. When set,
   * overrides structure-based detection. See `Settings.ocrDecimalPlaces`.
   */
  decimalPlaces?: 0 | 1 | 2 | 3;
}

export async function scanWeight(
  crop: HTMLCanvasElement,
  params: OcrParams = DEFAULT_PARAMS,
  opts: ScanWeightOpts = {},
): Promise<ScanResult> {
  const session = await getOcrSession();
  const usePreprocess = opts.usePreprocess ?? true;

  let input: HTMLCanvasElement;
  let pickedPolarity: 'normal' | 'invert' = 'normal';
  let structureByPolarity: Record<string, DigitStructure>;
  let sevenSegByPolarity: Record<string, SevenSegResult>;
  let polarityScores: Record<string, PolarityScore>;

  if (usePreprocess) {
    const pick = preprocessAndPickBestPolarity(crop, params);
    input = pick.canvas;
    pickedPolarity = pick.polarity;
    structureByPolarity = pick.structureByPolarity;
    sevenSegByPolarity = pick.sevenSegByPolarity;
    polarityScores = pick.polarityScores;
  } else {
    input = cloneCanvas(crop);
    structureByPolarity = { normal: EMPTY_STRUCTURE };
    sevenSegByPolarity = { normal: EMPTY_SEVEN_SEG };
    polarityScores = {
      normal: { digitCount: 0, rejectedCount: 0, sevenSegWeight: null, sevenSegDigits: 0 },
    };
  }

  const raw = await session.recognize(input);
  // The weight is derived purely from the ONNX text + decimal-place rule.
  // Structure/seven-seg data is retained on the result for the debug overlay only.
  const weight = reconstructWeight(raw, opts.decimalPlaces);

  return {
    weight,
    // Sentinel: 100 when we got something parseable, 0 when we didn't.
    // Verify-flow UI gates on staff confirmation, not on this number.
    confidence: weight === null ? 0 : 100,
    rawText: raw,
    preprocessedCanvas: input,
    pickedPolarity,
    structureByPolarity,
    sevenSegByPolarity,
    polarityScores,
    votes: weight === null ? 0 : 1,
    totalRuns: 1,
    debug: [],
  };
}
