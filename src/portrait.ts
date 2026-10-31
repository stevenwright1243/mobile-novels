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
import { noteTap, noteText, setAutoMoveOn, setAutoPaused } from './auto-play';
import { ARROW_SHAPES } from './arrow-shapes';
import './menus-sheet';
import './visual-novels';
import './input-settings';
import './zoom-pad';
import './quick-save';
import {
  boxRead,
  latestPage,
  pageRead,
  probesBox,
  probesPage,
} from './auto-page';
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
import {
  backgroundYCapFor,
  copyToSample,
  drawSample,
  fitSample,
  sampleParts,
  setUpSample,
} from './sizes-sample';
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
  // Auto doesn't click while you're in the game's menus.
  setAutoPaused(rawMode);
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
nextArrow.innerHTML = ARROW_SHAPES;
function setMessageStyle(style: MessageStyle) {
  textLine.dataset.border = style.border;
  pageView.dataset.border = style.border;
  nextArrow.dataset.arrow = style.arrow;
  portrait.dataset.arrow = style.arrow;
}
window.vn.onMessageStyleChanged(setMessageStyle);
window.vn.getMessageStyle().then(setMessageStyle);

// The picker outlines the part of the background that's shown, which depends
// on the zone's shape (it changes with the window's size), so let it know.
// In CSS pixels: the zone fills the portrait, so this is also the screen's
// size, which the picker's Sizes sample is laid out at.
function reportZoneSize() {
  window.vn.setBackgroundZoneSize({
    width: backgroundCanvas.clientWidth,
    height: backgroundCanvas.clientHeight,
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
      // The reader places the picture the same way on the full screen, so
      // this is where it ends there too, for the sample's message window.
      const bottom = drawSample(video, clientArea, regions);
      if (bottom !== null) {
        setPictureBottom(bottom);
      }
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
function clickTextBox() {
  if (!regions) {
    return false;
  }
  const { x, y, w, h } = regions.text;
  window.vn.clickGame({ x: x + w / 2, y: y + h / 2 });
  return true;
}

// In full-screen text mode, a tap on the page clicks the page region's
// bottom-right corner: anywhere moves the game on, and there the mouse
// pointer (which the capture shows) stays clear of the text being read.
const PAGE_CORNER = 0.98;
function clickPageCorner() {
  if (!regions) {
    return false;
  }
  const { x, y, w, h } = regions.page;
  window.vn.clickGame({ x: x + w * PAGE_CORNER, y: y + h * PAGE_CORNER });
  return true;
}

// A tap in the reader that clicks the game: shown with a ripple, and noted
// for Auto to learn your reading pace from (auto-play.ts).
function tapWith(clickGame: () => boolean) {
  return (event: MouseEvent) => {
    if (clickGame()) {
      showRipple(event);
      noteTap();
    }
  };
}
textLine.addEventListener('click', tapWith(clickTextBox));
// The name tag too, as it's part of the message window.
nameTag.addEventListener('click', tapWith(clickTextBox));
pageView.addEventListener('click', tapWith(clickPageCorner));

// Auto moves the game on the same way a tap on the text would, if there's a
// game to click.
setAutoMoveOn(() =>
  video.videoWidth > 0
    ? isPageMode()
      ? clickPageCorner()
      : clickTextBox()
    : false,
);

// Full-screen text mode (switched in the Menus sheet): the page shows in
// place of the line and name (the `page-mode` class), and only the page
// region is read. There's no name box, so no speaker either.
onPageModeChanged((on) => {
  portrait.classList.toggle('page-mode', on);
  if (on) {
    window.vn.setSpeaker('');
    // Auto switched to the page on a read the page reader won't send again.
    if (latestPage()) {
      showPage(latestPage());
    }
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
    // In the reader this moves the game on too; in Menus it's a menu.
    if (!rawMode) {
      noteTap();
    }
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
  // Auto times its next click from it (in full-screen text, each new
  // paragraph comes here too).
  noteText(line, isPageMode());
  textLine.textContent = line;
  // A new line starts from its beginning, if it scrolls.
  textLine.scrollTop = 0;
  updateScrollState(textLine);
  copyLineToSample();
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
  copyLineToSample();
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

// The highest the picture may sit with text position "top" (see
// `backgroundYCapFor`), measured on the reader's text zone, or in Menus
// mode (where that's hidden) on the Sizes sample's. Worked out each frame.
const textZone = document.querySelector<HTMLElement>('#text-zone')!;
const pageText = document.querySelector<HTMLElement>('#page-text')!;

function updateBackgroundYCap(regions: Regions) {
  const parts = rawMode
    ? sampleParts
    : {
        zone: textZone,
        lines: isPageMode() ? pageText : textLine,
        tag: nameTag,
      };
  const cap = backgroundYCapFor(parts, video, clientArea, regions, {
    width: innerWidth,
    height: innerHeight,
  });
  if (cap !== null) {
    backgroundYCap.set(cap);
  }
}

// The window scrolls by dragging (when it scrolls at all), and is marked
// for being scrolled back (drag-scroll.ts), checked again whenever its
// size changes.
dragToScroll(textLine);
new ResizeObserver(() => updateScrollState(textLine)).observe(textLine);

// --- The Sizes sample ----------------------------------------------------------

// While the Menus sheet's Sizes drop-down is open, it shows a small copy of
// the reader screen (sizes-sample.ts), this window's size.
const sizesDropdown = document.querySelector<HTMLDetailsElement>('#sizes')!;
setUpSample();

const copyLineToSample = () =>
  copyToSample(textLine.textContent ?? '', nameText.textContent ?? '');
sizesDropdown.addEventListener('toggle', () => {
  copyLineToSample();
  if (sizesDropdown.open) {
    // Sized now, so the sheet knows how tall it is, then scrolled up into
    // view: it opens at the bottom of the sheet.
    fitSample();
    sizesDropdown.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

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
// Both rest in full-screen text mode, when the page is read instead, except
// that Auto still glances at the text box then (auto-page.ts).
const boxesActive = () => !isPageMode();
startTextReader(
  video,
  findRegion('text'),
  (line) => {
    if (boxRead(line)) {
      window.vn.setTextLine(line);
    }
  },
  { textBox: true, active: () => boxesActive() || probesBox() },
);
// Names are often light text on a shaded plate, so they get a second try
// with the background removed.
startTextReader(
  video,
  findRegion('name'),
  (name) => window.vn.setSpeaker(tidyName(name)),
  { retryFlattened: true, active: boxesActive },
);
// The page of full-screen text, read with its paragraphs (page-view.ts);
// with Auto, also while the text box has been empty a moment, to see if
// the game has switched to full-screen text (auto-page.ts).
startTextReader(
  video,
  findRegion('page'),
  (text) => {
    if (pageRead(text)) {
      showPage(text);
    }
  },
  { page: true, active: () => isPageMode() || probesPage() },
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

// On the phone the mouse pointer is hidden (portrait.css), but a mouse paired
// with the phone needs it. A tap jumps the pointer once, while a mouse moves
// it in a run of small steps: after a few moves in a row with no button held,
// show it, and hide it again once it's been still for a while.
const MOVES_TO_SHOW = 3;
// Moves further apart than this (ms) start a new run.
const MOVE_RUN = 300;
const HIDE_AFTER = 2000;
let moves = 0;
let lastMove = 0;
let hidePointer: number | undefined;
document.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || event.buttons) {
    return;
  }
  moves = event.timeStamp - lastMove < MOVE_RUN ? moves + 1 : 1;
  lastMove = event.timeStamp;
  if (moves < MOVES_TO_SHOW) {
    return;
  }
  document.documentElement.classList.add('pointer-shown');
  clearTimeout(hidePointer);
  hidePointer = window.setTimeout(
    () => document.documentElement.classList.remove('pointer-shown'),
    HIDE_AFTER,
  );
});
