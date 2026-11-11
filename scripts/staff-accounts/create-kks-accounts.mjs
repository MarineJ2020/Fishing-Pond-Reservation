// Creates the staff logins in the sheet on the KKS website: a Firebase Auth user
// (email already marked verified, so no verification email or mailbox access is
// needed) plus the users/{uid} profile with the staff role. Accounts that already
// exist are skipped and never modified. Dry run by default; --confirm writes.
// Uses the Firebase CLI login (same as scripts/backfill-seat-claims.mjs):
//   node scripts/staff-accounts/create-kks-accounts.mjs --confirm
import { execFileSync } from 'node:child_process';
import { flag, readSheet, writeSheet } from './sheet.mjs';

const projectId = process.env.FIREBASE_PROJECT_ID || 'kolamkelisayang';
const confirmed = flag('--confirm');
const rows = readSheet();
const ALLOWED_ROLES = ['STAFF', 'COUNTER_STAFF'];
const bad = rows.filter((r) => !ALLOWED_ROLES.includes(String(r.Peranan).toUpperCase()));
if (bad.length) { console.log(`Peranan must be STAFF or COUNTER_STAFF: ${bad.map((r) => r.Email).join(', ')}`); process.exit(1); }

console.log(`Project ${projectId}: ${rows.length} accounts. ${confirmed ? 'CREATING' : 'Dry run (add --confirm to create)'}.`);
if (!confirmed) {
  rows.forEach((row) => console.log(`  would create ${row.Email}  role ${row.Peranan}  [${row['Akaun KKS'] || 'not yet'}]`));
  process.exit(0);
}

const loginToken = async () => {
  const cli = process.platform === 'win32' ? ['cmd.exe', ['/c', 'npx', '-y', 'firebase-tools', 'login:list', '--json']] : ['npx', ['-y', 'firebase-tools', 'login:list', '--json']];
  const login = JSON.parse(execFileSync(cli[0], cli[1], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const account = (login.result || []).find((entry) => entry.user?.email === (process.env.FIREBASE_ACCOUNT || 'hello@kolamkelisayang.com.my')) || (login.result || [])[0];
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
const token = await loginToken();
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

let created = 0;
let skipped = 0;
let failed = 0;
for (const row of rows) {
  if (row['Akaun KKS'] === 'DIBUAT') { skipped += 1; continue; }
  const role = String(row.Peranan).toUpperCase();
  const signup = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: row.Email, password: row.Password, displayName: row.Nama, emailVerified: true }),
  });
  const body = await signup.json().catch(() => ({}));
  if (!signup.ok) {
    const message = body.error?.message || `HTTP ${signup.status}`;
    if (/EMAIL_EXISTS/.test(message)) {
      row['Akaun KKS'] = 'SUDAH ADA';
      skipped += 1;
      console.log(`  exists   ${row.Email}  (left unchanged - its password may differ from the sheet)`);
    } else {
      row['Akaun KKS'] = 'GAGAL';
      failed += 1;
      console.log(`  FAILED   ${row.Email}  ${message}`);
    }
    writeSheet(rows);
    continue;
  }
  const uid = body.localId;
  const profile = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      fields: {
        email: { stringValue: row.Email },
        name: { stringValue: row.Nama },
        phone: { stringValue: '' },
        role: { stringValue: role },
        createdAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
  if (!profile.ok) {
    row['Akaun KKS'] = 'PROFIL GAGAL';
    failed += 1;
    console.log(`  FAILED   ${row.Email}  login created but profile write failed: HTTP ${profile.status}`);
  } else {
    row['Akaun KKS'] = 'DIBUAT';
    row['Email disahkan'] = 'YA';
    created += 1;
    console.log(`  created  ${row.Email}  role ${role}`);
  }
  writeSheet(rows);
}
console.log(`Done: ${created} created, ${skipped} skipped, ${failed} failed.`);
