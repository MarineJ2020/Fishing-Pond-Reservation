import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Walkthrough for the booking page. It spotlights the real parts of the page
// (data-tour="…" targets) and explains them in a card. Two short tours:
//   • select  — choose pertandingan, pancang, then Teruskan
//   • details — why phone/e-mel are needed, how to pay, upload the receipt
// Each opens automatically once per browser (localStorage) and can be skipped;
// the "Cara Tempah" button replays the tour for the current page. Client-only,
// so no server cost.

export type TourPhase = 'select' | 'details';

interface TourStep {
  /** CSS selector of the element to spotlight; null/missing = centred card. */
  target?: string;
  /** If the target is not on screen yet (e.g. the pond panel before a competition is chosen). */
  fallbackChip?: number;
  title: string;
  body: React.ReactNode;
}

const FLOWS: Record<TourPhase, TourStep[]> = {
  select: [
    {
      title: 'Cara tempah pancang',
      body: <>Tempahan ada <strong>4 langkah</strong>. Kami tunjukkan di mana untuk memilih pertandingan dan pancang, kemudian cara bayaran.</>,
    },
    {
      target: '[data-tour="competition"]',
      fallbackChip: 1,
      title: 'Pilih pertandingan',
      body: <>Di sini anda pilih <strong>pertandingan</strong> yang tempahannya sedang dibuka. Tarikh, masa dan yuran ditunjukkan pada setiap kad. Menukar pertandingan akan set semula pilihan kolam dan pancang.</>,
    },
    {
      target: '[data-tour="pond"]',
      fallbackChip: 2,
      title: 'Pilih kolam',
      body: <>Selepas pilih pertandingan, bahagian <strong>kolam</strong> muncul. Pilih kolam yang anda mahu; bilangan pancang kosong ditunjukkan pada setiap kolam.</>,
    },
    {
      target: '[data-tour="seat"]',
      fallbackChip: 3,
      title: 'Pilih pancang',
      body: <>Tekan <strong>Buka Peta Pancang</strong> dan pilih satu atau lebih pancang yang masih kosong. Pancang yang sudah ditempah tidak boleh dipilih.</>,
    },
    {
      target: '[data-tour="summary"]',
      title: 'Semak & teruskan',
      body: <>Ringkasan menunjukkan pertandingan, pancang dan <strong>jumlah bayaran</strong>. Tekan <strong>Teruskan</strong>; pancang anda ditahan <strong>10 minit</strong> sementara anda membuat bayaran.</>,
    },
  ],
  details: [
    {
      target: '[data-tour="contact"]',
      title: 'Kenapa perlu nombor telefon & e-mel?',
      body: (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>E-mel:</strong> pengesahan tempahan dan <strong>QR setiap peg</strong> dihantar ke e-mel ini. Anda perlukan QR itu untuk check-in dan timbang ikan.</li>
          <li><strong>Telefon:</strong> staf menghubungi anda jika ada masalah bayaran atau perubahan pada tempahan.</li>
          <li>Pastikan kedua-duanya betul. Boleh dikemas kini di <strong>Profil</strong>.</li>
        </ul>
      ),
    },
    {
      target: '[data-tour="payment"]',
      title: 'Cara membayar',
      body: <>Bayar jumlah yang <strong>tepat</strong> melalui <strong>DuitNow QR</strong> atau pemindahan bank ke akaun di sini. Tekan imej QR untuk membesarkan dan menyimpannya ke galeri, supaya boleh dimuat naik dalam aplikasi bank.</>,
    },
    {
      target: '[data-tour="receipt"]',
      title: 'Muat naik slip bayaran',
      body: (
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>Muat naik <strong>slip bayaran / tangkapan skrin</strong> bayaran (JPG, PNG atau PDF).</li>
          <li>Isi <strong>No. Rujukan Bank</strong> daripada slip bayaran.</li>
          <li>Tandakan persetujuan syarat, kemudian tekan hantar.</li>
          <li>Kami semak bayaran dan hantar e-mel pengesahan.</li>
        </ol>
      ),
    },
  ],
};

const SEEN_KEYS: Record<TourPhase, string> = {
  select: 'kks.bookingTourSeen',
  details: 'kks.bookingTourDetailsSeen',
};

const PAD = 8;

const readSeen = (phase: TourPhase): boolean => {
  try { return localStorage.getItem(SEEN_KEYS[phase]) === '1'; } catch { return false; }
};
const markSeen = (phase: TourPhase) => {
  try { localStorage.setItem(SEEN_KEYS[phase], '1'); } catch { /* ignore */ }
};

const findTarget = (step: TourStep): HTMLElement | null => {
  if (step.target) {
    const el = document.querySelector<HTMLElement>(step.target);
    if (el) return el;
  }
  if (step.fallbackChip) return document.querySelector<HTMLElement>(`.bk-progress > :nth-child(${step.fallbackChip})`);
  return null;
};

const BookingTour: React.FC<{ phase: TourPhase }> = ({ phase }) => {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const steps = FLOWS[phase];
  const step = steps[Math.min(index, steps.length - 1)];
  // True when the real panel is missing and a progress chip is shown instead.
  const usingFallback = !!step.target && !!step.fallbackChip && !document.querySelector(step.target);

  // Open once per phase on first sight; a phase change closes the previous tour.
  useEffect(() => {
    setOpen(false);
    setIndex(0);
    if (readSeen(phase)) return;
    const timer = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const close = useCallback(() => {
    setOpen(false);
    setIndex(0);
    markSeen(phase);
  }, [phase]);

  const measure = useCallback(() => {
    const el = findTarget(step);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  // Bring the target into view, then measure once the page has settled. The site
  // sets `html { scroll-behavior: smooth }`, so scrolling must be forced to
  // 'instant'; otherwise the rect was measured mid-animation and the spotlight and
  // card kept drifting up and down. Manual scrolling is locked while open, so no
  // scroll listener is needed.
  useLayoutEffect(() => {
    if (!open) return;
    const el = findTarget(step);
    if (el) {
      const r = el.getBoundingClientRect();
      const wanted = r.height > window.innerHeight * 0.55
        ? r.top - 100
        : r.top - (window.innerHeight - r.height) / 2;
      window.scrollTo({ top: Math.max(0, window.scrollY + wanted), behavior: 'instant' as ScrollBehavior });
    }
    measure();
    // Re-measure after layout settles (images, sticky header, panel animations).
    const timers = [window.setTimeout(measure, 60), window.setTimeout(measure, 300)];
    window.addEventListener('resize', measure);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', measure);
    };
  }, [open, index, step, measure]);

  // Lock manual scrolling while the tour is open so the spotlight and card stay
  // put (the tour scrolls the page itself between steps). Wheel/touch/keys are
  // blocked everywhere except inside the explanation card, which may scroll.
  useEffect(() => {
    if (!open) return;
    const insideCard = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.('[data-tour-card]');
    const block = (event: Event) => { if (!insideCard(event.target)) event.preventDefault(); };
    const blockKeys = (event: KeyboardEvent) => {
      if ([' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) event.preventDefault();
    };
    // Hiding the page overflow also removes the scrollbar, so it can't be dragged.
    // The scrollbar's width is added back as padding so nothing shifts sideways.
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    const prevPadding = root.style.paddingRight;
    const barWidth = window.innerWidth - root.clientWidth;
    root.style.overflow = 'hidden';
    if (barWidth > 0) root.style.paddingRight = `${barWidth}px`;
    window.addEventListener('wheel', block, { passive: false });
    window.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('keydown', blockKeys);
    return () => {
      root.style.overflow = prevOverflow;
      root.style.paddingRight = prevPadding;
      window.removeEventListener('wheel', block);
      window.removeEventListener('touchmove', block);
      window.removeEventListener('keydown', blockKeys);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(steps.length - 1, i + 1));
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, steps.length]);

  const last = index === steps.length - 1;
  // Card goes opposite the spotlight so it never covers what it explains.
  const cardAtTop = !!rect && rect.top + rect.height / 2 > window.innerHeight * 0.5;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0 -4px' }}>
        <button type="button" className="btn btn-light btn-sm" onClick={() => { setIndex(0); setOpen(true); }}>
          <i className="fa-solid fa-circle-question"></i> Cara Tempah
        </button>
      </div>
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Panduan cara tempah" style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>
          {rect ? (
            <div
              style={{
                position: 'fixed',
                left: rect.left - PAD, top: rect.top - PAD,
                width: rect.width + PAD * 2, height: rect.height + PAD * 2,
                borderRadius: 14, border: '2px solid #fcd34d',
                boxShadow: '0 0 0 9999px rgba(8,16,28,0.72)',
                pointerEvents: 'none',
              }}
            />
          ) : (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,16,28,0.72)' }} />
          )}
          {/* Click-catcher so the page underneath can't be used mid-tour. */}
          <div style={{ position: 'fixed', inset: 0 }} onClick={(e) => e.stopPropagation()} />
          <div
            data-tour-card
            style={{
              position: 'fixed', left: '50%', transform: 'translateX(-50%)',
              ...(!rect ? { top: '50%', marginTop: -110 } : cardAtTop ? { top: 12 } : { bottom: 12 }),
              width: 'min(440px, calc(100vw - 24px))', maxHeight: '48vh', overflowY: 'auto',
              background: '#fff', color: '#112a41', borderRadius: 16, padding: '16px 18px',
              boxShadow: '0 20px 50px rgba(0,0,0,.4)', fontSize: 14, lineHeight: 1.55,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#c1121f', marginBottom: 4 }}>
              {index + 1} / {steps.length}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{step.title}</div>
            <div>{step.body}</div>
            {usingFallback && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: '#6b7280' }}>
                Bahagian ini muncul selepas anda membuat pilihan sebelumnya (ditunjukkan di bar langkah).
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Langkau</button>
              <span style={{ flex: 1 }} />
              {index > 0 && (
                <button type="button" className="btn btn-light btn-sm" onClick={() => setIndex(index - 1)}>Kembali</button>
              )}
              <button type="button" className="btn btn-red btn-sm" onClick={() => (last ? close() : setIndex(index + 1))}>
                {last ? 'Faham' : 'Seterusnya'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default BookingTour;
