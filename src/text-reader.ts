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

import { cropForOcr, type OcrPrep, pngBytes, type VideoRect } from './capture';

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

// Telling real text from garbage. During scene transitions the text box
// fades or disappears, and OCR "reads" whatever art is there. Such reads have
// low confidence (real lines score around 80) and are mostly not words.
const MIN_CONFIDENCE = 55;
// A read with the background removed (see `OcrPrep`) has to be far surer:
// it turns any edges in the art into strokes, which OCR can read as letters.
// In Aokana a real name reads at 96 that way, while a character's hair
// outline read as "7 WN" at 55.
const MIN_FLATTENED_CONFIDENCE = 80;
const MIN_WORD_SHARE = 0.7;
// One word: letters or digits, joined by apostrophes or dashes ("don't",
// "clean-up", "inch—of"), maybe in quotes or brackets, maybe followed by
// punctuation. `\p{L}` is any letter, `\p{N}` any digit.
const WORD =
  /^["'“‘(]*[\p{L}\p{N}]+(?:['’\-–—][\p{L}\p{N}]+)*[.,!?…:;"'”’)\-–—]*$/u;
// Punctuation on its own ("...", "—") is normal in dialogue, so it counts
// neither for nor against.
const PUNCTUATION = /^[.,!?…"'“”‘’\-–—]+$/u;

function looksLikeText(
  text: string,
  confidence: number,
  minConfidence = MIN_CONFIDENCE,
) {
  if (confidence < minConfidence) {
    return false;
  }
  const words = text.split(' ').filter((word) => !PUNCTUATION.test(word));
  if (words.length === 0) {
    return true;
  }
  const real = words.filter((word) => WORD.test(word)).length;
  return real / words.length >= MIN_WORD_SHARE;
}

// --- Lines of just dots -------------------------------------------------------

// OCR can't read a line that's only dots, like "..." (it sees nothing there
// at all), so such a line is spotted by looking at the box itself: a light
// box with a few small, separate dark marks on it. Each mark is a dot, and
// the line is shown with as many dots ("…" for each three). Measured in
// Aokana at full size: three dots are 42 dark pixels, an empty box 6, a line
// of text over 12,000, and the bare art (no text box) is darker overall.
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

const dotsCanvas = document.createElement('canvas');
const dotsContext = dotsCanvas.getContext('2d', { willReadFrequently: true })!;

// The line's dots, e.g. "……" for six, or '' when the box isn't just dots.
function readDots(video: HTMLVideoElement, { sx, sy, sw, sh }: VideoRect) {
  // Full size, since each dot is only a few pixels across.
  dotsCanvas.width = Math.max(1, Math.round(sw));
  dotsCanvas.height = Math.max(1, Math.round(sh));
  const { width, height } = dotsCanvas;
  dotsContext.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  const { data } = dotsContext.getImageData(0, 0, width, height);
  // Each pixel's brightness, weighted the way eyes see colour.
  const brightness = new Uint8Array(width * height);
  for (let i = 0; i < brightness.length; i++) {
    brightness[i] =
      data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
  }
  // The box's usual brightness: the middle value (the "median"), which a
  // few dark dots can't shift.
  const median = brightness.slice().sort()[brightness.length >> 1];
  if (median < MIN_BOX_BRIGHTNESS) {
    return '';
  }
  // Which pixels are dark ("ink").
  const ink = new Uint8Array(brightness.length);
  let inkTotal = 0;
  for (let i = 0; i < brightness.length; i++) {
    if (brightness[i] < median - INK_CONTRAST) {
      ink[i] = 1;
      inkTotal++;
    }
  }
  const letter = (height / 10) ** 2;
  if (inkTotal < MIN_DOTS_INK * letter || inkTotal > MAX_DOTS_INK * letter) {
    return '';
  }
  // Count the separate marks: from each dark pixel not counted yet, follow
  // its dark neighbours (a "flood fill") to find the whole mark and its
  // size. Specks are skipped; anything letter-sized means it isn't dots.
  let dots = 0;
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (ink[start] !== 1) {
      continue;
    }
    ink[start] = 2;
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
        if (n >= 0 && n < ink.length && ink[n] === 1) {
          ink[n] = 2;
          stack.push(n);
        }
      }
    }
    if (size > MAX_DOT * letter) {
      return '';
    }
    if (size >= MIN_DOT * letter) {
      dots++;
    }
  }
  return '…'.repeat(Math.floor(dots / 3)) + '.'.repeat(dots % 3);
}

// Reads a box with OCR, prepared as `prep` says. Garbage counts as an
// empty box: ''.
async function readBox(video: HTMLVideoElement, box: VideoRect, prep: OcrPrep) {
  const { text, confidence } = await window.vn.readText(
    await pngBytes(await cropForOcr(video, box, prep)),
  );
  const tidied = tidy(text);
  const minConfidence =
    prep === 'flatten' ? MIN_FLATTENED_CONFIDENCE : MIN_CONFIDENCE;
  return tidied && looksLikeText(tidied, confidence, minConfidence)
    ? tidied
    : '';
}

// Starts reading. `findTextBox` says where the box is in the video right
// now, or null when there's nothing to read yet (no capture or regions).
// `onRead` gets each confirmed read ('' when the box is empty). With
// `retryFlattened`, a box that reads as nothing is read again with its
// background removed (see `OcrPrep`), for names on shaded plates. With
// `spotDots`, a box that reads as nothing but has a few dots in it reads as
// its dots (see `readDots`), for the text box.
export function startTextReader(
  video: HTMLVideoElement,
  findTextBox: () => VideoRect | null,
  onRead: (text: string) => void,
  { retryFlattened = false, spotDots = false } = {},
) {
  // The sample at the last read, the text of the last read, and the last
  // line sent to main.
  let lastSample: Uint8Array | null = null;
  let lastRead: string | null = null;
  let confirmed: string | null = null;

  async function check() {
    const box = findTextBox();
    if (box && box.sw >= 1 && box.sh >= 1) {
      const sample = takeSample(video, box);
      // Dots are too small to change the sample, so while the box is
      // empty, look for them each time too.
      const dotsAppeared =
        spotDots && confirmed === '' && readDots(video, box) !== '';
      // Read when a new line has started, or to confirm an unconfirmed read.
      if (
        hasChanged(sample, lastSample) ||
        lastRead !== confirmed ||
        dotsAppeared
      ) {
        lastSample = sample;
        let read = await readBox(video, box, 'clean');
        if (!read && retryFlattened) {
          read = await readBox(video, box, 'flatten');
        }
        if (!read && spotDots) {
          read = readDots(video, box);
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
