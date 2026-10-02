import type { Settings } from '../types';

/** Display precision only: never use the returned string for storage or ranking. */
export function formatWeight(weight: number, decimalPlaces: Settings['ocrDecimalPlaces']): string {
  if (!Number.isFinite(weight)) return '—';
  if (decimalPlaces === undefined || ![0, 1, 2, 3].includes(decimalPlaces)) return String(weight);
  // Intl rounds decimal ties correctly (e.g. 12.115 -> 12.12), unlike toFixed.
  return new Intl.NumberFormat('en-US', {
    useGrouping: false,
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(weight);
}

/** Heaviest single weigh-in treated as normal; anything above asks staff to confirm. */
export const MAX_PLAUSIBLE_WEIGHT_KG = 30;

/**
 * Warning text before saving an unusual weight, or null when it looks normal.
 * Catches the common slip of typing "345" for 3.45 kg when the scale shows
 * `decimalPlaces` decimals.
 */
export function weightSanityWarning(
  weight: number,
  rawInput: string,
  decimalPlaces: Settings['ocrDecimalPlaces'],
): string | null {
  if (!Number.isFinite(weight) || weight <= 0) return 'Berat mesti lebih daripada 0.';
  if (weight <= MAX_PLAUSIBLE_WEIGHT_KG) return null;
  const digits = rawInput.replace(/[^0-9]/g, '');
  const missingDecimal = decimalPlaces && decimalPlaces > 0 && !rawInput.includes('.') && digits.length > decimalPlaces;
  const suggestion = missingDecimal
    ? ` Adakah anda maksudkan ${digits.slice(0, digits.length - decimalPlaces)}.${digits.slice(digits.length - decimalPlaces)} kg?`
    : '';
  return `Berat ${weight} kg luar biasa tinggi (melebihi ${MAX_PLAUSIBLE_WEIGHT_KG} kg).${suggestion}`;
}
