/**
 * Landing page image assets.
 *
 * Source files originally provided by the client as Google Drive links — those
 * are listed below for reference. For production we host on Cloudinary (same
 * account used for booking-receipt uploads). When the Cloudinary URLs are
 * ready, replace the `cloudinary` strings; the Drive URLs remain as fallback.
 */

const drive = (id: string) => `https://lh3.googleusercontent.com/d/${id}`;
const driveThumb = (id: string, w = 2000) =>
  `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`;

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
    drive: drive('1-peYEKZdjfMxCxph7NTi0A3Rz2Y9Q9xL'),
  },
  pondBg: {
    cloudinary: '',
    drive: driveThumb('1TEQRIHtwsHuJdJsaWIn1o7FbjJVkovvy'),
  },
  bookingBg: {
    cloudinary: '',
    drive: driveThumb('1xt79FLXTUHrwme--WglCJfxWjnYbdPtT'),
  },
} as const;

type AssetKey = keyof typeof LANDING_ASSETS;

export const asset = (key: AssetKey): string => {
  const entry = LANDING_ASSETS[key];
  return entry.cloudinary || entry.drive;
};
