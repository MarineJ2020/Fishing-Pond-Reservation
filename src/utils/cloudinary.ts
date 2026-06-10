import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../lib/firebase';

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

const isPdfFile = (file: Blob | File) => {
  const mime = (file.type || '').toLowerCase();
  if (mime === 'application/pdf') return true;
  return file instanceof File ? /\.pdf$/i.test(file.name) : false;
};

export async function uploadImageToCloudinary(file: Blob | File, folder: string): Promise<string> {
  if (isPdfFile(file)) {
    const baseName = file instanceof File && file.name ? file.name.replace(/[^a-zA-Z0-9._-]/g, '_') : `upload-${Date.now()}.pdf`;
    const objectRef = ref(storage, `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName}`);
    await uploadBytes(objectRef, file, { contentType: 'application/pdf' });
    return getDownloadURL(objectRef);
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', folder);
  if (file instanceof File && file.name) {
    formData.append('filename_override', file.name);
  }

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData },
  );

  if (!response.ok) throw new Error('Gagal muat naik gambar');
  const result = await response.json();
  return result.secure_url as string;
}

// Best-effort compatibility for older PDF URLs that were saved as image/upload.
export function normalizeCloudinaryFileUrl(url: string): string {
  if (!url) return url;
  if (!/res\.cloudinary\.com/i.test(url)) return url;
  if (/\.pdf($|\?)/i.test(url) && url.includes('/image/upload/')) {
    return url.replace('/image/upload/', '/raw/upload/');
  }
  return url;
}

/**
 * Compress an image File to a JPEG data URL (max 1600px, q0.82). Non-image
 * files (e.g. PDF) fall back to a raw data-URL read. Mirrors the receipt
 * compression used in the booking form.
 */
export function compressImageToDataUrl(file: File): Promise<string> {
  const MAX_DIM = 1600;
  const QUALITY = 0.82;
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
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
      resolve(canvas.toDataURL('image/jpeg', QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('Gagal membaca fail'));
      reader.readAsDataURL(file);
    };
    img.src = objectUrl;
  });
}

export async function uploadDataUrlToCloudinary(dataUrl: string, folder: string): Promise<string> {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  // Preserve the original MIME type from the data-URL header so PDFs are not
  // corrupted by being relabelled as JPEG. Cloudinary's image/upload endpoint
  // accepts PDFs and returns a .pdf URL.
  const mimeMatch = /^data:([^;,]+)[;,]/.exec(dataUrl);
  const mime = mimeMatch?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const extension = mime === 'application/pdf' ? 'pdf' : 'jpg';
  const file = new File([bytes], `upload.${extension}`, { type: mime });
  return uploadImageToCloudinary(file, folder);
}
