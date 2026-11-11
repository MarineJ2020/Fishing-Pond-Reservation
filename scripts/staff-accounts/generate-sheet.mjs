// Generates kkstimbang01 .. kkstimbang20 @kolamkelisayang.com.my with a random
// password each and writes staff-accounts/staff-accounts.csv. Refuses to overwrite
// an existing sheet (so passwords already handed out are never regenerated).
//   node scripts/staff-accounts/generate-sheet.mjs [--role=STAFF]
import fs from 'node:fs';
import { randomInt } from 'node:crypto';
import { DOMAIN, SHEET_FILE, writeSheet } from './sheet.mjs';

const FROM = 1;
const TO = 20;
const role = (process.argv.find((a) => a.startsWith('--role=')) || '--role=STAFF').split('=')[1].toUpperCase();

// No look-alike characters (0/O, 1/l/I) and no symbols that need escaping in URLs/CSV.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const pick = (set) => set[randomInt(set.length)];
const makePassword = (length = 12) => {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT)];
  const all = UPPER + LOWER + DIGIT;
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
};

if (fs.existsSync(SHEET_FILE)) {
  console.log(`Sheet already exists, not overwriting: ${SHEET_FILE}`);
  process.exit(1);
}
const rows = [];
for (let n = FROM; n <= TO; n += 1) {
  const num = String(n).padStart(2, '0');
  rows.push({
    No: n,
    Email: `kkstimbang${num}@${DOMAIN}`,
    Password: makePassword(),
    Nama: `KKS Timbang ${num}`,
    Peranan: role,
    'Mailbox cPanel': '',
    'Akaun KKS': '',
    'Email disahkan': '',
  });
}
writeSheet(rows);
console.log(`Wrote ${rows.length} accounts (role ${role}) to ${SHEET_FILE}`);
