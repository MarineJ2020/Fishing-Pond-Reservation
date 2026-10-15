import { adminAuth } from './auth-utils.js'; // ensures admin.initializeApp() has run
import admin from 'firebase-admin';
import { regional } from './regions.js';

void adminAuth;

// Firebase Storage download URLs are slow to first byte from Malaysia (~2s) and
// are sent `Cache-Control: private, max-age=0`, so the landing hero (the LCP
// element) never benefits from a CDN. Hosting rewrites /landing-img here; the
// response is cacheable and Hosting's CDN serves repeats from the edge.
// Object names are timestamp-unique (see imageStorage.ts) so a long TTL is safe.
const PREFIX = 'fishing-pond-landing/';

export const landingImage = regional.runWith({ maxInstances: 10 }).https.onRequest(async (req, res) => {
    const name = String(req.query.o || '');
    if (!name.startsWith(PREFIX) || name.includes('..') || name.length > 300) {
        res.status(400).send('Bad request');
        return;
    }
    try {
        const file = admin.storage().bucket().file(name);
        const [meta] = await file.getMetadata();
        res.set('Content-Type', meta.contentType || 'application/octet-stream');
        res.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
        file.createReadStream()
            .on('error', () => { if (!res.headersSent) res.status(500).end(); else res.end(); })
            .pipe(res);
    } catch (err) {
        if (err?.code === 404) {
            res.set('Cache-Control', 'public, max-age=60');
            res.status(404).send('Not found');
            return;
        }
        console.error('landingImage failed', err);
        res.status(500).send('Error');
    }
});
