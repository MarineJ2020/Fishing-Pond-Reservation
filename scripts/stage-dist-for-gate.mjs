// Copies the built site (dist/) into functions/staging-dist so the staging gate function can
// serve it behind the IP allowlist. Gitignored; excluded from production function uploads.
import { cpSync, existsSync, rmSync } from 'node:fs';

const from = new URL('../dist', import.meta.url);
const to = new URL('../functions/staging-dist', import.meta.url);
if (!existsSync(from)) throw new Error('dist/ is missing - run npm run build:staging first');
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log('Copied dist -> functions/staging-dist');
