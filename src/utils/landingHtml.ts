import DOMPurify from 'dompurify';

const FORBIDDEN_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'meta',
  'link',
  'base',
];

/**
 * Sanitize administrator-authored landing-page HTML before it crosses into
 * React's dangerouslySetInnerHTML boundary. The HTML profile excludes SVG and
 * MathML, while DOMPurify also removes event handlers and unsafe URL schemes.
 */
export const sanitizeLandingHtml = (html: string): string => {
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    ALLOW_DATA_ATTR: false,
  });

  // DOMPurify protects HTML attributes and URI-bearing attributes. Inline CSS
  // is intentionally supported for CMS layouts, but URL-like CSS constructs
  // are removed so styles cannot become a second remote/executable channel.
  const template = document.createElement('template');
  template.innerHTML = sanitized;
  template.content.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const style = element.getAttribute('style') || '';
    if (/(?:url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding)/i.test(style)) {
      element.removeAttribute('style');
    }
  });
  template.content.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]').forEach((link) => {
    link.rel = 'noopener noreferrer';
  });
  return template.innerHTML;
};
