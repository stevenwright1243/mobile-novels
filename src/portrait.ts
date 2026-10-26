/**
 * The portrait view: the page that gets streamed to the phone. It captures
 * the same game window that was picked in the main window, and draws regions
 * of it into the layout's zones.
 */

import './portrait.css';
import { playCapture } from './capture';

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

// CSS stretches each canvas to fill its zone, but the canvas's own pixel grid
// doesn't follow. Match it to the on-screen size × devicePixelRatio, so the
// drawing stays sharp on high-resolution screens.
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const canvas = entry.target as HTMLCanvasElement;
    canvas.width = Math.round(entry.contentRect.width * devicePixelRatio);
    canvas.height = Math.round(entry.contentRect.height * devicePixelRatio);
  }
});
for (const zone of zones) {
  resizeObserver.observe(zone.canvas);
}

function drawZone(zone: Zone, regions: Regions) {
  const { canvas, fit } = zone;
  const context = canvas.getContext('2d')!;
  const region = regions[zone.region];

  // The region in the video's actual pixels.
  const sx = region.x * video.videoWidth;
  const sy = region.y * video.videoHeight;
  const sw = region.w * video.videoWidth;
  const sh = region.h * video.videoHeight;

  // Scale to fill (cover) or fit (contain) the canvas, then center it.
  const scaleX = canvas.width / sw;
  const scaleY = canvas.height / sh;
  const scale =
    fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const dw = sw * scale;
  const dh = sh * scale;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    video,
    sx,
    sy,
    sw,
    sh,
    (canvas.width - dw) / 2,
    (canvas.height - dh) / 2,
    dw,
    dh,
  );
}

// Redraw every screen refresh. `requestAnimationFrame` calls us just before
// the browser paints, so drawing stays in step with the display.
function drawFrame() {
  if (regions && video.videoWidth > 0) {
    for (const zone of zones) {
      drawZone(zone, regions);
    }
  }
  requestAnimationFrame(drawFrame);
}
requestAnimationFrame(drawFrame);

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
