// Customer-facing text for an error: our own server messages pass through,
// but raw Firebase/browser errors ("Firebase: Error (auth/network-request-failed).")
// become a plain bilingual explanation.
const NETWORK = 'Sambungan internet terputus atau perlahan. Sila semak sambungan anda dan cuba lagi. / Connection problem — check your internet and try again.';

export const friendlyError = (err: unknown, fallback: string): string => {
  const code = String((err as { code?: unknown })?.code || '');
  const message = String((err as { message?: unknown })?.message || '');
  if (/network-request-failed|unavailable|deadline-exceeded/.test(code) || /Failed to fetch|NetworkError|network error|Load failed/i.test(message)) return NETWORK;
  if (/permission-denied|unauthenticated|auth\/user-token-expired|auth\/invalid-user-token/.test(code)) {
    return 'Sesi anda telah tamat. Sila log masuk semula dan cuba lagi. / Your session expired — please log in again.';
  }
  if (!message || message.startsWith('Firebase:') || code) return fallback;
  return message;
};
