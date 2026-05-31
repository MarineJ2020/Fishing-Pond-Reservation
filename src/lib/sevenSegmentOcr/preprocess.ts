import * as ort from "onnxruntime-web/wasm";

export interface InputSpec {
  height: number;
  width: number;
  channels: number;
  name: string;
}

export type ImageSource =
  | HTMLImageElement
  | HTMLCanvasElement
  | ImageBitmap
  | ImageData;

function toImageData(src: ImageSource, w: number, h: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (src instanceof ImageData) {
    // Draw the source ImageData onto a temp canvas then scale.
    const tmp = document.createElement("canvas");
    tmp.width = src.width;
    tmp.height = src.height;
    tmp.getContext("2d")!.putImageData(src, 0, 0);
    ctx.drawImage(tmp, 0, 0, w, h);
  } else {
    ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
  }
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Convert an image source into the NCHW grayscale Float32 tensor the model
 * expects. Matches `training/dataset.py::load_image`:
 *   grayscale via PIL "L" (0.299 R + 0.587 G + 0.114 B), resize to (W,H),
 *   divide by 255.
 */
export function preprocess(src: ImageSource, spec: InputSpec): ort.Tensor {
  const { width: w, height: h } = spec;
  const imgData = toImageData(src, w, h);
  const data = new Float32Array(1 * spec.channels * h * w);

  // Single grayscale channel only (spec.channels === 1).
  let p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = imgData.data[i];
      const g = imgData.data[i + 1];
      const b = imgData.data[i + 2];
      // ITU-R 601-2 luma transform — same as PIL's "L" mode.
      const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
      data[p++] = gray;
    }
  }

  return new ort.Tensor("float32", data, [1, spec.channels, h, w]);
}
