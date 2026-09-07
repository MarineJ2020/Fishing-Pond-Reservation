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
