/**
 * The "Portrait view" box (picker window): outlines, inside the
 * background region in the preview, the part of the background that makes
 * it onto the phone. The background's zoom and position are fixed
 * (`BACKGROUND_VIEW`); what's shown depends on them and on the shape of the
 * portrait's background zone, which the portrait reports through main.
 */

import { BACKGROUND_VIEW, placeInZone } from './zone-view';

const outline = document.querySelector<HTMLDivElement>(
  '.outline[data-region="background"]',
)!;
const visibleArea = outline.querySelector<HTMLDivElement>('.visible-area')!;

// The portrait's background zone size; null until the portrait reports it.
let zoneSize: Size | null = null;

// Outlines the part of the background the portrait shows. The outline's
// shape on screen matches the region's shape in game pixels, so its size can
// stand in for the region's.
function showVisibleArea() {
  const width = outline.clientWidth;
  const height = outline.clientHeight;
  if (!zoneSize || !width || !height) {
    visibleArea.hidden = true;
    return;
  }
  const { scale, dx, dy } = placeInZone(
    width,
    height,
    zoneSize.width,
    zoneSize.height,
    BACKGROUND_VIEW,
  );
  // The zone's edges, mapped back onto the region and kept inside it.
  const left = Math.max(0, -dx / scale);
  const top = Math.max(0, -dy / scale);
  const right = Math.min(width, (zoneSize.width - dx) / scale);
  const bottom = Math.min(height, (zoneSize.height - dy) / scale);

  visibleArea.hidden = false;
  visibleArea.style.left = `${(left / width) * 100}%`;
  visibleArea.style.top = `${(top / height) * 100}%`;
  visibleArea.style.width = `${((right - left) / width) * 100}%`;
  visibleArea.style.height = `${((bottom - top) / height) * 100}%`;
}

window.vn.onBackgroundZoneSizeChanged((size) => {
  zoneSize = size;
  showVisibleArea();
});
window.vn.getBackgroundZoneSize().then((size) => {
  zoneSize ??= size;
  showVisibleArea();
});

// The region was moved, resized or zoomed: the shown part changes shape too.
new ResizeObserver(showVisibleArea).observe(outline);
