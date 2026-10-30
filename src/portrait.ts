/**
 * The portrait view: the page that gets streamed to the phone. It captures
 * the same game window that was picked in the main window, and draws regions
 * of it into the layout's zones.
 */

// The colour scheme and its fonts (theme.ts).
import { onThemeApplied } from './theme';
import './portrait.css';
import {
  getClientArea,
  playCapture,
  regionInVideo,
  stopCapture,
} from './capture';
import './history-log';
import { startTextReader } from './text-reader';
import { BACKGROUND_VIEW, placeInZone, SHOW_ALL } from './zone-view';

// Each zone of the layout: its canvas, which region it shows, and how it's
// zoomed and positioned. `view` is a function so it always gives the latest.
interface Zone {
  canvas: HTMLCanvasElement;
  region: RegionName;
  view: () => ZoneView;
}

const backgroundCanvas = document.querySelector<HTMLCanvasElement>(
  '#background-zone canvas',
)!;
const zones: Zone[] = [
  {
    canvas: backgroundCanvas,
    region: 'background',
    view: () => BACKGROUND_VIEW,
  },
  {
    // The text box picture always shows in full, so no text is cut off.
    canvas: document.querySelector('#text-zone canvas')!,
    region: 'text',
    view: () => SHOW_ALL,
  },
  {
    // The name box picture (image mode), in the name tag.
    canvas: document.querySelector('#name-tag canvas')!,
    region: 'name',
    view: () => SHOW_ALL,
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

// How the text zone shows the game's text (see `TextMode`). The `text-mode`
// class switches the zone's look in portrait.css; in text mode its canvas is
// hidden and not drawn.
const portrait = document.querySelector<HTMLElement>('.portrait')!;
let textMode: TextMode = 'text';
function setTextMode(mode: TextMode) {
  textMode = mode;
  portrait.classList.toggle('text-mode', mode === 'text');
  layoutChanged();
}
window.vn.onTextModeChanged(setTextMode);
window.vn.getTextMode().then(setTextMode);

// --- Menus: the whole game ("raw mode") -------------------------------------------------------

// The top-left button switches between the reader layout and the whole game:
// the entire game screen in full, so every menu, setting and choice can be
// seen and tapped, with taps landing 1:1. Just for now, not saved. The
// `raw-mode` class switches the layout in portrait.css.
const WHOLE_GAME: Region = { x: 0, y: 0, w: 1, h: 1 };
let rawMode = false;
const rawButton = document.querySelector<HTMLButtonElement>('#raw-button')!;
rawButton.addEventListener('click', () => {
  rawMode = !rawMode;
  portrait.classList.toggle('raw-mode', rawMode);
  rawButton.classList.toggle('raw', rawMode);
  rawButton.setAttribute(
    'aria-label',
    rawMode ? 'Back to the reader layout' : 'Menus: show the whole game',
  );
});

// What a zone shows, and how: in whole-game mode the background zone shows
// the whole game, all of it (`SHOW_ALL`); otherwise its own region and view.
function zoneRegion(zone: Zone, regions: Regions) {
  return rawMode && zone.region === 'background'
    ? WHOLE_GAME
    : regions[zone.region];
}
function zoneView(zone: Zone) {
  return rawMode && zone.region === 'background' ? SHOW_ALL : zone.view();
}

// The text and name sizes (see `TextStyle`), passed to portrait.css as
// `--text-size` and `--name-size`.
function setTextStyle(style: TextStyle) {
  chosenSize = style.size;
  oversizedSize = style.oversizedSize ?? null;
  portrait.style.setProperty('--text-size', String(style.size));
  portrait.style.setProperty('--name-size', String(style.nameSize ?? 1));
  layoutChanged();
}
window.vn.onTextStyleChanged(setTextStyle);
window.vn.getTextStyle().then(setTextStyle);

// The corner buttons' size (an app setting), passed to portrait.css as
// `--button-size`.
function setButtonSize(size: number) {
  portrait.style.setProperty('--button-size', String(size));
}
window.vn.onButtonSizeChanged(setButtonSize);
window.vn.getButtonSize().then(setButtonSize);

// The message window's border and arrow (an app setting), set as
// `data-border` and `data-arrow` attributes that portrait.css styles by.
function setMessageStyle(style: MessageStyle) {
  portrait.dataset.border = style.border;
  portrait.dataset.arrow = style.arrow;
}
window.vn.onMessageStyleChanged(setMessageStyle);
window.vn.getMessageStyle().then(setMessageStyle);

// --- Keeping things in step -------------------------------------------------------

// Something that affects the message window changed (text mode, text size,
// or the window's size): tell the picker the background zone's size, and
// refit the current line. The background picture doesn't depend on the text
// at all: it fills the whole portrait, and the window lies over it.
function layoutChanged() {
  reportZoneSize();
  fitText();
}

// --- Fitting long lines -----------------------------------------------------------

// The text size chosen in the picker (see `TextStyle`).
let chosenSize = 1;
// The size for lines too long to fit at the chosen size, or null to shrink
// each one just enough ("Auto").
let oversizedSize: number | null = null;
// The smallest a line may shrink to, as a text size: the slider's minimum.
const SMALLEST_SIZE = 0.6;
// The last shrunk size sent to main (null = not shrunk), to only send changes.
let reportedShrink: number | null = null;

// Changes the size of a line that's too long for the message window's
// resting height (room for 3 lines at the chosen size):
//  - With a long-line size set, it's shown at exactly that size, and the
//    window grows over the background picture as much as it needs to.
//  - With "Auto", it's shrunk just enough to fit, so the window doesn't grow.
// Every new line starts again at the chosen size. Text too long for the
// window's maximum height scrolls inside it.
function fitText() {
  const line = document.querySelector<HTMLElement>('#text-line')!;
  let fit = 1;
  if (textMode === 'text' && line.textContent) {
    // The window's resting height, in CSS pixels.
    const limit = parseFloat(getComputedStyle(line).minHeight) || 0;
    // `scrollHeight` is the height the window's text needs. Reading it right
    // after changing the size makes the browser lay the text out again
    // straight away, so each try is measured for real.
    const fits = (scale: number) => {
      line.style.setProperty('--fit', String(scale));
      return line.scrollHeight <= limit + 1;
    };
    // The long-line size as a fit (never bigger than the chosen size).
    const oversizedFit =
      oversizedSize === null ? null : Math.min(1, oversizedSize / chosenSize);
    if (fits(1)) {
      fit = 1;
    } else if (oversizedFit !== null) {
      fit = oversizedFit;
    } else {
      // A "binary search": try halfway between a size that fits and one that
      // doesn't, and keep the half the answer is in. 8 tries narrows it to
      // within half a percent.
      let low = Math.min(1, SMALLEST_SIZE / chosenSize);
      let high = 1;
      for (let i = 0; i < 8; i++) {
        const middle = (low + high) / 2;
        if (fits(middle)) {
          low = middle;
        } else {
          high = middle;
        }
      }
      fit = low;
    }
  }
  line.style.setProperty('--fit', String(fit));

  // Tell the picker, which shows a note while a line is shrunk.
  const shrunkTo = fit < 1 ? chosenSize * fit : null;
  if (shrunkTo !== reportedShrink) {
    reportedShrink = shrunkTo;
    window.vn.setTextShrink(shrunkTo);
  }
}

// The picker outlines the part of the background that's shown, which depends
// on the zone's shape, so let it know.
function reportZoneSize() {
  window.vn.setBackgroundZoneSize({
    width: backgroundCanvas.width,
    height: backgroundCanvas.height,
  });
}

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
    // The window resized: the zone's shape, and the text's size (which
    // follows the window's width), may have changed.
    if (canvas === backgroundCanvas) {
      layoutChanged();
    }
  }
});
for (const zone of zones) {
  resizeObserver.observe(zone.canvas, { box: 'device-pixel-content-box' });
}

// Where a zone's region comes from in the video (`s...`, source) and where it
// lands on the zone's canvas (`d...`, destination), all in pixels. Used both
// to draw the zone and to work out where a tap on it points in the game.
function placeZone(zone: Zone, regions: Regions) {
  const { canvas } = zone;
  const region = zoneRegion(zone, regions);
  const { sx, sy, sw, sh } = regionInVideo(video, clientArea, region);
  const { dx, dy, dw, dh } = placeInZone(
    sw,
    sh,
    canvas.width,
    canvas.height,
    zoneView(zone),
  );
  return { sx, sy, sw, sh, dx, dy, dw, dh };
}

// The backdrop behind a zoomed-out background: the same picture, filling the
// zone, blurred and darkened. Drawn tiny and then stretched, which blurs it
// almost for free (a real blur filter on a full-size canvas, every frame,
// would be slow).
const BACKDROP_SHRINK = 24;
const backdrop = document.createElement('canvas');
const backdropContext = backdrop.getContext('2d')!;

// The colour washed over the backdrop, from the theme in theme.css. Read
// again whenever the theme changes.
const readBackdropTint = () =>
  getComputedStyle(document.documentElement)
    .getPropertyValue('--backdrop-tint')
    .trim() || 'rgb(0 0 0 / 55%)';
let backdropTint = readBackdropTint();
onThemeApplied(() => {
  backdropTint = readBackdropTint();
});

function drawBackdrop(
  context: CanvasRenderingContext2D,
  { sx, sy, sw, sh }: { sx: number; sy: number; sw: number; sh: number },
) {
  const { width, height } = context.canvas;
  // Resizing a canvas clears and reallocates it, so only when it changes.
  const smallWidth = Math.max(1, Math.ceil(width / BACKDROP_SHRINK));
  const smallHeight = Math.max(1, Math.ceil(height / BACKDROP_SHRINK));
  if (backdrop.width !== smallWidth || backdrop.height !== smallHeight) {
    backdrop.width = smallWidth;
    backdrop.height = smallHeight;
  }
  const fill = placeInZone(sw, sh, backdrop.width, backdrop.height, {
    fill: 1,
    x: 0.5,
    y: 0.5,
  });
  // A light blur at this tiny size smooths out the blockiness.
  backdropContext.filter = 'blur(1px)';
  backdropContext.drawImage(
    video,
    sx,
    sy,
    sw,
    sh,
    fill.dx,
    fill.dy,
    fill.dw,
    fill.dh,
  );
  context.drawImage(backdrop, 0, 0, width, height);
  // Wash it with the theme's tint, so the real picture stands out.
  context.fillStyle = backdropTint;
  context.fillRect(0, 0, width, height);
}

function drawZone(zone: Zone, regions: Regions) {
  const { canvas } = zone;
  const context = canvas.getContext('2d')!;
  const place = placeZone(zone, regions);
  const { sx, sy, sw, sh, dx, dy, dw, dh } = place;
  context.clearRect(0, 0, canvas.width, canvas.height);
  // Space around the picture: fill it with the backdrop rather than black
  // (the text box picture keeps plain bars, so the text stands out).
  const leavesSpace = dw < canvas.width - 1 || dh < canvas.height - 1;
  if (leavesSpace && zone.region === 'background') {
    drawBackdrop(context, place);
  }
  context.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Shapes an element like a region (width / height in real pixels), through a
// CSS variable (`--text-aspect` for the text zone, `--name-aspect` for the
// name tag), so the picture's `contain` fit has no bars. Only touches the
// style when the shape changes, so layout isn't redone every frame.
const textZone = document.querySelector<HTMLElement>('#text-zone')!;
const nameTag = document.querySelector<HTMLElement>('#name-tag')!;
const aspects = new Map<HTMLElement, string>();
function fitShape(element: HTMLElement, variable: string, { w, h }: Region) {
  const aspect = (
    (w * clientArea.w * video.videoWidth) /
    (h * clientArea.h * video.videoHeight)
  ).toFixed(4);
  if (aspect !== aspects.get(element)) {
    aspects.set(element, aspect);
    element.style.setProperty(variable, aspect);
  }
}

// Redraw every screen refresh. `requestAnimationFrame` calls us just before
// the browser paints, so drawing stays in step with the display.
function drawFrame() {
  if (regions && video.videoWidth > 0) {
    fitShape(textZone, '--text-aspect', regions.text);
    fitShape(nameTag, '--name-aspect', regions.name);
    for (const zone of zones) {
      // The text and name box pictures aren't shown in text mode or
      // whole-game mode.
      if (zone.region !== 'background' && (textMode === 'text' || rawMode)) {
        continue;
      }
      drawZone(zone, regions);
    }
  }
  requestAnimationFrame(drawFrame);
}
requestAnimationFrame(drawFrame);

// --- Taps ----------------------------------------------------------------------

// Works backwards from a tap on a zone to the spot in the game it shows, as
// fractions of the game's content. Null if the tap is on the space around a
// zoomed-out picture, which shows nothing of the game.
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
  const region = zoneRegion(zone, regions);
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

// In text mode, a tap on the text clicks the middle of the game's text box,
// which moves on to the next line in most VNs.
const textLine = document.querySelector<HTMLParagraphElement>('#text-line')!;
function clickTextBox(event: MouseEvent) {
  if (regions) {
    const { x, y, w, h } = regions.text;
    showRipple(event);
    window.vn.clickGame({ x: x + w / 2, y: y + h / 2 });
  }
}
textLine.addEventListener('click', clickTextBox);
// The name tag too, as it's part of the message window. (In image mode its
// picture is a zone, and a tap on it clicks the game where it points.)
nameTag.addEventListener('click', (event) => {
  if (textMode === 'text') {
    clickTextBox(event);
  }
});

for (const zone of zones) {
  zone.canvas.addEventListener('click', (event) => {
    const point = tapToGame(zone, event);
    if (point) {
      showRipple(event);
      window.vn.clickGame(point);
    }
  });
}

function showSource(sourceId: string | null) {
  if (sourceId) {
    status.hidden = true;
    playCapture(video, sourceId);
    return;
  }
  // The game was closed: stop the (now blank) capture, clear its last frame
  // from the zones, and say so.
  stopCapture(video);
  for (const zone of zones) {
    zone.canvas
      .getContext('2d')!
      .clearRect(0, 0, zone.canvas.width, zone.canvas.height);
  }
  status.textContent =
    'The game was closed. Start it again, then pick it in the main window.';
  status.hidden = false;
}

// --- Text mode -----------------------------------------------------------------

// Shows the line read by OCR, with a quick fade-in so a new line is
// noticeable without being jarring.
function showTextLine(line: string) {
  if (line === textLine.textContent) {
    return;
  }
  textLine.textContent = line;
  // A new line starts at the chosen size, shrunk only if it doesn't fit.
  fitText();
  // Fades in while drifting up slightly, like a message window turning a
  // page.
  textLine.animate(
    [
      { opacity: 0, translate: '0 0.3rem' },
      { opacity: 1, translate: '0 0' },
    ],
    { duration: 220, easing: 'ease-out' },
  );
}
window.vn.onTextLineChanged(showTextLine);
window.vn.getTextLine().then(showTextLine);

// The speaker's name, in the tag on the message window's top-left corner.
// Hidden by portrait.css while it's empty (narration).
const nameText = document.querySelector<HTMLSpanElement>('#name-text')!;
function showSpeaker(name: string) {
  if (name === nameText.textContent) {
    return;
  }
  nameText.textContent = name;
  // Pops in with a little slide from the left, like a name card.
  nameTag.animate(
    [
      { opacity: 0, translate: '-0.4em 0' },
      { opacity: 1, translate: '0 0' },
    ],
    { duration: 200, easing: 'ease-out' },
  );
}
window.vn.onSpeakerChanged(showSpeaker);
window.vn.getSpeaker().then(showSpeaker);

// A name box often has a decoration beside the name (an icon, brackets, a
// colon) that OCR reads as stray marks: trim anything that isn't a letter,
// a digit or a question mark ("???" is a common unknown speaker) off both
// ends.
const tidyName = (name: string) =>
  name.replace(/^[^\p{L}\p{N}?]+|[^\p{L}\p{N}?!]+$/gu, '');

// Read the game's text and the speaker's name automatically, each from its
// own box (see text-reader.ts).
const findRegion = (name: RegionName) => () =>
  regions && video.videoWidth > 0
    ? regionInVideo(video, clientArea, regions[name])
    : null;
startTextReader(video, findRegion('text'), (line) =>
  window.vn.setTextLine(line),
);
// Names are often light text on a shaded plate, so they get a second try
// with the background removed.
startTextReader(
  video,
  findRegion('name'),
  (name) => window.vn.setSpeaker(tidyName(name)),
  { retryFlattened: true },
);

window.vn.onSourceSelected(showSource);
window.vn.getSelectedSource().then((sourceId) => {
  if (sourceId) {
    showSource(sourceId);
  }
});

// Whether this window is full screen on the phone's display (see
// phone-display.ts), for styles that only apply there.
const showOnPhone = (phone: PhoneDisplay | null) =>
  document.documentElement.classList.toggle(
    'on-phone',
    phone?.portraitOnPhone ?? false,
  );
window.vn.onPhoneDisplayChanged(showOnPhone);
window.vn.getPhoneDisplay().then(showOnPhone);
