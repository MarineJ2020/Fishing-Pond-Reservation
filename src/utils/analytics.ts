declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

/** Thin wrapper around gtag.js — no-ops if the script hasn't loaded (ad-blockers, etc). */
export function trackEvent(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', eventName, params);
}
