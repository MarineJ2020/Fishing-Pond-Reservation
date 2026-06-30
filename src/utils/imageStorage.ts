import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { isPdfFile } from './pdfStorage';

// Receipts and other uploaded images are compressed client-side before upload.
// WebP gives the smallest payload at equal/better legibility, so we prefer it
// and fall back to JPEG only on the (rare) browser without WebP encode support.
const MAX_DIM = 1280;
const WEBP_QUALITY = 0.7;
const JPEG_QUALITY = 0.6;

let webpSupport: boolean | null = null;

/** Detect (once) whether canvas can encode WebP in this browser. */
const supportsWebp = (): boolean => {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
};

const extForMime = (mime: string): string => {
  switch ((mime || '').toLowerCase()) {
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    default: {
      const sub = (mime || '').split('/')[1] || 'jpg';
      return sub.replace(/\+xml$/i, '') || 'jpg';
    }
  }
};

const sanitizeName = (name: string): string => {
  const trimmed = name.trim().replace(/\s+/g, '-');
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || `upload-${Date.now()}`;
};

/** Reconstruct a File (correct mime + extension) from a data URL. */
const dataUrlToFile = (dataUrl: string, fileName: string): File => {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const mimeMatch = /^data:([^;,]+)[;,]/.exec(dataUrl);
  const mime = mimeMatch?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const base = sanitizeName(fileName.replace(/\.[^.]+$/, '')) || `upload-${Date.now()}`;
  return new File([bytes], `${base}.${extForMime(mime)}`, { type: mime });
};

/**
 * Compress an image to a WebP data URL (max 1280px, q0.7); falls back to JPEG
 * q0.6 where WebP encode is unavailable. Non-image sources (e.g. PDF) fall back
 * to a raw data-URL read. Shared by every receipt/photo upload.
 */
const compressSourceToDataUrl = (src: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objectUrl);
      resolve(
        supportsWebp()
          ? canvas.toDataURL('image/webp', WEBP_QUALITY)
          : canvas.toDataURL('image/jpeg', JPEG_QUALITY),
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Gagal membaca fail'));
      reader.readAsDataURL(src);
    };
    img.src = objectUrl;
  });

/** Compress an image File to a WebP (or JPEG fallback) data URL. */
export function compressImageToDataUrl(file: File): Promise<string> {
  return compressSourceToDataUrl(file);
}

/**
 * Compress a Blob/File to a WebP File ready for upload. Used by CMS callers that
 * already hold a Blob (scale-weight photo, pond-map). For weight photos this runs
 * AFTER OCR — the captured frame is recognised first, only the stored copy is
 * compressed, so recognition accuracy is never degraded.
 */
export async function compressBlobToWebp(blob: Blob, fileName: string): Promise<File> {
  const dataUrl = await compressSourceToDataUrl(blob);
  return dataUrlToFile(dataUrl, fileName);
}

const buildImagePath = (folder: string, file: Blob | File, fileName?: string): string => {
  const rawName = fileName || (file instanceof File ? file.name : '') || `upload-${Date.now()}`;
  const base = sanitizeName(rawName.replace(/\.[^.]+$/, ''));
  const ext = extForMime(file.type);
  return `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}.${ext}`;
};

/** Upload an image Blob/File to Firebase Storage and return its download URL. */
export async function uploadImageToFirebaseStorage(
  file: Blob | File,
  folder: string,
  fileName?: string,
): Promise<string> {
  if (isPdfFile(file)) {
    throw new Error('Fail PDF mesti dimuat naik ke Firebase Storage melalui pdfStorage.');
  }
  const objectRef = ref(storage, buildImagePath(folder, file, fileName));
  await uploadBytes(objectRef, file, { contentType: file.type || 'image/jpeg' });
  return getDownloadURL(objectRef);
}

/** Upload an image data URL (e.g. from compressImageToDataUrl) to Firebase Storage. */
export async function uploadDataUrlToFirebaseStorage(
  dataUrl: string,
  folder: string,
  fileName?: string,
): Promise<string> {
  const mimeMatch = /^data:([^;,]+)[;,]/.exec(dataUrl);
  const mime = (mimeMatch?.[1] || 'image/jpeg').toLowerCase();
  if (mime === 'application/pdf') {
    throw new Error('Data URL PDF mesti dimuat naik ke Firebase Storage melalui pdfStorage.');
  }
  const file = dataUrlToFile(dataUrl, fileName || `upload-${Date.now()}`);
  return uploadImageToFirebaseStorage(file, folder, file.name);
}
