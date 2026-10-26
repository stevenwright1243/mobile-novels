/**
 * Portrait background settings (picker window): sliders, each with an exact
 * percent field, for how the background is zoomed and positioned in the
 * portrait (see `ZoneView`), and
 * the "Shown in portrait" box that outlines the part that makes it onto the
 * phone. Changes go to main, which passes them on to the portrait to redraw.
 */

import { placeInZone } from './zone-view';

// Each setting of `ZoneView` has a slider and a percent field, matched by
// id: #bg-fill and #bg-fill-percent, and so on.
const KEYS = ['fill', 'x', 'y'] as const;
const controls = KEYS.map((key) => ({
  key,
  slider: document.querySelector<HTMLInputElement>(`#bg-${key}`)!,
  field: document.querySelector<HTMLInputElement>(`#bg-${key}-percent`)!,
}));
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
  resetButton.disabled = false;
  setDisabled('fill', false);
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
  const { scale, dx, dy, dw, dh } = placeInZone(
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

  // Left / Right does nothing when the picture exactly fits the zone's
  // width (nothing trimmed, no space to move in); the same for Top / Bottom.
  setDisabled('x', !enabled || Math.abs(dw - zoneSize.width) < 1);
  setDisabled('y', !enabled || Math.abs(dh - zoneSize.height) < 1);
  setDisabled('fill', !enabled);
}

// `(typeof KEYS)[number]` is the type of KEYS' items: 'fill' | 'x' | 'y'.
function setDisabled(key: (typeof KEYS)[number], disabled: boolean) {
  for (const control of controls) {
    if (control.key === key) {
      control.slider.disabled = disabled;
      control.field.disabled = disabled;
    }
  }
}

// Percent, to one decimal place: 0.625 -> "62.5".
const percent = (fraction: number) => String(Math.round(fraction * 1000) / 10);

// Shows the current view in the sliders and fields. `except` skips a field
// the user is typing in, so it isn't rewritten under them.
function showView(except?: HTMLInputElement) {
  for (const { key, slider, field } of controls) {
    slider.value = String(view[key]);
    if (field !== except) {
      field.value = percent(view[key]);
    }
  }
  showVisibleArea();
}

function applyView(newView: ZoneView, except?: HTMLInputElement) {
  view = newView;
  window.vn.setBackgroundView(view);
  showView(except);
}

for (const { key, slider, field } of controls) {
  // `input` fires continuously while dragging, so the portrait follows live.
  // `[key]` in brackets uses the variable's value as the property name.
  slider.addEventListener('input', () => {
    applyView({ ...view, [key]: slider.valueAsNumber });
  });

  // Typing applies as you go; anything that isn't a number is ignored until
  // it is. Values are kept between 0 and 100%.
  field.addEventListener('input', () => {
    if (Number.isFinite(field.valueAsNumber)) {
      const value = Math.min(100, Math.max(0, field.valueAsNumber)) / 100;
      applyView({ ...view, [key]: value }, field);
    }
  });
  // Leaving the field (or pressing Enter) tidies what's shown in it.
  field.addEventListener('change', () => showView());
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
