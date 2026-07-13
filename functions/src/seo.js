import * as functions from 'firebase-functions';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminDb } from './auth-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// template.html is copied from dist/index.html by scripts/copy-seo-template.mjs
// as part of `npm run build`, so its hashed asset refs always match the
// deployed hosting bundle. Read once at cold start; a missing file fails loud
// rather than silently serving a broken page.
const TEMPLATE = readFileSync(path.join(__dirname, 'template.html'), 'utf8');

// Mirrors src/config/landingDefaults.ts SEO_DEFAULTS — kept in sync manually
// (same precedent as other cross-runtime constants in this functions codebase).
// Used only as a last-resort fallback if the settings/global read fails.
const SEO_DEFAULTS = {
    siteUrl: 'https://kolamkelisayang.com.my',
    siteName: 'Kolam Keli Sayang',
    defaultOgImage: '',
    pages: {
        home: {
            title: 'Kolam Keli Sayang (KKS) – Port Pancing Terbaik Kedah',
            description: 'Kolam pertandingan memancing keli di Kubang Rotan, Alor Setar. 12 lubuk mega, 480 peserta. Tempah slot pertandingan anda secara online.',
        },
        book: {
            title: 'Tempah Slot Pertandingan | Kolam Keli Sayang',
            description: 'Pilih pertandingan, kolam dan tempat duduk anda, kemudian buat bayaran secara online — tempahan siap kurang dari 2 minit.',
        },
        live: {
            title: 'Keputusan Live | Kolam Keli Sayang',
            description: 'Ikuti keputusan dan carta pendahulu pertandingan memancing keli secara langsung di Kolam Keli Sayang.',
        },
        confirmed: {
            title: 'Tempahan Disahkan | Kolam Keli Sayang',
            description: 'Tempahan slot pertandingan anda di Kolam Keli Sayang telah disahkan.',
        },
    },
};

const PAGE_BY_PATH = { '/': 'home', '/book': 'book', '/live': 'live', '/confirmed': 'confirmed' };

const CACHE_CONTROL = 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400';
const TTL_MS = 60_000;
let cache = { settings: null, at: 0 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function getSettings() {
    if (cache.settings && Date.now() - cache.at < TTL_MS) return cache.settings;
    try {
        const snap = await adminDb.doc('settings/global').get();
        cache = { settings: snap.exists ? snap.data() : {}, at: Date.now() };
    } catch (err) {
        console.error('seoRender: settings read failed', err);
        cache = { settings: cache.settings || {}, at: Date.now() };
    }
    return cache.settings;
}

const mergeSeo = (raw) => {
    const pages = (raw && raw.pages) || {};
    return {
        siteUrl: (raw && raw.siteUrl) || SEO_DEFAULTS.siteUrl,
        siteName: (raw && raw.siteName) || SEO_DEFAULTS.siteName,
        defaultOgImage: (raw && raw.defaultOgImage) || SEO_DEFAULTS.defaultOgImage,
        latitude: raw && typeof raw.latitude === 'number' ? raw.latitude : undefined,
        longitude: raw && typeof raw.longitude === 'number' ? raw.longitude : undefined,
        pages: {
            home: { ...SEO_DEFAULTS.pages.home, ...(pages.home || {}) },
            book: { ...SEO_DEFAULTS.pages.book, ...(pages.book || {}) },
            live: { ...SEO_DEFAULTS.pages.live, ...(pages.live || {}) },
            confirmed: { ...SEO_DEFAULTS.pages.confirmed, ...(pages.confirmed || {}) },
        },
    };
};

function buildLocalBusinessJsonLd(seo, raw) {
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: seo.siteName,
        url: seo.siteUrl,
        image: seo.defaultOgImage || raw.landingImages?.logo || undefined,
        telephone: raw.phone || undefined,
        email: raw.email || undefined,
        address: raw.location ? {
            '@type': 'PostalAddress',
            streetAddress: raw.location,
            addressRegion: 'Kedah',
            addressCountry: 'MY',
        } : undefined,
        geo: (typeof seo.latitude === 'number' && typeof seo.longitude === 'number') ? {
            '@type': 'GeoCoordinates',
            latitude: seo.latitude,
            longitude: seo.longitude,
        } : undefined,
        openingHoursSpecification: raw.openingHours ? {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: raw.openingHours.days,
            opens: raw.openingHours.timeStart,
            closes: raw.openingHours.timeEnd,
        } : undefined,
        sameAs: [raw.whatsapp, raw.googleMapsUrl].filter(Boolean),
    };
    // JSON.stringify drops undefined keys automatically; escape '<' so a stray
    // "</script>" can never terminate the script tag early.
    return JSON.stringify(ld).replace(/</g, '\\u003c');
}

function buildHead(seo, raw, pageKey, urlPath) {
    const meta = seo.pages[pageKey] || seo.pages.home;
    const siteUrl = (seo.siteUrl || '').replace(/\/$/, '');
    const canonical = `${siteUrl}${urlPath}`;
    const ogImage = meta.ogImage || seo.defaultOgImage || '';

    const tags = [
        `<title>${esc(meta.title)}</title>`,
        `<meta name="description" content="${esc(meta.description)}" />`,
        `<link rel="canonical" href="${esc(canonical)}" />`,
        `<meta name="robots" content="index, follow" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:url" content="${esc(canonical)}" />`,
        `<meta property="og:title" content="${esc(meta.title)}" />`,
        `<meta property="og:description" content="${esc(meta.description)}" />`,
        `<meta property="og:site_name" content="${esc(seo.siteName)}" />`,
        `<meta property="og:locale" content="ms_MY" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${esc(meta.title)}" />`,
        `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    ];
    if (ogImage) {
        tags.push(
            `<meta property="og:image" content="${esc(ogImage)}" />`,
            `<meta property="og:image:width" content="1200" />`,
            `<meta property="og:image:height" content="630" />`,
            `<meta name="twitter:image" content="${esc(ogImage)}" />`,
        );
    }
    if (pageKey === 'home') {
        tags.push(`<script type="application/ld+json">${buildLocalBusinessJsonLd(seo, raw)}</script>`);
    }
    return tags.join('\n    ');
}

function sendSitemap(res, seo, updatedAt) {
    const siteUrl = (seo.siteUrl || '').replace(/\/$/, '');
    let lastmod = new Date().toISOString();
    try {
        if (updatedAt && typeof updatedAt.toDate === 'function') lastmod = updatedAt.toDate().toISOString();
    } catch { /* fall back to now */ }
    const urls = ['/', '/book', '/live', '/confirmed'];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url>\n    <loc>${esc(siteUrl + u)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`)
        .join('\n')}\n</urlset>\n`;
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', CACHE_CONTROL);
    res.status(200).send(xml);
}

export const seoRender = functions.https.onRequest(async (req, res) => {
    const raw = (await getSettings()) || {};
    const seo = mergeSeo(raw.seo);

    if (req.path === '/sitemap.xml') {
        return sendSitemap(res, seo, raw.updatedAt);
    }

    const pageKey = PAGE_BY_PATH[req.path] || 'home';
    const head = buildHead(seo, raw, pageKey, req.path === '/' ? '/' : req.path);
    const html = TEMPLATE.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, head);

    res.set('Cache-Control', CACHE_CONTROL);
    res.status(200).send(html);
});
