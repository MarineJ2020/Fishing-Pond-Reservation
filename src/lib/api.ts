import { createBookingDocument } from './firestore';
import { auth } from '../../lib/firebase';

const baseUrl = import.meta.env.VITE_FUNCTIONS_BASE_URL || '';

const getAuthHeader = async () => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required. Please sign in and try again.');
  }
  const token = await currentUser.getIdToken();
  return `Bearer ${token}`;
};

const postJson = async (path: string, body: any) => {
  const authHeader = await getAuthHeader();
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `Request failed: ${response.status}`);
  }

  return response.json();
};

export const createClientAccount = async (payload: { name: string; email: string; phone?: string }) => postJson('/createClientAccount', payload);
export const acquireSeatLock = async (payload: { seatId: string; competitionId: string }) => postJson('/acquireSeatLock', payload);
export const createBooking = async (payload: any) => {
  if (!baseUrl) {
    const docRef = await createBookingDocument(payload);
    return { bookingId: docRef.id, bookingRef: payload.bookingRef };
  }
  return postJson('/createBooking', payload);
};
export const approveBooking = async (payload: { bookingId: string }) => postJson('/approveBooking', payload);
export const rejectBooking = async (payload: { bookingId: string }) => postJson('/rejectBooking', payload);
export const checkInBooking = async (payload: { bookingRef: string; amount: number; method: string }) => postJson('/checkInBooking', payload);
export const updateResult = async (payload: { bookingId: string; totalWeight: number; fishCount: number }) => postJson('/updateResult', payload);
