// Writes firebase.staging.json from firebase.json for the staging project:
//  - X-Robots-Tag: noindex on every response (staging must never be indexed)
//  - no `extensions` (the Trigger Email extension isn't installed there, so no real mail is sent)
// Used by `npm run deploy:staging`; the output is gitignored.
import { readFileSync, writeFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
delete config.extensions;
const all = config.hosting.headers.find((entry) => entry.source === '**');
all.headers.push({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
writeFileSync(new URL('../firebase.staging.json', import.meta.url), `${JSON.stringify(config, null, 2)}\n`);
console.log('Wrote firebase.staging.json');
