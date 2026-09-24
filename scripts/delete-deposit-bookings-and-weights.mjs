import admin from 'firebase-admin';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'kolamkelisayang';
const confirmed = process.argv.includes('--confirm');

admin.initializeApp({ projectId });
const db = admin.firestore();

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const deleteRefs = async (refs, label) => {
  if (!refs.length) return;
  for (const group of chunk(refs, 400)) {
    const batch = db.batch();
    group.forEach((ref) => batch.delete(ref));
    if (confirmed) await batch.commit();
  }
  console.log(`${confirmed ? 'Deleted' : 'Would delete'} ${refs.length} ${label}.`);
};

const depositBookings = new Map();
for (const paymentType of ['deposit', 'baki']) {
  const snap = await db.collection('bookings').where('paymentType', '==', paymentType).get();
  snap.docs.forEach((doc) => depositBookings.set(doc.id, doc));
}

const bookingsWithBalance = await db.collection('bookings').where('balanceDue', '>', 0).get();
bookingsWithBalance.docs.forEach((doc) => depositBookings.set(doc.id, doc));

const bookingDocs = Array.from(depositBookings.values());
const bookingIds = new Set(bookingDocs.map((doc) => doc.id));
const bookingRefs = new Set(bookingDocs.map((doc) => doc.ref.path));

const resultRefs = [];
const allResults = await db.collection('eventResults').get();
allResults.docs.forEach((doc) => {
  const bookingId = doc.data().bookingId;
  const value = typeof bookingId === 'string' ? bookingId : bookingId?.path || bookingId?.id || '';
  if (bookingIds.has(value) || bookingRefs.has(value)) resultRefs.push(doc.ref);
});

const paymentRefs = [];
for (const bookingDoc of bookingDocs) {
  const payments = await bookingDoc.ref.collection('payments').get();
  payments.docs.forEach((doc) => paymentRefs.push(doc.ref));
}

const claimRefs = [];
const allClaims = await db.collection('bookingSeatClaims').get();
allClaims.docs.forEach((doc) => {
  if (bookingIds.has(doc.data().bookingId)) claimRefs.push(doc.ref);
});

console.log(`Project: ${projectId}`);
console.log(`Matched ${bookingDocs.length} old deposit/balance bookings.`);
console.log(`Matched ${resultRefs.length} related weigh-in records.`);
console.log(`Matched ${paymentRefs.length} payment subrecords and ${claimRefs.length} seat claims.`);

if (!confirmed) {
  console.log('Dry run only. Re-run with --confirm to delete.');
  process.exit(0);
}

await deleteRefs(paymentRefs, 'payment subrecords');
await deleteRefs(resultRefs, 'weigh-in records');
await deleteRefs(claimRefs, 'seat claims');
await deleteRefs(bookingDocs.map((doc) => doc.ref), 'bookings');

console.log('Cleanup complete.');
