// Sets settings/global.phone and settings/global.whatsapp on production (only those two fields).
//   node scripts/set-contact-numbers.mjs "+60 19-706 5002" "60197065002"
import { execFileSync } from 'node:child_process';

const [phone, whatsapp] = process.argv.slice(2);
if (!phone || !whatsapp) throw new Error('Usage: node scripts/set-contact-numbers.mjs <phone> <whatsapp>');
const projectId = process.env.FIREBASE_PROJECT_ID || 'kolamkelisayang';

const cli = process.platform === 'win32' ? ['cmd.exe', ['/c', 'npx', '-y', 'firebase-tools', 'login:list', '--json']] : ['npx', ['-y', 'firebase-tools', 'login:list', '--json']];
const login = JSON.parse(execFileSync(cli[0], cli[1], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const account = (login.result || []).find((e) => e.user?.email === (process.env.FIREBASE_ACCOUNT || 'hello@kolamkelisayang.com.my')) || (login.result || [])[0];
if (!account?.tokens?.refresh_token) throw new Error('No Firebase CLI login found. Run: npx -y firebase-tools login');
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.tokens.refresh_token,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  }),
});
const token = (await tokenRes.json()).access_token;
if (!token) throw new Error('Could not refresh the Firebase CLI token. Run: npx -y firebase-tools login --reauth');
console.log(`Account: ${account.user?.email}`);

const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/global`;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const before = await (await fetch(url, { headers })).json();
console.log('Before:', before.fields?.phone?.stringValue, '|', before.fields?.whatsapp?.stringValue);

const res = await fetch(`${url}?updateMask.fieldPaths=phone&updateMask.fieldPaths=whatsapp`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ fields: { phone: { stringValue: phone }, whatsapp: { stringValue: whatsapp } } }),
});
if (!res.ok) throw new Error(`PATCH failed ${res.status}: ${await res.text()}`);
const after = await res.json();
console.log('After: ', after.fields?.phone?.stringValue, '|', after.fields?.whatsapp?.stringValue);
