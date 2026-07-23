import { useEffect } from 'react';
import { Settings, SeoPageKey } from '../types';

const SECTION_TO_SEO_KEY: Partial<Record<string, SeoPageKey>> = {
  home: 'home',
  book: 'book',
  live: 'live',
};

const upsertMeta = (attr: 'name' | 'property', key: string, content: string) => {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
};

const upsertLink = (rel: string, href: string) => {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
};

const removeLink = (rel: string) => {
  document.head.querySelector(`link[rel="${rel}"]`)?.remove();
};

/**
 * Client-side head manager for SPA navigation. Idempotently upserts the same
 * <title>/<meta>/<link> elements the seoRender Cloud Function injects into the
 * first-load HTML, so it never fights server-rendered tags — it just keeps
 * them correct as the user navigates between routes without a full reload.
 */
export const useSEO = (section: string, settings: Settings | undefined) => {
  useEffect(() => {
    const seo = settings?.seo;
    const pageKey = SECTION_TO_SEO_KEY[section];

    if (pageKey && seo) {
      const meta = seo.pages[pageKey];
      const siteUrl = (seo.siteUrl || '').replace(/\/$/, '');
      const path = pageKey === 'home' ? '/' : `/${pageKey}`;
      document.title = meta.title;
      upsertMeta('name', 'description', meta.description);
      upsertMeta('name', 'robots', 'index, follow');
      if (siteUrl) upsertLink('canonical', `${siteUrl}${path}`);
      else removeLink('canonical');
    } else {
      document.title = settings?.seo?.siteName || 'Kolam Keli Sayang';
      upsertMeta('name', 'description', '');
      upsertMeta('name', 'robots', 'noindex, nofollow');
      removeLink('canonical');
    }
  }, [section, settings?.seo]);
};
