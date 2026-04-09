import { createBookingDocument } from './firestore';
const baseUrl = import.meta.env.VITE_FUNCTIONS_BASE_URL || '';
const postJson = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || `Request failed: ${response.status}`);
    }
    return response.json();
};
export const createClientAccount = async (payload) => postJson('/createClientAccount', payload);
export const acquireSeatLock = async (payload) => postJson('/acquireSeatLock', payload);
export const createBooking = async (payload) => {
    if (!baseUrl) {
        const docRef = await createBookingDocument(payload);
        return { bookingId: docRef.id, bookingRef: payload.bookingRef };
    }
    return postJson('/createBooking', payload);
};
export const approveBooking = async (payload) => postJson('/approveBooking', payload);
export const rejectBooking = async (payload) => postJson('/rejectBooking', payload);
export const checkInBooking = async (payload) => postJson('/checkInBooking', payload);
export const updateResult = async (payload) => postJson('/updateResult', payload);
