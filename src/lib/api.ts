import {
  acceptBookingReceiptDirect,
  cancelBookingCheckInDirect,
  checkInBookingDirect,
  rejectBookingReceiptDirect,
} from './firestore';
import { auth } from '../../lib/firebase';
import { bookingRequest } from './bookingApi';

const baseUrl = (import.meta.env.VITE_FUNCTIONS_BASE_URL || '').replace(/\/$/, '');

const getAuthHeader = async () => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Pengesahan diperlukan. Sila log masuk dan cuba lagi. / Authentication required. Please sign in and try again.');
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
  return bookingRequest('/createBooking', payload);
};
export const submitBookingReceipt = async (payload: { bookingId: string; receiptUrl: string; amount: number; bankReference?: string }) => {
  return bookingRequest('/submitBookingReceipt', payload);
};
export const replaceBookingReceipt = (bookingId: string, receiptIndex: number, receiptUrl: string) =>
  bookingRequest('/replaceBookingReceipt', { bookingId, receiptIndex, receiptUrl });
export const acceptBookingReceipt = async (payload: { bookingId: string; receiptIndex: number }) => {
  if (!baseUrl) return acceptBookingReceiptDirect(payload.bookingId, payload.receiptIndex);
  return postJson('/acceptBookingReceipt', payload);
};
export const rejectBookingReceipt = async (payload: { bookingId: string; receiptIndex: number }) => {
  if (!baseUrl) return rejectBookingReceiptDirect(payload.bookingId, payload.receiptIndex);
  return postJson('/rejectBookingReceipt', payload);
};
export const approveBooking = async (payload: { bookingId: string }) => postJson('/approveBooking', payload);
export const rejectBooking = async (payload: { bookingId: string }) => postJson('/rejectBooking', payload);
export const checkInBooking = async (payload: { bookingId: string; bookingRef?: string; amount: number; method: string; seatNum?: number; pondId?: number }) => {
  if (!baseUrl) return checkInBookingDirect(payload);
  return postJson('/checkInBooking', payload);
};
export const cancelBookingCheckIn = async (payload: { bookingId: string; seatNum: number; pondId?: number }) => {
  if (!baseUrl) return cancelBookingCheckInDirect(payload);
  return postJson('/cancelBookingCheckIn', payload);
};
export const updateResult = async (payload: { bookingId: string; totalWeight: number; fishCount: number }) => postJson('/updateResult', payload);
