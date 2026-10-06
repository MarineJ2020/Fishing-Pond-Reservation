// One-time switch of checkout to peg-claim mode (see createSecureBooking).
//
// 1. Verifies every pond's seat docs are numbered exactly 1..N (claim-mode checkout
//    reads only the requested seat docs and relies on this to apply seat caps).
// 2. Gives every occupying booking a bookingSeatClaims doc per peg, reporting any
//    pegs that two live bookings already share.
// 3. Writes systemFlags/seatClaims, which turns claim mode on.
//
// Deploy rules + functions first, so nothing can create an occupying booking
// without claims while this runs. Dry run by default; --confirm writes.
//   node scripts/backfill-seat-claims.mjs [--confirm]
import { execFileSync } from 'node:child_process';
import { bookingPegs, claimId, legacySeatIds, occupiesSeats, pondCatalog, refId } from '../functions/src/booking-policy.js';

const projectId = process.env.FIREBASE_PROJECT_ID || 'kolamkelisayang';
const confirmed = process.argv.includes('--confirm');
const root = `projects/${projectId}/databases/(default)/documents`;
const OCCUPYING = ['PENDING', 'PENDING_APPROVAL', 'APPROVED', 'CONFIRMED', 'LIVE', 'pending', 'confirmed', 'approved', 'live'];

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const api = emulator ? `http://${emulator}/v1/${root}` : `https://firestore.googleapis.com/v1/${root}`;

// Firebase CLI login -> fresh access token (stored ones expire after an hour).
// The emulator accepts the fixed "owner" token as an admin.
const loginToken = async () => {
  const cli = process.platform === 'win32' ? ['cmd.exe', ['/c', 'npx', '-y', 'firebase-tools', 'login:list', '--json']] : ['npx', ['-y', 'firebase-tools', 'login:list', '--json']];
  const login = JSON.parse(execFileSync(cli[0], cli[1], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const account = (login.result || []).find((entry) => entry.user?.email === process.env.FIREBASE_ACCOUNT) || (login.result || [])[0];
  if (!account?.tokens?.refresh_token) throw new Error('No Firebase CLI login found. Run: npx -y firebase-tools login');
  // Public OAuth client of firebase-tools (same values ship in its source).
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.tokens.refresh_token,
      client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
      client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
    }),
  });
  const accessToken = (await tokenRes.json()).access_token;
  if (!accessToken) throw new Error('Could not refresh the Firebase CLI token. Run: npx -y firebase-tools login --reauth');
  console.log(`Account: ${account.user?.email || 'unknown'}`);
  return accessToken;
};
const token = emulator ? 'owner' : await loginToken();

const request = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} failed ${res.status}: ${await res.text()}`);
  return res.json();
};
const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const idOf = (name) => name.split('/').pop();

// REST values -> the shapes the Admin SDK hands booking-policy (refs keep .id/.path).
const plain = (value) => {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) {
    const path = value.referenceValue.split('/documents/')[1];
    return { id: idOf(path), path };
  }
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(plain);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, plain(v)]));
  return null;
};
const snap = (doc) => {
  const data = Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, plain(v)]));
  return { id: idOf(doc.name), data: () => data };
};

const runQuery = async (structuredQuery) => (await request(`${api}:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery }) }))
  .map((row) => row.document).filter(Boolean);
const listAll = async (collectionId, fields) => {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(`${api}/${collectionId}`);
    url.searchParams.set('pageSize', '1000');
    fields?.forEach((field) => url.searchParams.append('mask.fieldPaths', field));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const json = await request(url.toString());
    docs.push(...(json.documents || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return docs;
};
const batchGet = async (names) => {
  const found = new Map();
  for (const group of chunk(names, 100)) {
    const rows = await request(`${api}:batchGet`, { method: 'POST', body: JSON.stringify({ documents: group }) });
    rows.forEach((row) => { if (row.found) found.set(row.found.name, row.found); });
  }
  return found;
};

console.log(`Project: ${projectId}${emulator ? ' (emulator)' : ''}${confirmed ? '' : ' - DRY RUN'}`);

// 1. Seat numbering.
const pondIndex = (await listAll('ponds', ['name'])).map(snap);
const seatsByPond = new Map();
(await listAll('seats', ['pondId', 'seatNumber'])).map(snap).forEach((seat) => {
  const pondDocId = refId(seat.data().pondId);
  if (!seatsByPond.has(pondDocId)) seatsByPond.set(pondDocId, []);
  seatsByPond.get(pondDocId).push(seat.data().seatNumber);
});
const badPonds = [];
pondIndex.forEach((pond) => {
  const numbers = (seatsByPond.get(pond.id) || []).slice().sort((a, b) => a - b);
  if (numbers.some((num, i) => num !== i + 1)) badPonds.push(`${pond.id}: ${numbers.length} seats, numbers not exactly 1..${numbers.length}`);
});
console.log(`Ponds: ${pondIndex.length}; seat numbering problems: ${badPonds.length}`);
badPonds.forEach((line) => console.log(`  ${line}`));

// 2. Claims for every occupying booking.
const bookings = (await runQuery({
  from: [{ collectionId: 'bookings' }],
  where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'IN', value: { arrayValue: { values: OCCUPYING.map((stringValue) => ({ stringValue })) } } } },
})).map(snap).filter((booking) => occupiesSeats(booking.data()));
const live = new Set(bookings.map((booking) => booking.id));
const legacyIds = [...new Set(bookings.flatMap((booking) => legacySeatIds(booking.data())))];
const legacySeats = [...(await batchGet(legacyIds.map((id) => `${root}/seats/${id}`))).values()].map(snap);
const catalog = pondCatalog(pondIndex, []);

const wanted = new Map(); // claim id -> [{ bookingId, competitionId, label }]
bookings.forEach((booking) => {
  const competitionId = refId(booking.data().competitionId);
  bookingPegs(booking.data(), catalog, legacySeats).forEach(({ pondDocId, num }) => {
    const id = claimId(competitionId, pondDocId, num);
    if (!wanted.has(id)) wanted.set(id, []);
    wanted.get(id).push({ bookingId: booking.id, competitionId, label: `${competitionId} pond ${pondDocId} peg ${num}` });
  });
});
const existing = await batchGet([...wanted.keys()].map((id) => `${root}/bookingSeatClaims/${id}`));
const unknownOwners = [...new Set([...existing.values()].map((doc) => plain(doc.fields?.bookingId)).filter((id) => id && !live.has(id)))];
const ownerDocs = await batchGet(unknownOwners.map((id) => `${root}/bookings/${id}`));
ownerDocs.forEach((doc) => { if (occupiesSeats(snap(doc).data())) live.add(idOf(doc.name)); });

const writes = [];
const conflicts = [];
let alreadyClaimed = 0;
for (const [id, holders] of wanted) {
  const owner = plain(existing.get(`${root}/bookingSeatClaims/${id}`)?.fields?.bookingId);
  const bookingIds = [...new Set(holders.map((h) => h.bookingId))];
  if (bookingIds.length > 1 || (owner && live.has(owner) && !bookingIds.includes(owner))) {
    conflicts.push(`${holders[0].label}: bookings ${[...new Set([owner, ...bookingIds].filter(Boolean))].join(', ')}`);
  }
  if (owner && live.has(owner)) { alreadyClaimed += 1; continue; }
  writes.push({
    update: {
      name: `${root}/bookingSeatClaims/${id}`,
      fields: { bookingId: { stringValue: bookingIds[0] }, competitionId: { stringValue: holders[0].competitionId }, updatedAt: { timestampValue: new Date().toISOString() } },
    },
  });
}
console.log(`Occupying bookings: ${bookings.length}; pegs: ${wanted.size}; already claimed: ${alreadyClaimed}; claims to write: ${writes.length}`);
console.log(`Pegs already held by two live bookings (fix these by hand in the CMS): ${conflicts.length}`);
conflicts.forEach((line) => console.log(`  ${line}`));

// process.exit() while fetch sockets close crashes Node on Windows; set exitCode instead.
if (badPonds.length) {
  console.log('Not enabling claim mode until seat numbering is fixed (re-save the pond seat count in the CMS).');
  process.exitCode = 1;
} else if (!confirmed) {
  console.log('Dry run only. Re-run with --confirm to write claims and enable claim mode.');
} else {
  for (const group of chunk(writes, 400)) {
    await request(`${api}:batchWrite`, { method: 'POST', body: JSON.stringify({ writes: group }) });
  }
  await request(`${api}:batchWrite`, {
    method: 'POST',
    body: JSON.stringify({ writes: [{ update: { name: `${root}/systemFlags/seatClaims`, fields: {
      verifiedAt: { timestampValue: new Date().toISOString() },
      bookingsChecked: { integerValue: String(bookings.length) },
      claimsWritten: { integerValue: String(writes.length) },
      sharedPegs: { integerValue: String(conflicts.length) },
    } } }] }),
  });
  console.log(`Wrote ${writes.length} claims. Claim mode is ON (delete systemFlags/seatClaims to switch back).`);
}
