import React from 'react';
import { BookingProvider } from './context/BookingContext';
import { LiveScoresProvider } from './context/LiveScoresContext';
import { UIProvider } from './context/UIContext';
import AppContent from './AppContent';

const App: React.FC = () => {
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

