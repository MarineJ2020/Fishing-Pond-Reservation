import React from 'react';

/** Google-style search result snippet preview, fed live from CMS draft state. */
export const SeoSnippetPreview: React.FC<{ url: string; title: string; description: string }> = ({ url, title, description }) => {
  const displayTitle = title.length > 60 ? `${title.slice(0, 57)}…` : title;
  const displayDesc = description.length > 160 ? `${description.slice(0, 157)}…` : description;
  return (
    <div style={{ background: '#fff', borderRadius: '8px', padding: '14px 16px', fontFamily: 'arial, sans-serif', border: '1px solid #dfe1e5' }}>
      <div style={{ color: '#202124', fontSize: '13px', marginBottom: '2px' }}>{url}</div>
      <div style={{ color: '#1a0dab', fontSize: '18px', lineHeight: 1.3, marginBottom: '2px' }}>{displayTitle || 'Tajuk halaman'}</div>
      <div style={{ color: '#4d5156', fontSize: '13px', lineHeight: 1.4 }}>{displayDesc || 'Penerangan halaman'}</div>
    </div>
  );
};

/** WhatsApp/Facebook-style link-preview social card, fed live from CMS draft state. */
export const SocialCardPreview: React.FC<{ url: string; title: string; description: string; image?: string }> = ({ url, title, description, image }) => {
  let domain = url;
  try { domain = new URL(url).hostname; } catch { /* ignore invalid preview URL while editing */ }
  return (
    <div style={{ background: '#fff', borderRadius: '10px', overflow: 'hidden', border: '1px solid #dadde1', maxWidth: '360px', fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <div style={{ width: '100%', aspectRatio: '1.91 / 1', background: image ? `url('${image}') center/cover` : 'linear-gradient(135deg, #cfd8dc, #90a4ae)', display: image ? undefined : 'flex', alignItems: 'center', justifyContent: 'center', color: '#546e7a', fontSize: '12px' }}>
        {!image && 'Tiada imej OG'}
      </div>
      <div style={{ padding: '10px 12px', background: '#f2f3f5' }}>
        <div style={{ color: '#65676b', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>{domain}</div>
        <div style={{ color: '#050505', fontSize: '14px', fontWeight: 600, lineHeight: 1.3, marginBottom: '2px' }}>{title || 'Tajuk halaman'}</div>
        <div style={{ color: '#65676b', fontSize: '12px', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{description || 'Penerangan halaman'}</div>
      </div>
    </div>
  );
};
