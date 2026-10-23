import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Calendar + button-grid time picker. Value/onChange use the `datetime-local` format: YYYY-MM-DDTHH:mm. */
interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const MONTHS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
const WEEKDAYS = ['Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab', 'Ahd'];
const POPUP_W = 300;

const pad = (n: number) => String(n).padStart(2, '0');

function parse(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +m[4], mi: +m[5] };
}

function format(p: { y: number; mo: number; d: number; h: number; mi: number }) {
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

function display(value: string) {
  const p = parse(value);
  if (!p) return '';
  const h12 = p.h % 12 || 12;
  return `${pad(p.d)}/${pad(p.mo + 1)}/${p.y}  ${pad(h12)}:${pad(p.mi)} ${p.h < 12 ? 'AM' : 'PM'}`;
}

const DateTimeField: React.FC<Props> = ({ value, onChange, className = 'form-input' }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const parsed = parse(value);
  const now = new Date();
  const [view, setView] = useState({ y: parsed?.y ?? now.getFullYear(), mo: parsed?.mo ?? now.getMonth() });

  const current = parsed ?? { y: now.getFullYear(), mo: now.getMonth(), d: now.getDate(), h: 9, mi: 0 };

  const openPopup = () => {
    const p = parse(value);
    setView({ y: p?.y ?? now.getFullYear(), mo: p?.mo ?? now.getMonth() });
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const popH = popRef.current?.offsetHeight ?? 460;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POPUP_W - 8));
    let top = r.bottom + 4;
    if (top + popH > window.innerHeight - 8) top = Math.max(8, r.top - popH - 4);
    setPos({ top, left });
  }, [open, view.y, view.mo]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const emit = (patch: Partial<typeof current>) => onChange(format({ ...current, ...patch }));

  const shiftMonth = (delta: number) => {
    const d = new Date(view.y, view.mo + delta, 1);
    setView({ y: d.getFullYear(), mo: d.getMonth() });
  };

  const firstDow = (new Date(view.y, view.mo, 1).getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(view.y, view.mo + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const h12 = current.h % 12 || 12;
  const isPm = current.h >= 12;
  const setHour12 = (h: number) => emit({ h: (h % 12) + (isPm ? 12 : 0) });
  const setMeridiem = (pm: boolean) => emit({ h: (current.h % 12) + (pm ? 12 : 0) });
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

  return (
    <div className="date-input-wrap" ref={anchorRef} onClick={() => (open ? setOpen(false) : openPopup())}>
      <input
        className={className}
        type="text"
        readOnly
        value={display(value)}
        placeholder="Pilih tarikh & masa"
        style={{ cursor: 'pointer' }}
      />
      <span className="date-picker-btn" aria-hidden="true">📅</span>
      {open && createPortal(
        <div
          ref={popRef}
          className="dtp-pop"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: POPUP_W }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dtp-head">
            <button type="button" className="dtp-nav" onClick={() => shiftMonth(-1)} aria-label="Bulan sebelumnya">‹</button>
            <span className="dtp-title">{MONTHS[view.mo]} {view.y}</span>
            <button type="button" className="dtp-nav" onClick={() => shiftMonth(1)} aria-label="Bulan seterusnya">›</button>
          </div>
          <div className="dtp-grid">
            {WEEKDAYS.map((w) => <span key={w} className="dtp-dow">{w}</span>)}
            {cells.map((d, i) => d === null ? <span key={`b${i}`} /> : (
              <button
                key={d}
                type="button"
                className={`dtp-day${parsed && parsed.y === view.y && parsed.mo === view.mo && parsed.d === d ? ' sel' : ''}${todayKey === `${view.y}-${view.mo}-${d}` ? ' today' : ''}`}
                onClick={() => emit({ y: view.y, mo: view.mo, d })}
              >{d}</button>
            ))}
          </div>

          <div className="dtp-label">Jam</div>
          <div className="dtp-times cols6">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <button key={h} type="button" className={`dtp-t${parsed && h12 === h ? ' sel' : ''}`} onClick={() => setHour12(h)}>{pad(h)}</button>
            ))}
          </div>
          <div className="dtp-label">Minit</div>
          <div className="dtp-times cols6">
            {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
              <button key={m} type="button" className={`dtp-t${parsed && current.mi === m ? ' sel' : ''}`} onClick={() => emit({ mi: m })}>{pad(m)}</button>
            ))}
          </div>
          <div className="dtp-row">
            <label className="dtp-exact">
              Tepat:
              <input
                type="number"
                min={0}
                max={59}
                value={parsed ? current.mi : ''}
                onChange={(e) => {
                  const n = Math.min(59, Math.max(0, parseInt(e.target.value || '0', 10) || 0));
                  emit({ mi: n });
                }}
              />
            </label>
            <div className="dtp-ampm">
              <button type="button" className={`dtp-t${parsed && !isPm ? ' sel' : ''}`} onClick={() => setMeridiem(false)}>AM</button>
              <button type="button" className={`dtp-t${parsed && isPm ? ' sel' : ''}`} onClick={() => setMeridiem(true)}>PM</button>
            </div>
          </div>

          <div className="dtp-foot">
            <button type="button" className="dtp-link" onClick={() => { onChange(''); setOpen(false); }}>Kosongkan</button>
            <button type="button" className="dtp-link" onClick={() => {
              const n = new Date();
              onChange(format({ y: n.getFullYear(), mo: n.getMonth(), d: n.getDate(), h: n.getHours(), mi: n.getMinutes() }));
              setView({ y: n.getFullYear(), mo: n.getMonth() });
            }}>Sekarang</button>
            <button type="button" className="dtp-done" onClick={() => setOpen(false)}>Selesai</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default DateTimeField;
