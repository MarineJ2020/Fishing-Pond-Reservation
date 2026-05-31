/**
 * Singleton wrapper around the vendored OcrSession (CNN+BiGRU+CTC, ~1 MB ONNX,
 * runs via onnxruntime-web in WASM). The model + WASM blobs are loaded once
 * per page; subsequent recognise() calls reuse the warm session.
 *
 * WASM paths: vite.config.js mirrors `node_modules/onnxruntime-web/dist/*.wasm`
 * into `dist/ort/`. We point ort.env.wasm.wasmPaths at that mount.
 *
 * Model assets: `public/ocr-model/{recognizer.onnx,alphabet.json}`.
 */

import * as ort from 'onnxruntime-web/wasm';
import { OcrSession } from './ocr';

// Same-origin path that vite-plugin-static-copy writes ORT WASM blobs to.
// Trailing slash is required by ort.
ort.env.wasm.wasmPaths = '/ort/';

// Force single-threaded execution. ORT 1.26 ships only threaded wasm builds;
// the threaded path needs SharedArrayBuffer (cross-origin isolation / COOP+COEP),
// which Firebase Hosting doesn't provide — on mobile that surfaces as
// "no available backend found". numThreads=1 runs without SharedArrayBuffer.
// Combined with the wasm-only entry (no 26 MB JSEP blob), this also fixes the
// mobile "RangeError: out of memory" during model load.
ort.env.wasm.numThreads = 1;

const MODEL_URL = '/ocr-model/recognizer.onnx';
const META_URL = '/ocr-model/alphabet.json';

let sessionPromise: Promise<OcrSession> | null = null;

export function getOcrSession(): Promise<OcrSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const s = new OcrSession();
      await s.load(MODEL_URL, META_URL);
      return s;
    })().catch((err) => {
      // Reset so a future call can retry; surface the failure to the caller.
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

export { OcrSession } from './ocr';
export type { ImageSource, InputSpec } from './preprocess';
