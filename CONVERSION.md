# CastBook — Fishing Competition Booking App

A modern React + TypeScript + Vite application for managing fishing competition bookings, live results, and staff administration.

## Project Overview

This is a complete refactor of the original single-file HTML/CSS/JS application into a modular, type-safe React architecture.

## Technology Stack

- **React 19.2.4**: Modern UI framework with hooks
- **TypeScript 5.x**: Type-safe development
- **Vite 8.0.1**: Lightning-fast build tool and dev server
- **TailwindCSS (+ PostCSS)**: Utility-first CSS (configured but custom styles used)
- **ESLint**: Code quality and consistency
- **Font Awesome 6.5.1**: Icon library
- **Google Fonts**: Bebas Neue, DM Sans, DM Mono

## Project Structure

```
FishingPond/
├── src/
│   ├── components/          # Reusable React components
│   │   ├── Navbar.tsx       # Navigation and user menu
│   │   ├── Hero.tsx         # Landing section with stats
│   │   ├── PondsGrid.tsx    # Pond listing and selection
│   │   ├── BookingSidebar.tsx # Pond selection in booking
│   │   ├── SeatMap.tsx      # Interactive peg/seat selection
│   │   ├── BookingForm.tsx  # Payment and booking submission
│   │   ├── LiveResults.tsx  # Leaderboard and countdown
│   │   └── AuthModal.tsx    # Login/register modal
│   ├── App.tsx              # Main app component with state
│   ├── main.tsx             # React entry point
│   ├── types.ts             # TypeScript interfaces
│   ├── utils.ts             # Helper functions
│   ├── data.ts              # Data initialization and storage
│   ├── styles.css           # Global styles and design tokens
│   └── index.css            # Base styles
├── index.html               # HTML template
├── vite.config.js           # Vite configuration
├── tsconfig.json            # TypeScript configuration
├── package.json             # Dependencies and scripts
└── README.md                # This file
```

## Key Components

### Navbar
- Navigation links with active state
- User authentication display
- Login/Register button
- Staff CMS access
- Live indicator button

### Hero
- Banner with competition info
- Call-to-action buttons
- Statistics display (ponds, pegs, bookings, scores)
- Animated water effects

### PondsGrid
- Responsive grid layout
- Pond cards with availability
- Availability percentage bar
- Tagging system (Full/Limited/Open)

### Booking Features
- **BookingSidebar**: Quick pond selection
- **SeatMap**: Interactive zone-based seat layout with visual pond representation
- **BookingForm**: Payment type selection, receipt upload, booking submission

### LiveResults
- Real-time countdown timer
- User's personal ranking
- Leaderboard with filters
- Configurable top-N display
- Pond-based filtering

### Authentication
- **AuthModal**: Login and registration
- Email-based authentication
- Session persistence with localStorage

## Data Management

### State Structure
```typescript
{
  user: User | null,
  pond: number | null,
  seats: number[],
  payType: 'full' | 'deposit',
  receiptData: string | null,
  receiptFile: File | null,
  cmsAuthed: boolean,
  cdInt: number | null,
  lpf: string  // live pond filter
}
```

### Storage
- **localStorage**: User sessions and persisted data
- **sessionStorage**: Current section/page
- Structure: Data serialized as JSON with `cb_` prefix

## Features Implemented

✅ Pond browsing and selection
✅ Interactive seat selection with zones
✅ Payment type selection (Full/50% Deposit)
✅ Receipt file upload (JPG, PNG, PDF)
✅ User authentication (Login/Register)
✅ Booking history with status tracking
✅ Live competition results leaderboard
✅ Real-time countdown timer
✅ User personal ranking display
✅ Responsive design (desktop & mobile)
✅ Toast notifications
✅ LocalStorage persistence
✅ TypeScript type safety

## Running the Application

### Development
```bash
npm run dev
```
Starts Vite dev server at `http://localhost:5173/` or next available port.

### Production Build
```bash
npm run build
```
Creates optimized production bundle in `dist/` folder.

### Preview Build
```bash
npm run preview
```
Locally preview the production build.

### Linting
```bash
npm run lint
```
Check code quality with ESLint.

## Demo Credentials

**Login (any credentials work in demo)**
- Email: any email
- Password: any password

**Staff CMS**
- Email: `admin@castbook.com`
- Password: `admin123`

## Key Design Patterns

### Component Props
- Components accept data and callbacks as props
- No global state management (using React hooks)
- Controlled components for forms

### State Management
- App-level state in `App.tsx`
- Local component state for UI interactions
- Custom update functions for predictable state changes

### Event Handling
- Consistent naming: `onSectionChange`, `onSelectPond`, etc.
- Callback-based architecture
- Error handling with toast notifications

## Styling

All styles are defined in `styles.css` using CSS custom properties (variables) for theming:
- `--bg`, `--surface`, `--surface2`: Color palette
- `--accent`, `--accent2`, `--accent3`: Brand colors
- `--radius`: Border radius
- `--fd`, `--fb`, `--fm`: Font families

Mobile-first responsive design with breakpoints at 900px and 640px.

## Browser Support

- Chrome/Chromium (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Notes

- The CMS panel is partially implemented (placeholder only)
- Score entry system needs completion for full staff features
- Email notifications are mocked (would require backend)
- Payment processing is simulated (receipt upload only)

## Future Enhancements

- [ ] Complete Staff CMS with score entry
- [ ] Backend API integration
- [ ] Real email notifications
- [ ] Payment gateway integration
- [ ] Real-time updates with WebSockets
- [ ] User dashboard with booking analytics
- [ ] Mobile app version
- [ ] Accessibility improvements (WCAG 2.1 AA)
