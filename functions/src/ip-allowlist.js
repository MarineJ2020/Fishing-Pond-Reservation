// Optional IP allowlist, used only on the staging project (ALLOWED_IPS set in
// functions/.env.kolamkelisayang-staging). Production leaves ALLOWED_IPS unset, so every
// helper here is a no-op there and behaviour is unchanged.
//
// Cached copies would bypass the check (Hosting' CDN keys on the URL, not the visitor), so
// while the gate is on every response is rewritten to `private, no-store`.

const parseList = (value) => String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);

export const allowedIps = () => parseList(process.env.ALLOWED_IPS);
export const gateEnabled = () => allowedIps().length > 0;

const normalize = (ip) => String(ip || '').trim().replace(/^::ffff:/i, '');

// Firebase Hosting reaches functions from Google's own proxy range (66.249.64.0/19, seen as
// 66.249.82.x), and only then is Fastly's view of the visitor trustworthy.
const isHostingProxy = (ip) => /^66\.249\.(6[4-9]|[78]\d|9[0-5])\./.test(ip);

// The visitor's address. Request headers a client can set itself (X-Forwarded-For entries,
// Fastly-Client-IP, Via) are believed ONLY when X-Appengine-User-Ip - set by Google, never by
// the client - shows the request really came through Hosting. A direct call to a function URL
// is judged by its own X-Appengine-User-Ip. A missing header means unknown, i.e. not allowed.
export const clientIp = (req) => {
    const edge = normalize(req.headers['x-appengine-user-ip']);
    if (!isHostingProxy(edge)) return edge;
    const fastly = normalize(req.headers['fastly-client-ip']);
    if (fastly) return fastly;
    return normalize(String(req.headers['x-forwarded-for'] || '').split(',')[0]);
};

export const isAllowed = (req) => {
    const ip = clientIp(req);
    return ip !== '' && allowedIps().includes(ip);
};

const forbid = (res) => {
    res.statusCode = 403;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('403 Forbidden');
};

// Force `Cache-Control: private, no-store` on anything the handler sets afterwards.
const neverCache = (res) => {
    const original = res.setHeader.bind(res);
    res.setHeader = (name, value) => original(name, String(name).toLowerCase() === 'cache-control' ? 'private, no-store' : value);
    res.setHeader('Cache-Control', 'private, no-store');
};

// Express middleware.
export const ipGate = (req, res, next) => {
    if (!gateEnabled()) return next();
    if (!isAllowed(req)) return forbid(res);
    neverCache(res);
    return next();
};

// Wraps a plain (req, res) function handler.
export const gated = (handler) => (req, res) => {
    if (!gateEnabled()) return handler(req, res);
    if (!isAllowed(req)) return forbid(res);
    neverCache(res);
    return handler(req, res);
};
