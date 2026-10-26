/**
 * The portrait view: the page that gets streamed to the phone. It captures
 * the same game window that was picked in the main window, and draws regions
 * of it into the layout's zones.
 */

import './portrait.css';
import { getClientArea, playCapture } from './capture';

// How a region is scaled into its zone. `cover` fills the zone and trims the
// edges; `contain` shows the whole region, with bars if the shapes differ.
type Fit = 'cover' | 'contain';

// Each zone of the layout: its canvas, which region it shows, and how.
interface Zone {
  canvas: HTMLCanvasElement;
  region: RegionName;
  fit: Fit;
}

const zones: Zone[] = [
  {
    canvas: document.querySelector('#background-zone canvas')!,
    region: 'background',
    fit: 'cover',
  },
  {
    canvas: document.querySelector('#text-zone canvas')!,
    region: 'text',
    fit: 'contain',
  },
];

// The current regions, kept up to date by main. Null until they arrive.
let regions: Regions | null = null;
window.vn.onRegionsChanged((newRegions) => {
  regions = newRegions;
});
window.vn.getRegions().then((initialRegions) => {
  regions ??= initialRegions;
});

const status = document.querySelector<HTMLParagraphElement>('#status')!;

// The capture plays in a <video> that's never shown; the zones draw from it.
const video = document.createElement('video');
video.muted = true;

// Where the game's content is inside the capture (without the title bar).
// Re-measured whenever the capture changes size, e.g. the game is resized.
let clientArea: Region = { x: 0, y: 0, w: 1, h: 1 };
video.addEventListener('resize', async () => {
  clientArea = await getClientArea();
});

// CSS stretches each canvas to fill its zone, but the canvas's own pixel grid
// doesn't follow. Match it to the canvas's size in real screen pixels, so the
// drawing stays sharp. Observing the "device-pixel-content-box" means this
// also runs when only the screen scaling changes (e.g. the window moves to a
// monitor with different Windows scaling), not just when the box resizes.
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const canvas = entry.target as HTMLCanvasElement;
    const size = entry.devicePixelContentBoxSize[0];
    canvas.width = size.inlineSize;
    canvas.height = size.blockSize;
  }
});
for (const zone of zones) {
  resizeObserver.observe(zone.canvas, { box: 'device-pixel-content-box' });
}

// Where a zone's region comes from in the video (`s...`, source) and where it
// lands on the zone's canvas (`d...`, destination), all in pixels. Used both
// to draw the zone and to work out where a tap on it points in the game.
function placeZone(zone: Zone, regions: Regions) {
  const { canvas, fit } = zone;
  const region = regions[zone.region];

  // The region in the video's actual pixels. Regions are fractions of the
  // game's content, which is itself a part of the capture.
  const contentWidth = clientArea.w * video.videoWidth;
  const contentHeight = clientArea.h * video.videoHeight;
  const sx = clientArea.x * video.videoWidth + region.x * contentWidth;
  const sy = clientArea.y * video.videoHeight + region.y * contentHeight;
  const sw = region.w * contentWidth;
  const sh = region.h * contentHeight;

  // Scale to fill (cover) or fit (contain) the canvas, then center it.
  const scaleX = canvas.width / sw;
  const scaleY = canvas.height / sh;
  const scale =
    fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (canvas.width - dw) / 2;
  const dy = (canvas.height - dh) / 2;

  return { sx, sy, sw, sh, dx, dy, dw, dh };
}

function drawZone(zone: Zone, regions: Regions) {
  const { canvas } = zone;
  const context = canvas.getContext('2d')!;
  const { sx, sy, sw, sh, dx, dy, dw, dh } = placeZone(zone, regions);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Shapes the text zone like the text region (width / height in real pixels),
// through the `--text-aspect` CSS variable, so its `contain` fit has no bars.
// Only touches the style when the shape changes, so layout isn't redone
// every frame.
const textZone = document.querySelector<HTMLElement>('#text-zone')!;
let textAspect = '';
function fitTextZone(regions: Regions) {
  const { w, h } = regions.text;
  const aspect = (
    (w * clientArea.w * video.videoWidth) /
    (h * clientArea.h * video.videoHeight)
  ).toFixed(4);
  if (aspect !== textAspect) {
    textAspect = aspect;
    textZone.style.setProperty('--text-aspect', aspect);
  }
}

// Redraw every screen refresh. `requestAnimationFrame` calls us just before
// the browser paints, so drawing stays in step with the display.
function drawFrame() {
  if (regions && video.videoWidth > 0) {
    fitTextZone(regions);
    for (const zone of zones) {
      drawZone(zone, regions);
    }
  }
  requestAnimationFrame(drawFrame);
}
requestAnimationFrame(drawFrame);

// --- Taps ----------------------------------------------------------------------

// Works backwards from a tap on a zone to the spot in the game it shows, as
// fractions of the game's content. Null if the tap is on the bars around a
// `contain` zone, which show nothing of the game.
function tapToGame(zone: Zone, event: MouseEvent) {
  if (!regions || !video.videoWidth) {
    return null;
  }
  const { canvas } = zone;
  const rect = canvas.getBoundingClientRect();
  // The tap in canvas pixels (the canvas has more pixels than CSS pixels on
  // high-resolution screens).
  const px = ((event.clientX - rect.left) * canvas.width) / rect.width;
  const py = ((event.clientY - rect.top) * canvas.height) / rect.height;

  // Undo the scaling: where the tap falls within the drawn region, 0 to 1.
  const { dx, dy, dw, dh } = placeZone(zone, regions);
  const u = (px - dx) / dw;
  const v = (py - dy) / dh;
  if (u < 0 || u > 1 || v < 0 || v > 1) {
    return null;
  }
  const region = regions[zone.region];
  return { x: region.x + u * region.w, y: region.y + v * region.h };
}

// A quick expanding circle where you tapped, so you can see it registered.
function showRipple(event: MouseEvent) {
  const ripple = document.createElement('div');
  ripple.className = 'ripple';
  ripple.style.left = `${event.clientX}px`;
  ripple.style.top = `${event.clientY}px`;
  document.body.append(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

for (const zone of zones) {
  zone.canvas.addEventListener('click', (event) => {
    const point = tapToGame(zone, event);
    if (point) {
      showRipple(event);
      window.vn.clickGame(point);
    }
  });
}

function showSource(sourceId: string) {
  status.hidden = true;
  playCapture(video, sourceId);
}

window.vn.onSourceSelected(showSource);
window.vn.getSelectedSource().then((sourceId) => {
  if (sourceId) {
    showSource(sourceId);
  }
});
