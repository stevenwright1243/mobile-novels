/**
 * The "Portrait view" box (picker window): outlines, inside the
 * background region in the preview, the part of the background that makes
 * it onto the phone. The background is centered left to right
 * (`BACKGROUND_VIEW`); how much of its width shows and its height are the
 * game's own, set with the "Portrait width" and "Portrait height" sliders
 * here (each a slider with an exact percent field; changes go to main,
 * which passes them on to the portrait). What's shown depends on those and
 * on the shape of the portrait's background zone, which the portrait
 * reports through main.
 */

import { BACKGROUND_VIEW, placeInZone } from './zone-view';

const outline = document.querySelector<HTMLDivElement>(
  '.outline[data-region="background"]',
)!;
const visibleArea = outline.querySelector<HTMLDivElement>('.visible-area')!;

// Where the background sits, top (0) to bottom (1): the game's
// `backgroundY`; and how much of its width shows: its `backgroundWidth`.
let backgroundY = BACKGROUND_VIEW.y;
let backgroundWidth = BACKGROUND_VIEW.width!;
// Whether a game is picked, so there's something to adjust.
let enabled = false;

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
    { ...BACKGROUND_VIEW, width: backgroundWidth, y: backgroundY },
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

// Wires a slider and its percent field to one of the two settings: `get`
// and `set` read and change it here, `send` passes a change to main.
// Returns a function that shows the current value in both. Typing applies
// as you go, but only values in range (as in text-style.ts); Enter or
// leaving the field applies what's there, kept in range.
function linkPercent(
  sliderId: string,
  get: () => number,
  set: (value: number) => void,
  send: (value: number) => void,
) {
  const slider = document.querySelector<HTMLInputElement>(`#${sliderId}`)!;
  const field = document.querySelector<HTMLInputElement>(
    `#${sliderId}-percent`,
  )!;
  const min = Number(slider.min);
  const max = Number(slider.max);

  // `except` skips a field the user is typing in, so it isn't rewritten
  // under them.
  const show = (except?: HTMLInputElement) => {
    slider.value = String(get());
    if (field !== except) {
      field.value = String(Math.round(get() * 100));
    }
    slider.disabled = !enabled;
    field.disabled = !enabled;
    showVisibleArea();
  };
  const apply = (value: number, except?: HTMLInputElement) => {
    set(Math.min(max, Math.max(min, value)));
    send(get());
    show(except);
  };

  // `input` fires continuously while dragging, so the portrait follows live.
  slider.addEventListener('input', () => apply(slider.valueAsNumber));
  field.addEventListener('input', () => {
    const value = field.valueAsNumber / 100;
    if (value >= min && value <= max) {
      apply(value, field);
    }
  });
  field.addEventListener('change', () => {
    if (Number.isFinite(field.valueAsNumber)) {
      apply(field.valueAsNumber / 100);
    }
    show();
  });
  return show;
}

const showY = linkPercent(
  'background-y',
  () => backgroundY,
  (y) => (backgroundY = y),
  (y) => window.vn.setBackgroundY(y),
);
const showWidth = linkPercent(
  'background-width',
  () => backgroundWidth,
  (width) => (backgroundWidth = width),
  (width) => window.vn.setBackgroundWidth(width),
);

export function enableBackgroundY() {
  enabled = true;
  showY();
  showWidth();
}

// A game's saved height and width arrive from main when it's picked.
function receiveY(y: number) {
  backgroundY = y;
  showY();
}
window.vn.onBackgroundYChanged(receiveY);
window.vn.getBackgroundY().then(receiveY);

function receiveWidth(width: number) {
  backgroundWidth = width;
  showWidth();
}
window.vn.onBackgroundWidthChanged(receiveWidth);
window.vn.getBackgroundWidth().then(receiveWidth);

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
