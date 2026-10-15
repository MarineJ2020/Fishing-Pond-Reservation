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
        // No getMetadata() round trip: the type comes from the extension (the CMS
        // only uploads images) and a missing object surfaces as a stream error.
        const ext = name.split('.').pop().toLowerCase();
        const type = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' }[ext];
        if (!type) { res.status(400).send('Bad request'); return; }
        const stream = admin.storage().bucket().file(name).createReadStream();
        stream.once('error', (err) => {
            if (res.headersSent) { res.end(); return; }
            const notFound = err?.code === 404;
            if (!notFound) console.error('landingImage failed', err);
            res.set('Cache-Control', 'public, max-age=60');
            res.status(notFound ? 404 : 500).send(notFound ? 'Not found' : 'Error');
        });
        stream.once('response', () => {
            res.set('Content-Type', type);
            res.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
        });
        stream.pipe(res);
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
