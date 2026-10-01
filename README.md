# CastBook — Fishing Competition Booking App

A React + TypeScript + Vite web app for managing catfish pond fishing competition bookings, live results, and staff administration.

- **Live site**: https://kolamkelisayang.web.app
- **Firebase project**: `kolamkelisayang`

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite |
| Styling | CSS3 + CSS Variables (Tailwind configured but unused) |
| Database | Cloud Firestore |
| Auth | Firebase Authentication (email/password) |
| File storage | Firebase Storage (receipts, PDFs, maps, scale photos, landing/SEO images) |
| Email | Trigger Email from Firestore extension via Zoho SMTP |
| Deployment | Firebase Hosting |
| Backend | Cloud Functions (Node.js + Express) — requires Blaze plan |

## Quick Start

```bash
npm install
cp .env.example .env.local   # fill in credentials (see below)
npm run dev                  # http://localhost:5173
```

Other scripts:

```bash
npm run build       # production bundle → dist/
npm run typecheck   # TypeScript check
npm run lint        # ESLint
```

## Environment Variables (`.env.local`)

### Firebase (client)
```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_USE_FIREBASE_EMULATOR=false
VITE_FUNCTIONS_BASE_URL=        # deployed Cloud Functions URL
```

### Email
Transactional email is queued in Firestore's `mail` collection and delivered by
the Firebase Trigger Email extension configured with Zoho SMTP credentials. SMTP
secrets live in Firebase/Google Secret Manager, not in `.env.local`.

## Firebase Setup

1. [Firebase Console](https://console.firebase.google.com/) → use project `kolamkelisayang`
2. Enable: **Firestore**, **Authentication** (Email/Password), **Cloud Functions**, **Hosting**
3. Project Settings → Service Accounts → generate private key → add to `.env.local`
4. Firestore → `seatLocks` collection → enable TTL policy on `expiresAt` field (auto-deletes expired locks)

## Firestore Data Structure

| Collection | Fields |
|---|---|
| `users` | `uid, email, name, phone, role, createdAt` |
| `competitions` | `id, name, eventDate, status, prizes` |
| `ponds` | `id, name, totalSeats` |
| `seats` | `pondId, seatNumber` |
| `bookings` | `userId, competitionId, pondId, seatIds, status` |
| `payments` | *(subcollection of bookings)* `amount, method, createdAt` |
| `seatLocks` | `seatId, userId, competitionId, expiresAt` (TTL auto-delete) |
| `eventResults` | `bookingId, competitionId, totalWeight, fishCount, rank` |

## Cloud Functions Endpoints

Write routes require a Firebase ID token (`Authorization: Bearer <token>`).
`GET /bookingAvailability` is public and returns only compact occupancy data.

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /bookingAvailability` | Public | Compact occupied-seat projection for the booking page |
| `POST /createClientAccount` | STAFF | Create client account + send welcome email |
| `POST /acquireSeatLock` | USER | Reserve seat for 15 minutes |
| `POST /createBooking` | USER | Submit booking + send confirmation email |
| `POST /approveBooking` | STAFF | Approve booking + notify client |
| `POST /rejectBooking` | STAFF | Reject booking + release seats |
| `POST /checkInBooking` | STAFF | Record event-day check-in & payment |
| `POST /updateResult` | STAFF | Submit weight/fish count; ranks auto-calculate |

## Deployment

Project: `kolamkelisayang`. Hosting serves `dist/`.

### One-click (Windows)
Double-click **`build and deploy.bat`** in the repo root. It builds the bundle and
deploys **hosting + functions** together (see the warning below for why both are
required), falling back to `npx firebase` if the global CLI fails.

### Manual
```bash
npm run build
firebase deploy --only "hosting,functions" --project kolamkelisayang
```

> ⚠️ **Always deploy `hosting` and `functions` together.** The `/`, `/book`,
> `/live` and `/confirmed` routes are rendered by the **`seoRender` Cloud
> Function**, which serves a bundled copy of the built `index.html`
> (`functions/src/template.html`, refreshed by `scripts/copy-seo-template.mjs`
> during `npm run build`). That template contains **hashed asset names** that
> change on every build. Deploying hosting alone leaves `seoRender` pointing at a
> JS bundle hosting has already replaced → `/` returns a blank page with a
> `MIME type "text/html"` module-script error. `firebase` skips unchanged
> functions automatically, so including `functions` in every deploy is cheap.
>
> After deploy, `/` is CDN-cached (`s-maxage=600`); the hosting release purges
> that edge cache, so a hard refresh shows the new build right away.

Include `firestore,storage` as well when rules changed:
`firebase deploy --only "hosting,functions,firestore,storage" --project kolamkelisayang`.

If a deploy fails to resolve `node`/`npm` (a known PATH quirk on the build
machine), prefix the clean Node path or retry via `npx firebase deploy ...`.

### Firebase Storage CORS (required for browser PDF upload)
```bash
gsutil cors set storage.cors.json gs://kolamkelisayang.firebasestorage.app
```

## Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    match /competitions/{document=**} {
      allow read;
      allow write: if request.auth.token.role == 'ADMIN';
    }
    match /bookings/{document=**} {
      allow read: if request.auth.uid == resource.data.userId.id ||
                     request.auth.token.role in ['STAFF', 'ADMIN'];
      allow write: if request.auth.token.role in ['STAFF', 'ADMIN'];
    }
    match /seatLocks/{document=**} {
      allow read, write: if request.auth != null;
    }
    match /eventResults/{document=**} {
      allow read;
      allow write: if request.auth.token.role in ['STAFF', 'ADMIN'];
    }
  }
}
```

## Key Features

- **Booking system** — pond/seat selection, receipt upload, status tracking (pending → approved/rejected → confirmed)
- **Staff CMS** — manage ponds, competitions, prizes; approve/reject bookings; view receipts
- **Live leaderboard** — real-time rankings updated as results are entered
- **Role-based access** — USER / STAFF / ADMIN via Firebase custom claims
- **Responsive** — mobile hamburger nav, optimised layouts

## Important Notes

- **Cloud Functions are required** for secure booking creation, receipt submission, email queueing and SEO rendering.
- **Always deploy hosting and functions together** so `seoRender` and hashed frontend assets stay in sync.
- **Deploy Firestore and Storage rules whenever rules changed**: `firebase deploy --only "hosting,functions,firestore,storage" --project kolamkelisayang`.
- **Uploads use Firebase Storage** for receipts, rules PDFs, maps, payment QR, scale photos, landing images and SEO images.

## Troubleshooting

| Error | Fix |
|---|---|
| "Token verification failed" | Pass `getIdToken()` result as `Authorization: Bearer <token>` |
| "Availability request timed out" | Check `GET /bookingAvailability` latency and deploy both `hosting,functions`; the client allows cold starts but the endpoint should stay fast. |
| "Emulator connection refused" | Run `firebase emulators:start` or set `VITE_USE_FIREBASE_EMULATOR=false` |
