import { auth } from '../../lib/firebase';

export function receiptUploadFolder(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sila log masuk sebelum memuat naik resit.');
  return `fishing-pond-receipts/${uid}`;
}
