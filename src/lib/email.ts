import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../../lib/firebase';

const functions = getFunctions(app);

/**
 * Client code can request only server-defined transactional messages. Recipient,
 * subject, and HTML are resolved from trusted Auth/Firestore data in Functions.
 */
export const requestWelcomeEmail = async (): Promise<void> => {
  await httpsCallable(functions, 'requestWelcomeEmail')();
};

export const requestBalanceReminderEmail = async (bookingId: string): Promise<void> => {
  await httpsCallable(functions, 'requestBalanceReminder')({ bookingId });
};
