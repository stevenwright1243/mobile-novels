/**
 * Reads the game's text automatically with OCR (runs in the portrait page,
 * which always has the live capture). The confirmed line goes to main, which
 * shares it with every window.
 *
 * The tricky part is knowing when a line is finished. Text often types out
 * a letter at a time, and the "next" arrow keeps bobbing, so the text box
 * never fully stops changing. Instead:
 *  1. A few times a second, take a tiny sample of the text box. If it has
 *     changed a lot since the last read (a new line starting), start reading.
 *  2. Keep reading until two reads in a row give the same text. That's the
 *     line, finished; send it to main and stop reading.
 */

import { cropForOcr, pngBytes, type VideoRect } from './capture';

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
const MIN_WORD_SHARE = 0.7;
// One word: letters or digits, joined by apostrophes or dashes ("don't",
// "clean-up", "inch—of"), maybe in quotes or brackets, maybe followed by
// punctuation. `\p{L}` is any letter, `\p{N}` any digit.
const WORD =
  /^["'“‘(]*[\p{L}\p{N}]+(?:['’\-–—][\p{L}\p{N}]+)*[.,!?…:;"'”’)\-–—]*$/u;
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

// Starts reading. `findTextBox` says where the text box is in the video right
// now, or null when there's nothing to read yet (no capture or regions).
export function startTextReader(
  video: HTMLVideoElement,
  findTextBox: () => VideoRect | null,
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
      // Read when a new line has started, or to confirm an unconfirmed read.
      if (hasChanged(sample, lastSample) || lastRead !== confirmed) {
        lastSample = sample;
        const { text, confidence } = await window.vn.readText(
          await pngBytes(await cropForOcr(video, box)),
        );
        // Garbage counts as an empty text box: nothing to show.
        const tidied = tidy(text);
        const read = tidied && looksLikeText(tidied, confidence) ? tidied : '';
        if (read === lastRead && read !== confirmed) {
          confirmed = read;
          window.vn.setTextLine(read);
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
