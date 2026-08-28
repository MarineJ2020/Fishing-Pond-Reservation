import { LandingSectionContent, LandingSectionKey } from '../types';

export const LANDING_SECTION_KEYS: LandingSectionKey[] = [
  'hero',
  'about',
  'competitions',
  'steps',
  'rules',
  'location',
  'footer',
];

export const LANDING_SECTION_LABELS: Record<LandingSectionKey, string> = {
  hero: 'Hero',
  about: 'Tentang Kami',
  competitions: 'Pertandingan',
  steps: 'Cara Tempah',
  rules: 'Syarat & Peraturan',
  location: 'Lokasi',
  footer: 'Footer',
};

export const createDefaultLandingSections = (): Record<LandingSectionKey, LandingSectionContent> =>
  LANDING_SECTION_KEYS.reduce((sections, key) => {
    sections[key] = { mode: 'fields', html: '' };
    return sections;
  }, {} as Record<LandingSectionKey, LandingSectionContent>);

export const normalizeLandingSections = (
  value: unknown,
): Record<LandingSectionKey, LandingSectionContent> => {
  const defaults = createDefaultLandingSections();
  if (!value || typeof value !== 'object') return defaults;

  const stored = value as Record<string, unknown>;
  LANDING_SECTION_KEYS.forEach((key) => {
    const entry = stored[key];
    if (!entry || typeof entry !== 'object') return;
    const candidate = entry as Partial<LandingSectionContent>;
    defaults[key] = {
      mode: candidate.mode === 'html' ? 'html' : 'fields',
      html: typeof candidate.html === 'string' ? candidate.html : '',
    };
  });
  return defaults;
};
