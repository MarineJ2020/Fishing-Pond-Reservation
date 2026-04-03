import React from 'react';
import { Pond } from '../types';

interface PondsGridProps {
  ponds: Pond[];
  onSelectPond: (id: number) => void;
}

const PondsGrid: React.FC<PondsGridProps> = ({ ponds, onSelectPond }) => {
  return (
    <div className="ponds-section">
      <div className="section-title">Available Ponds</div>
      <div className="section-sub">Select a pond to view peg availability and pricing</div>
      <div className="ponds-grid">
        {ponds.map(p => {
          const tot = p.seats.length;
          const av = p.seats.filter(s => s.status === 'available').length;
          const pct = Math.round((av / tot) * 100);
          const tc = av === 0 ? 'tag-full' : av < tot * 0.2 ? 'tag-limited' : 'tag-open';
          const tl = av === 0 ? '● Full' : av < tot * 0.2 ? '● Limited' : '● Open';
          return (
            <div key={p.id} className="card card-hover pond-card" onClick={() => onSelectPond(p.id)}>
              <div className={`pond-tag ${tc}`}>{tl}</div>
              <div className="pond-date">{p.date}</div>
              <div className="pond-name">{p.name}</div>
              <div className="pond-desc">{p.desc}</div>
              <div className="avail-bar">
                <div className="avail-fill" style={{ width: `${pct}%` }}></div>
              </div>
              <div className="pond-meta">
                <div className="pond-avail">
                  <span>{av}</span> / {tot} pegs left
                </div>
                <div>
                  <div className="pond-price">RM {p.seats[0]?.price ?? '—'}</div>
                  <div className="pond-price-label">per peg</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PondsGrid;