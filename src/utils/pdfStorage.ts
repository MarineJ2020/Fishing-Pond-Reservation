import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../lib/firebase';

const PDF_MIME = 'application/pdf';

export const isPdfFile = (file: Blob | File): boolean => {
  const mime = (file.type || '').toLowerCase();
  if (mime === PDF_MIME) return true;
  return file instanceof File ? /\.pdf$/i.test(file.name) : false;
};

const sanitizeName = (name: string): string => {
  const trimmed = name.trim().replace(/\s+/g, '-');
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || `upload-${Date.now()}.pdf`;
};

const buildPdfPath = (folder: string, fileName?: string): string => {
  const baseName = sanitizeName(fileName || `upload-${Date.now()}.pdf`);
  const withExtension = /\.pdf$/i.test(baseName) ? baseName : `${baseName}.pdf`;
  return `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${withExtension}`;
};

export async function uploadPdfToFirebaseStorage(
  file: Blob | File,
  folder: string,
  fileName?: string,
): Promise<string> {
  if (!isPdfFile(file)) {
    throw new Error('Hanya fail PDF dibenarkan untuk fungsi ini.');
  }

  const objectRef = ref(storage, buildPdfPath(folder, fileName));
  await uploadBytes(objectRef, file, { contentType: PDF_MIME });
  return getDownloadURL(objectRef);
}

export async function uploadPdfDataUrlToFirebaseStorage(
  dataUrl: string,
  folder: string,
  fileName?: string,
): Promise<string> {
  const mimeMatch = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  const mime = (mimeMatch?.[1] || '').toLowerCase();
  if (mime !== PDF_MIME) {
    throw new Error('Data URL bukan PDF yang sah.');
  }

  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) throw new Error('Data URL tidak sah.');
  const base64 = dataUrl.slice(commaIdx + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const file = new File([bytes], sanitizeName(fileName || `upload-${Date.now()}.pdf`), {
    type: PDF_MIME,
  });
  return uploadPdfToFirebaseStorage(file, folder, file.name);
}

export const normalizePdfUrl = (url: string): string => {
  if (!url) return url;
  if (/\.pdf($|\?)/i.test(url) && /res\.cloudinary\.com/i.test(url) && url.includes('/image/upload/')) {
    return url.replace('/image/upload/', '/raw/upload/');
  }
  return url;
};
