import { execFileSync } from 'node:child_process';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'kolamkelisayang';
const accountEmail = process.env.FIREBASE_ACCOUNT || 'hello@kolamkelisayang.com.my';
const confirmed = process.argv.includes('--confirm');
const database = '(default)';

const cliOutput = execFileSync(
  'cmd.exe',
  ['/c', 'scripts\\firebase-cli.cmd', 'login:list', '--json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
const login = JSON.parse(cliOutput);
const account = (login.result || []).find((entry) => entry.user?.email === accountEmail) || (login.result || [])[0];
const token = account?.tokens?.access_token;
if (!token) throw new Error(`No Firebase CLI access token found. Run firebase login:add for ${accountEmail}.`);

const api = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents`;

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const fieldValue = (value) => {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('referenceValue' in value) return value.referenceValue;
  if ('booleanValue' in value) return value.booleanValue;
  return undefined;
};

const docPath = (docName) => docName.split('/documents/')[1] || docName;
const docId = (docName) => docPath(docName).split('/').pop();
const docUrl = (path) => `${api}/${path.split('/').map(encodeURIComponent).join('/')}`;

const request = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${options.method || 'GET'} ${url} failed ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
};

const runQuery = async (structuredQuery) => {
  const rows = await request(`${api}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery }),
  });
  return rows.map((row) => row.document).filter(Boolean);
};

const queryByField = (collectionId, fieldPath, op, value) => runQuery({
  from: [{ collectionId }],
  where: {
    fieldFilter: {
      field: { fieldPath },
      op,
      value,
    },
  },
});

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

const deleteNames = async (names, label) => {
  if (!names.length) return;
  console.log(`${confirmed ? 'Deleting' : 'Would delete'} ${names.length} ${label}.`);
  if (!confirmed) return;
  for (const group of chunk(names, 400)) {
    await request(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents:batchWrite`, {
      method: 'POST',
      body: JSON.stringify({ writes: group.map((name) => ({ delete: name })) }),
    });
  }
};

const bookingMap = new Map();
for (const paymentType of ['deposit', 'baki']) {
  const docs = await queryByField('bookings', 'paymentType', 'EQUAL', { stringValue: paymentType });
  docs.forEach((doc) => bookingMap.set(doc.name, doc));
}
const balanceDocs = await queryByField('bookings', 'balanceDue', 'GREATER_THAN', { integerValue: 0 });
balanceDocs.forEach((doc) => bookingMap.set(doc.name, doc));

const bookingDocs = Array.from(bookingMap.values());
const bookingIds = new Set(bookingDocs.map((doc) => docId(doc.name)));
const bookingNames = new Set(bookingDocs.map((doc) => doc.name));

const resultDocs = await listCollection('eventResults');
const resultNames = resultDocs
  .filter((doc) => {
    const raw = fieldValue(doc.fields?.bookingId);
    return bookingIds.has(raw) || bookingNames.has(raw);
  })
  .map((doc) => doc.name);

const paymentNames = [];
for (const booking of bookingDocs) {
  const payments = await listCollection(`${docPath(booking.name)}/payments`);
  payments.forEach((doc) => paymentNames.push(doc.name));
}

const claimDocs = await listCollection('bookingSeatClaims');
const claimNames = claimDocs
  .filter((doc) => bookingIds.has(String(fieldValue(doc.fields?.bookingId) || '')))
  .map((doc) => doc.name);

console.log(`Project: ${projectId}`);
console.log(`Account: ${account.user?.email || accountEmail}`);
console.log(`Matched ${bookingDocs.length} old deposit/balance bookings.`);
console.log(`Matched ${resultNames.length} related weigh-in records.`);
console.log(`Matched ${paymentNames.length} payment subrecords and ${claimNames.length} seat claims.`);

if (!confirmed) {
  console.log('Dry run only. Re-run with --confirm to delete.');
  process.exit(0);
}

await deleteNames(paymentNames, 'payment subrecords');
await deleteNames(resultNames, 'weigh-in records');
await deleteNames(claimNames, 'seat claims');
await deleteNames(bookingDocs.map((doc) => doc.name), 'bookings');
console.log('Cleanup complete.');
