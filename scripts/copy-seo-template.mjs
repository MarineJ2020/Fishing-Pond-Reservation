// Copies the built dist/index.html into functions/src/template.html so the
// seoRender Cloud Function injects meta tags into the exact same HTML shell
// (with matching hashed asset refs) that Firebase Hosting serves. Run as part
// of `npm run build` — never deploy hosting or functions alone after a
// rebuild, or the two can drift out of sync.
//
// It then renames dist/index.html -> dist/app.html. Firebase Hosting serves
// an existing static file for a request BEFORE it ever consults rewrites, and
// "/" implicitly resolves to "index.html" — so as long as dist/index.html
// physically exists, requests to "/" always serve the static shell directly
// and the "/" -> seoRender rewrite in firebase.json never fires. Removing the
// literal index.html (the catch-all rewrite instead targets /app.html) lets
// the "/" rewrite reach the function like every other route does.
import { copyFileSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'dist', 'index.html');
const dest = path.join(root, 'functions', 'src', 'template.html');
const renamed = path.join(root, 'dist', 'app.html');

if (!existsSync(src)) {
  console.error(`copy-seo-template: ${src} not found — run "vite build" first.`);
  process.exit(1);
}

copyFileSync(src, dest);
console.log(`copy-seo-template: copied ${src} -> ${dest}`);

renameSync(src, renamed);
console.log(`copy-seo-template: renamed ${src} -> ${renamed} (keeps "/" from shadowing the seoRender rewrite)`);
