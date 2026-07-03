/** Common Malaysian mobile phone prefixes (011 carries an extra digit). */
export const MY_PHONE_PREFIXES = ['010', '011', '012', '013', '014', '015', '016', '017', '018', '019'];

/** Malaysian mobile numbers are 01X-XXX XXXX (7 digits) except 011-XXXX XXXX (8 digits). */
export function phoneRestLength(prefix: string): number {
  return prefix === '011' ? 8 : 7;
}

export function isValidMyPhoneRest(prefix: string, rest: string): boolean {
  const digits = rest.replace(/\D/g, '');
  return MY_PHONE_PREFIXES.includes(prefix) && digits.length === phoneRestLength(prefix);
}

export function formatMyPhone(prefix: string, rest: string): string {
  return `${prefix}-${rest.replace(/\D/g, '')}`;
}

/**
 * Best-effort parse of a previously freeform-entered phone string (e.g.
 * "+60 12-345 6789") back into {prefix, rest} for editing. Falls back to a
 * default prefix when the stored value doesn't cleanly match a known one —
 * the field stays editable either way.
 */
export function splitMyPhone(phone: string | null | undefined): { prefix: string; rest: string } {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('60') && digits.length > 9) digits = `0${digits.slice(2)}`;
  if (!digits.startsWith('0')) digits = `0${digits}`;
  const prefix = digits.slice(0, 3);
  const rest = digits.slice(3);
  if (MY_PHONE_PREFIXES.includes(prefix)) {
    return { prefix, rest: rest.slice(0, phoneRestLength(prefix)) };
  }
  return { prefix: '012', rest: digits.replace(/^0/, '').slice(0, 7) };
}
