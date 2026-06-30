import React, { useEffect, useRef, useState } from 'react';

// Rectangle expressed in normalised image coordinates (0–1) so the value is
// independent of preview size (and therefore of the current zoom level).
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  imageUrl: string;
  initial?: NormRect;
  onChange?: (rect: NormRect) => void;
  className?: string;
}

const MIN_FRAC = 0.05; // never shrink below 5% of image width/height
const MAX_ZOOM = 4;
const MIN_ZOOM = 1;

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

const CropRectOverlay: React.FC<Props> = ({
  imageUrl,
  initial = { x: 0.15, y: 0.35, w: 0.7, h: 0.3 },
  onChange,
  className,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [rect, setRect] = useState<NormRect>(initial);
  // Fitted image size at zoom = 1 (measured once the image lays out). The actual
  // preview size is base × zoom; all the drag math reads previewW/previewH so it
  // stays correct as the image grows.
  const [base, setBase] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pinching, setPinching] = useState(false);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; orig: NormRect } | null>(null);
  // Active touch/pen/mouse pointers, keyed by pointerId, for pinch detection.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);

  const previewW = base.w * zoom;
  const previewH = base.h * zoom;

  useEffect(() => { onChange?.(rect); }, [rect, onChange]);

  // Measure the fitted size only at zoom = 1; above that the image carries an
  // explicit (base × zoom) size so clientWidth would no longer be the base.
  const measureBase = () => {
    const el = imgRef.current;
    if (!el || zoom !== 1) return;
    setBase({ w: el.clientWidth, h: el.clientHeight });
  };

  useEffect(() => {
    window.addEventListener('resize', measureBase);
    return () => window.removeEventListener('resize', measureBase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const pointerFromEvent = (e: React.PointerEvent | PointerEvent) => {
    const wrap = wrapRef.current;
    if (!wrap || previewW === 0) return { nx: 0, ny: 0 };
    const rectBox = wrap.getBoundingClientRect();
    const nx = (e.clientX - rectBox.left) / previewW;
    const ny = (e.clientY - rectBox.top) / previewH;
    return { nx, ny };
  };

  const startDrag = (mode: DragMode, e: React.PointerEvent) => {
    // Two fingers down → this is a pinch, not a box drag.
    if (pointersRef.current.size >= 2) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { nx, ny } = pointerFromEvent(e);
    dragRef.current = { mode, startX: nx, startY: ny, orig: { ...rect } };
  };

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  // Set a new zoom while keeping the given client point (pinch midpoint or
  // viewport centre) anchored under the same pixel.
  const applyZoom = (next: number, centerClient?: { x: number; y: number }) => {
    const clamped = clamp(next, MIN_ZOOM, MAX_ZOOM);
    const sc = scrollRef.current;
    if (sc && centerClient && zoom > 0) {
      const box = sc.getBoundingClientRect();
      const offX = centerClient.x - box.left;
      const offY = centerClient.y - box.top;
      const contentX = sc.scrollLeft + offX;
      const contentY = sc.scrollTop + offY;
      const ratio = clamped / zoom;
      setZoom(clamped);
      requestAnimationFrame(() => {
        sc.scrollLeft = contentX * ratio - offX;
        sc.scrollTop = contentY * ratio - offY;
      });
    } else {
      setZoom(clamped);
    }
  };

  const onWrapPointerDown = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      // Second finger landed → cancel any box drag and begin a pinch.
      dragRef.current = null;
      const pts = [...pointersRef.current.values()];
      pinchRef.current = { startDist: dist(pts[0], pts[1]) || 1, startZoom: zoom };
      setPinching(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const d = dist(pts[0], pts[1]);
      const next = pinchRef.current.startZoom * (d / pinchRef.current.startDist);
      applyZoom(next, { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const { nx, ny } = pointerFromEvent(e);
    const dx = nx - drag.startX;
    const dy = ny - drag.startY;
    let { x, y, w, h } = drag.orig;
    switch (drag.mode) {
      case 'move':
        x = clamp(drag.orig.x + dx, 0, 1 - w);
        y = clamp(drag.orig.y + dy, 0, 1 - h);
        break;
      case 'nw': {
        const nx2 = clamp(drag.orig.x + dx, 0, drag.orig.x + drag.orig.w - MIN_FRAC);
        const ny2 = clamp(drag.orig.y + dy, 0, drag.orig.y + drag.orig.h - MIN_FRAC);
        w = drag.orig.w + (drag.orig.x - nx2);
        h = drag.orig.h + (drag.orig.y - ny2);
        x = nx2; y = ny2;
        break;
      }
      case 'ne': {
        const ny2 = clamp(drag.orig.y + dy, 0, drag.orig.y + drag.orig.h - MIN_FRAC);
        w = clamp(drag.orig.w + dx, MIN_FRAC, 1 - drag.orig.x);
        h = drag.orig.h + (drag.orig.y - ny2);
        y = ny2;
        break;
      }
      case 'sw': {
        const nx2 = clamp(drag.orig.x + dx, 0, drag.orig.x + drag.orig.w - MIN_FRAC);
        w = drag.orig.w + (drag.orig.x - nx2);
        h = clamp(drag.orig.h + dy, MIN_FRAC, 1 - drag.orig.y);
        x = nx2;
        break;
      }
      case 'se':
        w = clamp(drag.orig.w + dx, MIN_FRAC, 1 - drag.orig.x);
        h = clamp(drag.orig.h + dy, MIN_FRAC, 1 - drag.orig.y);
        break;
    }
    setRect({ x, y, w, h });
  };

  const endPointer = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
      setPinching(false);
    }
    dragRef.current = null;
  };

  const zoomBy = (factor: number) => {
    const sc = scrollRef.current;
    const center = sc
      ? (() => { const b = sc.getBoundingClientRect(); return { x: b.left + sc.clientWidth / 2, y: b.top + sc.clientHeight / 2 }; })()
      : undefined;
    applyZoom(zoom * factor, center);
  };

  const resetZoom = () => {
    setZoom(1);
    const sc = scrollRef.current;
    if (sc) { sc.scrollLeft = 0; sc.scrollTop = 0; }
  };

  const px = (n: number, dim: 'w' | 'h') => `${n * (dim === 'w' ? previewW : previewH)}px`;

  const handleSize = 18;

  const imgStyle: React.CSSProperties = base.w > 0
    ? { display: 'block', width: previewW, height: previewH, maxWidth: 'none', maxHeight: 'none', borderRadius: 8 }
    : { display: 'block', maxWidth: '100%', maxHeight: '60vh', borderRadius: 8 };

  return (
    <div className={className} style={{ display: 'inline-block', maxWidth: '100%' }}>
      {/* Zoom toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, justifyContent: 'center' }}>
        <button type="button" className="btn btn-sm" onClick={() => zoomBy(1 / 1.5)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom keluar">−</button>
        <span style={{ minWidth: 52, textAlign: 'center', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn btn-sm" onClick={() => zoomBy(1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom masuk">+</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={resetZoom} disabled={zoom === 1} style={{ fontSize: 11 }}>Reset</button>
      </div>

      <div
        ref={scrollRef}
        style={{
          maxWidth: '100%',
          maxHeight: '60vh',
          overflow: zoom > 1 ? 'auto' : 'hidden',
          borderRadius: 8,
          touchAction: pinching ? 'none' : 'pan-x pan-y',
        }}
      >
        <div ref={wrapRef}
          style={{ position: 'relative', display: 'inline-block', userSelect: 'none' }}
          onPointerDown={onWrapPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="capture"
            onLoad={measureBase}
            style={imgStyle}
          />
          {previewW > 0 && (
            <>
              {/* dim overlay */}
              <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55))`,
                clipPath: `polygon(
                  0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                  ${rect.x * 100}% ${rect.y * 100}%,
                  ${rect.x * 100}% ${(rect.y + rect.h) * 100}%,
                  ${(rect.x + rect.w) * 100}% ${(rect.y + rect.h) * 100}%,
                  ${(rect.x + rect.w) * 100}% ${rect.y * 100}%,
                  ${rect.x * 100}% ${rect.y * 100}%
                )`,
              }} />
              {/* crop rect */}
              <div
                onPointerDown={(e) => startDrag('move', e)}
                style={{
                  position: 'absolute',
                  left: px(rect.x, 'w'),
                  top: px(rect.y, 'h'),
                  width: px(rect.w, 'w'),
                  height: px(rect.h, 'h'),
                  border: '2px solid #fcd34d',
                  boxSizing: 'border-box',
                  cursor: 'move',
                  touchAction: 'none',
                }}
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map(corner => (
                  <div key={corner}
                    onPointerDown={(e) => startDrag(corner, e)}
                    style={{
                      position: 'absolute',
                      width: handleSize, height: handleSize,
                      background: '#fcd34d',
                      borderRadius: 4,
                      ...(corner.includes('n') ? { top: -handleSize / 2 } : { bottom: -handleSize / 2 }),
                      ...(corner.includes('w') ? { left: -handleSize / 2 } : { right: -handleSize / 2 }),
                      cursor: `${corner}-resize`,
                      touchAction: 'none',
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export default CropRectOverlay;
