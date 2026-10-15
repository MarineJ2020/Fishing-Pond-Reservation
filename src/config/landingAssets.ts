/**
 * Landing page image assets.
 *
 * Source files originally provided by the client as Google Drive links — those
 * are listed below for reference. For production we host on Cloudinary (same
 * account used for booking-receipt uploads). When the Cloudinary URLs are
 * ready, replace the `cloudinary` strings; the Drive URLs remain as fallback.
 */

const drive = (id: string) => `https://lh3.googleusercontent.com/d/${id}`;
// Full-size Drive originals are huge (hero is 1.4 MB). `=w1280-rw` makes Google
// serve a resized WebP (~175 KB). functions/src/seo.js preloads the hero with
// the exact same URL - keep them in sync.
const driveSized = (id: string, w = 1280) => `${drive(id)}=w${w}-rw`;

export const LANDING_ASSETS = {
  logo: {
    cloudinary: '',
    drive: drive('1f031JD0R0LDN1OvBKtlUkjBy5lwzkmXC'),
  },
  footerLogo: {
    cloudinary: '',
    drive: drive('1XP4GY9Drf77O-H5_lCISzMhcuDMmXeSm'),
  },
  heroBg: {
    cloudinary: '',
    drive: driveSized('1-peYEKZdjfMxCxph7NTi0A3Rz2Y9Q9xL'),
  },
  pondBg: {
    cloudinary: '',
    drive: driveSized('1TEQRIHtwsHuJdJsaWIn1o7FbjJVkovvy'),
  },
  bookingBg: {
    cloudinary: '',
    drive: driveSized('1xt79FLXTUHrwme--WglCJfxWjnYbdPtT'),
  },
} as const;

type AssetKey = keyof typeof LANDING_ASSETS;

/**
 * Resolve a landing image URL: CMS-uploaded Storage URL (settings.landingImages)
 * takes priority, then the Cloudinary slot, then the original Drive fallback.
 */
export const asset = (key: AssetKey, settings?: { landingImages?: Partial<Record<AssetKey, string>> }): string => {
  const entry = LANDING_ASSETS[key];
  return settings?.landingImages?.[key] || entry.cloudinary || entry.drive;
};
