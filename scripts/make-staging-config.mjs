// Writes firebase.staging.json from firebase.json for the staging project:
//  - X-Robots-Tag: noindex on every response (staging must never be indexed)
//  - no `extensions` (the Trigger Email extension isn't installed there, so no real mail is sent)
//  - IP allowlist: Hosting serves only staging-public/ (robots.txt); everything else rewrites to
//    the stagingGate function, which checks ALLOWED_IPS (functions/.env.kolamkelisayang-staging)
//    and serves the site bundled in functions/staging-dist (see scripts/stage-dist-for-gate.mjs)
// Used by `npm run deploy:staging`; the output is gitignored.
import { readFileSync, writeFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
delete config.extensions;
const all = config.hosting.headers.find((entry) => entry.source === '**');
all.headers.push({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
config.hosting.public = 'staging-public';
const catchAll = config.hosting.rewrites.find((rule) => rule.source === '**');
delete catchAll.destination;
catchAll.function = { functionId: 'stagingGate', region: 'asia-southeast1' };
config.functions[0].ignore = config.functions[0].ignore.filter((entry) => entry !== 'staging-dist');
writeFileSync(new URL('../firebase.staging.json', import.meta.url), `${JSON.stringify(config, null, 2)}\n`);
console.log('Wrote firebase.staging.json');
