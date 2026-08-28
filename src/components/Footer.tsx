import React from 'react';
import { Settings } from '../types';
import { asset } from '../config/landingAssets';
import CustomLandingHtml from './CustomLandingHtml';

interface FooterProps {
  settings: Settings;
  onNavigate: (section: string) => void;
}

const Footer: React.FC<FooterProps> = ({ settings, onNavigate }) => {
  return (
    <footer className="kks-footer">
      {settings.landingSections.footer.mode === 'html' ? (
        <CustomLandingHtml section="footer" html={settings.landingSections.footer.html} containerClassName="kks-footer-container" />
      ) : (
      <div className="kks-footer-container">
        <div className="kks-footer-grid">
          <div className="kks-footer-brand">
            <div className="kks-footer-logo">
              <img src={asset('footerLogo', settings)} alt="Kolam Keli Sayang" />
            </div>
            <p className="kks-preserve-lines">{settings.footerTagline}</p>
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
              {settings.phone && <strong className="kks-footer-phone">{settings.phone}</strong>}
              {settings.email && <>{settings.email}<br /></>}
              Waktu Operasi : 9:00 pagi &ndash; 5:30 petang
            </p>
          </div>
        </div>
        <div className="kks-footer-copy">
          {new Date().getFullYear()} All Rights Reserved by Kolam Keli Sayang.
        </div>
      </div>
      )}
    </footer>
  );
};

export default Footer;
