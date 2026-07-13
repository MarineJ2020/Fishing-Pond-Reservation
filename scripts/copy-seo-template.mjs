// Copies the built dist/index.html into functions/src/template.html so the
// seoRender Cloud Function injects meta tags into the exact same HTML shell
// (with matching hashed asset refs) that Firebase Hosting serves. Run as part
// of `npm run build` — never deploy hosting or functions alone after a
// rebuild, or the two can drift out of sync.
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'dist', 'index.html');
const dest = path.join(root, 'functions', 'src', 'template.html');

if (!existsSync(src)) {
  console.error(`copy-seo-template: ${src} not found — run "vite build" first.`);
  process.exit(1);
}

copyFileSync(src, dest);
console.log(`copy-seo-template: copied ${src} -> ${dest}`);
