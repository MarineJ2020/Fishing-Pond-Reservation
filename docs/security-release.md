# Booking security release

## Changes

- Full booking documents and payment history are readable by their owner, staff and admins. Legacy email and user-reference ownership is supported; email ownership requires a verified email.
- The public availability endpoint returns only competition, pond, peg and reservation status. It derives occupancy from existing bookings, so no historical backfill is necessary. Public ranking and winner data remain in `eventResults`.
- New customer and CMS receipt uploads use `fishing-pond-receipts/{uploaderUid}/{fileName}`. Only the uploader can create a new file. Existing files cannot be overwritten or deleted by clients; staff/admins can review them. Old single-folder receipts retain authenticated read access and existing token URLs remain usable.
- Booking creation validates competition dates, booking windows, configured ponds and peg limits on the server. Prices, deposits, identity, status and references are server controlled. Existing booking windows are preserved: an upcoming event can accept advance bookings when its booking window is already open.
- Transactions check both legacy competition ID encodings and deterministic private peg claims. Cancelled/rejected claims are immediately reusable; a trigger cleans them up without deleting a replacement booking's claim.
- Customer receipt submission and replacement use transactions. Accepted receipt history, payment totals and booking status cannot be edited through these endpoints or direct client writes.
- The HTTP API permits public invocation so browsers can reach it. Every write route still verifies a Firebase Auth token and its required role or booking ownership; only seat availability is readable anonymously.
- CMS approval/check-in workflows keep their existing APIs. Private booking data is cleared on account changes and is no longer written to the browser's shared application cache.

## Verification

Requires Node.js, Firebase CLI and Java 21 on PATH. Tests use a demo project and reject execution without emulator configuration.

```sh
node --test functions/test/*.test.mjs
firebase emulators:exec --only auth,firestore,storage --project demo-kks-security --config firebase.security.json "npm run test:security"
npm run build
```

The emulator suite covers owner/staff/admin reads, blocked public and foreign reads, forged creates and financial updates, scoped immutable receipts, old receipt previews, public results, competing submissions, historical seat conflicts, claim release, deposit/balance receipts and rejected-receipt replacement. HTTP tests use actual emulator sign-ins and Storage uploads. Production data is not used.

The existing repository-wide TypeScript check is not clean (including missing Next imports, OCR module resolution and existing unused declarations). A successful Vite build does not imply those pre-existing errors are fixed.

## Staged release

Keep hosting and functions together as required by `AGENTS.md`, because `seoRender` embeds the current asset names. Do not deploy restrictive Firestore rules before the new API and client are available.

1. Build with the intended Firebase project configuration and run `scripts/copy-seo-template.mjs` (already included in `npm run build`). The booking API defaults to `https://us-central1-${VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net/api`; an explicit `VITE_FUNCTIONS_BASE_URL` must include `/api`.
2. Deploy the compatibility stage: `firebase deploy --only "hosting,functions,storage" --project kolamkelisayang`. This enables the new API, frontend, immutable scoped uploads and claim cleanup. Existing Firestore rules remain temporarily in effect. This stage alone does not complete booking privacy hardening.
3. Verify `/bookingAvailability` succeeds; check public pages logged out, owner booking list/detail, and a controlled booking/payment workflow. Check both ADMIN and STAFF CMS access, old receipt previews, approval/rejection, force-cancel, check-in and weighing. Refresh older browser tabs to load the new client. An older tab cannot use the removed insecure booking fallback once rules are tightened.
4. Complete lockdown promptly after these checks: `firebase deploy --only "hosting,functions,firestore,storage" --project kolamkelisayang`. Verify owner/CMS access again and confirm an anonymous full-booking query is rejected.

## Operational notes

- No historical bookings, receipts, payments, results or winners need modification or deletion. The only new stored coordination data is `bookingSeatClaims` for new bookings.
- Existing download-token URLs are bearer links; their compatibility is intentionally retained. This release does not revoke historical receipt tokens.
- Availability currently scans existing bookings server-side on each request. This preserves historical compatibility; a later public occupancy projection can reduce read cost if booking volume requires it.
- If the availability API fails, the public site can still load, but peg selection fails closed with a Malay error. Booking submission has no direct-write fallback. A client-only preview using production Firebase needs the new Functions API deployed, or an emulator backend.
- Do not roll back only the frontend to the former direct-write client after lockdown. Keep a known-good build using the new API, or fix forward. Reopening booking rules would restore the original security problem.
- Live browser/CMS production smoke checks are still required during the staged release; automated emulator tests do not replace those checks.
