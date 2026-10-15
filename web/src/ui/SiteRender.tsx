import { memo } from 'react';
// Official Expo 2030 Riyadh night render, AI-upscaled (Real-ESRGAN x4, then 4000×2250) so it
// stays sharp when zoomed; map coordinates use the 2000×1125 frame.
import photo from '../assets/expo-site-night.jpg';

/**
 * Night-time aerial photo of the Expo site, used as the map base layer and
 * the simulated drone view. Map coordinates are the photo's pixel frame
 * (2000 × 1125). Zone shapes drawn on top are illustrative.
 */
export const SITE_W = 2000;
export const SITE_H = 1125;
export const SITE_PHOTO = photo;

function SiteRenderInner() {
  return (
    <g className="site" aria-hidden="true">
      <rect width={SITE_W} height={SITE_H} fill="#05070B" />
      <image href={photo} x={0} y={0} width={SITE_W} height={SITE_H} preserveAspectRatio="none" />
    </g>
  );
}
export const SiteRender = memo(SiteRenderInner);
