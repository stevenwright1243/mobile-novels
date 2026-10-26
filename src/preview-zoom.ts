/**
 * Zooming and moving around the picker's game preview, for placing regions
 * precisely. Zooming makes #zoom-box (the video plus the region outlines)
 * bigger than #preview-area, which then scrolls. The picture is really laid
 * out bigger, rather than just drawn bigger with a CSS `transform`, so the
 * region editor's maths (based on where things are on screen) keeps working
 * unchanged.
 */

const previewArea = document.querySelector<HTMLDivElement>('#preview-area')!;
const zoomBox = document.querySelector<HTMLDivElement>('#zoom-box')!;
const zoomOutButton = document.querySelector<HTMLButtonElement>('#zoom-out')!;
const zoomInButton = document.querySelector<HTMLButtonElement>('#zoom-in')!;
const fitButton = document.querySelector<HTMLButtonElement>('#zoom-fit')!;
const zoomLevel = document.querySelector<HTMLOutputElement>('#zoom-level')!;

// 1 = the whole picture fits the preview; 2 = twice that size, and so on.
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
// How much the buttons zoom by each click.
const STEP = 1.25;

let zoom = MIN_ZOOM;

// Changes the zoom, keeping the spot under the pointer (or the middle of the
// preview, for the buttons) in the same place on screen.
function setZoom(newZoom: number, clientX?: number, clientY?: number) {
  const area = previewArea.getBoundingClientRect();
  // The fixed spot, relative to the preview's visible top-left corner.
  const offsetX = (clientX ?? area.left + area.width / 2) - area.left;
  const offsetY = (clientY ?? area.top + area.height / 2) - area.top;
  // ...and as fractions of the whole zoomed picture, which don't change.
  const fractionX = (previewArea.scrollLeft + offsetX) / zoomBox.offsetWidth;
  const fractionY = (previewArea.scrollTop + offsetY) / zoomBox.offsetHeight;

  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
  zoomBox.style.setProperty('--zoom', String(zoom));

  // Scroll so the spot lands back under the pointer. Reading `offsetWidth`
  // makes the browser work out the new size straight away.
  previewArea.scrollLeft = fractionX * zoomBox.offsetWidth - offsetX;
  previewArea.scrollTop = fractionY * zoomBox.offsetHeight - offsetY;

  zoomLevel.textContent =
    zoom === MIN_ZOOM ? 'Fit' : `${Math.round(zoom * 100)}%`;
  zoomOutButton.disabled = zoom <= MIN_ZOOM;
  fitButton.disabled = zoom <= MIN_ZOOM;
  zoomInButton.disabled = zoom >= MAX_ZOOM;
  previewArea.classList.toggle('zoomed', zoom > MIN_ZOOM);
}

zoomInButton.addEventListener('click', () => setZoom(zoom * STEP));
zoomOutButton.addEventListener('click', () => setZoom(zoom / STEP));
fitButton.addEventListener('click', () => setZoom(MIN_ZOOM));

// Ctrl+scroll zooms around the pointer. Trackpad pinches arrive as Ctrl+scroll
// too, so they work as well. `passive: false` is needed to be allowed to
// `preventDefault()` (here: stop the page itself from zooming or scrolling).
previewArea.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    // One mouse wheel notch (deltaY ±100) zooms by about 22%; trackpads send
    // many small steps, which add up to the same thing.
    setZoom(
      zoom * Math.exp(-event.deltaY * 0.002),
      event.clientX,
      event.clientY,
    );
  },
  { passive: false },
);

// --- Dragging to move around ---------------------------------------------------

// Where a drag started: the pointer, and how far the preview was scrolled.
let pan: { x: number; y: number; left: number; top: number } | null = null;

previewArea.addEventListener('pointerdown', (event) => {
  // A left drag moves around, except while editing (where it edits the
  // region; see region-editor.ts). A middle drag always moves around.
  const editing = previewArea.classList.contains('editing');
  const panButton = event.button === 1 || (event.button === 0 && !editing);
  if (zoom === MIN_ZOOM || !panButton) {
    return;
  }
  event.preventDefault();
  pan = {
    x: event.clientX,
    y: event.clientY,
    left: previewArea.scrollLeft,
    top: previewArea.scrollTop,
  };
  previewArea.classList.add('panning');
  previewArea.setPointerCapture(event.pointerId);
});

previewArea.addEventListener('pointermove', (event) => {
  if (pan) {
    previewArea.scrollLeft = pan.left - (event.clientX - pan.x);
    previewArea.scrollTop = pan.top - (event.clientY - pan.y);
  }
});

function endPan() {
  pan = null;
  previewArea.classList.remove('panning');
}
previewArea.addEventListener('pointerup', endPan);
previewArea.addEventListener('pointercancel', endPan);

// Windows starts its own "autoscroll" mode on a middle click; stop it, since
// middle-dragging moves around here.
previewArea.addEventListener('mousedown', (event) => {
  if (event.button === 1) {
    event.preventDefault();
  }
});
