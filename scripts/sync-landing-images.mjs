// Downloads the CMS-uploaded landing images (settings/global.landingImages) into
// public/landing/ so Firebase Hosting serves them from its CDN. Storage download
// URLs take ~2s to first byte and are uncacheable; the hero is the LCP element.
//
// Writes the list of downloaded object names to src/generated/landing-static.json
// and functions/src/landing-static.json (the client's cdnImage() and seoRender's
// hero preload read it). Anything not listed — e.g. an image uploaded after this
// build — falls back to the /landing-img function. Never fails the build: with
// no network the list is simply empty.
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'landing');
const SETTINGS_URL = 'https://firestore.googleapis.com/v1/projects/kolamkelisayang/databases/(default)/documents/settings/global';
const STORAGE_RE = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/(fishing-pond-landing%2F[^?]+)/;

const names = [];
try {
    const res = await fetch(SETTINGS_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`settings ${res.status}`);
    const doc = await res.json();
    const images = doc.fields?.landingImages?.mapValue?.fields || {};
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const v of Object.values(images)) {
        const url = v.stringValue;
        const m = url && STORAGE_RE.exec(url);
        if (!m) continue;
        const name = decodeURIComponent(m[1]);
        const file = name.slice(name.lastIndexOf('/') + 1);
        const img = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!img.ok) { console.warn(`sync-landing-images: ${file} -> ${img.status}`); continue; }
        writeFileSync(path.join(outDir, file), Buffer.from(await img.arrayBuffer()));
        names.push(file);
    }
} catch (err) {
    console.warn('sync-landing-images: skipped (', err.message, ')');
    if (existsSync(outDir)) names.push(...readdirSync(outDir));
}

const json = JSON.stringify([...new Set(names)].sort(), null, 2) + '\n';
for (const target of ['src/generated/landing-static.json', 'functions/src/landing-static.json']) {
    writeFileSync(path.join(root, target), json);
}
console.log('sync-landing-images:', names.length ? names.join(', ') : 'none');
