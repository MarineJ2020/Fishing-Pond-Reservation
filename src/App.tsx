import React from 'react';
import { BookingProvider } from './context/BookingContext';
import { LiveScoresProvider } from './context/LiveScoresContext';
import { UIProvider } from './context/UIContext';
import AppContent from './AppContent';
import QrCardPage from './components/QrCardPage';

const App: React.FC = () => {
  // Email "Muat turun QR" landing page: standalone, so skip loading app data.
  if (window.location.pathname === '/qr-card') return <QrCardPage />;
  return (
    <BookingProvider>
      <LiveScoresProvider>
        <UIProvider>
          <AppContent />
        </UIProvider>
      </LiveScoresProvider>
    </BookingProvider>
  );
};

export default App;

