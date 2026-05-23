import React, { useEffect, useRef, useState } from 'react';

// Rectangle expressed in normalised image coordinates (0–1) so the value is
// independent of preview size.
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

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

const CropRectOverlay: React.FC<Props> = ({
  imageUrl,
  initial = { x: 0.15, y: 0.35, w: 0.7, h: 0.3 },
  onChange,
  className,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [rect, setRect] = useState<NormRect>(initial);
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; orig: NormRect } | null>(null);

  useEffect(() => { onChange?.(rect); }, [rect, onChange]);

  const updatePreviewSize = () => {
    const el = imgRef.current;
    if (!el) return;
    setPreviewSize({ w: el.clientWidth, h: el.clientHeight });
  };

  useEffect(() => {
    window.addEventListener('resize', updatePreviewSize);
    return () => window.removeEventListener('resize', updatePreviewSize);
  }, []);

  const pointerFromEvent = (e: React.PointerEvent | PointerEvent) => {
    const wrap = wrapRef.current;
    if (!wrap || previewSize.w === 0) return { nx: 0, ny: 0 };
    const rectBox = wrap.getBoundingClientRect();
    const nx = (e.clientX - rectBox.left) / previewSize.w;
    const ny = (e.clientY - rectBox.top) / previewSize.h;
    return { nx, ny };
  };

  const startDrag = (mode: DragMode, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { nx, ny } = pointerFromEvent(e);
    dragRef.current = { mode, startX: nx, startY: ny, orig: { ...rect } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
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

  const endDrag = () => { dragRef.current = null; };

  const px = (n: number, dim: 'w' | 'h') => `${n * (dim === 'w' ? previewSize.w : previewSize.h)}px`;

  const handleSize = 18;

  return (
    <div ref={wrapRef} className={className}
      style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', touchAction: 'none', userSelect: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <img
        ref={imgRef}
        src={imageUrl}
        alt="capture"
        onLoad={updatePreviewSize}
        style={{ display: 'block', maxWidth: '100%', maxHeight: '60vh', borderRadius: '8px' }}
      />
      {previewSize.w > 0 && (
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
  );
};

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export default CropRectOverlay;
