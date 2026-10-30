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
import './menus-sheet';
import './visual-novels';
import './input-settings';
import './zoom-pad';
import { isPageMode, onPageModeChanged } from './page-mode';
import { redrawPage, showPage } from './page-view';
import { dragToScroll, updateScrollState } from './drag-scroll';
import { resetZoom, zoomByGestures, zoomedPlace } from './game-zoom';
import {
  backgroundWidth,
  backgroundY,
  backgroundYCap,
  buttonSize,
  textStyle,
} from './portrait-sizes';
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

// The only zone drawn from the capture: the game's text and name are read
// by OCR and shown as text, not as pictures.
const backgroundZone: Zone = {
  canvas: backgroundCanvas,
  region: 'background',
  // `backgroundY`: where the background sits, top to bottom (the game's
  // own, set in the picker or the Menus sheet; portrait-sizes.ts).
  // And `backgroundWidth`: how much of its width shows. The height is held
  // at its cap (see `updateBackgroundYCap`).
  view: () => ({
    ...BACKGROUND_VIEW,
    width: backgroundWidth.get(),
    y: Math.min(backgroundY.get(), backgroundYCap.get()),
  }),
};

// The current regions, kept up to date by main. Null until they arrive.
let regions: Regions | null = null;
window.vn.onRegionsChanged((newRegions) => {
  regions = newRegions;
});
window.vn.getRegions().then((initialRegions) => {
  regions ??= initialRegions;
});

const portrait = document.querySelector<HTMLElement>('.portrait')!;

// --- Menus: the whole game ("raw mode") -------------------------------------------------------

// The top-left button switches between the reader layout and the whole game:
// the entire game screen in full, so every menu, setting and choice can be
// seen and tapped, with taps landing 1:1. Just for now, not saved. The
// `raw-mode` class switches the layout in portrait.css: the game goes in
// `#game-slot`, under the corner buttons, with the settings sheet below.
const WHOLE_GAME: Region = { x: 0, y: 0, w: 1, h: 1 };
let rawMode = false;
const rawButton = document.querySelector<HTMLButtonElement>('#raw-button')!;
rawButton.addEventListener('click', () => {
  rawMode = !rawMode;
  portrait.classList.toggle('raw-mode', rawMode);
  // Each visit to Menus starts with the whole game (after the layout
  // switches, so the zoom pad sees the game's slot).
  resetZoom();
  rawButton.classList.toggle('raw', rawMode);
  rawButton.setAttribute(
    'aria-label',
    rawMode ? 'Back to the reader layout' : 'Menus: show the whole game',
  );
});

// What a zone shows, and how: in whole-game mode the background zone shows
// the whole game, all of it (`SHOW_ALL`); otherwise its own region and view.
function zoneRegion(zone: Zone, regions: Regions) {
  return rawMode ? WHOLE_GAME : regions[zone.region];
}
function zoneView(zone: Zone) {
  return rawMode ? SHOW_ALL : zone.view();
}

// The text and name sizes (see `TextStyle`), passed to portrait.css as
// `--text-size` and `--name-size`.
function setTextStyle(style: TextStyle) {
  portrait.style.setProperty('--text-size', String(style.size));
  portrait.style.setProperty('--name-size', String(style.nameSize ?? 1));
  // Where the message window sits (portrait.css styles by it), and the
  // extra space on the side it grows from (`--text-padding`, 0 to 1).
  portrait.dataset.textPosition = style.position ?? 'bottom';
  portrait.style.setProperty('--text-padding', String(style.padding ?? 0));
}
textStyle.listen(setTextStyle);

// The corner buttons' size (an app setting), passed to portrait.css as
// `--button-size`.
function setButtonSize(size: number) {
  portrait.style.setProperty('--button-size', String(size));
}
buttonSize.listen(setButtonSize);

// The message window's border and arrow (an app setting), set as
// `data-border` and `data-arrow` attributes that portrait.css styles by. On
// the window and the arrow themselves, so the Menus sheet's samples can show
// other ones; the arrow also on .portrait, for the room the text leaves it.
const textLine = document.querySelector<HTMLParagraphElement>('#text-line')!;
const nextArrow = document.querySelector<HTMLElement>('#next-arrow')!;
const pageView = document.querySelector<HTMLElement>('#page-view')!;
// The Sizes sample's copies of the message window and arrow (see "The Sizes
// sample" below).
const sample = document.querySelector<HTMLElement>('#sizes-sample')!;
const sampleLine = sample.querySelector<HTMLElement>('.message-window')!;
const sampleArrow = sample.querySelector<HTMLElement>('.next-arrow')!;
function setMessageStyle(style: MessageStyle) {
  textLine.dataset.border = style.border;
  pageView.dataset.border = style.border;
  sampleLine.dataset.border = style.border;
  nextArrow.dataset.arrow = style.arrow;
  sampleArrow.dataset.arrow = style.arrow;
  portrait.dataset.arrow = style.arrow;
}
window.vn.onMessageStyleChanged(setMessageStyle);
window.vn.getMessageStyle().then(setMessageStyle);

// The picker outlines the part of the background that's shown, which depends
// on the zone's shape (it changes with the window's size), so let it know.
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
  // The game's shape, for the Menus mode's game slot (portrait.css).
  portrait.style.setProperty(
    '--game-aspect',
    String(
      (video.videoWidth * clientArea.w) / (video.videoHeight * clientArea.h),
    ),
  );
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
    // The window resized: the zone's shape may have changed.
    reportZoneSize();
  }
});
resizeObserver.observe(backgroundCanvas, { box: 'device-pixel-content-box' });

// In Menus mode the game is drawn into the box of `#game-slot` (under the
// corner buttons, above the settings sheet), while the backdrop still fills
// the whole canvas. That box, in the canvas's pixels.
const gameSlot = document.querySelector<HTMLElement>('#game-slot')!;
function slotInCanvas(canvas: HTMLCanvasElement) {
  const canvasRect = canvas.getBoundingClientRect();
  const slot = gameSlot.getBoundingClientRect();
  const scale = canvas.width / canvasRect.width;
  return {
    x: (slot.left - canvasRect.left) * scale,
    y: (slot.top - canvasRect.top) * scale,
    width: slot.width * scale,
    height: slot.height * scale,
  };
}

// Where a zone's region comes from in the video (`s...`, source) and where it
// lands on the zone's canvas (`d...`, destination), all in pixels. Used both
// to draw the zone and to work out where a tap on it points in the game.
// `box` is the part of the canvas it's drawn in: the game slot in Menus mode,
// where the game can be zoomed into (game-zoom.ts), otherwise all of it.
function placeZone(zone: Zone, regions: Regions) {
  const { canvas } = zone;
  const region = zoneRegion(zone, regions);
  const { sx, sy, sw, sh } = regionInVideo(video, clientArea, region);
  const box = rawMode
    ? slotInCanvas(canvas)
    : { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const { dx, dy, dw, dh } = placeInZone(
    sw,
    sh,
    box.width,
    box.height,
    zoneView(zone),
  );
  if (rawMode) {
    return { sx, sy, sw, sh, box, ...zoomedPlace(box, dw, dh) };
  }
  return { sx, sy, sw, sh, box, dx: box.x + dx, dy: box.y + dy, dw, dh };
}

// The backdrop behind a zoomed-out background: the same picture, filling the
// zone, blurred and darkened. Drawn tiny and then stretched, which blurs it
// almost for free (a real blur filter on a full-size canvas, every frame,
// would be slow).
const BACKDROP_SHRINK = 24;
const backdrop = document.createElement('canvas');
const backdropContext = backdrop.getContext('2d')!;
// Each frame is shrunk into `latest` first, then only partly blended into
// `backdrop` (a running average over the last few frames). Shrinking 24×
// makes each tiny pixel stand for hundreds of real ones, so the slightest
// flicker in the capture would make whole blocks of the blur shimmer; the
// average smooths that out, while real movement still comes through, a
// fraction of a second behind.
const latest = document.createElement('canvas');
const latestContext = latest.getContext('2d')!;
// How much of each new frame goes into the average. Lower is steadier but
// lags real movement more (at 0.15, a change is ~90% there in a quarter of a
// second).
const BACKDROP_BLEND = 0.15;
// True when `backdrop` holds nothing worth blending into yet, so the next
// frame is drawn whole.
let backdropEmpty = true;

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
    backdrop.width = latest.width = smallWidth;
    backdrop.height = latest.height = smallHeight;
    backdropEmpty = true;
  }
  const fill = placeInZone(sw, sh, latest.width, latest.height, {
    fill: 1,
    x: 0.5,
    y: 0.5,
  });
  // 'high' averages over all the pixels being shrunk, instead of sampling
  // a few of them (which is what makes small changes jump around).
  latestContext.imageSmoothingQuality = 'high';
  // A light blur at this tiny size smooths out the blockiness.
  latestContext.filter = 'blur(1px)';
  latestContext.clearRect(0, 0, latest.width, latest.height);
  latestContext.drawImage(
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
  backdropContext.globalAlpha = backdropEmpty ? 1 : BACKDROP_BLEND;
  backdropContext.drawImage(latest, 0, 0);
  backdropEmpty = false;
  context.imageSmoothingQuality = 'high';
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
  // Space around the picture: fill it with the backdrop rather than black.
  const leavesSpace = dw < canvas.width - 1 || dh < canvas.height - 1;
  if (leavesSpace) {
    drawBackdrop(context, place);
  }
  // Zoomed in, the game is bigger than its slot: only the slot shows it.
  const { box } = place;
  context.save();
  context.beginPath();
  context.rect(box.x, box.y, box.width, box.height);
  context.clip();
  context.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  context.restore();
  return place;
}

// Where the background picture ends, from the portrait's top, in CSS pixels,
// passed to portrait.css as `--picture-bottom`: the page of full-screen text
// stops growing there and scrolls instead, so it doesn't cover the picture,
// and with text position "top" the message window hangs from it.
let pictureBottom = '';
function setPictureBottom(pixels: number) {
  const bottom = `${Math.round(pixels)}px`;
  if (bottom !== pictureBottom) {
    pictureBottom = bottom;
    portrait.style.setProperty('--picture-bottom', bottom);
  }
}
function reportPictureBottom({ dy, dh }: { dy: number; dh: number }) {
  const { height, clientHeight } = backgroundCanvas;
  setPictureBottom(((dy + dh) * clientHeight) / height);
}

// Redraw every screen refresh. `requestAnimationFrame` calls us just before
// the browser paints, so drawing stays in step with the display.
function drawFrame() {
  if (regions && video.videoWidth > 0) {
    updateBackgroundYCap(regions);
    const place = drawZone(backgroundZone, regions);
    // In Menus mode the picture is the whole game, placed elsewhere.
    if (!rawMode) {
      reportPictureBottom(place);
    } else if (sizesDropdown.open) {
      drawSample(regions);
    }
  }
  requestAnimationFrame(drawFrame);
}
requestAnimationFrame(drawFrame);

// --- Taps ----------------------------------------------------------------------

// A pointer's position in a canvas's pixels (the canvas has more pixels than
// CSS pixels on high-resolution screens).
function inCanvasPixels(canvas: HTMLCanvasElement, event: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / rect.width,
    y: ((event.clientY - rect.top) * canvas.height) / rect.height,
  };
}

// Works backwards from a tap on a zone to the spot in the game it shows, as
// fractions of the game's content. Null if the tap is on the space around a
// zoomed-out picture, which shows nothing of the game, or outside the game
// slot in Menus mode (a zoomed-in game is hidden there).
function tapToGame(zone: Zone, event: MouseEvent) {
  if (!regions || !video.videoWidth) {
    return null;
  }
  const { x: px, y: py } = inCanvasPixels(zone.canvas, event);

  // Undo the scaling: where the tap falls within the drawn region, 0 to 1.
  const { box, dx, dy, dw, dh } = placeZone(zone, regions);
  const u = (px - dx) / dw;
  const v = (py - dy) / dh;
  const inBox =
    px >= box.x &&
    px <= box.x + box.width &&
    py >= box.y &&
    py <= box.y + box.height;
  if (!inBox || u < 0 || u > 1 || v < 0 || v > 1) {
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

// A tap on the text clicks the middle of the game's text box, which moves on
// to the next line in most VNs.
const nameTag = document.querySelector<HTMLElement>('#name-tag')!;
function clickTextBox(event: MouseEvent) {
  if (regions) {
    const { x, y, w, h } = regions.text;
    showRipple(event);
    window.vn.clickGame({ x: x + w / 2, y: y + h / 2 });
  }
}
textLine.addEventListener('click', clickTextBox);
// The name tag too, as it's part of the message window.
nameTag.addEventListener('click', clickTextBox);

// In full-screen text mode, a tap on the page clicks the page region's
// bottom-right corner: anywhere moves the game on, and there the mouse
// pointer (which the capture shows) stays clear of the text being read.
const PAGE_CORNER = 0.98;
pageView.addEventListener('click', (event) => {
  if (regions) {
    const { x, y, w, h } = regions.page;
    showRipple(event);
    window.vn.clickGame({ x: x + w * PAGE_CORNER, y: y + h * PAGE_CORNER });
  }
});

// Full-screen text mode (switched in the Menus sheet): the page shows in
// place of the line and name (the `page-mode` class), and only the page
// region is read. There's no name box, so no speaker either.
onPageModeChanged((on) => {
  portrait.classList.toggle('page-mode', on);
  if (on) {
    window.vn.setSpeaker('');
    redrawPage();
  }
});

// In Menus mode, pinching (or the wheel) zooms into the game and dragging
// moves around it (game-zoom.ts). Set up before the tap below, so a
// gesture's click is stopped before it reaches it.
zoomByGestures(
  backgroundCanvas,
  () =>
    rawMode && regions && video.videoWidth
      ? placeZone(backgroundZone, regions)
      : null,
  (event) => inCanvasPixels(backgroundCanvas, event),
);

backgroundCanvas.addEventListener('click', (event) => {
  const point = tapToGame(backgroundZone, event);
  if (point) {
    showRipple(event);
    window.vn.clickGame(point);
  }
});

function showSource(sourceId: string | null) {
  // Don't fade the new game in from the old one's backdrop, or show it
  // zoomed in where the old one was.
  backdropEmpty = true;
  resetZoom();
  if (sourceId) {
    status.hidden = true;
    playCapture(video, sourceId);
    return;
  }
  // The game was closed: stop the (now blank) capture, clear its last frame
  // from the background, and say so.
  stopCapture(video);
  backgroundCanvas
    .getContext('2d')!
    .clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
  status.textContent =
    'The game was closed. Start it again, then pick it in the main window.';
  status.hidden = false;
}

// --- Text ----------------------------------------------------------------------

// Shows the line read by OCR, with a quick fade-in so a new line is
// noticeable without being jarring.
function showTextLine(line: string) {
  if (line === textLine.textContent) {
    return;
  }
  textLine.textContent = line;
  // A new line starts from its beginning, if it scrolls.
  textLine.scrollTop = 0;
  updateScrollState(textLine);
  copyToSample();
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
  copyToSample();
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

// --- Portrait height cap (text position "top") -------------------------------

// With text position "top", the message window hangs under the picture and
// scrolls when the text needs more room than is left (portrait.css), so the
// picture can only go so low: it must leave room under it for the name tag
// and the window at its 3 lines (its `min-height`). Worked out each frame
// from the sizes on screen, measured on the reader's text zone, or in Menus
// mode (where that's hidden) on the Sizes sample's, which has the same
// layout at full size. The result is `backgroundYCap`.
const textZone = document.querySelector<HTMLElement>('#text-zone')!;
const sampleZone = document.querySelector<HTMLElement>(
  '.sample-screen .text-zone',
)!;
const pageText = document.querySelector<HTMLElement>('#page-text')!;
const sampleNameTag = sample.querySelector<HTMLElement>('.name-tag')!;

// How much of the screen's height Text padding 100% adds (as in
// portrait.css's `--text-extra`).
const TEXT_PADDING_SHARE = 0.2;

function updateBackgroundYCap(regions: Regions) {
  if (textStyle.get().position !== 'top') {
    backgroundYCap.set(1);
    return;
  }
  const zone = rawMode ? sampleZone : textZone;
  // The box whose `min-height` is the window's 3 lines, and the name tag.
  const lines = rawMode ? sampleLine : isPageMode() ? pageText : textLine;
  const tag = rawMode ? sampleNameTag : nameTag;
  if (!zone.offsetHeight) {
    // Not laid out (Menus mode with the sample shut): keep the last cap.
    return;
  }
  // The room the zone needs at 3 lines, from its parts (not the zone's own
  // height, which is squeezed when the picture is too low): the gap above
  // it (its side padding is the same `--gap`), its top and bottom padding,
  // the name tag's room (less its overlap with the window) and the window.
  const zoneStyle = getComputedStyle(zone);
  const tagStyle = getComputedStyle(tag);
  const room =
    parseFloat(zoneStyle.paddingLeft) +
    parseFloat(zoneStyle.paddingTop) +
    parseFloat(zoneStyle.paddingBottom) +
    tag.offsetHeight +
    parseFloat(tagStyle.marginTop) +
    parseFloat(tagStyle.marginBottom) +
    parseFloat(getComputedStyle(lines).minHeight) +
    // The Text padding, above the zone (a fifth of the screen at 100%).
    (textStyle.get().padding ?? 0) * TEXT_PADDING_SHARE * innerHeight;
  // The picture's height on screen (it doesn't depend on its position),
  // and the height that puts its bottom at the lowest it may go.
  const { sw, sh } = regionInVideo(video, clientArea, regions.background);
  const { dh } = placeInZone(sw, sh, innerWidth, innerHeight, {
    ...BACKGROUND_VIEW,
    width: backgroundWidth.get(),
  });
  const lowest = innerHeight - room;
  backgroundYCap.set(
    dh >= innerHeight
      ? 0
      : Math.min(1, Math.max(0, (lowest - dh) / (innerHeight - dh))),
  );
}

// The window scrolls by dragging (when it scrolls at all), and is marked
// for being scrolled back (drag-scroll.ts), checked again whenever its
// size changes.
dragToScroll(textLine);
new ResizeObserver(() => updateScrollState(textLine)).observe(textLine);

// --- The Sizes sample ----------------------------------------------------------

// While the Menus sheet's Sizes drop-down is open, it shows a small copy of
// the reader screen, so the sizes can be seen changing: the picture at its
// height, the line and name, the corner buttons. It's the screen's layout
// at its full size (`.sample-screen` is 100vw × 100dvh, so every size in
// it is the real one), scaled down to the sample's width.
const sizesDropdown = document.querySelector<HTMLDetailsElement>('#sizes')!;
const sampleCanvas = sample.querySelector('canvas')!;
const sampleName = sample.querySelector<HTMLElement>('.name-text')!;
sampleArrow.innerHTML = nextArrow.innerHTML;

// It's as tall as the sliders beside it (their own height, without the
// room their column spreads them over), so the last row, Text position,
// lines up with its bottom edge; its width follows from the screen's shape.
const sampleSliders = document.querySelector<HTMLElement>('#sizes .sliders')!;
function slidersHeight() {
  const rows = [...sampleSliders.children] as HTMLElement[];
  const gap = parseFloat(getComputedStyle(sampleSliders).rowGap) || 0;
  return (
    rows.reduce((sum, row) => sum + row.offsetHeight, 0) +
    gap * (rows.length - 1)
  );
}

// At most this share of the drop-down's width, so the sliders keep room.
const MAX_SAMPLE_SHARE = 0.5;

function fitSample() {
  const height = slidersHeight();
  const body = sample.parentElement!.clientWidth;
  if (height > 0 && body > 0) {
    const width = Math.min(
      (height * innerWidth) / innerHeight,
      body * MAX_SAMPLE_SHARE,
    );
    sample.style.width = `${width}px`;
  }
  const scale = sample.clientWidth / innerWidth;
  sample.style.setProperty('--sample-scale', String(scale));
  sample.style.height = `${innerHeight * scale}px`;
}
// Sized again when it's laid out (it's 0 while the drop-down is shut) or
// the sliders' column changes shape.
new ResizeObserver(fitSample).observe(sample);
new ResizeObserver(fitSample).observe(sampleSliders);
addEventListener('resize', fitSample);

// The line and name on screen, or stand-ins while there are none.
function copyToSample() {
  sampleLine.textContent =
    textLine.textContent || 'The text will look like this.';
  sampleName.textContent = nameText.textContent || 'Name';
}
sizesDropdown.addEventListener('toggle', () => {
  copyToSample();
  if (sizesDropdown.open) {
    // Sized now, so the sheet knows how tall it is, then scrolled up into
    // view: it opens at the bottom of the sheet.
    fitSample();
    sizesDropdown.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

// The picture, where the reader places it, over a blurred, tinted copy
// (drawn simply, with a blur filter: the sample is small).
function drawSample(regions: Regions) {
  const width = Math.round(sample.clientWidth * devicePixelRatio);
  const height = Math.round(sample.clientHeight * devicePixelRatio);
  if (width < 1 || height < 1) {
    return;
  }
  if (sampleCanvas.width !== width || sampleCanvas.height !== height) {
    sampleCanvas.width = width;
    sampleCanvas.height = height;
  }
  const context = sampleCanvas.getContext('2d')!;
  const { sx, sy, sw, sh } = regionInVideo(
    video,
    clientArea,
    regions.background,
  );
  const cover = placeInZone(sw, sh, width, height, { fill: 1, x: 0.5, y: 0.5 });
  context.filter = 'blur(6px)';
  context.drawImage(
    video,
    sx,
    sy,
    sw,
    sh,
    cover.dx,
    cover.dy,
    cover.dw,
    cover.dh,
  );
  context.filter = 'none';
  context.fillStyle = backdropTint;
  context.fillRect(0, 0, width, height);
  const { dx, dy, dw, dh } = placeInZone(
    sw,
    sh,
    width,
    height,
    backgroundZone.view(),
  );
  context.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  // The reader places the picture the same way on the full screen, so this
  // is where it ends there too (in Menus mode the reader's own drawing
  // doesn't report it), for the sample's message window.
  setPictureBottom(((dy + dh) / height) * innerHeight);
}

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
// The text box is also checked by its picture: for short lines OCR isn't
// sure of, and lines of only dots (see text-reader.ts).
// Both rest in full-screen text mode, when the page is read instead.
const boxesActive = () => !isPageMode();
startTextReader(
  video,
  findRegion('text'),
  (line) => window.vn.setTextLine(line),
  { textBox: true, active: boxesActive },
);
// Names are often light text on a shaded plate, so they get a second try
// with the background removed.
startTextReader(
  video,
  findRegion('name'),
  (name) => window.vn.setSpeaker(tidyName(name)),
  { retryFlattened: true, active: boxesActive },
);
// The page of full-screen text, read with its paragraphs (page-view.ts).
startTextReader(video, findRegion('page'), showPage, {
  page: true,
  active: isPageMode,
});

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
