import React, { useMemo, useState, useRef, useCallback, useId } from 'react';
import { Pond, Seat } from '../types';

const SVG_W = 600;
const SVG_H = 400;

interface SeatMapProps {
  pond: Pond | null;
  selectedSeats: number[];
  onToggleSeat: (num: number) => void;
  /** When true, always show the legacy capsule layout even if SVG polygon data exists */
  useLegacyView?: boolean;
}

// ── Shared SVG pond content (compact + expanded views) ──────────────────────

interface PondSVGContentProps {
  polygonPoints: string;
  positionedSeats: Seat[];
  selectedSeats: number[];
  onSeatClick: (num: number, status: string) => void;
  /** Pass current zoom level in expanded view to counter-scale seats (keeps them pixel-constant). Default 1. */
  seatScale?: number;
}

function PondSVGContent({ polygonPoints, positionedSeats, selectedSeats, onSeatClick, seatScale = 0.5 }: PondSVGContentProps) {
  const uid    = useId().replace(/:/g, '_');
  const clipId = `pc${uid}`;

  return (
    <>
      <defs>
        {/* Clip fish to polygon so they don't swim over seats / land */}
        <clipPath id={clipId}>
          <polygon points={polygonPoints} />
        </clipPath>
      </defs>

      {/* Background water */}
      <rect width={SVG_W} height={SVG_H} fill="#0d1c2e" rx="6" />

      {/* Water shimmer */}
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`sh${i}`} x1={30} y1={55 + i * 42} x2={SVG_W - 30} y2={55 + i * 42}
          stroke="rgba(77,166,255,0.055)" strokeWidth="1" pointerEvents="none" />
      ))}

      {/* ── Swimming fish, clipped strictly to pond polygon ── */}
      <g clipPath={`url(#${clipId})`} pointerEvents="none">
        <text x="80"  y="130" fontSize="18" className="svg-pond-fish svg-pond-fish-1">🐟</text>
        <text x="200" y="172" fontSize="22" className="svg-pond-fish svg-pond-fish-2">🐠</text>
        <text x="360" y="118" fontSize="16" className="svg-pond-fish svg-pond-fish-3">🐡</text>
        <text x="480" y="185" fontSize="20" className="svg-pond-fish svg-pond-fish-4">🐟</text>
        <text x="100" y="260" fontSize="18" className="svg-pond-fish svg-pond-fish-5">🐠</text>
        <text x="265" y="298" fontSize="20" className="svg-pond-fish svg-pond-fish-6">🐟</text>
        <text x="420" y="270" fontSize="14" className="svg-pond-fish svg-pond-fish-7">🐡</text>
        <text x="330" y="205" fontSize="18" className="svg-pond-fish svg-pond-fish-8">🐠</text>
      </g>

      {/* Pond polygon */}
      <polygon points={polygonPoints}
        fill="rgba(0, 120, 220, 0.17)"
        stroke="rgba(77, 166, 255, 0.6)"
        strokeWidth="2" strokeLinejoin="round" />

      {/* Seats — counter-scaled so visual pixel size stays constant when zoomed */}
      {positionedSeats.map(s => {
        const cx = (s.px! / 100) * SVG_W;
        const cy = (s.py! / 100) * SVG_H;
        const isSelected = selectedSeats.includes(s.num);
        const isBooked   = s.status === 'booked';
        const isPending  = s.status === 'pending';
        const isInactive = s.active === false;

        let fill = '#1a7a3e';
        if (isBooked)   fill = '#4a2222';
        if (isPending)  fill = '#5a4000';
        if (isInactive) fill = '#2a2a2a';
        if (isSelected) fill = '#c8922a';

        const stroke    = isSelected ? '#ffd700' : isBooked ? '#8b2222' : isInactive ? '#444' : 'rgba(255,255,255,0.35)';
        const clickable = !isBooked && !isInactive;
        const csTx      = seatScale !== 1 ? `translate(${cx},${cy}) scale(${0.5 / seatScale}) translate(${-cx},${-cy})` : undefined;

        return (
          <g key={s.num}
            transform={csTx}
            onClick={() => clickable && onSeatClick(s.num, s.status)}
            style={{ cursor: clickable ? 'pointer' : 'not-allowed' }}>
            {isSelected && (
              <circle cx={cx} cy={cy} r={17} fill="rgba(200,146,42,0.25)" pointerEvents="none" />
            )}
            <circle cx={cx} cy={cy} r={isSelected ? 14 : 12}
              fill={fill} stroke={stroke} strokeWidth={isSelected ? 2.5 : 1.5} />
            <text x={cx} y={cy + 4} textAnchor="middle"
              fill={isInactive ? '#555' : 'rgba(255,255,255,0.92)'}
              fontSize="10" fontWeight="bold" pointerEvents="none">{s.num}</text>
          </g>
        );
      })}

      {/* Low-opacity hint when nothing is selected yet */}
      {selectedSeats.length === 0 && positionedSeats.length > 0 && (
        <text x={SVG_W / 2} y={SVG_H - 36} textAnchor="middle"
          fill="rgba(255,255,255,0.22)" fontSize="13" letterSpacing="0.5" pointerEvents="none">
          Klik peg hijau untuk pilih tempat duduk
        </text>
      )}

      {/* Centre watermark */}
      <text x={SVG_W / 2} y={SVG_H - 13} textAnchor="middle"
        fill="rgba(255,255,255,0.10)" fontSize="11" letterSpacing="3" pointerEvents="none">
        KOLAM
      </text>
    </>
  );
}

// ── Main SeatMap component ────────────────────────────────────────────────────

const SeatMap: React.FC<SeatMapProps> = ({ pond, selectedSeats, onToggleSeat, useLegacyView = false }) => {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom]         = useState(1);
  const [pan, setPan]           = useState({ x: 0, y: 0 });

  const isDragRef       = useRef(false);
  const dragMovedRef    = useRef(false);
  const lastDragPos     = useRef({ x: 0, y: 0 });
  const lastTouchDist   = useRef<number | null>(null);
  const expandContainer = useRef<HTMLDivElement>(null);

  const splitSeats = useMemo(() => {
    if (!pond) return { left: [] as Seat[], right: [] as Seat[] };
    const ordered    = [...pond.seats].sort((a, b) => a.num - b.num);
    const leftCount  = Math.ceil(ordered.length / 2);
    return { left: ordered.slice(0, leftCount), right: ordered.slice(leftCount) };
  }, [pond]);

  // Zoom toward (cx, cy) in container-pixel space
  const applyZoom = useCallback((factor: number, cx: number, cy: number) => {
    setZoom(prev => {
      const nz = Math.max(0.35, Math.min(8, prev * factor));
      setPan(pp => ({
        x: cx - (cx - pp.x) * (nz / prev),
        y: cy - (cy - pp.y) * (nz / prev),
      }));
      return nz;
    });
  }, []);

  const zoomToCenter = useCallback((factor: number) => {
    const c = expandContainer.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    applyZoom(factor, r.width / 2, r.height / 2);
  }, [applyZoom]);

  const handleExpand = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); setExpanded(true); }, []);
  const handleClose  = useCallback(() => setExpanded(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const c = expandContainer.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    applyZoom(e.deltaY > 0 ? 0.85 : 1.18, e.clientX - r.left, e.clientY - r.top);
  }, [applyZoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragRef.current = true; dragMovedRef.current = false;
    lastDragPos.current = { x: e.clientX, y: e.clientY };
  }, []);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragRef.current) return;
    const dx = e.clientX - lastDragPos.current.x;
    const dy = e.clientY - lastDragPos.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragMovedRef.current = true;
    lastDragPos.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  }, []);
  const handleMouseUp = useCallback(() => { isDragRef.current = false; }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
      dragMovedRef.current  = true;
    } else {
      isDragRef.current = true; dragMovedRef.current = false;
      lastDragPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 2 && lastTouchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const c = expandContainer.current;
      if (c) {
        const r  = c.getBoundingClientRect();
        const mx = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - r.left;
        const my = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - r.top;
        applyZoom(dist / lastTouchDist.current, mx, my);
      }
      lastTouchDist.current = dist;
    } else if (e.touches.length === 1 && isDragRef.current) {
      const dx = e.touches[0].clientX - lastDragPos.current.x;
      const dy = e.touches[0].clientY - lastDragPos.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragMovedRef.current = true;
      lastDragPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    }
  }, [applyZoom]);
  const handleTouchEnd = useCallback(() => {
    isDragRef.current = false; lastTouchDist.current = null;
  }, []);

  // Seat click in expanded view – ignored if user was dragging
  const handleSeatClickExpanded = useCallback((num: number, status: string) => {
    if (dragMovedRef.current) return;
    if (status !== 'booked') onToggleSeat(num);
  }, [onToggleSeat]);

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

  const av           = pond.seats.filter(s => s.status === 'available').length;
  const hasShape     = (pond.shape?.length ?? 0) > 2;
  const posSeatsList = pond.seats.filter(s => s.px !== undefined && s.py !== undefined);
  const showCanvas   = !useLegacyView && hasShape && posSeatsList.length > 0;
  const polyPts      = (pond.shape ?? []).map(v => `${(v.x / 100) * SVG_W},${(v.y / 100) * SVG_H}`).join(' ');

  const selectedTotal = selectedSeats.reduce((a, n) => {
    const s = pond.seats.find(x => x.num === n);
    return a + (s ? s.price : 0);
  }, 0);

  const handleSeatClickNormal = (num: number, status: string) => {
    if (status !== 'booked') onToggleSeat(num);
  };

  return (
    <>
      <div className="card seat-map-card">
        {/* ── Header ── */}
        <div className="seat-map-header">
          <div>
            <div className="seat-map-title">{pond.name}</div>
            <div className="seat-map-subtitle">{pond.date} — {av} pegs available</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {showCanvas && (
              <button type="button" className="pond-expand-btn" onClick={handleExpand} title="Kembangkan paparan kolam">
                ⤢ Kembangkan
              </button>
            )}
            <div className="seat-legend">
              <div className="legend-item"><div className="legend-dot avail"></div> Available</div>
              <div className="legend-item"><div className="legend-dot selected"></div> Selected</div>
              <div className="legend-item"><div className="legend-dot booked"></div> Taken</div>
            </div>
          </div>
        </div>

        {/* ── Seat area ── */}
        <div id="seat-map-wrap" className="seat-map-wrap">
          {showCanvas ? (
            <div style={{ width: '100%' }}>
              <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="pond-booking-svg"
                style={{ width: '100%', display: 'block', borderRadius: '8px' }}>
                <PondSVGContent
                  polygonPoints={polyPts}
                  positionedSeats={posSeatsList}
                  selectedSeats={selectedSeats}
                  onSeatClick={handleSeatClickNormal}
                />
              </svg>
            </div>
          ) : (
            /* ── Legacy column layout ── */
            <>
              <div className="seat-zone-wrap left">
                <div className="seat-zone-label">Kiri</div>
                <div className="seat-col">
                  {splitSeats.left.map(s => {
                    const isSel    = selectedSeats.includes(s.num);
                    const isBooked = s.status === 'booked';
                    const cls      = isBooked ? 'booked' : isSel ? 'selected' : 'avail';
                    return (
                      <button key={s.num} type="button" className={`seat-btn ${cls}`}
                        onClick={() => handleSeatClickNormal(s.num, s.status)}
                        disabled={isBooked} title={`Peg #${s.num} - ${s.status}`}>{s.num}</button>
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
                    const isSel    = selectedSeats.includes(s.num);
                    const isBooked = s.status === 'booked';
                    const cls      = isBooked ? 'booked' : isSel ? 'selected' : 'avail';
                    return (
                      <button key={s.num} type="button" className={`seat-btn ${cls}`}
                        onClick={() => handleSeatClickNormal(s.num, s.status)}
                        disabled={isBooked} title={`Peg #${s.num} - ${s.status}`}>{s.num}</button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Price bar ── */}
        {selectedSeats.length > 0 && (
          <div className="price-bar">
            <div>
              <div className="price-bar-label">Total Amount</div>
              <div className="price-bar-detail">{selectedSeats.length} peg{selectedSeats.length !== 1 ? 's' : ''} selected</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="price-bar-total">RM {selectedTotal}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Fullscreen expanded overlay ── */}
      {expanded && showCanvas && (
        <div className="pond-expand-overlay">
          {/* Top bar */}
          <div className="pond-expand-header">
            <span className="pond-expand-title">⊛ {pond.name}</span>
            <div className="pond-expand-controls">
              <button type="button" className="pond-zoom-btn" onClick={() => zoomToCenter(0.8)} title="Zoom out">−</button>
              <span className="pond-zoom-label">{Math.round(zoom * 100)}%</span>
              <button type="button" className="pond-zoom-btn" onClick={() => zoomToCenter(1.25)} title="Zoom in">+</button>
              <button type="button" className="pond-zoom-reset" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
              <button type="button" className="pond-expand-close" onClick={handleClose}>✕</button>
            </div>
          </div>

          {/* Zoomable / pannable canvas */}
          <div
            className="pond-expand-canvas"
            ref={expandContainer}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              style={{
                width: '100%',
                display: 'block',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                userSelect: 'none',
              }}
            >
              <PondSVGContent
                polygonPoints={polyPts}
                positionedSeats={posSeatsList}
                selectedSeats={selectedSeats}
                onSeatClick={handleSeatClickExpanded}
                seatScale={zoom}
              />
            </svg>
          </div>

          {/* Bottom bar: selected seats + total */}
          <div className="pond-expand-footer">
            {selectedSeats.length > 0 ? (
              <>
                <div className="pond-expand-seats">
                  {selectedSeats.map(n => {
                    const s = pond.seats.find(x => x.num === n);
                    return (
                      <button key={n} type="button" className="pond-expand-seat-chip"
                        onClick={() => onToggleSeat(n)} title="Klik untuk nyahpilih">
                        Peg #{n}{s ? ` · RM${s.price}` : ''} ✕
                      </button>
                    );
                  })}
                </div>
                <div className="pond-expand-total">
                  <span className="pond-expand-total-label">Jumlah</span>
                  <span className="pond-expand-total-amt">RM {selectedTotal}</span>
                </div>
              </>
            ) : (
              <div className="pond-expand-empty-hint">Tiada peg dipilih · Klik peg hijau untuk pilih</div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default SeatMap;