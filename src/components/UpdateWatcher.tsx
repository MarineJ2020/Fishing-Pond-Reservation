import React, { useEffect, useState } from 'react';

// Notices when a newer build has been deployed and moves open tabs onto it, so
// a tab left open for days can't keep running old code (on 2026-11-13 a stale
// admin tab auto-created a fake competition that customers then booked).
//
// Cost: one tiny static /version.json fetch from Hosting (no Firestore reads)
// when the tab comes back into view and every CHECK_EVERY_MS while visible.
//
// Where reloading could lose work (booking form, CMS, a booking page) it only
// shows a banner; elsewhere it reloads by itself.

const CHECK_EVERY_MS = 15 * 60 * 1000;
const MIN_GAP_MS = 2 * 60 * 1000;
const RELOAD_GUARD_KEY = 'kks-reloaded-for-build';
// If a reload still lands on old code (cached HTML), don't loop: wait this long
// before trying the same target build again.
const RELOAD_RETRY_MS = 15 * 60 * 1000;

const UNSAFE_PATHS = [/^\/book\/?$/, /^\/cms/, /^\/bookings\//, /^\/confirmed/, /^\/profile/];
const isSafeToReload = () => !UNSAFE_PATHS.some((re) => re.test(window.location.pathname));

const readGuard = (): { build?: string; at?: number } => {
  try { return JSON.parse(sessionStorage.getItem(RELOAD_GUARD_KEY) || '{}'); } catch { return {}; }
};

const reloadFor = (build: string) => {
  const guard = readGuard();
  if (guard.build === build && guard.at && Date.now() - guard.at < RELOAD_RETRY_MS) return false;
  try { sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify({ build, at: Date.now() })); } catch { /* storage blocked */ }
  window.location.reload();
  return true;
};

const UpdateWatcher: React.FC = () => {
  const [pendingBuild, setPendingBuild] = useState<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let lastCheck = 0;
    let latest: string | null = null;
    let cancelled = false;

    const apply = () => {
      if (!latest || latest === __APP_BUILD_ID__) return;
      if (isSafeToReload() && reloadFor(latest)) return;
      setPendingBuild(latest);
    };

    const check = async (force = false) => {
      if (document.visibilityState !== 'visible') return;
      if (!force && Date.now() - lastCheck < MIN_GAP_MS) { apply(); return; }
      lastCheck = Date.now();
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = await res.json();
        if (cancelled || typeof build !== 'string' || !build) return;
        latest = build;
        apply();
      } catch { /* offline / weak signal: try again later */ }
    };

    // Old lazy chunks disappear after a deploy; a failed chunk load means this
    // tab is outdated, so reload (once) instead of showing a broken screen.
    const onPreloadError = (event: Event) => {
      event.preventDefault();
      reloadFor(`chunk-${__APP_BUILD_ID__}`);
    };

    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('vite:preloadError', onPreloadError);
    // Also re-evaluate on in-app navigation: leaving the booking form/CMS for a
    // safe page lets a pending update apply without any network request.
    const pathTimer = window.setInterval(apply, 5000);
    const checkTimer = window.setInterval(() => void check(true), CHECK_EVERY_MS);
    const firstCheck = window.setTimeout(() => void check(true), 30_000);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('vite:preloadError', onPreloadError);
      window.clearInterval(pathTimer);
      window.clearInterval(checkTimer);
      window.clearTimeout(firstCheck);
    };
  }, []);

  if (!pendingBuild) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 100000, maxWidth: 520, margin: '0 auto',
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12,
        background: '#0b2a44', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,.35)', fontSize: 14, lineHeight: 1.35,
      }}
    >
      <span style={{ flex: 1 }}>
        Versi baharu laman tersedia. Sila muat semula selepas selesai.
        <br /><span style={{ opacity: 0.75, fontSize: 12 }}>A new version is available — reload when you're done.</span>
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ border: 0, borderRadius: 8, padding: '8px 12px', background: '#16b7dc', color: '#04121f', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        Muat semula
      </button>
    </div>
  );
};

export default UpdateWatcher;
