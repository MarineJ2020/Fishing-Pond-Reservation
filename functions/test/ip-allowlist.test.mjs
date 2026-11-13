import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ALLOWED_IPS = '60.53.223.200, 37.35.39.148';
const { clientIp, isAllowed, gated } = await import('../src/ip-allowlist.js');

const req = (headers) => ({ headers, ip: '::ffff:169.254.1.1' });
const viaHosting = (visitor, extra = {}) => req({
    'x-appengine-user-ip': '66.249.82.224', 'fastly-client-ip': visitor, 'x-forwarded-for': `${visitor},66.249.82.224`, via: '1.1 Firebase Hosting', ...extra,
});
const direct = (realIp, extra = {}) => req({ 'x-appengine-user-ip': realIp, 'x-forwarded-for': `${extra.spoof ? `${extra.spoof},` : ''}${realIp}`, ...extra.headers });

test('requests through Hosting use the Fastly client IP', () => {
    assert.equal(clientIp(viaHosting('60.53.223.200')), '60.53.223.200');
    assert.equal(isAllowed(viaHosting('60.53.223.200')), true);
    assert.equal(isAllowed(viaHosting('37.35.39.148')), true);
    assert.equal(isAllowed(viaHosting('8.8.8.8')), false);
});

test('a direct call is judged by its own address, whatever headers it forges', () => {
    assert.equal(isAllowed(direct('37.35.39.148')), true);
    assert.equal(isAllowed(direct('8.8.8.8')), false);
    // forged hosting-style headers + forged X-Forwarded-For must not help
    const forged = direct('8.8.8.8', { spoof: '60.53.223.200', headers: { via: '1.1 Firebase Hosting', 'fastly-client-ip': '60.53.223.200' } });
    assert.equal(clientIp(forged), '8.8.8.8');
    assert.equal(isAllowed(forged), false);
});

test('unknown address (no Google header) is never allowed', () => {
    assert.equal(isAllowed(req({ 'x-forwarded-for': '60.53.223.200', 'fastly-client-ip': '60.53.223.200' })), false);
});

test('gated handlers answer 403 and force no-store; allowed requests pass through uncached', () => {
    const run = (request) => {
        const out = { headers: {}, status: 0, ended: false, body: '' };
        const res = {
            statusCode: 0,
            setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
            end(b) { out.ended = true; out.body = b; out.status = this.statusCode; },
        };
        let called = false;
        gated((_req, response) => { called = true; response.setHeader('Cache-Control', 'public, s-maxage=600'); response.statusCode = 200; response.end('ok'); })(request, res);
        return { called, ...out };
    };
    const denied = run(viaHosting('8.8.8.8'));
    assert.equal(denied.called, false);
    assert.equal(denied.status, 403);
    const ok = run(viaHosting('60.53.223.200'));
    assert.equal(ok.called, true);
    assert.equal(ok.headers['cache-control'], 'private, no-store');
});

test('with ALLOWED_IPS unset nothing is gated (production)', async () => {
    delete process.env.ALLOWED_IPS;
    const { gated: gatedProd } = await import('../src/ip-allowlist.js');
    let called = false;
    gatedProd(() => { called = true; })(req({}), {});
    assert.equal(called, true);
});
