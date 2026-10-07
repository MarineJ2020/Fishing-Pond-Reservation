import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { renderQrCardBlob } from '../utils/qrDownload';

// Public landing page for the "Muat turun QR" link in booking emails. The email
// can only carry a bare QR image, so this page draws the full card (QR plus
// competition, time, pond/peg and ref) in the browser and saves it as a PNG.
// No login, no Firestore, no server cost: everything comes from the link.
const QrCardPage: React.FC = () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const value = params.get('v') || '';
  const peg = params.get('t') || '';
  const lines = useMemo(() => {
    const pond = params.get('p');
    const ref = params.get('r');
    return [
      peg ? `No Pancang ${peg}` : '',
      params.get('c') || '',
      params.get('d') || '',
      pond ? `Kolam ${pond}` : '',
      ref ? `Ref: ${ref}` : '',
    ].filter(Boolean);
  }, [params, peg]);
  // Only draw QRs that point at this site's booking pages.
  const valid = value.startsWith(`${window.location.origin}/bookings/`);
  const svgBox = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const filename = `QR-${params.get('r') || 'tempahan'}-${peg || 'peg'}.png`;

  useEffect(() => {
    if (!valid) return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const svg = svgBox.current?.querySelector('svg');
        if (!svg) throw new Error('no svg');
        const blob = await renderQrCardBlob(svg as SVGSVGElement, lines);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImageUrl(url);
        // Save straight away; browsers that block it still show the image below.
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [valid, lines, filename]);

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', display: 'flex', justifyContent: 'center', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, color: '#112a41', margin: '0 0 14px' }}>QR Peg Anda</h1>
        {!valid || error ? (
          <p style={{ color: '#991b1b' }}>Pautan QR tidak sah atau gagal dibuka. Sila buka tempahan anda di laman web untuk memuat turun QR.</p>
        ) : (
          <>
            <div ref={svgBox} style={{ position: 'absolute', left: -9999, top: 0 }} aria-hidden="true">
              <QRCodeSVG value={value} size={160} level="M" marginSize={2} bgColor="#ffffff" fgColor="#112a41" />
            </div>
            {imageUrl ? (
              <>
                <img src={imageUrl} alt="Kad QR peg" style={{ width: '100%', borderRadius: 12, border: '1px solid #dde3e8', background: '#fff' }} />
                <a
                  href={imageUrl}
                  download={filename}
                  style={{ display: 'inline-block', marginTop: 14, background: '#c1121f', color: '#fff', padding: '12px 22px', borderRadius: 8, fontWeight: 700, textDecoration: 'none' }}
                >
                  ⬇ Muat turun QR
                </a>
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 10 }}>Jika tidak tersimpan, tekan lama pada gambar dan pilih simpan.</p>
              </>
            ) : (
              <p style={{ color: '#6b7280' }}>Menyediakan QR…</p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default QrCardPage;
