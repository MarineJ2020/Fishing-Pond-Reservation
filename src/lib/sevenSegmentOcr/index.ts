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

import * as ort from 'onnxruntime-web';
import { OcrSession } from './ocr';

// Same-origin path that vite-plugin-static-copy writes ORT WASM blobs to.
// Trailing slash is required by ort.
ort.env.wasm.wasmPaths = '/ort/';

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
