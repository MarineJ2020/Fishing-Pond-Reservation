import React, { useState, useRef, useEffect } from 'react';
import { Seat, PondVertex } from '../types';

const W = 600;
const H = 400;

const clamp = (v: number) => Math.max(0, Math.min(100, v));

function toPct(svgX: number, svgY: number) {
  return { px: clamp((svgX / W) * 100), py: clamp((svgY / H) * 100) };
}

function fromPct(px: number, py: number) {
  return { x: (px / 100) * W, y: (py / 100) * H };
}

function getSVGPoint(e: MouseEvent | React.MouseEvent, svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  const x = Math.max(0, Math.min(W, ((e.clientX - rect.left) * W) / rect.width));
  const y = Math.max(0, Math.min(H, ((e.clientY - rect.top) * H) / rect.height));
  return { x, y };
}

interface LinePopupData {
  sx: number;
  sy: number;
  ex: number;
  ey: number;
}

interface PondEditorProps {
  shape: PondVertex[];
  seats: Seat[];
  maxSeats?: number;
  onChange: (shape: PondVertex[], seats: Seat[]) => void;
}

export default function PondEditor({ shape: shapeProp, seats: seatsProp, maxSeats, onChange }: PondEditorProps) {
  const [mode, setMode] = useState<'shape' | 'seats'>('shape');
  const [localShape, setLocalShape] = useState<PondVertex[]>(shapeProp);
  const [localSeats, setLocalSeats] = useState<Seat[]>(seatsProp);
  const [selectedVertexIdx, setSelectedVertexIdx] = useState<number | null>(null);
  const [selectedSeatNum, setSelectedSeatNum] = useState<number | null>(null);
  const [dragLine, setDragLine] = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);
  const [linePopup, setLinePopup] = useState<LinePopupData | null>(null);
  const [popupCount, setPopupCount] = useState('2');
  const [popupStartNum, setPopupStartNum] = useState('1');

  const svgRef = useRef<SVGSVGElement>(null);

  const dragRef = useRef<{
    type: 'vertex' | 'seat' | 'canvas';
    idx: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const isDragging = useRef(false);

  // Keep mutable refs so window handlers always see latest values
  const modeRef = useRef(mode);
  const localShapeRef = useRef(localShape);
  const localSeatsRef = useRef(localSeats);
  const onChangeRef = useRef(onChange);

  modeRef.current = mode;
  localShapeRef.current = localShape;
  localSeatsRef.current = localSeats;
  onChangeRef.current = onChange;

  // Sync from props only when not dragging
  useEffect(() => {
    if (!isDragging.current) {
      setLocalShape(shapeProp);
      setLocalSeats(seatsProp);
    }
  }, [shapeProp, seatsProp]);

  // Global mouse handlers – allows drag outside SVG boundary
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const dr = dragRef.current;
      if (!dr || !svgRef.current) return;
      const { x, y } = getSVGPoint(e, svgRef.current);
      const dx = x - dr.startX;
      const dy = y - dr.startY;
      if (Math.sqrt(dx * dx + dy * dy) > 3) dr.moved = true;

      if (modeRef.current === 'shape' && dr.type === 'vertex' && dr.moved) {
        const pct = toPct(x, y);
        const newShape = localShapeRef.current.map((v, i) =>
          i === dr.idx ? { x: pct.px, y: pct.py } : v
        );
        setLocalShape(newShape);
      } else if (modeRef.current === 'seats' && dr.type === 'seat' && dr.moved) {
        const pct = toPct(x, y);
        const newSeats = localSeatsRef.current.map(s =>
          s.num === dr.idx ? { ...s, px: pct.px, py: pct.py } : s
        );
        setLocalSeats(newSeats);
      } else if (dr.type === 'canvas') {
        setDragLine(prev => (prev ? { ...prev, ex: x, ey: y } : null));
      }
    };

    const handleUp = (e: MouseEvent) => {
      const dr = dragRef.current;
      if (!dr) return;
      dragRef.current = null;
      isDragging.current = false;

      const { x, y } = svgRef.current
        ? getSVGPoint(e, svgRef.current)
        : { x: 0, y: 0 };

      if (modeRef.current === 'shape') {
        if (dr.type === 'vertex') {
          onChangeRef.current(localShapeRef.current, localSeatsRef.current);
        } else if (dr.type === 'canvas' && !dr.moved) {
          const pct = toPct(x, y);
          const v: PondVertex = { x: pct.px, y: pct.py };
          const newShape = [...localShapeRef.current, v];
          setLocalShape(newShape);
          onChangeRef.current(newShape, localSeatsRef.current);
        }
      } else {
        // seats mode
        if (dr.type === 'seat') {
          if (dr.moved) {
            onChangeRef.current(localShapeRef.current, localSeatsRef.current);
          } else {
            // toggle active / inactive
            const newSeats = localSeatsRef.current.map(s =>
              s.num === dr.idx ? { ...s, active: s.active !== false ? false : true } : s
            );
            setLocalSeats(newSeats);
            onChangeRef.current(localShapeRef.current, newSeats);
          }
        } else if (dr.type === 'canvas') {
          setDragLine(null);
          const dx = x - dr.startX;
          const dy = y - dr.startY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 20) {
            const remaining = maxSeats !== undefined ? maxSeats - localSeatsRef.current.length : 50;
            if (remaining <= 0) return; // already at max
            const maxNum =
              localSeatsRef.current.length
                ? Math.max(...localSeatsRef.current.map(s => s.num))
                : 0;
            setPopupCount(String(Math.min(2, remaining)));
            setPopupStartNum(String(maxNum + 1));
            setLinePopup({ sx: dr.startX, sy: dr.startY, ex: x, ey: y });
          }
        }
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (linePopup) return;
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const { x, y } = getSVGPoint(e, svg);
    const el = e.target as SVGElement;
    const elType = el.dataset.type;
    const elIdx = el.dataset.idx !== undefined ? parseInt(el.dataset.idx) : -1;

    isDragging.current = true;

    if (mode === 'shape') {
      if (elType === 'vertex') {
        dragRef.current = { type: 'vertex', idx: elIdx, startX: x, startY: y, moved: false };
        setSelectedVertexIdx(elIdx);
      } else {
        dragRef.current = { type: 'canvas', idx: -1, startX: x, startY: y, moved: false };
        setSelectedVertexIdx(null);
      }
    } else {
      if (elType === 'seat') {
        dragRef.current = { type: 'seat', idx: elIdx, startX: x, startY: y, moved: false };
        setSelectedSeatNum(elIdx);
      } else {
        dragRef.current = { type: 'canvas', idx: -1, startX: x, startY: y, moved: false };
        setDragLine({ sx: x, sy: y, ex: x, ey: y });
        setSelectedSeatNum(null);
      }
    }
  };

  const confirmSeatLine = () => {
    if (!linePopup) return;
    const remaining = maxSeats !== undefined ? maxSeats - localSeats.length : 50;
    const count = Math.max(1, Math.min(remaining, parseInt(popupCount) || 1));
    const startNum = parseInt(popupStartNum) || 1;
    const defaultPrice = localSeats[0]?.price || 100;

    const newSeats: Seat[] = [...localSeats];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const svgX = linePopup.sx + (linePopup.ex - linePopup.sx) * t;
      const svgY = linePopup.sy + (linePopup.ey - linePopup.sy) * t;
      const pct = toPct(svgX, svgY);
      newSeats.push({
        num: startNum + i,
        zone: 'A',
        price: defaultPrice,
        status: 'available',
        px: pct.px,
        py: pct.py,
        active: true,
      });
    }
    setLocalSeats(newSeats);
    onChange(localShape, newSeats);
    setLinePopup(null);
  };

  const deleteSelectedVertex = () => {
    if (selectedVertexIdx === null) return;
    const newShape = localShape.filter((_, i) => i !== selectedVertexIdx);
    setLocalShape(newShape);
    setSelectedVertexIdx(null);
    onChange(newShape, localSeats);
  };

  const deleteSelectedSeat = () => {
    if (selectedSeatNum === null) return;
    const newSeats = localSeats.filter(s => s.num !== selectedSeatNum);
    setLocalSeats(newSeats);
    setSelectedSeatNum(null);
    onChange(localShape, newSeats);
  };

  const clearShape = () => {
    setLocalShape([]);
    setSelectedVertexIdx(null);
    onChange([], localSeats);
  };

  const clearSeats = () => {
    setLocalSeats([]);
    setSelectedSeatNum(null);
    onChange(localShape, []);
  };

  const polygonPoints = localShape
    .map(v => {
      const p = fromPct(v.x, v.y);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  // Popup position: centre of the drag line, clamped to canvas
  const popupSvgX = linePopup
    ? Math.max(4, Math.min(W - 204, (linePopup.sx + linePopup.ex) / 2 - 100))
    : 0;
  const popupSvgY = linePopup
    ? Math.max(4, Math.min(H - 154, (linePopup.sy + linePopup.ey) / 2 - 75))
    : 0;

  const seatsWithPos = localSeats.filter(s => s.px !== undefined && s.py !== undefined);

  return (
    <div className="pond-editor-wrap">
      {/* ── Toolbar ── */}
      <div className="pond-editor-toolbar">
        <button
          type="button"
          className={`btn btn-sm ${mode === 'shape' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { setMode('shape'); setSelectedSeatNum(null); }}
        >
          ⬡ Bentuk
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'seats' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { setMode('seats'); setSelectedVertexIdx(null); }}
        >
          ⊕ Tempat
        </button>

        <span className="pond-editor-badge">
          {maxSeats !== undefined
            ? <>{localSeats.length} / {maxSeats} peg{localSeats.length !== maxSeats && <span style={{ color: localSeats.length > maxSeats ? '#f87171' : '#facc15', marginLeft: 4 }}>{localSeats.length > maxSeats ? '(terlalu banyak)' : `(perlu ${maxSeats - localSeats.length} lagi)`}</span>}</>
            : <>{localSeats.length} peg</>}
        </span>

        {mode === 'shape' && selectedVertexIdx !== null && (
          <button type="button" className="btn btn-sm btn-danger" onClick={deleteSelectedVertex}>
            ✕ Buang Titik
          </button>
        )}
        {mode === 'seats' && selectedSeatNum !== null && (
          <button type="button" className="btn btn-sm btn-danger" onClick={deleteSelectedSeat}>
            ✕ Buang Peg #{selectedSeatNum}
          </button>
        )}

        <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          {localShape.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="Padam semua titik bentuk"
              onClick={clearShape}
            >
              Kosong Bentuk
            </button>
          )}
          {localSeats.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="Padam semua tempat duduk"
              onClick={clearSeats}
            >
              Kosong Tempat
            </button>
          )}
        </span>
      </div>

      {/* ── SVG Canvas ── */}
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="pond-editor-svg"
          onMouseDown={handleMouseDown}
          style={{ userSelect: 'none', cursor: mode === 'shape' ? 'crosshair' : 'crosshair' }}
        >
          {/* Background */}
          <rect width={W} height={H} fill="#0d1c2e" rx="6" />

          {/* Subtle grid */}
          {Array.from({ length: 21 }, (_, i) => (
            <line
              key={`vg${i}`}
              x1={(i * W) / 20}
              y1={0}
              x2={(i * W) / 20}
              y2={H}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="1"
              pointerEvents="none"
            />
          ))}
          {Array.from({ length: 14 }, (_, i) => (
            <line
              key={`hg${i}`}
              x1={0}
              y1={(i * H) / 13}
              x2={W}
              y2={(i * H) / 13}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="1"
              pointerEvents="none"
            />
          ))}

          {/* ── Polygon ── */}
          {localShape.length > 2 && (
            <polygon
              points={polygonPoints}
              fill="rgba(0, 120, 220, 0.25)"
              stroke="rgba(77, 166, 255, 0.9)"
              strokeWidth="2"
              strokeLinejoin="round"
              data-type="polygon"
            />
          )}
          {localShape.length === 2 && (
            <line
              x1={fromPct(localShape[0].x, localShape[0].y).x}
              y1={fromPct(localShape[0].x, localShape[0].y).y}
              x2={fromPct(localShape[1].x, localShape[1].y).x}
              y2={fromPct(localShape[1].x, localShape[1].y).y}
              stroke="rgba(77, 166, 255, 0.9)"
              strokeWidth="2"
              data-type="line"
            />
          )}

          {/* ── Vertex handles (shape mode only) ── */}
          {mode === 'shape' &&
            localShape.map((v, i) => {
              const p = fromPct(v.x, v.y);
              const isSel = selectedVertexIdx === i;
              return (
                <g key={i} style={{ cursor: 'grab' }}>
                  {/* Hit area */}
                  <circle cx={p.x} cy={p.y} r={16} fill="transparent" data-type="vertex" data-idx={i} />
                  {/* Glow ring when selected */}
                  {isSel && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={10}
                      fill="rgba(255, 215, 0, 0.25)"
                      stroke="none"
                      pointerEvents="none"
                    />
                  )}
                  {/* Dot */}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isSel ? 8 : 6}
                    fill={isSel ? '#ffd700' : '#4da6ff'}
                    stroke="white"
                    strokeWidth="2"
                    data-type="vertex"
                    data-idx={i}
                  />
                  <text
                    x={p.x}
                    y={p.y - 12}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.6)"
                    fontSize="9"
                    pointerEvents="none"
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}

          {/* ── Seat circles ── */}
          {seatsWithPos.map(s => {
            const p = fromPct(s.px!, s.py!);
            const isSel = selectedSeatNum === s.num;
            const isInactive = s.active === false;
            return (
              <g
                key={s.num}
                style={{ cursor: mode === 'seats' ? 'pointer' : 'default', pointerEvents: mode === 'shape' ? 'none' : 'auto' }}
              >
                {/* Hit area */}
                <circle cx={p.x} cy={p.y} r={18} fill="transparent" data-type="seat" data-idx={s.num} />
                {/* Glow ring when selected */}
                {isSel && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={16}
                    fill="rgba(255,215,0,0.2)"
                    stroke="none"
                    pointerEvents="none"
                  />
                )}
                {/* Inactive dashed ring */}
                {isInactive && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={14}
                    fill="none"
                    stroke="#666"
                    strokeWidth="1.5"
                    strokeDasharray="3,2"
                    pointerEvents="none"
                  />
                )}
                {/* Main circle */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isSel ? 14 : 12}
                  fill={isInactive ? '#3a3a3a' : isSel ? '#ffd700' : '#1a7a3e'}
                  stroke={isSel ? '#ffd700' : isInactive ? '#555' : 'rgba(255,255,255,0.45)'}
                  strokeWidth={isSel ? 2.5 : 1.5}
                  data-type="seat"
                  data-idx={s.num}
                />
                {/* Number label */}
                <text
                  x={p.x}
                  y={p.y + 4}
                  textAnchor="middle"
                  fill={isInactive ? '#777' : isSel ? '#1a1a1a' : 'white'}
                  fontSize="10"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  {s.num}
                </text>
              </g>
            );
          })}

          {/* ── Rubber-band drag line ── */}
          {dragLine && (
            <>
              <line
                x1={dragLine.sx}
                y1={dragLine.sy}
                x2={dragLine.ex}
                y2={dragLine.ey}
                stroke="#ffd700"
                strokeWidth="2"
                strokeDasharray="6,3"
                pointerEvents="none"
              />
              <circle cx={dragLine.sx} cy={dragLine.sy} r={4} fill="#ffd700" pointerEvents="none" />
              <circle cx={dragLine.ex} cy={dragLine.ey} r={4} fill="#ffd700" pointerEvents="none" />
            </>
          )}

          {/* ── Seat-line popup (foreignObject) ── */}
          {linePopup && (
            <>
              <line
                x1={linePopup.sx}
                y1={linePopup.sy}
                x2={linePopup.ex}
                y2={linePopup.ey}
                stroke="#ffd700"
                strokeWidth="2"
                strokeDasharray="6,3"
                pointerEvents="none"
              />
              <circle cx={linePopup.sx} cy={linePopup.sy} r={5} fill="#ffd700" pointerEvents="none" />
              <circle cx={linePopup.ex} cy={linePopup.ey} r={5} fill="#ffd700" pointerEvents="none" />

              <foreignObject
                x={popupSvgX}
                y={popupSvgY}
                width={200}
                height={152}
              >
                <div
                  className="pond-line-popup"
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="plp-header">Letak Tempat Duduk</div>
                  <div className="plp-row">
                    <label>Bilangan tempat</label>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={popupCount}
                      onChange={e => setPopupCount(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="plp-row">
                    <label>Nombor mula</label>
                    <input
                      type="number"
                      min="1"
                      value={popupStartNum}
                      onChange={e => setPopupStartNum(e.target.value)}
                    />
                  </div>
                  <div className="plp-btns">
                    <button type="button" onClick={() => setLinePopup(null)}>
                      Batal
                    </button>
                    <button type="button" className="ok" onClick={confirmSeatLine}>
                      OK
                    </button>
                  </div>
                </div>
              </foreignObject>
            </>
          )}

          {/* ── Empty state hint inside SVG ── */}
          {localShape.length === 0 && mode === 'shape' && (
            <text
              x={W / 2}
              y={H / 2}
              textAnchor="middle"
              fill="rgba(255,255,255,0.25)"
              fontSize="15"
              pointerEvents="none"
            >
              Klik pada kanvas untuk menambah titik bentuk kolam
            </text>
          )}
          {localShape.length > 2 && seatsWithPos.length === 0 && mode === 'seats' && (
            <text
              x={W / 2}
              y={H / 2}
              textAnchor="middle"
              fill="rgba(255,255,255,0.25)"
              fontSize="15"
              pointerEvents="none"
            >
              Seret pada kanvas untuk letak baris tempat duduk
            </text>
          )}
        </svg>

        {/* ── Hint text ── */}
        <div className="pond-editor-hint">
          {mode === 'shape'
            ? 'Klik kosong → tambah titik · Seret titik → gerak · Pilih titik → Buang Titik'
            : 'Seret untuk letak baris peg · Klik peg → aktif/tidak aktif · Seret peg → alih'}
        </div>
      </div>

    </div>
  );
}
