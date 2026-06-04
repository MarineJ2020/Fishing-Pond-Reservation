# Account Migration Guide — Firebase, Cloudinary & Google Maps

This guide migrates the Kolam Keli Sayang (KKS) site from the current third-party
accounts to **new** Firebase, Cloudinary, and Google Maps accounts. Follow the
sections in order. Nothing here changes application code — only configuration,
data, and external account setup.

---

## 0. Inventory — what the project actually uses

| Service | Used for | Where configured |
|---|---|---|
| **Firebase Auth** | Email/password + Google sign-in | `firebase.json` → `auth.providers`; client `lib/firebase.ts` |
| **Firebase Firestore** | All app data (competitions, ponds, seats, bookings, settings, eventResults) + `mail` queue. Region `asia-southeast1` | `firebase.json` → `firestore`; rules `firestore.rules`; indexes `firestore.indexes.json` |
| **Firebase Cloud Functions** | `createBooking`, `approveBooking`, `rejectBooking`, `createClientAccount`, seat locks, check-in, results | `functions/` (codebase `default`) |
| **Firebase Hosting** | Serves the built SPA from `dist/` | `firebase.json` → `hosting` |
| **Firebase App Check** | reCAPTCHA v3 gate on Firestore (protects `mail` queue) | `lib/firebase.ts`; env `VITE_RECAPTCHA_SITE_KEY` |
| **Trigger Email extension** | Sends `mail` collection docs via Zoho SMTP | Not yet installed — install fresh (see §1.9) |
| **Cloudinary** | Receipt + image uploads (unsigned preset) | `src/utils/cloudinary.ts`; env `VITE_CLOUDINARY_*` |
| **Google Maps** | Lokasi section embed | `src/AppContent.tsx` — **keyless embed URLs** (`output=embed`). The `VITE_GOOGLE_MAPS_API_KEY` env var is currently **declared but unused by code** |

**Current project identifiers (not secret):**
- Firebase project ID: `fishingpond-e34e9`
- Firestore region: `asia-southeast1`
- Cloudinary cloud name: `j-portfolio`, upload preset: `portfolio_uploads`

---

## ⚠️ Pre-migration: security cleanup

`.env.local` currently holds **live secrets** — a Firebase Admin SDK private key,
the Firebase web API key, the Maps key, etc. `.env.local` is gitignored (good — not
in version control), but you should still treat the existing keys as compromised and
**not reuse them**. Migration to fresh accounts naturally rotates everything.

- Do **not** copy old secret values into the new project.
- After migration, **disable/delete** the old service-account key and old API keys
  in the old accounts so they cannot be abused.
- Never paste real secret values into committed files (including this one).

---

## 1. Firebase migration

> Requires the Firebase CLI: `npm i -g firebase-tools` then `firebase login`.
> The new project must be on the **Blaze (pay-as-you-go)** plan — Cloud Functions
> and the email extension require it. (Free Spark tier cannot deploy functions.)

### 1.1 Create the new Firebase project
1. https://console.firebase.google.com → **Add project**.
2. Note the new **Project ID** (e.g. `kks-prod`). You'll substitute it everywhere
   `fishingpond-e34e9` appears.
3. Upgrade the new project to **Blaze** (Settings → Usage and billing).

### 1.2 Register the Web App & capture config
1. Project Overview → **Add app → Web**. Give it a nickname (e.g. "KKS Web").
2. Copy the generated `firebaseConfig` values. These map to the client env vars:

   | Firebase config field | Env var (`.env.local`) |
   |---|---|
   | `apiKey` | `VITE_FIREBASE_API_KEY` |
   | `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
   | `projectId` | `VITE_FIREBASE_PROJECT_ID` |
   | `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET` |
   | `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
   | `appId` | `VITE_FIREBASE_APP_ID` |

### 1.3 Enable Authentication providers
Console → **Authentication → Sign-in method**:
1. Enable **Email/Password**.
2. Enable **Google**. Set the **public-facing name** (`KKS`) and a **support email**
   (matches `firebase.json` → `googleSignIn.supportEmail`; update that file if the
   support email changes).
3. Console → Authentication → **Settings → Authorized domains**: add your production
   domain and any preview domains. (The new `*.firebaseapp.com` / `*.web.app` are
   added automatically.)

### 1.4 Create the Firestore database
Console → **Firestore Database → Create database**:
- **Production mode**.
- **Location: `asia-southeast1`** (must match `firebase.json`; the location is
  permanent once chosen).

### 1.5 Point the repo at the new project
Edit `.firebaserc`:
```json
{ "projects": { "default": "<new-project-id>" } }
```
(Or run `firebase use --add` and select the new project.)

### 1.6 Deploy rules & indexes
```bash
firebase deploy --only firestore:rules,firestore:indexes
```
This pushes `firestore.rules` (incl. the hardened `mail` collection rules) and the
3 composite indexes in `firestore.indexes.json`.

### 1.7 Migrate Firestore data
The new database is empty. Choose one:

**Option A — Full data copy (recommended, preserves bookings/history).**
Requires `gcloud` CLI authenticated on both projects and a GCS bucket.
```bash
# Export from OLD project to a bucket
gcloud config set project fishingpond-e34e9
gcloud firestore export gs://<old-bucket>/kks-export

# Make the dump readable by the new project's service account, then import
gcloud config set project <new-project-id>
gcloud firestore import gs://<old-bucket>/kks-export
```
Collections to confirm after import: `competitions`, `ponds`, `seats`, `bookings`,
`settings`, `eventResults`, `users`. (Do **not** import `mail` / `seatLocks` —
those are transient.)

**Option B — Re-seed manually.** If you'd rather start clean: sign in as an admin on
the new deployment and recreate competitions/ponds/seats/settings through the CMS.
Past bookings are lost. Only sensible for a fresh launch.

### 1.8 Migrate Auth users (only if doing Option A / keeping accounts)
```bash
firebase use fishingpond-e34e9
firebase auth:export users.json --format=json
firebase use <new-project-id>
firebase auth:import users.json --hash-algo=SCRYPT \
  --hash-key=<OLD_PROJECT_SCRYPT_KEY> ...
```
Get the SCRYPT params from the **old** project: Console → Authentication →
(⋮ menu) → **Password hash parameters**. Without these, imported users can't log in
with existing passwords (they'd need a reset). Google-sign-in users carry over by
email automatically and don't need hash params.

> **Custom claims (roles):** `STAFF`/`ADMIN` roles are stored both as custom claims
> and in the `users` Firestore doc (`isAdmin()` in `firestore.rules` checks both).
> `auth:import` does **not** carry custom claims. After import, re-apply staff/admin
> claims with the Admin SDK (or rely on the `users.role` doc field, which Option A
> import preserves). Verify at least one ADMIN can reach the CMS.

### 1.8.1 Important: deleting a user in Firestore vs Authentication
- Deleting `users/{uid}` in Firestore **does not** disable login. Sign-in is controlled by
   Firebase Authentication.
- To actually block a person from signing in, disable/delete the account in
   **Authentication → Users** (and optionally revoke refresh tokens for immediate logout).
- Deleting an Authentication user **does not cascade-delete** their Firestore bookings by
   default. Existing `bookings` docs remain unless you explicitly remove/anonymize them.
- Recommended offboarding sequence:
   1. Disable/delete user in Firebase Authentication.
   2. Decide retention policy for booking history (keep, anonymize, or delete).
   3. Clean up `users/{uid}` profile doc and any role claims after step 1.

### 1.9 Install the "Trigger Email from Firestore" extension (Zoho SMTP)
```bash
firebase ext:install firebase/firestore-send-email --project=<new-project-id>
```
Configure (per the email plan):
- **SMTP URI:** `smtps://noreply%40kolamkelisayang.com.my:APP_PASSWORD@smtp.zoho.com:465`
  (generate a fresh Zoho **App Password**; `@` → `%40`)
- **Default FROM:** `Kolam Keli Sayang <noreply@kolamkelisayang.com.my>`
- **Reply-To:** `hello@kolamkelisayang.com.my`
- **Mail collection:** `mail`
- **TTL:** 3 days
Credentials are stored in the new project's **Cloud Secret Manager** — never in the repo.

### 1.10 Set up App Check (reCAPTCHA v3)
1. Console → **App Check → Apps** → register the Web app → **reCAPTCHA v3**.
2. Create the reCAPTCHA v3 site key at https://www.google.com/recaptcha/admin (add
   your production domain). Paste the **site key** into `.env.local` as
   `VITE_RECAPTCHA_SITE_KEY` and the **secret** into the App Check config.
3. After verifying real traffic works, set Firestore to **Enforce** under
   App Check → APIs.
> Local dev with the emulator skips App Check automatically (`lib/firebase.ts` guard).

### 1.11 Configure Cloud Functions env & deploy
If any functions still read `APP_URL` (email links) set it for the new domain:
```bash
firebase functions:config:set app.url="https://<your-domain>"   # or use .env in functions/
```
Then deploy:
```bash
npm install                 # root, builds client deps
firebase deploy --only functions
```
> The client currently uses `VITE_FUNCTIONS_BASE_URL=""` (empty), meaning it writes
> bookings **directly to Firestore** and does not call the functions. Leave it empty
> unless you switch to the Cloud Function booking path — in which case set it to the
> new functions base URL (`https://<region>-<new-project-id>.cloudfunctions.net`).

### 1.12 Build & deploy hosting
```bash
npm run build
firebase deploy --only hosting
```

---

## 2. Cloudinary migration

Receipts/images upload via an **unsigned** preset from the browser
(`src/utils/cloudinary.ts`). No secret/API-secret is used client-side — only the
cloud name and preset name, both public.

### 2.1 Create the new Cloudinary account / cloud
1. https://cloudinary.com → sign up / create a new product environment.
2. Note the new **Cloud name** (Dashboard → Product Environment).

### 2.2 Create an unsigned upload preset
1. Settings → **Upload → Upload presets → Add upload preset**.
2. **Signing Mode: Unsigned**.
3. (Optional) lock it down: restrict allowed formats to images, set a max file size,
   and set a folder. The code passes its own `folder` arg
   (`fishing-pond-receipts`, etc.), which works with unsigned presets.
4. Save and note the **preset name**.

### 2.3 Update env vars
| Env var | New value |
|---|---|
| `VITE_CLOUDINARY_CLOUD_NAME` | new cloud name |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | new preset name |

### 2.4 Existing receipt images (important)
Receipt URLs already saved in Firestore (`bookings.receiptUrl`) are **absolute URLs**
pointing at the **old** Cloudinary cloud (`j-portfolio`). They will keep resolving
**only while the old account stays alive**.
- **Simplest:** keep the old Cloudinary account active (free tier) so historical
  receipt links don't break. New uploads go to the new cloud.
- **Clean break:** migrate old assets — download from the old cloud and re-upload to
  the new one, then rewrite the `receiptUrl` fields in Firestore. Only worth it if you
  must fully decommission the old account. For a low-volume booking site, keeping the
  old account is usually fine.

---

## 3. Google Maps migration

The Lokasi map uses **keyless** Google Maps embed URLs
(`https://www.google.com/maps?q=...&output=embed`, built in `src/AppContent.tsx`).
**No API key is required for the current functionality.** The
`VITE_GOOGLE_MAPS_API_KEY` in `.env.local` is not referenced by any source file.

You therefore have two paths:

**Path A — Do nothing (recommended).** The map keeps working with no key. You can
delete the unused `VITE_GOOGLE_MAPS_API_KEY` line from `.env.local`/`.env.example`,
and disable/delete the old key in the old Google Cloud project for hygiene.

**Path B — Provision a new key (only if you later add the Maps JS/Embed API).**
1. https://console.cloud.google.com → create/select a GCP project (can be the same
   GCP project that backs the new Firebase project).
2. APIs & Services → **Enable** "Maps Embed API" (and/or "Maps JavaScript API").
3. Credentials → **Create credentials → API key**.
4. **Restrict the key** (critical, since it's exposed in the client bundle):
   - Application restriction: **HTTP referrers** → your production + preview domains.
   - API restriction: only the Maps APIs you enabled.
5. Put it in `.env.local` as `VITE_GOOGLE_MAPS_API_KEY` and wire it into the embed
   code (not currently wired). Then delete the old key.

---

## 4. Environment variable reference (old → new)

Update **`.env.local`** (and keep `.env.example` documented). Everything below gets
**new** values from the steps above.

```bash
# --- Firebase (client) — from §1.2 ---
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=<new-project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<new-project-id>
VITE_FIREBASE_STORAGE_BUCKET=<new-project-id>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# --- Firebase App Check — from §1.10 ---
VITE_RECAPTCHA_SITE_KEY=

# --- Firebase Admin SDK (functions / server) — from a NEW service account ---
# Console → Project Settings → Service accounts → Generate new private key
FIREBASE_PROJECT_ID=<new-project-id>
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# --- Functions base URL (leave empty unless using the Cloud Function booking path) ---
VITE_FUNCTIONS_BASE_URL=

# --- Cloudinary — from §2 ---
VITE_CLOUDINARY_CLOUD_NAME=
VITE_CLOUDINARY_UPLOAD_PRESET=

# --- Google Maps — only if Path B in §3 ---
VITE_GOOGLE_MAPS_API_KEY=

# --- Misc ---
VITE_USE_FIREBASE_EMULATOR=false
APP_URL=https://<your-domain>
```

> For the Admin SDK private key: generate a **new** key in the new project
> (Project Settings → Service accounts → **Generate new private key**). Paste the JSON's
> `client_email` and `private_key` (newlines as `\n`). Do **not** reuse the old key.

**Where these are consumed (for sanity-checking):**
- `lib/firebase.ts` — all `VITE_FIREBASE_*`, `VITE_RECAPTCHA_SITE_KEY`, `VITE_USE_FIREBASE_EMULATOR`
- `lib/firebase-admin.ts` — `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`
- `src/lib/api.ts` — `VITE_FUNCTIONS_BASE_URL`
- `src/utils/cloudinary.ts` — `VITE_CLOUDINARY_*`

---

## 5. Verification checklist

Run locally first (`npm run dev`) with the new `.env.local`, then on the deployed site.

- [ ] **App boots** with no console errors; `npm run build` succeeds.
- [ ] **Auth:** sign up with email/password; sign in with Google. New user appears in
      new project's Authentication tab and a `users/{uid}` doc is created.
- [ ] **Admin access:** an ADMIN/STAFF account can open the CMS (confirms role claims
      and/or `users.role` survived migration).
- [ ] **Data present:** competitions/ponds/seats/settings render on the homepage and
      booking page (confirms Firestore import or re-seed).
- [ ] **Booking flow:** select seats → upload receipt → submit. Receipt uploads to the
      **new** Cloudinary cloud (check the new dashboard); booking doc created.
- [ ] **Email (received):** a `mail/` doc appears, and within ~2 min the customer +
      `hello@kolamkelisayang.com.my` receive the "Tempahan Diterima" email
      (From `noreply@...`, Reply-To `hello@...`).
- [ ] **Email (approved):** approve in CMS → customer gets "Tempahan Disahkan" with a
      scannable QR + link to the booking page; CC verified.
- [ ] **App Check:** Firestore requests carry an `X-Firebase-AppCheck` header; after
      enabling Enforce, the app still works and a console `addDoc` to `mail` with a
      foreign `to` is rejected (`permission-denied`).
- [ ] **Map:** Lokasi section renders the embedded map.
- [ ] **Deliverability:** test booking to a Gmail address → "Show original" shows
      SPF=PASS, DKIM=PASS, DMARC=PASS for `kolamkelisayang.com.my`.

---

## 6. Cut-over & decommission

1. Point your domain's DNS / hosting to the new Firebase Hosting site.
2. Monitor for 24–48h (Firebase Console → Functions logs, Firestore usage, Zoho Mail
   reports, Cloudinary usage).
3. Once stable:
   - **Old Firebase:** revoke the old Admin SDK service-account key; optionally keep
     the project read-only for a grace period before deleting.
   - **Old Cloudinary:** keep alive if historical receipt URLs still point to it
     (§2.4); otherwise migrate assets then close.
   - **Old Google Maps key:** delete it from the old GCP project.
   - **Rotate** anything that was ever exposed in the old `.env.local`.

## 7. Rollback

Because no application code changed, rollback is just reverting config:
1. Restore the old values in `.env.local` and `.firebaserc`.
2. `npm run build && firebase deploy` against the old project (`firebase use fishingpond-e34e9`).
3. Repoint DNS to the old hosting.
Keep the old accounts active until the new setup has run clean for at least a few days.
