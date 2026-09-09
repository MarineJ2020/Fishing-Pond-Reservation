import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../../lib/firebase';

const functions = getFunctions(app);

export interface EmailLogEntry {
  id: string;
  recipient: string;
  kind: string;
  triggeredAt: string;
  completedAt: string;
  status: string;
  attempts: number;
  recipientAccepted: boolean;
}

export interface EmailLogsPage {
  items: EmailLogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const getEmailLogsPage = async (cursor: string | null, pageSize = 50): Promise<EmailLogsPage> => {
  const callable = httpsCallable<{ cursor?: string; pageSize: number }, EmailLogsPage>(functions, 'listEmailLogs');
  const result = await callable({ ...(cursor ? { cursor } : {}), pageSize });
  return result.data;
};

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

/**
 * Branded Malay password-reset email (replaces Firebase Auth's default sender).
 * Resolves for unregistered addresses too — the server answers neutrally so the
 * login form cannot be used to enumerate accounts.
 */
export const requestPasswordResetEmail = async (email: string): Promise<void> => {
  await httpsCallable(functions, 'requestPasswordReset')({ email });
};
