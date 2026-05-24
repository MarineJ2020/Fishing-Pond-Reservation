import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const PATH_TO_SECTION: Record<string, string> = {
  '/': 'home',
  '/book': 'book',
  '/live': 'live',
  '/my-bookings': 'mybookings',
  '/confirmed': 'confirmed',
};

const SECTION_TO_PATH: Record<string, string> = {
  home: '/',
  book: '/book',
  live: '/live',
  mybookings: '/my-bookings',
  confirmed: '/confirmed',
};

const BOOKING_PATH_RE = /^\/bookings\/([^/?#]+)/;

export const useNavigation = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const bookingMatch = BOOKING_PATH_RE.exec(location.pathname);
  const bookingDetailId = bookingMatch ? decodeURIComponent(bookingMatch[1]) : null;

  const currentSection = bookingDetailId
    ? 'bookingDetail'
    : PATH_TO_SECTION[location.pathname] ?? 'home';

  const goToSection = useCallback((section: string) => {
    const path = SECTION_TO_PATH[section] ?? `/${section}`;
    navigate(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [navigate]);

  const goHome = useCallback(() => navigate('/'), [navigate]);
  const goToBook = useCallback(() => navigate('/book'), [navigate]);
  const goToLive = useCallback(() => navigate('/live'), [navigate]);
  const goToMyBookings = useCallback(() => navigate('/my-bookings'), [navigate]);
  const goToConfirmed = useCallback(() => navigate('/confirmed'), [navigate]);
  const goToBookingDetail = useCallback(
    (id: string) => navigate(`/bookings/${encodeURIComponent(id)}`),
    [navigate],
  );

  return {
    currentSection,
    bookingDetailId,
    goToSection,
    goHome,
    goToBook,
    goToLive,
    goToMyBookings,
    goToConfirmed,
    goToBookingDetail,
  };
};