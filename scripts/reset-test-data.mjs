// Wipes test data so testing can start from scratch:
//   bookings (+ their payments subcollection), bookingSeatClaims, eventResults
//   (weigh-ins, which feed Live results + ranking), competitions (Pertandingan),
//   prizeClaims (Rekod Hadiah), plus the uploaded images in Storage under
//   fishing-pond-receipts/ (Slip Bayaran) and fishing-pond-weights/ (weigh-in photos).
// Keeps ponds, seats, users, settings, audit log and mail log.
// Dry run by default. With --confirm it first saves a JSON backup of everything
// it is about to delete to backups/, then deletes. Storage images are NOT backed up.
//   node scripts/reset-test-data.mjs            # counts only
//   node scripts/reset-test-data.mjs --confirm  # backup + delete
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'kolamkelisayang';
const accountEmail = process.env.FIREBASE_ACCOUNT || 'hello@kolamkelisayang.com.my';
const confirmed = process.argv.includes('--confirm');
const database = '(default)';
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
const STORAGE_PREFIXES = ['fishing-pond-receipts/', 'fishing-pond-weights/'];
const COLLECTIONS = ['bookings', 'bookingSeatClaims', 'eventResults', 'prizeClaims', 'competitions'];

const cliOutput = execFileSync(
  'cmd.exe',
  ['/c', 'scripts\\firebase-cli.cmd', 'login:list', '--json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
const login = JSON.parse(cliOutput);
const account = (login.result || []).find((entry) => entry.user?.email === accountEmail) || (login.result || [])[0];
const token = account?.tokens?.access_token;
if (!token) throw new Error(`No Firebase CLI access token found. Run firebase login:add for ${accountEmail}.`);

const root = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}`;
const api = `${root}/documents`;
const docPath = (name) => name.split('/documents/')[1] || name;
const docUrl = (path) => `${api}/${path.split('/').map(encodeURIComponent).join('/')}`;

const request = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} failed ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const listCollection = async (path) => {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(docUrl(path));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const json = await request(url.toString());
    docs.push(...(json.documents || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return docs;
};

const found = {};
for (const name of COLLECTIONS) found[name] = await listCollection(name);

// bookings/{id}/payments subcollection
found['bookings/*/payments'] = [];
for (const booking of found.bookings) {
  found['bookings/*/payments'].push(...await listCollection(`${docPath(booking.name)}/payments`));
}

const listObjects = async (prefix) => {
  const names = [];
  let pageToken = '';
  do {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`);
    url.searchParams.set('prefix', prefix);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const json = await request(url.toString());
    names.push(...(json.items || []).map((item) => item.name));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return names;
};
const images = {};
for (const prefix of STORAGE_PREFIXES) images[prefix] = await listObjects(prefix);

console.log(`Project: ${projectId}   Account: ${account.user?.email || accountEmail}`);
for (const [name, docs] of Object.entries(found)) console.log(`  ${name}: ${docs.length}`);
for (const [prefix, names] of Object.entries(images)) console.log(`  storage ${prefix}: ${names.length} files`);

if (!confirmed) {
  console.log('\nDry run only. Re-run with --confirm to back up and delete.');
  process.exit(0);
}

mkdirSync('backups', { recursive: true });
const backupFile = `backups/reset-test-data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupFile, JSON.stringify(found));
console.log(`\nBackup saved to ${backupFile}`);

// Children first, then parents.
const order = ['bookings/*/payments', 'bookingSeatClaims', 'eventResults', 'prizeClaims', 'bookings', 'competitions'];
for (const key of order) {
  const names = found[key].map((doc) => doc.name);
  for (let i = 0; i < names.length; i += 400) {
    await request(`${api}:batchWrite`, {
      method: 'POST',
      body: JSON.stringify({ writes: names.slice(i, i + 400).map((name) => ({ delete: name })) }),
    });
  }
  console.log(`Deleted ${names.length} from ${key}`);
}
for (const [prefix, names] of Object.entries(images)) {
  for (const name of names) {
    await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }
  console.log(`Deleted ${names.length} files from ${prefix}`);
}
console.log('Reset complete.');
