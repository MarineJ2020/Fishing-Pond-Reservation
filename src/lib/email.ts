import { callFunction } from './callable';

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
  return callFunction<{ cursor?: string; pageSize: number }, EmailLogsPage>('listEmailLogs', { ...(cursor ? { cursor } : {}), pageSize });
};

/**
 * Client code can request only server-defined transactional messages. Recipient,
 * subject, and HTML are resolved from trusted Auth/Firestore data in Functions.
 */
export const requestWelcomeEmail = async (): Promise<void> => {
  await callFunction('requestWelcomeEmail');
};

export const requestBalanceReminderEmail = async (bookingId: string): Promise<void> => {
  await callFunction('requestBalanceReminder', { bookingId });
};

/**
 * Branded Malay password-reset email (replaces Firebase Auth's default sender).
 * Resolves for unregistered addresses too — the server answers neutrally so the
 * login form cannot be used to enumerate accounts.
 */
export const requestPasswordResetEmail = async (email: string): Promise<void> => {
  await callFunction('requestPasswordReset', { email });
};
