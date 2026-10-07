import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// First-visit walkthrough for the booking page. It spotlights each chip of the
// "Kemajuan tempahan" bar (always on screen, including on step 4) and explains
// the step in a card at the bottom. Static and client-only: no server cost.
// Shown once per browser (localStorage); the "Cara Tempah" button replays it.

const SEEN_KEY = 'kks.bookingTourSeen';

interface TourStep {
  /** 1-4 = chip in the progress bar; null = centred card with no spotlight. */
  chip: number | null;
  title: string;
  body: React.ReactNode;
}

const STEPS: TourStep[] = [
  {
    chip: null,
    title: 'Cara tempah pancang',
    body: <>Tempahan mengambil masa beberapa minit sahaja dan ada <strong>4 langkah</strong>. Kami akan tunjukkan setiap satu.</>,
  },
  {
    chip: 1,
    title: 'Langkah 1 — Pilih Pertandingan',
    body: <>Pilih pertandingan yang tempahannya sedang dibuka. Tarikh, masa dan yuran dipaparkan pada setiap kad.</>,
  },
  {
    chip: 2,
    title: 'Langkah 2 — Pilih Kolam',
    body: <>Pilih kolam yang anda mahu. Bilangan pancang kosong ditunjukkan pada setiap kolam.</>,
  },
  {
    chip: 3,
    title: 'Langkah 3 — Pilih Tempat',
    body: <>Tekan <strong>Buka Peta Pancang</strong> dan pilih satu atau lebih pancang yang masih kosong. Pancang yang sudah ditempah tidak boleh dipilih.</>,
  },
  {
    chip: 4,
    title: 'Langkah 4 — Maklumat & Bayaran',
    body: (
      <>
        Tekan <strong>Teruskan</strong>; pancang anda ditahan <strong>10 minit</strong>. Kemudian:
        <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
          <li>Imbas <strong>QR pembayaran</strong> (boleh dibesarkan &amp; disimpan).</li>
          <li>Muat naik <strong>resit</strong> dan isi no. rujukan bank.</li>
          <li>Tandakan persetujuan dan tekan hantar.</li>
        </ol>
        Kami semak bayaran, kemudian anda terima e-mel pengesahan dengan <strong>QR setiap peg</strong>.
      </>
    ),
  },
];

const PAD = 8;

const BookingTour: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[index];

  // First visit only. Delay slightly so the page has laid out.
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* storage blocked — treat as unseen */ }
    if (seen) return;
    const timer = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setIndex(0);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  }, []);

  const measure = useCallback(() => {
    if (step.chip == null) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`.bk-progress > :nth-child(${step.chip})`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step.chip]);

  // Bring the chip into view, then track it while the page scrolls/resizes.
  useLayoutEffect(() => {
    if (!open) return;
    if (step.chip != null) {
      document.querySelector<HTMLElement>(`.bk-progress > :nth-child(${step.chip})`)
        ?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, index, step.chip, measure]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(STEPS.length - 1, i + 1));
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const last = index === STEPS.length - 1;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0 -4px' }}>
        <button type="button" className="btn btn-light btn-sm" onClick={() => { setIndex(0); setOpen(true); }}>
          <i className="fa-solid fa-circle-question"></i> Cara Tempah
        </button>
      </div>
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Panduan cara tempah" style={{ position: 'fixed', inset: 0, zIndex: 10000 }}>
          {/* Dim layer: a spotlight cut-out when a chip is targeted, flat dim otherwise. */}
          {rect ? (
            <div
              style={{
                position: 'fixed',
                left: rect.left - PAD, top: rect.top - PAD,
                width: rect.width + PAD * 2, height: rect.height + PAD * 2,
                borderRadius: 14, border: '2px solid #fcd34d',
                boxShadow: '0 0 0 9999px rgba(8,16,28,0.72)',
                pointerEvents: 'none', transition: 'all .2s ease',
              }}
            />
          ) : (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,16,28,0.72)' }} />
          )}
          {/* Click-catcher so the page underneath can't be used mid-tour. */}
          <div style={{ position: 'fixed', inset: 0 }} onClick={(e) => e.stopPropagation()} />
          <div
            style={{
              position: 'fixed', left: '50%', transform: 'translateX(-50%)',
              ...(step.chip == null ? { top: '50%', marginTop: -110 } : { bottom: 16 }),
              width: 'min(440px, calc(100vw - 24px))', maxHeight: '60vh', overflowY: 'auto',
              background: '#fff', color: '#112a41', borderRadius: 16, padding: '18px 20px',
              boxShadow: '0 20px 50px rgba(0,0,0,.4)', fontSize: 14, lineHeight: 1.6,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#c1121f', marginBottom: 4 }}>
              {index + 1} / {STEPS.length}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{step.title}</div>
            <div>{step.body}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={close}>Langkau</button>
              <span style={{ flex: 1 }} />
              {index > 0 && (
                <button type="button" className="btn btn-light btn-sm" onClick={() => setIndex(index - 1)}>Kembali</button>
              )}
              <button type="button" className="btn btn-red btn-sm" onClick={() => (last ? close() : setIndex(index + 1))}>
                {last ? 'Faham, mula tempah' : 'Seterusnya'}
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
