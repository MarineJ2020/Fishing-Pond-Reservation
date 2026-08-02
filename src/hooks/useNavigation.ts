import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const PATH_TO_SECTION: Record<string, string> = {
  '/': 'home',
  '/book': 'book',
  '/live': 'live',
  '/my-bookings': 'mybookings',
  '/profile': 'profile',
  '/confirmed': 'confirmed',
  '/cms': 'cms',
};

const SECTION_TO_PATH: Record<string, string> = {
  home: '/',
  book: '/book',
  live: '/live',
  mybookings: '/my-bookings',
  profile: '/profile',
  confirmed: '/confirmed',
  cms: '/cms',
};

const BOOKING_PATH_RE = /^\/bookings\/([^/?#]+)/;

export const useNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const navigateFromTop = useCallback((path: string) => {
    navigate(path);
    // React Router preserves the previous document scroll position. Booking
    // entry links must always land at the beginning of the new page on both
    // desktop and mobile.
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }, [navigate]);

  const bookingMatch = BOOKING_PATH_RE.exec(location.pathname);
  const bookingDetailId = bookingMatch ? decodeURIComponent(bookingMatch[1]) : null;

  const currentSection = bookingDetailId
    ? 'bookingDetail'
    : PATH_TO_SECTION[location.pathname] ?? 'home';

  const goToSection = useCallback((section: string) => {
    const path = SECTION_TO_PATH[section] ?? `/${section}`;
    navigateFromTop(path);
  }, [navigateFromTop]);

  const goHome = useCallback(() => navigateFromTop('/'), [navigateFromTop]);
  const goToBook = useCallback(() => navigateFromTop('/book'), [navigateFromTop]);
  const goToLive = useCallback(() => navigateFromTop('/live'), [navigateFromTop]);
  const goToMyBookings = useCallback(() => navigateFromTop('/my-bookings'), [navigateFromTop]);
  const goToProfile = useCallback(() => navigateFromTop('/profile'), [navigateFromTop]);
  const goToConfirmed = useCallback(() => navigateFromTop('/confirmed'), [navigateFromTop]);
  const goToCMS = useCallback(() => navigateFromTop('/cms'), [navigateFromTop]);
  const goToBookingDetail = useCallback(
    (id: string) => navigateFromTop(`/bookings/${encodeURIComponent(id)}`),
    [navigateFromTop],
  );

  return {
    currentSection,
    bookingDetailId,
    goToSection,
    goHome,
    goToBook,
    goToLive,
    goToMyBookings,
    goToProfile,
    goToConfirmed,
    goToBookingDetail,
    goToCMS,
  };
};
