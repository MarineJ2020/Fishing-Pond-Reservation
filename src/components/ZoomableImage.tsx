import React, { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  height?: string;
}

const MIN = 1;
const MAX = 6;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Image viewer with zoom + pan: wheel / +/- buttons / double-click on desktop,
 * pinch + drag + double-tap on touch. Pan is clamped so the image can't be lost.
 */
const ZoomableImage: React.FC<Props> = ({ src, alt, height = '75dvh' }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const [dragging, setDragging] = useState(false);

  // Keep the scaled image covering the box (no empty gaps beyond the edges).
  const constrain = useCallback((scale: number, x: number, y: number) => {
    const box = boxRef.current;
    if (!box || scale <= 1) return { scale: clamp(scale, MIN, MAX), x: 0, y: 0 };
    const maxX = (box.clientWidth * (scale - 1)) / 2;
    const maxY = (box.clientHeight * (scale - 1)) / 2;
    return { scale, x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  // Zoom keeping the point (cx, cy) — relative to the box centre — fixed on screen.
  const zoomAt = useCallback((next: number, cx: number, cy: number) => {
    const { scale, x, y } = viewRef.current;
    const target = clamp(next, MIN, MAX);
    const ratio = target / scale;
    setView(constrain(target, cx - (cx - x) * ratio, cy - (cy - y) * ratio));
  }, [constrain]);

  const centreOf = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { cx: clientX - r.left - r.width / 2, cy: clientY - r.top - r.height / 2 };
  };

  // Wheel needs a non-passive listener to preventDefault page scroll.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { cx, cy } = centreOf(e.clientX, e.clientY);
      zoomAt(viewRef.current.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), cx, cy);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: viewRef.current.scale };
    } else if (pointers.current.size === 1) {
      setDragging(true);
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const { cx, cy } = centreOf(e.clientX, e.clientY);
        zoomAt(viewRef.current.scale > 1.05 ? 1 : 2.5, cx, cy);
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = centreOf((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomAt(gesture.current.scale * (dist / (gesture.current.dist || 1)), mid.cx, mid.cy);
    } else if (pointers.current.size === 1) {
      const { scale, x, y } = viewRef.current;
      if (scale > 1) setView(constrain(scale, x + e.clientX - prev.x, y + e.clientY - prev.y));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  const btn: React.CSSProperties = {
    width: 40, height: 40, borderRadius: 10, border: '1px solid rgba(0,0,0,0.15)',
    background: '#fff', color: '#0f2744', fontSize: '1.3rem', fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)', lineHeight: 1,
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          height, overflow: 'hidden', borderRadius: 8, background: 'rgba(0,0,0,0.04)',
          touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
          cursor: view.scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: dragging ? 'none' : 'transform 0.15s ease-out',
            willChange: 'transform', pointerEvents: 'none',
          }}
        />
      </div>
      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" style={btn} aria-label="Zoom in" onClick={() => zoomAt(viewRef.current.scale * 1.5, 0, 0)}>+</button>
        <button type="button" style={btn} aria-label="Zoom out" onClick={() => zoomAt(viewRef.current.scale / 1.5, 0, 0)}>−</button>
        {view.scale > 1 && (
          <button type="button" style={{ ...btn, fontSize: '0.7rem' }} aria-label="Reset zoom" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>1×</button>
        )}
      </div>
      <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted, #888)', marginTop: 8 }}>
        Cubit dua jari / skrol / dwi-klik untuk zum · seret untuk gerak
      </div>
    </div>
  );
};

export default ZoomableImage;
