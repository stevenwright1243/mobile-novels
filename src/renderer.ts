/**
 * Runs in the page (the "renderer" process). No Node or Electron APIs here;
 * anything from main has to come through `window.vn` (see preload.ts).
 */

import './index.css';
import { playCapture } from './capture';

// The `!` tells TypeScript "this element definitely exists", since
// querySelector would otherwise be typed as possibly null.
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')!;
const setTextZoneButton =
  document.querySelector<HTMLButtonElement>('#set-text-zone')!;
const windowList = document.querySelector<HTMLUListElement>('#window-list')!;
const preview = document.querySelector<HTMLVideoElement>('#preview')!;
const frame = document.querySelector<HTMLDivElement>('#frame')!;
const textOutline = document.querySelector<HTMLDivElement>('#text-outline')!;

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
        window.vn.selectSource(source.id);
        playCapture(preview, source.id);
        setTextZoneButton.disabled = false;
      });

      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
}

refreshButton.addEventListener('click', showWindowList);
showWindowList();

// --- Text zone -------------------------------------------------------------

// The preview is letterboxed (`object-fit: contain`), so the game picture
// doesn't fill the whole video element. Work out where it actually is and
// place #frame exactly over it.
function fitFrameToPicture() {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = preview;
  if (!videoWidth || !videoHeight) {
    return;
  }
  const scale = Math.min(clientWidth / videoWidth, clientHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  frame.style.left = `${(clientWidth - width) / 2}px`;
  frame.style.top = `${(clientHeight - height) / 2}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
}

// Refit when the preview changes size (window resized), and when the video's
// own size changes (a new window picked, or the game window resized).
new ResizeObserver(fitFrameToPicture).observe(preview);
preview.addEventListener('resize', fitFrameToPicture);

// Uses percentages of #frame, so the outline stays put when #frame resizes.
function showOutline(region: Region) {
  textOutline.style.left = `${region.x * 100}%`;
  textOutline.style.top = `${region.y * 100}%`;
  textOutline.style.width = `${region.w * 100}%`;
  textOutline.style.height = `${region.h * 100}%`;
}

window.vn.getRegions().then((regions) => showOutline(regions.text));

const clamp = (n: number) => Math.min(1, Math.max(0, n));

// The pointer's position as fractions (0 to 1) of the game picture.
function toFraction(event: PointerEvent) {
  const rect = frame.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
}

let drawing = false;
// Where the current drag started, or null when not dragging.
let dragStart: { x: number; y: number } | null = null;

function setDrawing(on: boolean) {
  drawing = on;
  frame.classList.toggle('drawing', on);
  setTextZoneButton.textContent = on ? 'Cancel' : 'Set text zone';
}

setTextZoneButton.addEventListener('click', () => setDrawing(!drawing));

frame.addEventListener('pointerdown', (event) => {
  if (!drawing) {
    return;
  }
  // Keep getting pointer events even if the pointer leaves the frame
  // mid-drag.
  frame.setPointerCapture(event.pointerId);
  dragStart = toFraction(event);
});

frame.addEventListener('pointermove', (event) => {
  if (!dragStart) {
    return;
  }
  const end = toFraction(event);
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
  showOutline(region);
  // Sent on every move, so the portrait window updates live while dragging.
  window.vn.setRegion('text', region);
});

function endDrag() {
  if (dragStart) {
    dragStart = null;
    setDrawing(false);
  }
}
frame.addEventListener('pointerup', endDrag);
frame.addEventListener('pointercancel', endDrag);
