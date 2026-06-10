const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export async function uploadImageToCloudinary(file: Blob | File, folder: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', folder);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData },
  );

  if (!response.ok) throw new Error('Gagal muat naik gambar');
  const result = await response.json();
  return result.secure_url as string;
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
  const blob = new Blob([bytes], { type: mime });
  return uploadImageToCloudinary(blob, folder);
}
