import React, { useState } from 'react';
import ZoomableImage from './ZoomableImage';

interface Props {
  title: string;
  /** One or more images; several get Prev/Next page controls. */
  images: string[];
  /** Optional original file (e.g. the PDF) offered as "Muat Turun". */
  downloadUrl?: string;
  onClose: () => void;
}

/** Shared popup for the pond map and the peg-number PDF pages, both zoomable. */
const ImageZoomModal: React.FC<Props> = ({ title, images, downloadUrl, onClose }) => {
  const [page, setPage] = useState(0);
  const multi = images.length > 1;
  const nav: React.CSSProperties = { padding: '6px 14px', fontSize: '0.85rem' };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem', animation: 'fadeIn 0.18s ease',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          background: 'var(--surface, #1a1a2e)', borderRadius: '1rem',
          maxWidth: '900px', width: '100%',
          boxShadow: '0 25px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
          animation: 'slideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {downloadUrl && (
              <a className="btn btn-light btn-sm" href={downloadUrl} target="_blank" rel="noopener noreferrer">
                <i className="fa-solid fa-download"></i> PDF
              </a>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted, #aaa)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
              aria-label="Tutup"
            >
              ×
            </button>
          </div>
        </div>
        <div style={{ padding: '1.25rem', textAlign: 'center' }}>
          <ZoomableImage key={images[page]} src={images[page]} alt={title} height="72dvh" />
          {multi && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 10 }}>
              <button className="btn btn-light btn-sm" style={nav} disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Sebelum</button>
              <span style={{ fontSize: '0.85rem' }}>Halaman {page + 1} / {images.length}</span>
              <button className="btn btn-light btn-sm" style={nav} disabled={page === images.length - 1} onClick={() => setPage((p) => Math.min(images.length - 1, p + 1))}>Seterusnya ›</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageZoomModal;
