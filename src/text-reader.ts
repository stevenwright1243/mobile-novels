/**
 * Reads the game's text automatically with OCR (runs in the portrait page,
 * which always has the live capture). Each box is read by its own reader:
 * the text box for the line, the name box for the speaker. The confirmed
 * text goes to main, which shares it with every window.
 *
 * The tricky part is knowing when a line is finished. Text often types out
 * a letter at a time, and the "next" arrow keeps bobbing, so the text box
 * never fully stops changing. Instead:
 *  1. A few times a second, take a tiny sample of the text box. If it has
 *     changed a lot since the last read (a new line starting), start reading.
 *  2. Keep reading until two reads in a row give the same text. That's the
 *     line, finished; send it to main and stop reading.
 */

import { cropBox, pngBytes, type VideoRect } from './capture';

// How often to check the text box, in milliseconds. Counted from the end of
// the previous check, so a slow read never piles up behind another.
const CHECK_EVERY = 250;

// The change-detection sample: the text box shrunk to this many pixels wide.
const SAMPLE_WIDTH = 160;
// How different a sample pixel must be (0 to 255) to count as changed, and
// how many must change to count as a new line. Small things, like the
// bobbing arrow, stay under this; old text being cleared doesn't.
const PIXEL_CHANGE = 32;
const MIN_CHANGED_PIXELS = 10;

const sampleCanvas = document.createElement('canvas');
// Tells the browser we'll read pixels back often, so it keeps them in memory
// instead of on the graphics card, where reading them back is slow.
const sampleContext = sampleCanvas.getContext('2d', {
  willReadFrequently: true,
})!;

// A tiny greyscale copy of the text box, for spotting changes cheaply.
function takeSample(video: HTMLVideoElement, { sx, sy, sw, sh }: VideoRect) {
  sampleCanvas.width = SAMPLE_WIDTH;
  sampleCanvas.height = Math.max(1, Math.round((SAMPLE_WIDTH * sh) / sw));
  sampleContext.drawImage(
    video,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    sampleCanvas.width,
    sampleCanvas.height,
  );
  const { data } = sampleContext.getImageData(
    0,
    0,
    sampleCanvas.width,
    sampleCanvas.height,
  );
  // `data` holds 4 numbers per pixel (red, green, blue, alpha); keep one
  // brightness value per pixel instead.
  const grey = new Uint8Array(data.length / 4);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
  }
  return grey;
}

function hasChanged(sample: Uint8Array, previous: Uint8Array | null) {
  if (!previous || previous.length !== sample.length) {
    return true;
  }
  let changed = 0;
  for (let i = 0; i < sample.length; i++) {
    if (Math.abs(sample[i] - previous[i]) > PIXEL_CHANGE) {
      changed++;
    }
  }
  return changed >= MIN_CHANGED_PIXELS;
}

// OCR keeps the game's own line breaks; the portrait re-wraps text to fit,
// so join everything into one line with single spaces.
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

// Telling real text from garbage, if OCR ever reads some (during scene
// transitions, when the text box fades and art shows). OneOCR reads bare art
// as nothing at all, and real lines at 88-99%, but quote marks and dots pull
// a short line down: "...I see." reads at 59%, a lone "“" at 8%.
const MIN_CONFIDENCE = 40;
const MIN_WORD_SHARE = 0.7;
// One word: letters or digits, joined by apostrophes or dashes ("don't",
// "clean-up", "inch—of"), maybe in quotes or brackets or after trailing-off
// dots ("...I"), maybe followed by punctuation. `\p{L}` is any letter,
// `\p{N}` any digit.
const WORD =
  /^["'“‘(.…\-–—]*[\p{L}\p{N}]+(?:['’\-–—][\p{L}\p{N}]+)*[.,!?…:;"'”’)\-–—]*$/u;
// Punctuation on its own ("...", "—") is normal in dialogue, so it counts
// neither for nor against.
const PUNCTUATION = /^[.,!?…"'“”‘’\-–—]+$/u;

function looksLikeText(text: string, confidence: number) {
  if (confidence < MIN_CONFIDENCE) {
    return false;
  }
  const words = text.split(' ').filter((word) => !PUNCTUATION.test(word));
  if (words.length === 0) {
    return true;
  }
  const real = words.filter((word) => WORD.test(word)).length;
  return real / words.length >= MIN_WORD_SHARE;
}

// --- Looking at the text box itself -------------------------------------------

// Looking at the text box's picture, a light box with dark writing ("ink")
// on it, tells two things OCR can't:
//  - A line of only dots, like "...": OCR may see nothing there at all
//    (Tesseract never did). Each separate small dark mark is a dot, and the
//    line is shown with as many ("…" for each three).
//  - Whether the box has writing on it at all (Auto: an empty read of a box
//    with writing is a line OCR couldn't read, not a pause).
// Measured in Aokana at full size: three dots are 42 dark pixels, an empty
// box 6, a line of text over 12,000 (4% of the box), and the bare art (no
// text box) is darker overall or far busier.
// "Dark" is this much darker than the box's usual brightness (0 to 255).
const INK_CONTRAST = 60;
// The box must be at least this bright, so dark boxes and bare art don't
// count.
const MIN_BOX_BRIGHTNESS = 170;
// Sizes are measured against a letter's box (a tenth of the box's height,
// squared), so they hold at any resolution. All the dark together must be
// at least this much (three dots: about 0.09; an empty box: 0.01) and at
// most this much (about 50 dots).
const MIN_DOTS_INK = 0.04;
const MAX_DOTS_INK = 1.5;
// One dot: big enough not to be a speck, small enough not to be a letter.
// In Aokana a dot is about 0.03, and a speck near the box's edge, there even
// when it's empty, about 0.013.
const MIN_DOT = 0.02;
const MAX_DOT = 0.2;
// Writing: more dark than dots, but at most this share of the box (a full
// line is about 4%, three lines about 12%; busy art can be 24%).
const MAX_WRITING_SHARE = 0.15;

const inkCanvas = document.createElement('canvas');
const inkContext = inkCanvas.getContext('2d', { willReadFrequently: true })!;

// The box's picture, measured: its usual brightness, which pixels are dark
// (1 in `ink`), how many, and a letter's size in pixels.
interface Ink {
  width: number;
  median: number;
  ink: Uint8Array;
  total: number;
  letter: number;
}

function measureInk(
  video: HTMLVideoElement,
  { sx, sy, sw, sh }: VideoRect,
): Ink {
  // Full size, since each dot is only a few pixels across.
  inkCanvas.width = Math.max(1, Math.round(sw));
  inkCanvas.height = Math.max(1, Math.round(sh));
  const { width, height } = inkCanvas;
  inkContext.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  const { data } = inkContext.getImageData(0, 0, width, height);
  // Each pixel's brightness, weighted the way eyes see colour.
  const brightness = new Uint8Array(width * height);
  for (let i = 0; i < brightness.length; i++) {
    brightness[i] =
      data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
  }
  // The box's usual brightness: the middle value (the "median"), which a
  // little writing can't shift.
  const median = brightness.slice().sort()[brightness.length >> 1];
  const ink = new Uint8Array(brightness.length);
  let total = 0;
  for (let i = 0; i < brightness.length; i++) {
    if (brightness[i] < median - INK_CONTRAST) {
      ink[i] = 1;
      total++;
    }
  }
  return { width, median, ink, total, letter: (height / 10) ** 2 };
}

// The sizes of the separate dark marks in the box, in pixels: from each
// dark pixel not counted yet, its dark neighbours are followed (a "flood
// fill") to find the whole mark.
function markSizes({ width, ink }: Ink) {
  const counted = new Uint8Array(ink.length);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || counted[start]) {
      continue;
    }
    counted[start] = 1;
    stack.push(start);
    let size = 0;
    while (stack.length > 0) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        i - width,
        i + width,
      ];
      for (const n of neighbours) {
        if (n >= 0 && n < ink.length && ink[n] && !counted[n]) {
          counted[n] = 1;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  return sizes;
}

// Whether the box is a light text box with writing on it: more dark than
// dots, or a mark bigger than a dot, a letter (a short line like "Ah..."
// has less ink than a row of dots).
function hasWriting(measured: Ink) {
  const { median, ink, total, letter } = measured;
  return (
    median >= MIN_BOX_BRIGHTNESS &&
    total <= MAX_WRITING_SHARE * ink.length &&
    (total > MAX_DOTS_INK * letter ||
      markSizes(measured).some((size) => size > MAX_DOT * letter))
  );
}

/** Whether the box in the video is a light text box with writing on it
 * (Auto: an empty line there is one OCR couldn't read, not a pause). */
export const boxHasWriting = (video: HTMLVideoElement, box: VideoRect) =>
  hasWriting(measureInk(video, box));

// The line's dots, e.g. "……" for six, or '' when the box isn't just dots:
// specks are skipped, and anything letter-sized means it isn't dots.
function readDots(measured: Ink) {
  const { median, total, letter } = measured;
  if (median < MIN_BOX_BRIGHTNESS) {
    return '';
  }
  if (total < MIN_DOTS_INK * letter || total > MAX_DOTS_INK * letter) {
    return '';
  }
  const sizes = markSizes(measured);
  if (sizes.some((size) => size > MAX_DOT * letter)) {
    return '';
  }
  const dots = sizes.filter((size) => size >= MIN_DOT * letter).length;
  return '…'.repeat(Math.floor(dots / 3)) + '.'.repeat(dots % 3);
}

// A page of full-screen text keeps its paragraphs, separated by a blank
// line, each tidied into one line.
const PARAGRAPH_BREAK = '\n\n';

// Reads a box with OCR. `text` is what was read, tidied, and `ok` whether
// it passes as text (garbage counts as an empty box). With `page`, `text`
// keeps the paragraphs (see `PARAGRAPH_BREAK`).
async function readBox(video: HTMLVideoElement, box: VideoRect, page = false) {
  const { text, confidence, paragraphs } = await window.vn.readText(
    await pngBytes(await cropBox(video, box)),
  );
  const tidied = tidy(text);
  if (page) {
    const ok = tidied !== '' && looksLikeText(tidied, confidence);
    const kept = paragraphs.map(tidy).filter((paragraph) => paragraph !== '');
    return { text: kept.join(PARAGRAPH_BREAK), confidence, ok };
  }
  const ok = tidied !== '' && looksLikeText(tidied, confidence);
  return { text: tidied, confidence, ok };
}

// Starts reading. `findTextBox` says where the box is in the video right
// now, or null when there's nothing to read yet (no capture or regions).
// `onRead` gets each confirmed read ('' when the box is empty). With
// `textBox`, the box's picture is checked too (see "Looking at the text box
// itself"): a less sure read is kept when the box clearly has writing, and
// a box of only dots reads as its dots. With `page`, the box is a page of
// full-screen text, read with its paragraphs kept (see `PARAGRAPH_BREAK`).
// While `active` says false, the reader rests, and it reads afresh (sending
// the box's text again) once it's active again.
export function startTextReader(
  video: HTMLVideoElement,
  findTextBox: () => VideoRect | null,
  onRead: (text: string) => void,
  {
    textBox = false,
    page = false,
    // `(): boolean` so TypeScript doesn't take the default's `true` as the
    // only value it may return.
    active = (): boolean => true,
  } = {},
) {
  // The sample at the last read, the text of the last read, and the last
  // line sent to main.
  let lastSample: Uint8Array | null = null;
  let lastRead: string | null = null;
  let confirmed: string | null = null;

  async function check() {
    if (!active()) {
      lastSample = null;
      lastRead = null;
      confirmed = null;
      return;
    }
    const box = findTextBox();
    if (box && box.sw >= 1 && box.sh >= 1) {
      const sample = takeSample(video, box);
      // Dots are too small to change the sample, so while the box is
      // empty, look for them each time too.
      const dotsAppeared =
        textBox && confirmed === '' && readDots(measureInk(video, box)) !== '';
      // Read when a new line has started, or to confirm an unconfirmed read.
      if (
        hasChanged(sample, lastSample) ||
        lastRead !== confirmed ||
        dotsAppeared
      ) {
        lastSample = sample;
        const result = await readBox(video, box, page);
        let read = result.ok ? result.text : '';
        if (!read && textBox) {
          read = readDots(measureInk(video, box));
        }
        if (read === lastRead && read !== confirmed) {
          confirmed = read;
          onRead(read);
        }
        lastRead = read;
      }
    }
  }

  // Check, wait, repeat. A failed check (e.g. the capture just stopped) is
  // logged but doesn't end the loop.
  async function loop() {
    try {
      await check();
    } catch (error) {
      console.error('Text reader:', error);
    }
    setTimeout(loop, CHECK_EVERY);
  }
  loop();
}
