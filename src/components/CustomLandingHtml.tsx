import React, { useMemo } from 'react';
import { LandingSectionKey } from '../types';
import { sanitizeLandingHtml } from '../utils/landingHtml';

interface CustomLandingHtmlProps {
  html: string;
  section: LandingSectionKey;
  containerClassName?: string;
}

const CustomLandingHtml: React.FC<CustomLandingHtmlProps> = ({ html, section, containerClassName = 'kks-container' }) => {
  const sanitizedHtml = useMemo(() => sanitizeLandingHtml(html), [html]);

  return (
    <div
      className={`${containerClassName} kks-custom-html kks-custom-html--${section}`}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};

export default CustomLandingHtml;
