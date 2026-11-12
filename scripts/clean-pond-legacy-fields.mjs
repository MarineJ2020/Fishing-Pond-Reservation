// Removes leftovers of the old drawn-pond-map feature from every pond doc:
//   seatLayout (per-peg map positions, ~250 KB across all ponds, shipped to every
//   visitor by /api/publicPonds) and shape (map outline). Neither is used: the
//   booking page always shows the Kiri/Kanan peg grid and the map editor is gone.
// Also resets pond pricePerSeat to 100 — peg price now comes from the
// competition's pricePerPeg; the pond value is only an unused fallback.
// Dry run by default. With --confirm it first backs up all pond docs to backups/.
//   node scripts/clean-pond-legacy-fields.mjs            # report only
//   node scripts/clean-pond-legacy-fields.mjs --confirm  # backup + clean
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const projectId = process.env.FIREBASE_PROJECT_ID || 'kolamkelisayang';
const accountEmail = process.env.FIREBASE_ACCOUNT || 'hello@kolamkelisayang.com.my';
const confirmed = process.argv.includes('--confirm');
const LEGACY_FIELDS = ['seatLayout', 'shape'];
const PRICE = 100;

const login = JSON.parse(execFileSync('cmd.exe', ['/c', 'scripts\\firebase-cli.cmd', 'login:list', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const account = (login.result || []).find((e) => e.user?.email === accountEmail) || (login.result || [])[0];
const token = account?.tokens?.access_token;
if (!token) throw new Error(`No Firebase CLI access token found. Run firebase login:add for ${accountEmail}.`);

const api = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const request = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} failed ${res.status}: ${await res.text()}`);
  return res.json();
};

const ponds = (await request(`${api}/ponds?pageSize=300`)).documents || [];
console.log(`Project: ${projectId}   Account: ${account.user?.email}   Ponds: ${ponds.length}`);
const plans = ponds.map((doc) => {
  const f = doc.fields || {};
  const remove = LEGACY_FIELDS.filter((name) => name in f);
  const price = Number(f.pricePerSeat?.integerValue ?? f.pricePerSeat?.doubleValue);
  const fixPrice = price !== PRICE;
  console.log(`  ${(f.name?.stringValue || doc.name.split('/').pop()).padEnd(10)} remove: ${remove.join(', ') || '-'}   price: ${Number.isFinite(price) ? price : 'none'}${fixPrice ? ` -> ${PRICE}` : ''}`);
  return { doc, remove, fixPrice };
}).filter((p) => p.remove.length || p.fixPrice);

if (!confirmed) {
  console.log(`\nDry run only. ${plans.length} pond(s) would change. Re-run with --confirm to back up and apply.`);
  process.exit(0);
}

mkdirSync('backups', { recursive: true });
const backupFile = `backups/ponds-before-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupFile, JSON.stringify(ponds));
console.log(`\nBackup saved to ${backupFile}`);

for (const { doc, remove, fixPrice } of plans) {
  // Fields listed in updateMask but absent from the body are deleted.
  const mask = [...remove, ...(fixPrice ? ['pricePerSeat'] : [])];
  const url = new URL(`https://firestore.googleapis.com/v1/${doc.name}`);
  mask.forEach((path) => url.searchParams.append('updateMask.fieldPaths', path));
  url.searchParams.set('currentDocument.exists', 'true');
  await request(url.toString(), { method: 'PATCH', body: JSON.stringify({ fields: fixPrice ? { pricePerSeat: { integerValue: String(PRICE) } } : {} }) });
  console.log(`Updated ${doc.fields?.name?.stringValue || doc.name}`);
}
console.log('Done.');
