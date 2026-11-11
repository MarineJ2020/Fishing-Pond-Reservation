// Creates the mailboxes in the sheet through the cPanel UAPI (Email::add_pop).
// Dry run by default; --confirm creates them. Mailboxes that already exist are
// skipped (never touched), and the sheet's "Mailbox cPanel" column is updated.
//
// Needs a cPanel API token (cPanel > Security > Manage API Tokens), passed as
// environment variables so nothing is stored in a file:
//   $env:CPANEL_HOST = 'kolamkelisayang.com.my'     # or the server name Exabytes gave you
//   $env:CPANEL_USER = 'your-cpanel-username'
//   $env:CPANEL_TOKEN = 'the-api-token'
//   node scripts/staff-accounts/create-cpanel-mailboxes.mjs --confirm
import { flag, readSheet, writeSheet } from './sheet.mjs';

const confirmed = flag('--confirm');
const { CPANEL_HOST, CPANEL_USER, CPANEL_TOKEN } = process.env;
const QUOTA_MB = 250;

const rows = readSheet();
console.log(`${rows.length} mailboxes in the sheet. ${confirmed ? 'CREATING' : 'Dry run (add --confirm to create)'}.`);

if (!confirmed) {
  rows.forEach((row) => console.log(`  would create ${row.Email}  [${row['Mailbox cPanel'] || 'not yet'}]`));
  process.exit(0);
}
if (!CPANEL_HOST || !CPANEL_USER || !CPANEL_TOKEN) {
  console.log('Set CPANEL_HOST, CPANEL_USER and CPANEL_TOKEN first (see the top of this file).');
  process.exit(1);
}

let created = 0;
let skipped = 0;
let failed = 0;
for (const row of rows) {
  if (row['Mailbox cPanel'] === 'DIBUAT') { skipped += 1; continue; }
  const [local, domain] = row.Email.split('@');
  const res = await fetch(`https://${CPANEL_HOST}:2083/execute/Email/add_pop`, {
    method: 'POST',
    headers: { Authorization: `cpanel ${CPANEL_USER}:${CPANEL_TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: local, domain, password: row.Password, quota: String(QUOTA_MB), send_welcome_email: '0' }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ errors: [e.message] }) }));
  const body = await res.json().catch(() => ({}));
  const errors = (body.errors || []).join(' ');
  if (body.status === 1) {
    row['Mailbox cPanel'] = 'DIBUAT';
    created += 1;
    console.log(`  created  ${row.Email}`);
  } else if (/already exists/i.test(errors)) {
    row['Mailbox cPanel'] = 'SUDAH ADA';
    skipped += 1;
    console.log(`  exists   ${row.Email}  (left unchanged - its password may differ from the sheet)`);
  } else {
    row['Mailbox cPanel'] = 'GAGAL';
    failed += 1;
    console.log(`  FAILED   ${row.Email}  HTTP ${res.status} ${errors || 'no detail'}`);
  }
  writeSheet(rows);
}
console.log(`Done: ${created} created, ${skipped} skipped, ${failed} failed.`);
