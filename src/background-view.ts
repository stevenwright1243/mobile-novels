/**
 * The "Portrait view" box (picker window): outlines, inside the
 * background region in the preview, the part of the background that makes
 * it onto the phone. The background's zoom and left/right position are fixed
 * (`BACKGROUND_VIEW`); its height is the game's own, set with the
 * "Portrait height" slider here (a slider with an exact percent field;
 * changes go to main, which passes them on to the portrait). What's shown
 * depends on those and on the shape of the portrait's background zone, which
 * the portrait reports through main.
 */

import { BACKGROUND_VIEW, placeInZone } from './zone-view';

const outline = document.querySelector<HTMLDivElement>(
  '.outline[data-region="background"]',
)!;
const visibleArea = outline.querySelector<HTMLDivElement>('.visible-area')!;
const ySlider = document.querySelector<HTMLInputElement>('#background-y')!;
const yField = document.querySelector<HTMLInputElement>(
  '#background-y-percent',
)!;

// Where the background sits, top (0) to bottom (1): the game's `backgroundY`.
let backgroundY = BACKGROUND_VIEW.y;
// Whether a game is picked, so there's something to adjust.
let enabled = false;

export function enableBackgroundY() {
  enabled = true;
  showY();
}

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
    { ...BACKGROUND_VIEW, y: backgroundY },
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

// Shows the current height in the slider and field. `except` skips a field
// the user is typing in, so it isn't rewritten under them.
function showY(except?: HTMLInputElement) {
  ySlider.value = String(backgroundY);
  if (yField !== except) {
    yField.value = String(Math.round(backgroundY * 100));
  }
  ySlider.disabled = !enabled;
  yField.disabled = !enabled;
  showVisibleArea();
}

function applyY(y: number, except?: HTMLInputElement) {
  backgroundY = Math.min(1, Math.max(0, y));
  window.vn.setBackgroundY(backgroundY);
  showY(except);
}

// `input` fires continuously while dragging, so the portrait follows live.
ySlider.addEventListener('input', () => applyY(ySlider.valueAsNumber));
// Typing applies as you go, but only values in range (as in text-style.ts);
// Enter or leaving the field applies what's there, kept in range.
yField.addEventListener('input', () => {
  const y = yField.valueAsNumber / 100;
  if (y >= 0 && y <= 1) {
    applyY(y, yField);
  }
});
yField.addEventListener('change', () => {
  if (Number.isFinite(yField.valueAsNumber)) {
    applyY(yField.valueAsNumber / 100);
  }
  showY();
});

// A game's saved height arrives from main when it's picked.
function receiveY(y: number) {
  backgroundY = y;
  showY();
}
window.vn.onBackgroundYChanged(receiveY);
window.vn.getBackgroundY().then(receiveY);

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
