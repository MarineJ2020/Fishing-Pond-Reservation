const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

const isPdfFile = (file: Blob | File) => {
  const mime = (file.type || '').toLowerCase();
  if (mime === 'application/pdf') return true;
  return file instanceof File ? /\.pdf$/i.test(file.name) : false;
};

export async function uploadImageToCloudinary(file: Blob | File, folder: string): Promise<string> {
  if (isPdfFile(file)) {
    throw new Error('Fail PDF mesti dimuat naik ke Firebase Storage.');
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

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Gagal muat naik fail${details ? `: ${details}` : ''}`);
  }
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
  const mimeMatch = /^data:([^;,]+)[;,]/.exec(dataUrl);
  const mime = mimeMatch?.[1] || 'image/jpeg';
  if (mime === 'application/pdf') {
    throw new Error('Data URL PDF mesti dimuat naik ke Firebase Storage.');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const file = new File([bytes], 'upload.jpg', { type: mime });
  return uploadImageToCloudinary(file, folder);
}
