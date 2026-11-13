// Keeps recent builds' hashed files in every deploy (run after `vite build`,
// from copy-seo-template.mjs).
//
// Why: Firebase Hosting serves only the files of the latest release, and any
// missing path falls through the `**` rewrite to app.html (200, text/html).
// During a deploy the HTML (seoRender template / cached pages) and the
// hosted JS change at different moments; a request for a JS file that is not
// (or no longer) hosted then gets HTML, and Cloudflare caches that HTML under
// the /assets/** "immutable" header -> blank site with a "MIME type
// text/html" module error (happened 2026-11-12 and 2026-11-13).
//
// Fix: every build's dist/assets is stored in .cache/hosted-assets/, and files
// from builds of the last KEEP_DAYS are copied back into dist/assets, so both
// the old and the new HTML find their JS during and after a deploy.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP_DAYS = 3;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distAssets = path.join(root, 'dist', 'assets');
const store = path.join(root, '.cache', 'hosted-assets');

export function keepPreviousAssets() {
  if (!existsSync(distAssets)) return;
  mkdirSync(store, { recursive: true });
  const now = new Date();
  const current = new Set(readdirSync(distAssets));
  // Remember this build (mtime = when it was last part of a build).
  for (const name of current) {
    const stored = path.join(store, name);
    copyFileSync(path.join(distAssets, name), stored);
    utimesSync(stored, now, now);
  }
  const cutoff = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let restored = 0;
  let pruned = 0;
  for (const name of readdirSync(store)) {
    const stored = path.join(store, name);
    if (current.has(name)) continue;
    if (statSync(stored).mtimeMs < cutoff) { unlinkSync(stored); pruned += 1; continue; }
    copyFileSync(stored, path.join(distAssets, name));
    restored += 1;
  }
  console.log(`keep-previous-assets: kept ${restored} file(s) from builds of the last ${KEEP_DAYS} days, pruned ${pruned}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) keepPreviousAssets();
