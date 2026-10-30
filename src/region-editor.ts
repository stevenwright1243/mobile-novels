/**
 * Region editing in the picker window. Each region has an outline over the
 * game preview. In edit mode the chosen region gets handles: drag a handle to
 * resize, drag inside to move, or drag anywhere else (even the black bars
 * around the picture) to draw it fresh. Edges can snap to the picture's sides
 * and to the other regions.
 *
 * For exact placement, the edit panel shows the region in game pixels: type
 * values, use the arrow keys in a field (Shift for steps of 10), or nudge the
 * box with the arrow keys. "Lock size" keeps the width and height fixed so
 * dragging only moves the box.
 */

import { getClientArea } from './capture';

const preview = document.querySelector<HTMLVideoElement>('#preview')!;
const previewArea = document.querySelector<HTMLDivElement>('#preview-area')!;
const frame = document.querySelector<HTMLDivElement>('#frame')!;
// One "Edit ..." button and one outline per region, matched by `data-region`.
const regionButtons = document.querySelectorAll<HTMLButtonElement>(
  'button[data-region]',
);
const outlines = document.querySelectorAll<HTMLDivElement>('.outline');

const editPanel = document.querySelector<HTMLDivElement>('#edit-panel')!;
const snapCheckbox = document.querySelector<HTMLInputElement>('#snap')!;
const lockSizeCheckbox =
  document.querySelector<HTMLInputElement>('#lock-size')!;
const gameSizeLabel = document.querySelector<HTMLSpanElement>('#game-size')!;
// The X / Y / W / H number fields. `keyof Region` is the type 'x' | 'y' |
// 'w' | 'h': the property names of Region.
const fields: Record<keyof Region, HTMLInputElement> = {
  x: document.querySelector('#field-x')!,
  y: document.querySelector('#field-y')!,
  w: document.querySelector('#field-w')!,
  h: document.querySelector('#field-h')!,
};

const buttonLabels: Record<RegionName, string> = {
  background: 'Edit background',
  text: 'Edit text zone',
  name: 'Edit name box',
  page: 'Edit full-screen text',
};

// Called once a game window is picked, since there's nothing to edit before.
export function enableRegionEditing() {
  for (const button of regionButtons) {
    button.disabled = false;
  }
}

// --- Fitting the overlay to the game picture --------------------------------

// Where the game's content is inside the capture (without the title bar).
let clientArea: Region = { x: 0, y: 0, w: 1, h: 1 };

// Re-measure the game's content and crop the preview to it. `object-view-box`
// crops what a <video> shows, in percentages of the full capture.
async function cropToContent() {
  clientArea = await getClientArea();
  const { x, y, w, h } = clientArea;
  const percent = (fraction: number) => `${fraction * 100}%`;
  preview.style.setProperty(
    'object-view-box',
    `inset(${percent(y)} ${percent(1 - x - w)} ${percent(1 - y - h)} ${percent(x)})`,
  );
  fitFrameToPicture();
  showFields();
}

// The preview is letterboxed (`object-fit: contain`), so the game picture
// doesn't fill the whole video element. Work out where it actually is and
// place #frame exactly over it.
function fitFrameToPicture() {
  const { clientWidth, clientHeight } = preview;
  // The size of the cropped picture, in the video's pixels.
  const pictureWidth = preview.videoWidth * clientArea.w;
  const pictureHeight = preview.videoHeight * clientArea.h;
  if (!pictureWidth || !pictureHeight) {
    return;
  }
  const scale = Math.min(
    clientWidth / pictureWidth,
    clientHeight / pictureHeight,
  );
  const width = pictureWidth * scale;
  const height = pictureHeight * scale;
  frame.style.left = `${(clientWidth - width) / 2}px`;
  frame.style.top = `${(clientHeight - height) / 2}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  placeLabels();
}

// Refit when the preview changes size (window resized). Re-measure when the
// video's own size changes (a new window picked, or the game window resized).
new ResizeObserver(fitFrameToPicture).observe(preview);
preview.addEventListener('resize', cropToContent);

// The game's content size in its own pixels (e.g. 1920×1080), or null before
// a capture is playing.
function gameSize() {
  const width = Math.round(preview.videoWidth * clientArea.w);
  const height = Math.round(preview.videoHeight * clientArea.h);
  return width && height ? { width, height } : null;
}

// --- Showing the regions ------------------------------------------------------

// The current regions. Main sends a new set when a game's saved regions are
// loaded; our own edits update it locally.
let regions: Regions | null = null;

// Positions each outline using percentages of #frame, so they stay put when
// #frame resizes.
function showOutlines() {
  if (!regions) {
    return;
  }
  for (const outline of outlines) {
    const region = regions[outline.dataset.region as RegionName];
    outline.style.left = `${region.x * 100}%`;
    outline.style.top = `${region.y * 100}%`;
    outline.style.width = `${region.w * 100}%`;
    outline.style.height = `${region.h * 100}%`;
  }
  placeLabels();
  showFields();
}

// The name box's name goes just above it, unless that would hang off the
// top of the game picture; then it goes inside, in the top left corner
// (the `label-inside` class in index.css). Rechecked whenever a region moves
// or the picture changes size, since the label's size is in screen pixels.
// (The other regions' names sit inside their boxes; see index.css.)
function placeLabels() {
  if (!regions) {
    return;
  }
  const frameHeight = frame.clientHeight;
  for (const outline of outlines) {
    const label = outline.querySelector<HTMLElement>(':scope > span');
    const region = regions[outline.dataset.region as RegionName];
    if (label && outline.dataset.region === 'name') {
      // Where the label's top edge would be, in pixels down the picture
      // (2px for the border it sits outside).
      const top = region.y * frameHeight - 2 - label.offsetHeight;
      outline.classList.toggle('label-inside', top < 0);
    }
  }
}

window.vn.onRegionsChanged((newRegions) => {
  regions = newRegions;
  showOutlines();
});
window.vn.getRegions().then((initialRegions) => {
  regions ??= initialRegions;
  showOutlines();
});

// Resize handles: corners and edge midpoints, named by compass direction.
// `as const` keeps the exact strings, so `Handle` is a type that only allows
// these eight values.
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

for (const outline of outlines) {
  for (const handle of HANDLES) {
    const element = document.createElement('div');
    element.className = 'handle';
    element.dataset.handle = handle;
    outline.append(element);
  }
}

// --- Changing a region ---------------------------------------------------------

// Regions smaller than this (a fraction of the picture) are ignored, so a
// plain click doesn't make an empty region.
const MIN_SIZE = 0.01;

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

// Rounds a region's edges to whole game pixels, so the numbers in the edit
// panel are exact. Rounding the edges (rather than position and size
// separately) keeps two regions that touch exactly touching.
function toWholePixels(region: Region): Region {
  const size = gameSize();
  if (!size) {
    return region;
  }
  const left = Math.round(region.x * size.width);
  const top = Math.round(region.y * size.height);
  const right = Math.max(
    left + 1,
    Math.round((region.x + region.w) * size.width),
  );
  const bottom = Math.max(
    top + 1,
    Math.round((region.y + region.h) * size.height),
  );
  return {
    x: left / size.width,
    y: top / size.height,
    w: (right - left) / size.width,
    h: (bottom - top) / size.height,
  };
}

// Every change to the region being edited (dragging, typing, nudging) comes
// through here.
function applyRegion(region: Region) {
  if (!editing || !regions) {
    return;
  }
  const rounded = toWholePixels(region);
  // `[editing]` in brackets uses the variable's value as the key.
  regions = { ...regions, [editing]: rounded };
  showOutlines();
  // Sent on every change, so the portrait window updates live while
  // dragging. Main saves it for this game once the changes settle.
  window.vn.setRegion(editing, rounded);
}

// --- Edit mode ---------------------------------------------------------------

// Which region is being edited, or null when not in edit mode.
let editing: RegionName | null = null;

function setEditing(region: RegionName | null) {
  editing = region;
  previewArea.classList.toggle('editing', region !== null);
  for (const outline of outlines) {
    outline.classList.toggle('editing', outline.dataset.region === region);
  }
  for (const button of regionButtons) {
    const name = button.dataset.region as RegionName;
    button.textContent = name === region ? 'Done' : buttonLabels[name];
  }
  editPanel.hidden = region === null;
  showFields();
}

for (const button of regionButtons) {
  button.addEventListener('click', () => {
    const name = button.dataset.region as RegionName;
    // Clicking the active button ("Done") leaves edit mode.
    setEditing(editing === name ? null : name);
  });
}

// --- Edit panel: exact numbers -----------------------------------------------

// Fills in the X / Y / W / H fields from the region being edited.
function showFields() {
  const size = gameSize();
  if (!editing || !regions || !size) {
    return;
  }
  const region = regions[editing];
  fields.x.value = String(Math.round(region.x * size.width));
  fields.y.value = String(Math.round(region.y * size.height));
  fields.w.value = String(Math.round(region.w * size.width));
  fields.h.value = String(Math.round(region.h * size.height));
  gameSizeLabel.textContent = `of ${size.width} × ${size.height} px`;
}

// Reads the fields back into a region, keeping it inside the picture.
function applyFields() {
  const size = gameSize();
  if (!size) {
    return;
  }
  // Empty or invalid fields keep their current value.
  for (const input of Object.values(fields)) {
    if (!Number.isFinite(input.valueAsNumber)) {
      showFields();
      return;
    }
  }
  const x = clamp(Math.round(fields.x.valueAsNumber), 0, size.width - 1);
  const y = clamp(Math.round(fields.y.valueAsNumber), 0, size.height - 1);
  const w = clamp(Math.round(fields.w.valueAsNumber), 1, size.width - x);
  const h = clamp(Math.round(fields.h.valueAsNumber), 1, size.height - y);
  applyRegion({
    x: x / size.width,
    y: y / size.height,
    w: w / size.width,
    h: h / size.height,
  });
}

for (const input of Object.values(fields)) {
  // `change` fires when a typed value is committed (Enter, Tab or clicking
  // away) and when the field's spinner arrows are clicked.
  input.addEventListener('change', applyFields);

  // Arrow keys step by 1, or by 10 with Shift held.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    input.value = String((input.valueAsNumber || 0) + step);
    applyFields();
  });
}

// --- Edit panel: snapping and size lock ----------------------------------------

// Remember the snap setting between sessions. Storage can be unavailable, so
// failures are ignored and the default (on) is used.
try {
  snapCheckbox.checked = localStorage.getItem('snap') !== 'off';
} catch {
  // Storage unavailable: keep the default.
}
snapCheckbox.addEventListener('change', () => {
  try {
    localStorage.setItem('snap', snapCheckbox.checked ? 'on' : 'off');
  } catch {
    // Storage unavailable: the setting just won't be remembered.
  }
});

// With the size locked, the W / H fields and the resize handles are disabled,
// and any drag moves the box.
lockSizeCheckbox.addEventListener('change', () => {
  const locked = lockSizeCheckbox.checked;
  fields.w.disabled = locked;
  fields.h.disabled = locked;
  previewArea.classList.toggle('size-locked', locked);
});

// --- Keyboard ------------------------------------------------------------------

// Arrow keys move the box by one game pixel (10 with Shift); Escape finishes.
const ARROW_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    setEditing(null);
    return;
  }
  const arrow = ARROW_KEYS[event.key];
  const size = gameSize();
  // Fields handle their own arrow keys.
  if (!arrow || !editing || !regions || !size) {
    return;
  }
  if (event.target instanceof HTMLInputElement) {
    return;
  }
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  const region = regions[editing];
  applyRegion({
    ...region,
    x: clamp(region.x + (arrow[0] * step) / size.width, 0, 1 - region.w),
    y: clamp(region.y + (arrow[1] * step) / size.height, 0, 1 - region.h),
  });
});

// --- Snapping ----------------------------------------------------------------

// How close, in screen pixels, an edge has to be before it snaps. Pixels on
// purpose: it's about how precisely a hand can aim, not the picture's size.
const SNAP_DISTANCE = 12;

// Snaps a coordinate to the picture's sides or the other regions' edges, if
// one is within SNAP_DISTANCE. Holding Alt flips the "Snap to edges" setting
// for the moment.
function snap(value: number, axis: 'x' | 'y', event: PointerEvent) {
  const snapping = snapCheckbox.checked !== event.altKey;
  if (!snapping || !regions || !editing) {
    return value;
  }
  const targets = [0, 1];
  for (const [name, region] of Object.entries(regions)) {
    // Not to the full-screen text area's edges, which are hidden unless
    // it's the one being edited.
    if (name !== editing && name !== 'page') {
      const start = axis === 'x' ? region.x : region.y;
      const size = axis === 'x' ? region.w : region.h;
      targets.push(start, start + size);
    }
  }
  const rect = frame.getBoundingClientRect();
  const threshold = SNAP_DISTANCE / (axis === 'x' ? rect.width : rect.height);

  let snapped = value;
  let closest = threshold;
  for (const target of targets) {
    const distance = Math.abs(value - target);
    if (distance <= closest) {
      snapped = target;
      closest = distance;
    }
  }
  return snapped;
}

// For a box being moved: snaps whichever of its two edges is closer to a
// target, keeping its size. Returns the new start position.
function snapBox(
  start: number,
  size: number,
  axis: 'x' | 'y',
  event: PointerEvent,
) {
  const startShift = snap(start, axis, event) - start;
  const endShift = snap(start + size, axis, event) - (start + size);
  if (startShift === 0 && endShift === 0) {
    return start;
  }
  if (
    endShift === 0 ||
    (startShift !== 0 && Math.abs(startShift) <= Math.abs(endShift))
  ) {
    return start + startShift;
  }
  return start + endShift;
}

// --- Dragging ----------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

// What the current drag is doing. Each `kind` carries what it needs; checking
// `drag.kind` tells TypeScript which of the three shapes it is (a
// "discriminated union").
type Drag =
  | { kind: 'draw'; start: Point }
  | { kind: 'move'; grab: Point; original: Region }
  | { kind: 'resize'; handle: Handle; original: Region };

let drag: Drag | null = null;

// The pointer's position as fractions (0 to 1) of the game picture. Positions
// outside the picture are pulled onto its edge, so overshooting a corner
// lands exactly on it.
function pointerPosition(event: PointerEvent): Point {
  const rect = frame.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
}

// A region from its four edges, in any order.
function fromEdges(left: number, top: number, right: number, bottom: number) {
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    w: Math.abs(right - left),
    h: Math.abs(bottom - top),
  };
}

// Listening on the whole preview area (not just the picture) lets drags start
// in the black bars.
previewArea.addEventListener('pointerdown', (event) => {
  // Only the main button edits; the middle one moves around when zoomed in
  // (see preview-zoom.ts).
  if (!editing || !regions || event.button !== 0) {
    return;
  }
  const target = event.target as HTMLElement;
  const point = pointerPosition(event);
  const original = regions[editing];

  if (lockSizeCheckbox.checked) {
    // Size locked: inside the box, drag it from where it was grabbed.
    // Anywhere else, the box jumps to center on the pointer, then follows it.
    const inside = target.closest('.outline.editing');
    const grab = inside
      ? point
      : { x: original.x + original.w / 2, y: original.y + original.h / 2 };
    drag = { kind: 'move', grab, original };
    if (!inside) {
      updateDrag(event);
    }
  } else if (target.dataset.handle) {
    drag = {
      kind: 'resize',
      handle: target.dataset.handle as Handle,
      original,
    };
  } else if (target.closest('.outline.editing')) {
    drag = { kind: 'move', grab: point, original };
  } else {
    drag = {
      kind: 'draw',
      start: { x: snap(point.x, 'x', event), y: snap(point.y, 'y', event) },
    };
  }
  // Keep getting pointer events even if the pointer leaves the preview
  // mid-drag.
  previewArea.setPointerCapture(event.pointerId);
});

function updateDrag(event: PointerEvent) {
  if (!drag) {
    return;
  }
  const point = pointerPosition(event);
  let region: Region;

  switch (drag.kind) {
    case 'draw': {
      const { start } = drag;
      region = fromEdges(
        start.x,
        start.y,
        snap(point.x, 'x', event),
        snap(point.y, 'y', event),
      );
      break;
    }
    case 'resize': {
      // Move only the edges this handle controls; the others stay put.
      const { handle, original: o } = drag;
      let left = o.x;
      let top = o.y;
      let right = o.x + o.w;
      let bottom = o.y + o.h;
      if (handle.includes('w')) left = snap(point.x, 'x', event);
      if (handle.includes('e')) right = snap(point.x, 'x', event);
      if (handle.includes('n')) top = snap(point.y, 'y', event);
      if (handle.includes('s')) bottom = snap(point.y, 'y', event);
      region = fromEdges(left, top, right, bottom);
      break;
    }
    case 'move': {
      // Shift by how far the pointer moved, keeping the box inside the
      // picture.
      const { grab, original: o } = drag;
      const x = clamp(o.x + point.x - grab.x, 0, 1 - o.w);
      const y = clamp(o.y + point.y - grab.y, 0, 1 - o.h);
      region = {
        x: snapBox(x, o.w, 'x', event),
        y: snapBox(y, o.h, 'y', event),
        w: o.w,
        h: o.h,
      };
      break;
    }
  }

  if (region.w < MIN_SIZE || region.h < MIN_SIZE) {
    return;
  }
  applyRegion(region);
}

previewArea.addEventListener('pointermove', updateDrag);

function endDrag() {
  drag = null;
}
previewArea.addEventListener('pointerup', endDrag);
previewArea.addEventListener('pointercancel', endDrag);
