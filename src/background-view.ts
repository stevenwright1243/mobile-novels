/**
 * Portrait background settings (picker window): sliders for how the
 * background is zoomed and positioned in the portrait (see `ZoneView`), and
 * the "Shown in portrait" box that outlines the part that makes it onto the
 * phone. Changes go to main, which passes them on to the portrait to redraw.
 */

import { placeInZone } from './zone-view';

const fillSlider = document.querySelector<HTMLInputElement>('#bg-fill')!;
const xSlider = document.querySelector<HTMLInputElement>('#bg-x')!;
const ySlider = document.querySelector<HTMLInputElement>('#bg-y')!;
const resetButton = document.querySelector<HTMLButtonElement>('#bg-reset')!;
const outline = document.querySelector<HTMLDivElement>(
  '.outline[data-region="background"]',
)!;
const visibleArea = outline.querySelector<HTMLDivElement>('.visible-area')!;

// Fills the zone, trimmed evenly on both sides (as in profiles.ts).
const DEFAULT_VIEW: ZoneView = { fill: 1, x: 0.5, y: 0.5 };

let view = DEFAULT_VIEW;
// The portrait's background zone size; null until the portrait reports it.
let zoneSize: Size | null = null;
// Whether a game is picked, so there's something to adjust.
let enabled = false;

export function enableBackgroundControls() {
  enabled = true;
  fillSlider.disabled = false;
  resetButton.disabled = false;
  showVisibleArea();
}

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
    view,
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

  // Left / Right only does something when the sides are trimmed, and Top /
  // Bottom when the top and bottom are.
  xSlider.disabled = !enabled || right - left >= width - 1;
  ySlider.disabled = !enabled || bottom - top >= height - 1;
}

function showView() {
  fillSlider.value = String(view.fill);
  xSlider.value = String(view.x);
  ySlider.value = String(view.y);
  showVisibleArea();
}

// Any slider moved: `input` fires continuously while dragging, so the
// portrait follows live.
function applySliders() {
  view = {
    fill: fillSlider.valueAsNumber,
    x: xSlider.valueAsNumber,
    y: ySlider.valueAsNumber,
  };
  window.vn.setBackgroundView(view);
  showVisibleArea();
}

for (const slider of [fillSlider, xSlider, ySlider]) {
  slider.addEventListener('input', applySliders);
}

resetButton.addEventListener('click', () => {
  view = DEFAULT_VIEW;
  window.vn.setBackgroundView(view);
  showView();
});

// A game's saved settings arrive from main when it's picked.
window.vn.onBackgroundViewChanged((newView) => {
  view = newView;
  showView();
});
window.vn.getBackgroundView().then((initialView) => {
  view = initialView;
  showView();
});

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
