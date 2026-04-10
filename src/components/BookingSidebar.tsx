import React from 'react';
import { Pond } from '../types';

interface BookingSidebarProps {
  ponds: Pond[];
  selectedPond: number | null;
  onSelectPond: (id: number) => void;
}

const BookingSidebar: React.FC<BookingSidebarProps> = ({ ponds, selectedPond, onSelectPond }) => {
  return (
    <div className="pond-tabs">
      {ponds.filter(p => p.open).map(p => {
        const av = p.seats.filter(s => s.status === 'available').length;
        return (
          <div
            key={p.id}
            className={`pond-tab ${selectedPond === p.id ? 'active' : ''}`}
            onClick={() => onSelectPond(p.id)}
          >
            {p.name} ({av})
          </div>
        );
      })}
    </div>
  );
};

export default BookingSidebar;