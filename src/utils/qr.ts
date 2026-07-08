/**
 * Shared QR payload encoding for bookings. Each seat in a booking gets its own
 * QR code so staff can check in / weigh-in participants independently instead
 * of scanning once per whole group booking.
 *
 * Payload is a full `/bookings/{id}?seat=N` URL so already-issued QR codes
 * (bare booking id, or a URL with no `seat` param) still resolve — parsers
 * just get back `seatNum: undefined` for those, meaning "no seat known yet".
 */

import jsQR from 'jsqr';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';

// Reused across frames — creating a MultiFormatReader per scan is wasteful and
// its hint table never changes. QR-only + TryHarder gives ZXing the best shot
// on awkward camera frames (glare, rotation, partial blur).
let zxingReader: MultiFormatReader | null = null;
function getZxingReader(): MultiFormatReader {
  if (!zxingReader) {
    zxingReader = new MultiFormatReader();
    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    zxingReader.setHints(hints);
  }
  return zxingReader;
}

/** Second-pass QR decode via ZXing. Returns decoded text or null (never throws). */
function decodeWithZxing(data: Uint8ClampedArray, width: number, height: number): string | null {
  try {
    // ZXing's RGBLuminanceSource wants a precomputed grayscale buffer
    // (length = width*height), not raw RGBA — convert with standard luma weights.
    const len = width * height;
    const luminances = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      luminances[i] = (r * 77 + g * 151 + b * 28) >> 8; // ≈ 0.299R + 0.587G + 0.114B
    }
    const source = new RGBLuminanceSource(luminances, width, height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    const reader = getZxingReader();
    try {
      const result = reader.decodeWithState(bitmap);
      return result?.getText() || null;
    } finally {
      reader.reset();
    }
  } catch {
    // NotFoundException / ChecksumException / FormatException → nothing decoded.
    return null;
  }
}

/**
 * Decode a QR code from raw RGBA pixel data. Tries jsQR first (fast, reliable on
 * clean screen-rendered QR), then falls back to ZXing which tends to succeed on
 * harder real-world camera frames. Returns the decoded text, or null if neither
 * engine found a code.
 */
export function decodeQr(data: Uint8ClampedArray, width: number, height: number): string | null {
  const js = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  if (js?.data) return js.data;
  return decodeWithZxing(data, width, height);
}

/** Convenience wrapper around {@link decodeQr} for a canvas `ImageData`. */
export function decodeQrFromImageData(imageData: ImageData): string | null {
  return decodeQr(imageData.data, imageData.width, imageData.height);
}

/** Build the booking-detail URL (origin + /bookings/:id), no seat info. */
export function buildBookingUrl(bookingId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/bookings/${encodeURIComponent(bookingId)}`;
}

/** Build the per-seat QR payload: booking-detail URL + `?seat=N`. */
export function buildSeatQrValue(bookingId: string, seatNum: number): string {
  return `${buildBookingUrl(bookingId)}?seat=${encodeURIComponent(String(seatNum))}`;
}

export interface ParsedQrPayload {
  bookingId: string;
  /** Present only when the scanned QR encoded a specific seat. */
  seatNum?: number;
}

/**
 * Parse a decoded QR/text payload into a booking id (and seat number, when
 * present). Accepts, in order:
 *   1. Full URL /bookings/{id}?seat=N  → { bookingId, seatNum }
 *   2. Full URL /bookings/{id}         → { bookingId }  (legacy, pre-per-seat QR)
 *   3. Bare alphanumeric id (6+ chars) → { bookingId }  (manual typed / legacy)
 */
export function parseQrPayload(raw: string): ParsedQrPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, 'http://placeholder');
    const match = url.pathname.match(/^\/bookings\/([^/]+)/);
    if (match) {
      const bookingId = decodeURIComponent(match[1]);
      const seatParam = url.searchParams.get('seat');
      const seatNum = seatParam !== null ? parseInt(seatParam, 10) : NaN;
      return Number.isFinite(seatNum) ? { bookingId, seatNum } : { bookingId };
    }
  } catch {
    // not a URL; fall through to plain id check
  }
  if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed)) return { bookingId: trimmed };
  return null;
}
