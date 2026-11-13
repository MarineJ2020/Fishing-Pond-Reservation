// Gives existing KKS accounts the SUPER_ADMIN role (users/{uid}.role; the syncUserRoleClaims
// trigger then updates their Auth custom claims). Accounts must already have signed up.
// Dry run by default (reads only); --confirm writes. Uses the Firebase CLI login.
//   node scripts/set-super-admin.mjs a@x.com b@y.com            (dry run)
//   node scripts/set-super-admin.mjs a@x.com b@y.com --confirm
import { execFileSync } from 'node:child_process';

const projectId = process.env.FIREBASE_PROJECT_ID || 'kolamkelisayang';
const confirmed = process.argv.includes('--confirm');
const emails = process.argv.slice(2).filter((a) => a.includes('@'));
if (!emails.length) { console.log('Usage: node scripts/set-super-admin.mjs <email> [<email>...] [--confirm]'); process.exit(1); }

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
const accessToken = (await tokenRes.json()).access_token;
if (!accessToken) throw new Error('Could not refresh the Firebase CLI token.');
const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
console.log(`Project ${projectId}, account ${account.user?.email}. ${confirmed ? 'WRITING' : 'Dry run (add --confirm to write)'}.`);

for (const email of emails) {
  const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
    method: 'POST', headers, body: JSON.stringify({ email: [email] }),
  });
  const user = (await lookup.json().catch(() => ({}))).users?.[0];
  if (!user) { console.log(`  ${email}: no account yet (must register/sign in once first)`); continue; }
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${user.localId}`;
  const doc = await (await fetch(docUrl, { headers })).json().catch(() => ({}));
  const current = doc.fields?.role?.stringValue || '(no profile)';
  console.log(`  ${email}: uid ${user.localId}, current role ${current}`);
  if (current === 'SUPER_ADMIN' || !confirmed) continue;
  const patch = await fetch(`${docUrl}?updateMask.fieldPaths=role`, {
    method: 'PATCH', headers, body: JSON.stringify({ fields: { role: { stringValue: 'SUPER_ADMIN' } } }),
  });
  console.log(patch.ok ? `    -> set to SUPER_ADMIN` : `    -> FAILED HTTP ${patch.status}`);
}
