# Firebase Full-Stack Implementation Guide

This is a **React/Vite + Firebase** web application for managing catfish pond fishing competitions with a public booking website and staff CMS.

## Tech Stack

- **Frontend**: React 18 + Vite, Tailwind CSS
- **Backend**: Cloud Functions (Node.js) + Express
- **Database**: Cloud Firestore (NoSQL)
- **Auth**: Firebase Authentication (Email/Password, Google OAuth)
- **Storage**: Cloudinary (25GB free tier for receipt uploads)
- **Emails**: Resend (transactional)
- **Deployment**: Firebase App Hosting or Firebase Hosting

## Installation

### 1. Prerequisites

- Node.js 18+
- Firebase CLI: `npm install -g firebase-tools`
- Vite + React dev environment

### 2. Clone & Install

```bash
cd FishingPond
npm install
cd functions && npm install && cd ..
```

### 3. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. **Enable Services**:
   - Firestore Database (Start in test mode initially)
   - Firebase Authentication (Email/Password + Google)
   - Cloud Functions
   - App Hosting (or Hosting)

   **Note**: Firebase Storage is NOT used. Instead, we use **Cloudinary** for receipt uploads (25GB free).

4. **Download Service Account Key**:
   - Project Settings → Service Accounts → Generate new private key
   - Add credentials to `.env`

### 4. Environment Variables

Copy `.env.example` to `.env.local` and fill in your Firebase credentials:

```bash
cp .env.example .env.local
```

### 5. Run Locally

**Terminal 1 - Frontend (Vite) on port 5173:**
```bash
npm run dev
```

**Terminal 2 - Firebase Emulators (optional):**
```bash
firebase emulators:start
```

If you are not using local emulators, set `VITE_USE_FIREBASE_EMULATOR=false` and leave `VITE_FUNCTIONS_BASE_URL` blank or point it to your deployed Cloud Functions endpoint.

Visit `http://localhost:5173`

## Firestore Data Structure

### Collections

- **users**: `{ uid, email, name, phone, role, createdAt }`
- **competitions**: `{ id, name, eventDate, status, prizes, ... }`
- **ponds**: `{ id, name, totalSeats, ... }`
- **seats**: `{ pondId, seatNumber, ... }`
- **bookings**: `{ userId, competitionId, pondId, seatIds, status, ... }`
- **payments** (subcollection under bookings): `{ amount, method, createdAt }`
- **seatLocks**: `{ seatId, userId, competitionId, expiresAt }` (auto-deleted via TTL policy)
- **eventResults**: `{ bookingId, competitionId, totalWeight, fishCount, rank }`

### TTL Policy (Auto-delete expired locks)

In Firestore Console:
1. Go to `seatLocks` collection
2. Hover over `expiresAt` field → Click menu → Enable TTL policy

## Cloud Functions Endpoints

All routes require Firebase ID token authentication (Bearer token).

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/createClientAccount` | POST | STAFF | Create new client account from staff CMS |
| `/acquireSeatLock` | POST | USER | Reserve seat for 15 minutes |
| `/createBooking` | POST | USER | Create booking after lock acquired |
| `/approveBooking` | POST | STAFF | Approve pending booking |
| `/rejectBooking` | POST | STAFF | Reject and release seats |
| `/checkInBooking` | POST | STAFF | Check in booking on event day |
| `/updateResult` | POST | STAFF | Update fishing result & rank |

## Client API Usage

```typescript
import { createBooking, approveBooking, updateResult } from '@/lib/api';

// Example: Create booking
await createBooking({
  competitionId: 'comp-123',
  pondId: 1,
  seatIds: ['seat-1', 'seat-2'],
  seatNumbers: [1, 2],
  paymentType: 'full',
  amount: 300,
  totalAmount: 300,
  receiptUrl: 'https://storage.googleapis.com/...',
  notes: 'Special seating request'
});

// Example: Approve booking
await approveBooking({ bookingId: 'booking-456' });

// Example: Update result
await updateResult({
  bookingId: 'booking-456',
  totalWeight: 45.5,
  fishCount: 8
});
```

## Authentication Flow

### Client-Side (useAuth hook)

```typescript
import { useAuth } from '@/hooks/useAuth';

const { login, register, logout } = useAuth();

// App automatically syncs auth state via onAuthStateChanged
// User profile loaded from Firestore users collection
```

### Server-Side (Cloud Functions)

```typescript
import { verifyToken, requireStaff, requireAdmin } from './auth-utils';

app.post('/approveBooking', verifyToken, requireStaff, (req, res) => {
  // Staff-only approval logic
});
```

## React Components Integration

### **BookingContext**

Manages bookings, seat selection, and file uploads. Automatically loads data from Firestore at startup.

```typescript
const { db, user, setPond, submitBooking, ... } = useBooking();
```

### **LiveScoresContext**

Provides real-time leaderboard state subscribed to eventResults.

```typescript
const { scores, comp, getLeaderboard } = useLiveScores();
```

### **useAuth Hook**

Wraps Firebase Auth with Firestore user profiles.

```typescript
const { login, register, logout } = useAuth();
await login('user@example.com', 'password');
```

## Email Templates

React Email components in `lib/emails/`:
- **welcome.tsx**: New staff account
- **booking-received.tsx**: Booking submitted
- **booking-approved.tsx**: Booking approved
- **booking-rejected.tsx**: Booking rejected

Sent via **Resend API** from Cloud Functions.

## Staff CMS

Access via **Navbar → CMS** (restricted to email containing 'admin' or 'staff').

**Capabilities**:
- Manage ponds & seats
- Edit competitions & prizes
- Update site settings
- Review & approve/reject bookings
- View receipts

## Event Day Flow

1. **Check-in**: Staff searches by booking reference, records payment
2. **Results Entry**: Staff updates weight & fish count
3. **Live Leaderboard**: Rankings auto-update, visible to clients
4. **Prizes**: Top anglers shown with rewards

## Deployment

### Firebase Hosting (Frontend only)

```bash
firebase deploy --only hosting
```

### Cloud Functions (Backend)

```bash
firebase deploy --only functions
```

### App Hosting (Full-stack)

Upload both frontend & functions; Firebase handles deployment.

## Firestore Security Rules (Recommended)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own profile
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }

    // Anyone can read competitions
    match /competitions/{document=**} {
      allow read;
      allow write: if request.auth.token.role == 'ADMIN';
    }

    // Bookings: read own, staff can write
    match /bookings/{document=**} {
      allow read: if request.auth.uid == resource.data.userId.id ||
                     request.auth.token.role in ['STAFF', 'ADMIN'];
      allow write: if request.auth.token.role in ['STAFF', 'ADMIN'];
    }

    // SeatLocks: auto-managed by functions
    match /seatLocks/{document=**} {
      allow read, write: if request.auth != null;
    }

    // EventResults: staff-managed
    match /eventResults/{document=**} {
      allow read;
      allow write: if request.auth.token.role in ['STAFF', 'ADMIN'];
    }
  }
}
```

## Troubleshooting

**"Token verification failed"**
- Ensure Firebase ID token passed in `Authorization: Bearer <token>`
- Client use `getIdToken()` from Firebase Auth

**"RESEND_API_KEY is not configured"**
- Add `RESEND_API_KEY` to Cloud Functions environment variables
- `firebase functions:config:set resend.api_key="re_..."`

**"Emulator connection refused"**
- Ensure `firebase emulators:start` is running if `VITE_USE_FIREBASE_EMULATOR=true`
- Otherwise set `VITE_USE_FIREBASE_EMULATOR=false`
- Check `VITE_FUNCTIONS_BASE_URL` is correct for your local emulator or deployed functions endpoint

## Next Steps

1. ✅ Set up Firebase project & enable services
2. ✅ Configure `.env.local` with credentials
3. ✅ Run `npm run dev` & `firebase emulators:start`
4. ✅ Test auth & booking flows
5. ✅ Deploy to Firebase App Hosting or Hosting

---

**Questions?** Check Firestore docs, Firebase Console error logs, or Cloud Functions stdout for debugging.
