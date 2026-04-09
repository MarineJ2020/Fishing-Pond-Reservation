# Deployment & Migration Guide

## Current Deployment Status
- **Project**: `fishingpond-e34e9` (Firebase)
- **Hosting URL**: https://fishingpond-e34e9.web.app
- **Status**: Active and live

## Quick Deploy (with latest fixes)
```bash
firebase deploy --only "hosting,firestore"
```

**Expected Output:**
```
   ✓ Deploy complete!
   Hosting URL: https://fishingpond-e34e9.web.app
   Firestore: Rules compiled successfully
```

## What Gets Deployed
- ✅ Hosting (React app from `/dist`)
- ✅ Firestore (database + rules)
- ❌ Cloud Functions (requires Blaze plan)

## Environment Variables Setup

### For New Firebase Project Migration
1. Get Firebase config from: https://console.firebase.google.com/project/YOUR_PROJECT/settings/general
2. Update `.env.local`:
```env
VITE_FIREBASE_API_KEY=YOUR_API_KEY
VITE_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET=YOUR_PROJECT.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID
VITE_FIREBASE_APP_ID=YOUR_APP_ID
```

### For Cloudinary Migration
1. Create account at https://cloudinary.com (25GB free)
2. Get from Dashboard > Settings > Upload
3. Update `.env.local`:
```env
VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET=your_unsigned_preset_name
```

## For New Developer Handoff

### Build & Run Locally
```bash
npm install              # Install dependencies
npm run dev              # Start dev server (http://localhost:5174)
npm run build            # Production build
npm run typecheck        # Type checking
```

### Project Structure
```
src/
  ├── components/       # React components (Navbar, AuthModal, etc.)
  ├── context/          # State management (BookingContext, UIContext)
  ├── hooks/            # Custom hooks (useAuth, useNavigation)
  ├── lib/              # Firebase & Firestore utilities
  ├── App.jsx           # Main app component
  ├── AppContent.jsx    # Page routing & content
  └── styles.css        # Global styles

lib/
  ├── firebase.js       # Firebase initialization
  ├── firestore.ts      # Firestore read/write operations
  ├── api.js            # Cloud Functions & Firestore fallback
  └── auth-utils.ts     # (Not used - kept for reference)

functions/
  ├── src/index.js      # Cloud Functions (requires Blaze)
  └── lib/              # Email templates
```

### Key Technologies
- **Runtime**: React 18 + TypeScript (mixed .ts/.js)
- **Build**: Vite
- **Styling**: CSS3 + CSS Variables
- **Database**: Firestore (real-time)
- **Auth**: Firebase Authentication (email/password only)
- **File Storage**: Cloudinary (receipt images)
- **Deployment**: Firebase Hosting

### Key Features
1. **User Authentication**: Email/password signup & login
2. **Booking System**: Select ponds, seats, upload receipt, track status
3. **Admin/Staff Access**: CMS modal for pond/booking management (role-based)
4. **Live Leaderboard**: Real-time fishing competition scores
5. **Responsive Mobile**: Hamburger menu, optimized layouts
6. **Status Tracking**: Bookings show pending/approved/rejected/confirmed

### Important Notes
- **No Google OAuth**: Would require Blaze plan
- **No Cloud Functions**: Setup requires Blaze plan (email delivery uses Firestore fallback)
- **Email Delivery**: Currently via Resend API (set `RESEND_API_KEY` if implementing)
- **Firestore Rules**: Already configured, contains auth checks and data validation

### Security
- ✅ Auth-required views (MyBookings requires login)
- ✅ Firestore rules prevent unauthorized access
- ✅ Receipt images stored on Cloudinary (not Firebase)
- ✅ Email validation
- ✅ Admin access gated by Firestore `role` field

## Migration Checklist

For moving to different Firebase project:

- [ ] Create new Firebase project
- [ ] Enable Authentication (Email/Password)
- [ ] Create Firestore database (test mode or custom rules)
- [ ] Create Cloudinary account
- [ ] Update `.env.local` with new credentials
- [ ] Run `firebase init` in project root
- [ ] Configure `firebase.json` for hosting/firestore
- [ ] Run `npm run build`
- [ ] Deploy with `firebase deploy --only "hosting,firestore"`
- [ ] Test booking flow end-to-end
- [ ] Verify auth modal doesn't show on refresh
- [ ] Check mobile hamburger menu

## Troubleshooting

### Build Fails
```bash
rm -r node_modules dist
npm install
npm run build
```

### Auth State Not Persisting
- Check browser Storage (DevTools > Application > LocalStorage)
- Verify Firebase config in `.env.local`
- Check browser console for errors

### Bookings Not Showing
- Verify user email matches in multiple places
- Check Firestore for booking documents
- Clear localStorage: `localStorage.clear()`

### Cloud Functions Deployment Error
- **Blaze plan required** - see Firebase console for upgrade link
- Not needed for core functionality (Firestore fallback works)

---

**Last Updated**: April 9, 2026  
**Version**: 1.0.0 (Production Ready)
