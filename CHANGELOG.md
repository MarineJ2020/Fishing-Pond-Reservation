# Changelog

## April 9, 2026

### Bug Fixes

**Booking visibility** — Submitted bookings weren't appearing in "My Bookings". Root cause: userId stored as `user.uid` but filtered by `user.email`. Fixed `BookingContext.jsx` to consistently use `user.email`.

**Auth loading race condition** — Login modal appeared on page refresh even when the user was logged in. Added `isAuthLoading` state to `useAuth()` so the navigation effect waits for Firebase auth state to resolve before showing the modal.

**Google OAuth removed** — Dropped to avoid requiring Blaze plan upgrade. Email/password login remains fully functional. Files changed: `useAuth.js`, `AuthModal.jsx`, `AppContent.jsx`.

### UI Polish

- **Mobile nav**: full-width buttons, consistent padding, smooth max-height transitions
- **Status badges**: thicker borders (1.5 px), brighter colours, improved padding
- **Form inputs**: focus shadow effects, smooth transitions, better padding
- **Buttons**: letter-spacing, box shadows, hover animations (`translateY` + shadow)
- **Auth modal**: backdrop blur, enhanced shadow, border with transparency, fade-in animation
- **Cards**: subtle shadows, refined borders, hover state transitions
- **Booking cards**: background + border colour change on hover

### Files Changed
```
src/context/BookingContext.jsx   — fixed userId consistency
src/hooks/useAuth.js             — added isAuthLoading state
src/AppContent.jsx               — auth effect loading guard
src/components/AuthModal.jsx     — removed Google OAuth button
src/styles.css                   — comprehensive UI polish
```
