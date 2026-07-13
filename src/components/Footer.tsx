import React from 'react';
import { Settings } from '../types';
import { asset } from '../config/landingAssets';

interface FooterProps {
  settings: Settings;
  onNavigate: (section: string) => void;
}

const Footer: React.FC<FooterProps> = ({ settings, onNavigate }) => {
  const whatsappDigits = (settings.whatsapp || settings.phone || '').replace(/[^0-9]/g, '');
  const whatsappHref = whatsappDigits ? `https://wa.me/${whatsappDigits}` : '#';

  return (
    <footer className="kks-footer">
      <div className="kks-footer-container">
        <div className="kks-footer-grid">
          <div className="kks-footer-brand">
            <div className="kks-footer-logo">
              <img src={asset('footerLogo', settings)} alt="Kolam Keli Sayang" />
            </div>
            <p>{settings.footerTagline}</p>
          </div>

          <div className="kks-footer-col">
            <h4>Pintasan</h4>
            <a onClick={() => onNavigate('competitions')}>Pertandingan</a>
            <a onClick={() => onNavigate('how')}>Cara Tempahan</a>
            <a onClick={() => onNavigate('rules')}>Syarat &amp; Peraturan</a>
            <a onClick={() => onNavigate('lokasi')}>Lokasi</a>
          </div>

          <div className="kks-footer-col">
            <h4>Hubungi Kami</h4>
            <p>
              {settings.email && <>{settings.email}<br /></>}
              {settings.phone && <>{settings.phone}<br /></>}
              {settings.whatsapp && settings.whatsapp !== settings.phone && <>{settings.whatsapp}</>}
            </p>
          </div>

          <div className="kks-footer-cta">
            <a className="btn btn-light" href={whatsappHref} target="_blank" rel="noopener noreferrer">
              <i className="fa-brands fa-whatsapp"></i> WhatsApp Us
            </a>
          </div>
        </div>
        <div className="kks-footer-copy">
          {new Date().getFullYear()} All Rights Reserved by Kolam Keli Sayang.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
