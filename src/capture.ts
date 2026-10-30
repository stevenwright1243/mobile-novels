// Shared by both pages: live capture of a game window into a <video>.

// The whole capture: used when the game's content can't be measured.
const FULL_FRAME: Region = { x: 0, y: 0, w: 1, h: 1 };

// Where the game's own content is inside the capture, leaving out the
// window's title bar and borders.
export async function getClientArea() {
  return (await window.vn.getClientArea()) ?? FULL_FRAME;
}

// Stops a capture playing in `video`, if there is one.
export function stopCapture(video: HTMLVideoElement) {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

// Starts playing a live capture of a window in `video`, replacing (and
// stopping) whatever it was showing before.
export async function playCapture(video: HTMLVideoElement, sourceId: string) {
  stopCapture(video);

  // `mandatory.chromeMediaSource` is a Chromium/Electron extension for
  // capturing a specific window by ID. It isn't in TypeScript's built-in
  // types, hence the cast.
  const constraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
    },
  } as MediaTrackConstraints;

  video.srcObject = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: constraints,
  });
  await video.play();
}

// A rectangle in the video's own pixels: `s` for "source", as in
// `drawImage`'s arguments.
export interface VideoRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

// Where a region is in the video's pixels. Regions are fractions of the
// game's content (`clientArea`), which is itself a part of the capture.
export function regionInVideo(
  video: HTMLVideoElement,
  clientArea: Region,
  region: Region,
): VideoRect {
  const contentWidth = clientArea.w * video.videoWidth;
  const contentHeight = clientArea.h * video.videoHeight;
  return {
    sx: clientArea.x * video.videoWidth + region.x * contentWidth,
    sy: clientArea.y * video.videoHeight + region.y * contentHeight,
    sw: region.w * contentWidth,
    sh: region.h * contentHeight,
  };
}

// OCR reads small text better when it's enlarged first. Tesseract reads best
// when a line of letters (top of a "k" to the bottom of a "g") is about this
// many pixels tall, so each crop is enlarged to bring its text to that size.
const TARGET_LETTER_HEIGHT = 40;
// The most and least a crop is enlarged.
const MIN_OCR_SCALE = 1;
const MAX_OCR_SCALE = 4;
// Used when the text's height can't be measured (an empty box, just dots).
const OCR_SCALE = 2;
// Letters shorter than this in the capture are probably a pixel font (old
// games): they're enlarged by a whole number with hard edges, keeping each
// pixel square, instead of being smoothed into a blur. A first guess.
const PIXEL_FONT_HEIGHT = 14;
// A pixel is part of the writing when its brightness is this far from the
// box's usual brightness, lighter or darker (0 to 255).
const TEXT_CONTRAST = 60;
// Rows of writing need this many such pixels, so stray specks don't count.
const MIN_ROW_INK = 2;
// Runs of writing rows shorter than this are lines or specks, not letters.
const MIN_LETTER_HEIGHT = 3;

// How a crop is enlarged for OCR: by `scale`, with or without smoothing.
// `letterHeight` is the measured height of its lines of text in the capture's
// pixels (null if none were found), shown by the picker's OCR test.
export interface OcrScale {
  scale: number;
  hardEdges: boolean;
  letterHeight: number | null;
}

const scaleCanvas = document.createElement('canvas');
const scaleContext = scaleCanvas.getContext('2d', {
  willReadFrequently: true,
})!;

// Measures how tall the text in a box is, and from that how much to enlarge
// it. Rows with writing in them come in runs, one run per line of text; the
// middle run height (the "median") is the letter height, which one odd run
// (a border, a stray mark) can't shift.
export function ocrScale(
  video: HTMLVideoElement,
  { sx, sy, sw, sh }: VideoRect,
): OcrScale {
  scaleCanvas.width = Math.max(1, Math.round(sw));
  scaleCanvas.height = Math.max(1, Math.round(sh));
  const { width, height } = scaleCanvas;
  scaleContext.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  const { data } = scaleContext.getImageData(0, 0, width, height);
  // Each pixel's brightness, weighted the way eyes see colour.
  const brightness = new Uint8Array(width * height);
  for (let i = 0; i < brightness.length; i++) {
    brightness[i] =
      data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
  }
  const median = brightness.slice().sort()[brightness.length >> 1];

  // The height of each run of rows with writing in them.
  const runs: number[] = [];
  let run = 0;
  for (let y = 0; y <= height; y++) {
    let ink = 0;
    for (let x = 0; y < height && x < width; x++) {
      if (Math.abs(brightness[y * width + x] - median) > TEXT_CONTRAST) {
        ink++;
      }
    }
    if (ink >= MIN_ROW_INK) {
      run++;
    } else {
      if (run >= MIN_LETTER_HEIGHT) {
        runs.push(run);
      }
      run = 0;
    }
  }
  if (runs.length === 0) {
    return { scale: OCR_SCALE, hardEdges: false, letterHeight: null };
  }
  const letterHeight = runs.sort((a, b) => a - b)[runs.length >> 1];
  let scale = Math.min(
    MAX_OCR_SCALE,
    Math.max(MIN_OCR_SCALE, TARGET_LETTER_HEIGHT / letterHeight),
  );
  const hardEdges = letterHeight < PIXEL_FONT_HEIGHT;
  if (hardEdges) {
    scale = Math.round(scale);
  }
  return { scale, hardEdges, letterHeight };
}

// How a crop is prepared for OCR:
//  - 'none': as it is.
//  - 'clean': black text on plain white, which is what OCR reads best (see
//    `toBlackOnWhite`). Works for dark text on a light box and light text
//    on a dark, see-through one.
//  - 'flatten': the background removed, leaving dark strokes on white. For
//    text that's barely different from a shaded background, like white names
//    on a light gradient plate, which 'clean' reads badly. It reads ordinary
//    text worse, though, so it's a second try (see text-reader.ts).
export type OcrPrep = 'none' | 'clean' | 'flatten';

// Copies part of the video into a PNG for OCR, enlarged to suit its text
// (`ocrScale()`, unless given), prepared as `prep` says.
export async function cropForOcr(
  video: HTMLVideoElement,
  box: VideoRect,
  prep: OcrPrep = 'clean',
  { scale, hardEdges } = ocrScale(video, box),
) {
  const { sx, sy, sw, sh } = box;
  let canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = !hardEdges;
  context.imageSmoothingQuality = 'high';
  // `filter` works like the CSS property, applied to whatever is drawn next.
  context.filter = prep === 'clean' ? 'grayscale(1) contrast(1.5)' : 'none';
  if (prep === 'flatten') {
    context.filter = 'grayscale(1)';
  }
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if (prep === 'clean') {
    toBlackOnWhite(canvas);
  }
  if (prep === 'flatten') {
    canvas = flatten(video, box, canvas, scale);
  }

  // `toBlob` hands over the PNG through a callback; wrapping it in a Promise
  // lets us `await` it instead.
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('No image'))),
      'image/png',
    ),
  );
}

// The share of a box's pixels at each end of the brightness range that are
// skipped when finding the text's brightness, so a few stray pixels can't set
// it. Text covers far more of a box than this (a short line about 4%).
const EXTREME_SHARE = 0.005;

// Turns a greyscale crop into black text on white, leaving out the
// background. Text is whichever way stands out from the box's usual
// brightness (the median): darker on a light box, lighter on a dark one.
// Pixels more than halfway from the usual brightness to the text's become
// black, the rest white. That also drops art showing through a see-through
// box (e.g. Katawa Shoujo's), since it's dimmer than the text. Then any mark
// touching the crop's edge is cleared: that's the box's frame or art cut off
// by the region, not text (so a region needs a little room around its text).
function toBlackOnWhite(canvas: HTMLCanvasElement) {
  const { width, height } = canvas;
  const context = canvas.getContext('2d')!;
  const image = context.getImageData(0, 0, width, height);
  const { data } = image;
  // Greyscale already, so red is the brightness.
  const brightness = new Uint8Array(width * height);
  for (let i = 0; i < brightness.length; i++) {
    brightness[i] = data[i * 4];
  }
  const sorted = brightness.slice().sort();
  const median = sorted[sorted.length >> 1];
  const darkest = sorted[Math.floor(sorted.length * EXTREME_SHARE)];
  const lightest = sorted[Math.floor(sorted.length * (1 - EXTREME_SHARE))];
  const lightText = lightest - median > median - darkest;
  const cut = (median + (lightText ? lightest : darkest)) / 2;
  const ink = new Uint8Array(brightness.length);
  for (let i = 0; i < ink.length; i++) {
    ink[i] = (lightText ? brightness[i] > cut : brightness[i] < cut) ? 1 : 0;
  }

  // Clear marks touching the edge: from every edge pixel, follow its ink
  // neighbours (a "flood fill") and clear them all.
  const stack: number[] = [];
  for (let x = 0; x < width; x++) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width, y * width + width - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (!ink[i]) {
      continue;
    }
    ink[i] = 0;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < ink.length - width) stack.push(i + width);
  }

  for (let i = 0; i < ink.length; i++) {
    const shade = ink[i] ? 0 : 255;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = shade;
    data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

// Removes the background from a greyscale crop (`canvas`, of `box`, enlarged
// by `scale`): it's
// compared with a blurred copy of itself (the local background shade), and
// only what differs from it is kept. That works whatever the background's
// shade, and for light text as well as dark. The difference is then
// brightened, and flipped to dark strokes on white, which OCR prefers.
function flatten(
  video: HTMLVideoElement,
  { sx, sy, sw, sh }: VideoRect,
  canvas: HTMLCanvasElement,
  scale: number,
) {
  const context = canvas.getContext('2d')!;
  // About the size of a letter's strokes and gaps.
  const blur = Math.max(3, canvas.height / 6);
  // 'difference' draws how far each pixel is from the one already there.
  context.globalCompositeOperation = 'difference';
  context.filter = `grayscale(1) blur(${blur}px)`;
  // A margin of the video around the box is blurred too, so the edges blur
  // real pixels, not empty space (which left stray marks there). A blur
  // reaches about 3 times its radius. In canvas pixels, then video pixels.
  const margin = 3 * blur;
  const videoMargin = margin / scale;
  context.drawImage(
    video,
    sx - videoMargin,
    sy - videoMargin,
    sw + 2 * videoMargin,
    sh + 2 * videoMargin,
    -margin,
    -margin,
    canvas.width + 2 * margin,
    canvas.height + 2 * margin,
  );
  const result = document.createElement('canvas');
  result.width = canvas.width;
  result.height = canvas.height;
  const resultContext = result.getContext('2d')!;
  resultContext.filter = 'brightness(2.5) invert(1) contrast(2)';
  resultContext.drawImage(canvas, 0, 0);
  return result;
}

// The bytes of a PNG, ready to send to main. IPC can carry raw bytes, and a
// Uint8Array is the usual way to send them.
export async function pngBytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
