import React, { useEffect, useRef, useState } from 'react';

const SECTIONS: { id: string; label: string }[] = [
  { id: 'home',         label: 'Home' },
  { id: 'about',        label: 'Tentang' },
  { id: 'competitions', label: 'Pertandingan' },
  { id: 'how',          label: 'Cara\nTempah' },
  { id: 'prizes',       label: 'Hadiah' },
  { id: 'payment',      label: 'Bayaran' },
  { id: 'contact',      label: 'Hubungi' },
];

interface Props {
  onSectionChange: (id: string) => void;
}

const SecondaryMobileNav: React.FC<Props> = ({ onSectionChange }) => {
  const [activeSection, setActiveSection] = useState('home');
  const btnRefs   = useRef<Map<string, HTMLButtonElement>>(new Map());
  const innerRef  = useRef<HTMLDivElement>(null);

  /* ── Scroll progress → CSS custom property on :root ── */
  useEffect(() => {
    const onScroll = () => {
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const p    = docH > 0 ? Math.min(1, window.scrollY / docH) : 0;
      document.documentElement.style.setProperty('--sec-progress', `${(p * 100).toFixed(2)}%`);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.documentElement.style.removeProperty('--sec-progress');
    };
  }, []);

  /* ── Active section via IntersectionObserver ── */
  useEffect(() => {
    const ratios = new Map<string, number>();
    SECTIONS.forEach(s => ratios.set(s.id, 0));

    const obs = new IntersectionObserver(
      entries => {
        entries.forEach(e => ratios.set(e.target.id, e.intersectionRatio));
        let best = 'home', bestR = -1;
        ratios.forEach((r, id) => { if (r > bestR) { bestR = r; best = id; } });
        setActiveSection(prev => (prev === best ? prev : best));
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75] }
    );

    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  /* ── Auto-scroll active button into view ── */
  useEffect(() => {
    const btn   = btnRefs.current.get(activeSection);
    const inner = innerRef.current;
    if (!btn || !inner) return;
    const targetLeft = btn.offsetLeft - inner.clientWidth / 2 + btn.offsetWidth / 2;
    inner.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }, [activeSection]);

  return (
    <div className="sec-nav" role="navigation" aria-label="Navigasi bahagian">

      {/* ── Progress fill ── */}
      <div className="sec-fill" aria-hidden="true" />

      {/* ── Wavy boundary line (SVG) ── */}
      <svg
        className="sec-wave-svg"
        viewBox="-12 0 24 44"
        width="24"
        height="44"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        {/* Glow halo */}
        <path
          d="M0,0 Q-9,7.5 0,15 Q9,22 0,29 Q-9,36 0,44"
          fill="none"
          stroke="rgba(200,146,42,0.35)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        {/* Main wave line (animated via CSS) */}
        <path
          className="sec-wave-path"
          d="M0,0 Q-9,7.5 0,15 Q9,22 0,29 Q-9,36 0,44"
          fill="none"
          stroke="rgba(240,192,96,0.9)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>

      {/* ── Section buttons ── */}
      <div ref={innerRef} className="sec-nav-inner">
        {SECTIONS.map(({ id, label }) => (
          <button
            key={id}
            ref={el => { if (el) btnRefs.current.set(id, el); else btnRefs.current.delete(id); }}
            className={`sec-nav-btn${activeSection === id ? ' active' : ''}`}
            onClick={() => onSectionChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SecondaryMobileNav;
