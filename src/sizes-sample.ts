/**
 * The Sizes panel's sample (sizes-panel.ts): a small copy of the reader
 * screen, so the sizes can be seen changing: the picture at its height,
 * the line and name, the corner buttons. `.sample-screen` is the screen's
 * layout at its full size (set here from `screen`, the reader screen's size
 * in CSS pixels; its sizes are in container units, see reader.css), scaled
 * down to the sample's width. Used by the portrait's Menus sheet, where the
 * screen is the window itself, and the picker, where it's the portrait's
 * size as the portrait reports it.
 */

// The panel is built first: this finds the sample in it.
import './sizes-panel';
import { ARROW_SHAPES } from './arrow-shapes';
import { regionInVideo } from './capture';
import {
  backgroundWidth,
  backgroundY,
  backgroundYCap,
  textStyle,
} from './portrait-sizes';
import { onThemeApplied } from './theme';
import { BACKGROUND_VIEW, placeInZone } from './zone-view';

const sample = document.querySelector<HTMLElement>('#sizes-sample')!;
const sampleScreen = sample.querySelector<HTMLElement>('.sample-screen')!;
const sampleCanvas = sample.querySelector('canvas')!;
const sampleZone = sample.querySelector<HTMLElement>('.text-zone')!;
const sampleNameTag = sample.querySelector<HTMLElement>('.name-tag')!;
const sampleName = sample.querySelector<HTMLElement>('.name-text')!;
const sampleLine = sample.querySelector<HTMLElement>('.message-window')!;
const sampleArrow = sample.querySelector<HTMLElement>('.next-arrow')!;
const sliders = document.querySelector<HTMLElement>('#sizes .sliders')!;
sampleArrow.innerHTML = ARROW_SHAPES;

// The sample's message window takes the border and arrow picked.
function showMessageStyle(style: MessageStyle) {
  sampleLine.dataset.border = style.border;
  sampleArrow.dataset.arrow = style.arrow;
}
window.vn.onMessageStyleChanged(showMessageStyle);
window.vn.getMessageStyle().then(showMessageStyle);

// The colour washed over the blurred backdrop, from the theme in
// theme.css. Read again whenever the theme changes.
const readBackdropTint = () =>
  getComputedStyle(document.documentElement)
    .getPropertyValue('--backdrop-tint')
    .trim() || 'rgb(0 0 0 / 55%)';
let backdropTint = readBackdropTint();
onThemeApplied(() => {
  backdropTint = readBackdropTint();
});

// The reader screen's size, in CSS pixels.
let screen: () => Size = () => ({ width: innerWidth, height: innerHeight });

// It's as tall as the sliders beside it (their own height, without the
// room their column spreads them over), so the last row, Text position,
// lines up with its bottom edge; its width follows from the screen's shape.
function slidersHeight() {
  const rows = [...sliders.children] as HTMLElement[];
  const gap = parseFloat(getComputedStyle(sliders).rowGap) || 0;
  return (
    rows.reduce((sum, row) => sum + row.offsetHeight, 0) +
    gap * (rows.length - 1)
  );
}

// At most this share of the panel's width, so the sliders keep room.
const MAX_SAMPLE_SHARE = 0.5;

export function fitSample() {
  const { width: screenWidth, height: screenHeight } = screen();
  if (screenWidth < 1 || screenHeight < 1) {
    return;
  }
  sampleScreen.style.width = `${screenWidth}px`;
  sampleScreen.style.height = `${screenHeight}px`;
  const height = slidersHeight();
  const body = sample.parentElement!.clientWidth;
  if (height > 0 && body > 0) {
    const width = Math.min(
      (height * screenWidth) / screenHeight,
      body * MAX_SAMPLE_SHARE,
    );
    sample.style.width = `${width}px`;
  }
  const scale = sample.clientWidth / screenWidth;
  sample.style.setProperty('--sample-scale', String(scale));
  sample.style.height = `${screenHeight * scale}px`;
}

// Sets where the reader screen's size comes from (by default this window's),
// and sizes the sample again when it's laid out (it's 0 while hidden) or
// the sliders' column changes shape.
export function setUpSample(screenSize?: () => Size) {
  if (screenSize) {
    screen = screenSize;
  }
  new ResizeObserver(fitSample).observe(sample);
  new ResizeObserver(fitSample).observe(sliders);
  addEventListener('resize', fitSample);
  fitSample();
}

// Whether the sample is on screen (not in a shut drop-down or hidden page).
export const sampleShown = () => sample.clientWidth > 0;

// The line and name, or stand-ins while there are none.
export function copyToSample(line: string, name: string) {
  sampleLine.textContent = line || 'The text will look like this.';
  sampleName.textContent = name || 'Name';
}

// The picture, where the reader places it, over a blurred, tinted copy
// (drawn simply, with a blur filter: the sample is small). Returns where
// the picture ends, from the screen's top, in the screen's CSS pixels
// (for `--picture-bottom`), or null if there was nothing to draw.
export function drawSample(
  video: HTMLVideoElement,
  clientArea: Region,
  regions: Regions,
) {
  const width = Math.round(sample.clientWidth * devicePixelRatio);
  const height = Math.round(sample.clientHeight * devicePixelRatio);
  if (width < 1 || height < 1 || !video.videoWidth) {
    return null;
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
  // As the reader places it (see portrait.ts's background zone).
  const { dx, dy, dw, dh } = placeInZone(sw, sh, width, height, {
    ...BACKGROUND_VIEW,
    width: backgroundWidth.get(),
    y: Math.min(backgroundY.get(), backgroundYCap.get()),
  });
  context.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  return ((dy + dh) / height) * screen().height;
}

// --- Portrait height cap (text position "top") -------------------------------

// How much of the screen's height Text padding 100% adds (as in
// reader.css's `--text-extra`).
const TEXT_PADDING_SHARE = 0.2;

// With text position "top", the message window hangs under the picture and
// scrolls when the text needs more room than is left (reader.css), so the
// picture can only go so low: it must leave room under it for the name tag
// and the window at its 3 lines (its `min-height`). The highest
// `backgroundY` that does, measured from a text zone's parts (the reader's
// own, or the sample's, which has the same layout at full size): 1 with
// text position "bottom", which has no cap, or null when the zone isn't laid
// out (keep the last cap).
export function backgroundYCapFor(
  parts: { zone: HTMLElement; lines: HTMLElement; tag: HTMLElement },
  video: HTMLVideoElement,
  clientArea: Region,
  regions: Regions,
  screenSize: Size = screen(),
) {
  if (textStyle.get().position !== 'top') {
    return 1;
  }
  const { zone, lines, tag } = parts;
  if (!zone.offsetHeight) {
    return null;
  }
  // The room the zone needs at 3 lines, from its parts (not the zone's own
  // height, which is squeezed when the picture is too low): the gap above
  // it (its side padding is the same `--gap`), its top and bottom padding,
  // the name tag's room (less its overlap with the window) and the window.
  const zoneStyle = getComputedStyle(zone);
  const tagStyle = getComputedStyle(tag);
  const { width: screenWidth, height: screenHeight } = screenSize;
  const room =
    parseFloat(zoneStyle.paddingLeft) +
    parseFloat(zoneStyle.paddingTop) +
    parseFloat(zoneStyle.paddingBottom) +
    tag.offsetHeight +
    parseFloat(tagStyle.marginTop) +
    parseFloat(tagStyle.marginBottom) +
    // The window at 3 lines (in Top, its `min-height` fits shorter text).
    parseFloat(getComputedStyle(lines).getPropertyValue('--three-lines')) +
    // The Text padding, above the zone (a fifth of the screen at 100%).
    (textStyle.get().padding ?? 0) * TEXT_PADDING_SHARE * screenHeight;
  // The picture's height on screen (it doesn't depend on its position),
  // and the height that puts its bottom at the lowest it may go.
  const { sw, sh } = regionInVideo(video, clientArea, regions.background);
  const { dh } = placeInZone(sw, sh, screenWidth, screenHeight, {
    ...BACKGROUND_VIEW,
    width: backgroundWidth.get(),
  });
  const lowest = screenHeight - room;
  return dh >= screenHeight
    ? 0
    : Math.min(1, Math.max(0, (lowest - dh) / (screenHeight - dh)));
}

// The sample's own text zone, for `backgroundYCapFor`.
export const sampleParts = {
  zone: sampleZone,
  lines: sampleLine,
  tag: sampleNameTag,
};
