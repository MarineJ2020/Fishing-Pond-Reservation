import React from 'react';
import { Pond } from '../types';

interface BookingSidebarProps {
  ponds: Pond[];
  selectedPond: number | null;
  onSelectPond: (id: number) => void;
}

const BookingSidebar: React.FC<BookingSidebarProps> = ({ ponds, selectedPond, onSelectPond }) => {
  return (
    <div className="booking-sidebar">
      <div style={{ padding: '7px 3px 11px', fontSize: '10px', fontWeight: 600, color: 'var(--muted)', letterSpacing: '1px', textTransform: 'uppercase' }}>
        Ponds
      </div>
      {ponds.filter(p => p.open).map(p => {
        const av = p.seats.filter(s => s.status === 'available').length;
        return (
          <div
            key={p.id}
            className={`pond-item ${selectedPond === p.id ? 'active' : ''}`}
            onClick={() => onSelectPond(p.id)}
          >
            <div className="pond-item-name">{p.name}</div>
            <div className="pond-item-info">{av} pegs · RM {p.seats[0]?.price}</div>
          </div>
        );
      })}
    </div>
  );
};

export default BookingSidebar;