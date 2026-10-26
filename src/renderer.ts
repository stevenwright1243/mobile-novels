/**
 * Runs in the page (the "renderer" process). No Node or Electron APIs here;
 * anything from main has to come through `window.vn` (see preload.ts).
 */

import './index.css';
import { getClientArea, playCapture } from './capture';

// The `!` tells TypeScript "this element definitely exists", since
// querySelector would otherwise be typed as possibly null.
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')!;
const windowList = document.querySelector<HTMLUListElement>('#window-list')!;
const preview = document.querySelector<HTMLVideoElement>('#preview')!;
const frame = document.querySelector<HTMLDivElement>('#frame')!;
// One "Set ..." button and one outline per region, matched by `data-region`.
const regionButtons = document.querySelectorAll<HTMLButtonElement>(
  'button[data-region]',
);
const outlines = document.querySelectorAll<HTMLDivElement>('.outline');

async function showWindowList() {
  const sources = await window.vn.listWindows();
  windowList.replaceChildren(
    ...sources.map((source) => {
      const img = document.createElement('img');
      img.src = source.thumbnail;
      const label = document.createElement('span');
      label.textContent = source.name;

      const button = document.createElement('button');
      button.append(img, label);
      button.addEventListener('click', () => {
        window.vn.selectSource({ id: source.id, name: source.name });
        playCapture(preview, source.id);
        for (const regionButton of regionButtons) {
          regionButton.disabled = false;
        }
      });

      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
}

refreshButton.addEventListener('click', showWindowList);
showWindowList();

// --- Regions ---------------------------------------------------------------

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
}

// Refit when the preview changes size (window resized). Re-measure when the
// video's own size changes (a new window picked, or the game window resized).
new ResizeObserver(fitFrameToPicture).observe(preview);
preview.addEventListener('resize', cropToContent);

// The current regions. Main sends a new set when a game's saved regions are
// loaded; our own drags update it locally.
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
}

window.vn.onRegionsChanged((newRegions) => {
  regions = newRegions;
  showOutlines();
});
window.vn.getRegions().then((initialRegions) => {
  regions ??= initialRegions;
  showOutlines();
});

const clamp = (n: number) => Math.min(1, Math.max(0, n));

interface Point {
  x: number;
  y: number;
}

// How close, in screen pixels, an edge has to be before it snaps.
const SNAP_DISTANCE = 12;

// The closest of `targets` within `threshold` of `value`, or `value` itself
// if none are that close.
function snapValue(value: number, targets: number[], threshold: number) {
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

// The pointer's position as fractions (0 to 1) of the game picture, snapped
// to the picture's sides and to the edges of the other regions. Hold Alt to
// place it freely.
function pointerPosition(event: PointerEvent, drawing: RegionName): Point {
  const rect = frame.getBoundingClientRect();
  const point = {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
  if (event.altKey || !regions) {
    return point;
  }

  const xTargets = [0, 1];
  const yTargets = [0, 1];
  for (const outline of outlines) {
    const name = outline.dataset.region as RegionName;
    if (name !== drawing) {
      const { x, y, w, h } = regions[name];
      xTargets.push(x, x + w);
      yTargets.push(y, y + h);
    }
  }
  return {
    x: snapValue(point.x, xTargets, SNAP_DISTANCE / rect.width),
    y: snapValue(point.y, yTargets, SNAP_DISTANCE / rect.height),
  };
}

// Which region is being drawn, or null when not in drawing mode.
let drawingRegion: RegionName | null = null;
// Where the current drag started, or null when not dragging.
let dragStart: Point | null = null;

const buttonLabels: Record<RegionName, string> = {
  background: 'Set background',
  text: 'Set text zone',
};

function setDrawing(region: RegionName | null) {
  drawingRegion = region;
  frame.classList.toggle('drawing', region !== null);
  for (const button of regionButtons) {
    const name = button.dataset.region as RegionName;
    button.textContent = name === region ? 'Cancel' : buttonLabels[name];
  }
}

for (const button of regionButtons) {
  button.addEventListener('click', () => {
    const name = button.dataset.region as RegionName;
    // Clicking the active button ("Cancel") turns drawing off.
    setDrawing(drawingRegion === name ? null : name);
  });
}

frame.addEventListener('pointerdown', (event) => {
  if (!drawingRegion) {
    return;
  }
  // Keep getting pointer events even if the pointer leaves the frame
  // mid-drag.
  frame.setPointerCapture(event.pointerId);
  dragStart = pointerPosition(event, drawingRegion);
});

frame.addEventListener('pointermove', (event) => {
  if (!dragStart || !drawingRegion || !regions) {
    return;
  }
  const end = pointerPosition(event, drawingRegion);
  const region: Region = {
    x: Math.min(dragStart.x, end.x),
    y: Math.min(dragStart.y, end.y),
    w: Math.abs(end.x - dragStart.x),
    h: Math.abs(end.y - dragStart.y),
  };
  // Ignore tiny drags (like a plain click), which would be an empty region.
  if (region.w < 0.01 || region.h < 0.01) {
    return;
  }
  // `[drawingRegion]` in brackets uses the variable's value as the key.
  regions = { ...regions, [drawingRegion]: region };
  showOutlines();
  // Sent on every move, so the portrait window updates live while dragging.
  // Main saves it for this game once the drag settles.
  window.vn.setRegion(drawingRegion, region);
});

function endDrag() {
  if (dragStart) {
    dragStart = null;
    setDrawing(null);
  }
}
frame.addEventListener('pointerup', endDrag);
frame.addEventListener('pointercancel', endDrag);
