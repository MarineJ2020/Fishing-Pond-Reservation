import React from 'react';

interface DocPreviewModalProps {
  /** Document URL (PDF or image). When null/empty the modal is closed. */
  url: string | null;
  title?: string;
  onClose: () => void;
}

const isPdfUrl = (url: string) =>
  /\.pdf($|\?)/i.test(url) || url.startsWith('data:application/pdf');

/**
 * Shared in-app document viewer. Renders PDFs in an iframe and images inline
 * inside a modal popup instead of opening a new browser tab. A "buka di tab
 * baharu" link is kept as a fallback for clients that can't render inline.
 */
const DocPreviewModal: React.FC<DocPreviewModalProps> = ({ url, title, onClose }) => {
  if (!url) return null;
  const pdf = isPdfUrl(url);

  return (
    <div className="doc-preview-modal" onClick={onClose}>
      <div className="doc-preview-dialog" role="dialog" aria-modal="true" aria-label={title || 'Dokumen'} onClick={(e) => e.stopPropagation()}>
        <div className="doc-preview-head">
          <strong>{title || (pdf ? 'Dokumen PDF' : 'Imej')}</strong>
          <div className="doc-preview-actions">
            <a className="btn btn-light btn-sm" href={url} target="_blank" rel="noopener noreferrer">
              <i className="fa-solid fa-up-right-from-square"></i> Tab Baharu
            </a>
            <button className="doc-preview-close" type="button" aria-label="Tutup" onClick={onClose}>
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>
        <div className="doc-preview-body">
          {pdf ? (
            <iframe title={title || 'Dokumen PDF'} src={url} className="doc-preview-frame" />
          ) : (
            <img src={url} alt={title || 'Imej'} className="doc-preview-img" />
          )}
        </div>
      </div>
    </div>
  );
};

export default DocPreviewModal;
