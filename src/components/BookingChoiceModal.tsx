import React from 'react';

interface BookingChoiceModalProps {
  open: boolean;
  onClose: () => void;
  /** Continue to the in-app booking wizard. */
  onWebsite: () => void;
  /** WhatsApp number from settings (any format; non-digits are stripped). */
  whatsapp?: string;
  /** Optional prefilled WhatsApp message. */
  message?: string;
}

/**
 * V5 "Tempah di Website vs WhatsApp" choice popup shown when a booking CTA is
 * tapped. If no WhatsApp number is configured the caller should skip straight
 * to the website flow instead of opening this modal.
 */
const BookingChoiceModal: React.FC<BookingChoiceModalProps> = ({ open, onClose, onWebsite, whatsapp, message }) => {
  if (!open) return null;

  const waDigits = (whatsapp || '').replace(/\D/g, '');
  const waHref = waDigits
    ? `https://wa.me/${waDigits}${message ? `?text=${encodeURIComponent(message)}` : ''}`
    : '';

  return (
    <div className="v5-choice-modal" onClick={onClose}>
      <div className="v5-choice-dialog" role="dialog" aria-modal="true" aria-label="Pilih cara tempahan" onClick={(e) => e.stopPropagation()}>
        <button className="v5-choice-close" type="button" aria-label="Tutup" onClick={onClose}>
          <i className="fa-solid fa-xmark"></i>
        </button>
        <div className="v5-choice-head">
          <div className="bk-eyebrow">Cara Tempahan</div>
          <h2>Pilih Cara Anda Tempah</h2>
          <p>Tempah terus di website untuk pilih seat sendiri, atau hubungi kami di WhatsApp untuk bantuan.</p>
        </div>
        <div className="v5-choice-grid">
          <button
            className="v5-choice-route"
            type="button"
            onClick={() => { onClose(); onWebsite(); }}
          >
            <span className="v5-choice-ico"><i className="fa-solid fa-laptop"></i></span>
            <strong>Tempah di Website</strong>
            <small>Pilih pertandingan, kolam &amp; seat sendiri — siap dalam beberapa minit.</small>
          </button>

          {waHref ? (
            <a
              className="v5-choice-route wa"
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
            >
              <span className="v5-choice-ico"><i className="fa-brands fa-whatsapp"></i></span>
              <strong>WhatsApp Kami</strong>
              <small>Tak pasti? Hubungi admin KKS untuk bantuan tempahan.</small>
            </a>
          ) : (
            <button className="v5-choice-route wa" type="button" disabled>
              <span className="v5-choice-ico"><i className="fa-brands fa-whatsapp"></i></span>
              <strong>WhatsApp Kami</strong>
              <small>Nombor WhatsApp belum ditetapkan.</small>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingChoiceModal;
