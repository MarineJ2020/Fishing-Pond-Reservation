import { auth } from '../../lib/firebase';

const project = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const emulator = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';
const defaultUrl = project
  ? (emulator ? `http://localhost:5001/${project}/us-central1/api` : `https://us-central1-${project}.cloudfunctions.net/api`)
  : '';
const baseUrl = (import.meta.env.VITE_FUNCTIONS_BASE_URL || defaultUrl).replace(/\/$/, '');

export async function bookingRequest(path: string, payload?: unknown) {
  if (!baseUrl) throw new Error('Perkhidmatan tempahan belum tersedia. Sila cuba lagi kemudian.');
  const headers: Record<string, string> = {};
  if (payload !== undefined) {
    if (!auth.currentUser) throw new Error('Sila log masuk dan cuba lagi.');
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: payload === undefined ? 'GET' : 'POST', headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch {
    throw new Error('Perkhidmatan tempahan tidak dapat dihubungi. Sila semak Tempahan Saya sebelum mencuba lagi.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Tempahan tidak dapat diproses. Sila cuba lagi.');
  return result;
}
