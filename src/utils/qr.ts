/**
 * Shared QR payload encoding for bookings. Each seat in a booking gets its own
 * QR code so staff can check in / weigh-in participants independently instead
 * of scanning once per whole group booking.
 *
 * Payload is a full `/bookings/{id}?seat=N` URL so already-issued QR codes
 * (bare booking id, or a URL with no `seat` param) still resolve — parsers
 * just get back `seatNum: undefined` for those, meaning "no seat known yet".
 */

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
