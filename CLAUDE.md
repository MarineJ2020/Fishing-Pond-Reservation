# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Kolam Keli Sayang (KKS) / "CastBook": a React 18 + TypeScript + Vite app on Firebase
(Firestore, Auth, Storage, Hosting, Cloud Functions) for booking pegs at catfish
pond fishing competitions, live weigh-in results, and a staff CMS. Firebase project:
`kolamkelisayang`. User-facing text is Malay (often bilingual Malay / English).

## Git commits
- Do **not** include a `Co-Authored-By` trailer in commit messages.
- `AGENTS.md` holds the same rules for Codex; keep the two in sync when changing them.

## Commands

```bash
npm run dev            # Vite dev server on :5173 (honours PORT env var)
npm run build          # vite build + scripts/copy-seo-template.mjs (see below)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit — NOT clean on master (pre-existing errors); a passing build does not mean typecheck passes
npm --prefix functions test                  # Cloud Functions unit tests (node:test, functions/test/*.test.mjs)
node --test functions/test/role-policy.test.mjs   # single unit test file
npm run test:security  # rules + booking API tests in tests/security/ against Auth/Firestore/Storage emulators
```

The security suite needs Java 21 and the Firebase CLI; it refuses to run without
emulator env vars and uses the demo project `demo-kks-security` with
`firebase.security.json` (alternate emulator ports). Explicit form:
`firebase emulators:exec --only auth,firestore,storage --project demo-kks-security --config firebase.security.json "node --test tests/security/*.test.mjs"`.

Production builds fail on purpose if the `VITE_FIREBASE_*` vars in `.env.local` are
missing or malformed (`vite.config.mjs`), to avoid deploying a blank site.

## Build & deploy
- **Always deploy `hosting` and `functions` together** (never `--only hosting`
  alone). `/`, `/book`, `/live`, `/confirmed` are rendered by the `seoRender`
  Cloud Function from a bundled `functions/src/template.html` that carries the
  build's hashed asset names. A hosting-only deploy leaves that template pointing
  at a JS bundle hosting has replaced → `/` goes blank with a `MIME type
  "text/html"` module error. `firebase` skips unchanged functions, so this is cheap.
- Preferred command: `firebase deploy --only "hosting,functions" --project kolamkelisayang`
  (add `,firestore,storage` when rules changed). If the CLI fails, retry with
  `npx firebase deploy ...`. The repo-root **`build and deploy.bat`** does the full
  build + combined deploy in one step.
- `scripts/copy-seo-template.mjs` (run by `npm run build`) copies `dist/index.html`
  to `functions/src/template.html` and then **renames it to `dist/app.html`**, so the
  `/` rewrite reaches `seoRender` instead of being shadowed by a static index.html.
  The `**` catch-all rewrite in `firebase.json` targets `/app.html`. Don't hand-edit
  `template.html`; rebuild instead.
- Don't deploy tightened Firestore rules ahead of the client/API that depends on
  them — see `docs/security-release.md` for the staged-release reasoning.

## Architecture

### Frontend (`src/`)
- `main.tsx` → `App.tsx` → `AppContent.tsx` (large: page shell and most page-level
  UI). Routing uses react-router, but pages are modelled as "sections":
  `hooks/useNavigation.ts` maps paths (`/`, `/book`, `/live`, `/my-bookings`,
  `/profile`, `/confirmed`, `/cms`, `/bookings/:id`) to section names.
- State lives in contexts: `BookingContext` (app data loaded via
  `loadAppDB` / settings subscription), `LiveScoresContext`, `UIContext`.
- `src/lib/firestore.ts` is the large client-side Firestore data layer (reads, CMS
  writes allowed by rules). `src/lib/api.ts` / `bookingApi.ts` call the `api` HTTP
  function with a Firebase ID token; `src/lib/email.ts`, `users.ts` and
  `hooks/useAuth.ts` use `httpsCallable` functions. Some CMS actions in `api.ts`
  fall back to `*Direct` Firestore writes only when `VITE_FUNCTIONS_BASE_URL` is unset.
- Root-level `lib/firebase.ts` (outside `src/`) initialises the client Firebase SDK
  (App Check, emulator hookup when `VITE_USE_FIREBASE_EMULATOR=true` in dev) and is
  imported by `src/`. Other files in root `lib/` (emails, admin, auth-utils) are legacy.
- Scale weigh-in OCR: `src/lib/sevenSegmentOcr/` runs an ONNX model
  (`public/ocr-model/`) via onnxruntime-web WASM, single-threaded; Vite copies only
  the needed `ort-wasm-simd-threaded.*` blobs to `dist/ort/`. Tesseract is a fallback.
- `src/utils/roles.ts` mirrors the server role policy for UI gating.

### Cloud Functions (`functions/src/`, Node 22, plain ESM JavaScript — no build step)
- Entry point is `index.js` (per `functions/package.json` `main`). `index.jsx` and
  `*.bak` files are dead legacy code (`*.bak` is excluded from deploy) — don't edit them.
- `api` — one Express app exported as a public-invoker HTTPS function. Every write
  route verifies the ID token and a role/ownership check in-handler (`auth-utils.js`
  middlewares: `verifyToken`, `requireStaff`, `requireBookingManager`, `requireAdmin`).
  Booking creation and receipt routes are registered from `booking-service.js`;
  `GET /bookingAvailability` is the only anonymous route (cached occupancy projection).
- Booking integrity: server computes prices/status; `booking-policy.js` validates
  windows/pond/peg limits; `booking-seats.js` handles seat state. Transactions
  claim pegs via deterministic docs in `bookingSeatClaims`; the
  `releaseBookingSeatClaims` trigger frees claims on cancel/reject.
- Roles (`role-policy.js`): `CLIENT`, `STAFF`, `COUNTER_STAFF`, `ADMIN`, `SUPER_ADMIN`,
  stored on `users/{uid}.role` and synced to Auth custom claims by
  `syncUserRoleClaims`. Booking managers = COUNTER_STAFF + admins; only SUPER_ADMIN
  can change ADMINs; SUPER_ADMIN can't be changed; no self-changes.
- Email: functions write docs to the Firestore `mail` collection, delivered by the
  `firestore-send-email` extension (Zoho SMTP; secrets in Secret Manager).
  Templates in `email-templates.js`, queueing/logging/retry in `email-service.js`
  plus scheduled reminders/retries in `index.js`.
- `seo.js` — `seoRender`: injects per-route meta (from Firestore settings) into
  `template.html`, also serves `/sitemap.xml`.

### Rules
`firestore.rules` and `storage.rules` enforce booking privacy (owner/staff reads,
no client writes to financial fields) and scoped immutable receipt uploads at
`fishing-pond-receipts/{uploaderUid}/{fileName}`. Changes to rules or booking flows
should be covered in `tests/security/booking.test.mjs`.
