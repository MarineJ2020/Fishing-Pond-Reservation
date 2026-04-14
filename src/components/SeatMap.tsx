import React, { useMemo } from 'react';
import { Pond, Seat } from '../types';

interface SeatMapProps {
  pond: Pond | null;
  selectedSeats: number[];
  onToggleSeat: (num: number) => void;
}

const SeatMap: React.FC<SeatMapProps> = ({ pond, selectedSeats, onToggleSeat }) => {
  const splitSeats = useMemo(() => {
    if (!pond) return { left: [] as Seat[], right: [] as Seat[] };
    const ordered = [...pond.seats].sort((a, b) => a.num - b.num);
    const leftCount = Math.ceil(ordered.length / 2);
    return {
      left: ordered.slice(0, leftCount),
      right: ordered.slice(leftCount),
    };
  }, [pond]);

  if (!pond) {
    return (
      <div className="card seat-map-card">
        <div className="seat-map-header">
          <div>
            <div className="seat-map-title">Select a Pond</div>
            <div className="seat-map-subtitle"></div>
          </div>
          <div className="seat-legend">
            <div className="legend-item">
              <div className="legend-dot avail"></div> Available
            </div>
            <div className="legend-item">
              <div className="legend-dot selected"></div> Selected
            </div>
            <div className="legend-item">
              <div className="legend-dot booked"></div> Taken
            </div>
          </div>
        </div>
        <div id="seat-map-wrap" className="seat-map-wrap">
          <div className="empty-state">
            <span className="empty-icon">🌊</span>
            <div className="empty-text">Select a pond to see peg layout</div>
          </div>
        </div>
      </div>
    );
  }

  const av = pond.seats.filter(s => s.status === 'available').length;

  const handleSeatClick = (num: number, status: string) => {
    if (status !== 'booked') {
      onToggleSeat(num);
    }
  };

  return (
    <div className="card seat-map-card">
      <div className="seat-map-header">
        <div>
          <div className="seat-map-title">{pond.name}</div>
          <div className="seat-map-subtitle">{pond.date} — {av} pegs available</div>
        </div>
        <div className="seat-legend">
          <div className="legend-item">
            <div className="legend-dot avail"></div> Available
          </div>
          <div className="legend-item">
            <div className="legend-dot selected"></div> Selected
          </div>
          <div className="legend-item">
            <div className="legend-dot booked"></div> Taken
          </div>
        </div>
      </div>
      <div id="seat-map-wrap" className="seat-map-wrap">
        <div className="seat-zone-wrap left">
          <div className="seat-zone-label">Kiri</div>
          <div className="seat-col">
            {splitSeats.left.map(s => {
                const isSelected = selectedSeats.includes(s.num);
                const isBooked = s.status === 'booked';
                const cls = isBooked ? 'booked' : isSelected ? 'selected' : 'avail';
                
                return (
                  <button
                    key={s.num}
                    className={`seat-btn ${cls}`}
                    onClick={() => handleSeatClick(s.num, s.status)}
                    disabled={isBooked}
                    title={`Peg #${s.num} - ${s.status}`}
                    type="button"
                  >
                    {s.num}
                  </button>
                );
              })}
          </div>
        </div>
        <div className="pond-visual">
          <div className="pond-ripple"></div>
          <div className="pond-ripple"></div>
          <div className="pond-ripple"></div>
          <div className="fish fish-1">🐟</div>
          <div className="fish fish-2">🐠</div>
          <div className="fish fish-3">🐟</div>
          <div className="pond-visual-emoji">🎣</div>
          <div className="pond-visual-text">KOLAM</div>
        </div>
        <div className="seat-zone-wrap right">
          <div className="seat-zone-label">Kanan</div>
          <div className="seat-col">
            {splitSeats.right.map(s => {
                const isSelected = selectedSeats.includes(s.num);
                const isBooked = s.status === 'booked';
                const cls = isBooked ? 'booked' : isSelected ? 'selected' : 'avail';
                
                return (
                  <button
                    key={s.num}
                    className={`seat-btn ${cls}`}
                    onClick={() => handleSeatClick(s.num, s.status)}
                    disabled={isBooked}
                    title={`Peg #${s.num} - ${s.status}`}
                    type="button"
                  >
                    {s.num}
                  </button>
                );
              })}
          </div>
        </div>
      </div>
      {selectedSeats.length > 0 && (
        <div className="price-bar">
          <div>
            <div className="price-bar-label">Total Amount</div>
            <div className="price-bar-detail">{selectedSeats.length} peg{selectedSeats.length !== 1 ? 's' : ''} selected</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="price-bar-total">RM {selectedSeats.reduce((a, n) => {
              const s = pond.seats.find(x => x.num === n);
              return a + (s ? s.price : 0);
            }, 0)}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SeatMap;