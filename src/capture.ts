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

// OCR reads small text better when it's enlarged first.
const OCR_SCALE = 2;

// How a crop is prepared for OCR:
//  - 'none': as it is.
//  - 'clean': greyscale with stronger contrast, which usually helps.
//  - 'flatten': the background removed, leaving dark strokes on white. For
//    text that's barely different from a shaded background, like white names
//    on a light gradient plate, which 'clean' reads badly. It reads ordinary
//    text worse, though, so it's a second try (see text-reader.ts).
export type OcrPrep = 'none' | 'clean' | 'flatten';

// Copies part of the video into a PNG for OCR, enlarged, prepared as `prep`
// says.
export async function cropForOcr(
  video: HTMLVideoElement,
  box: VideoRect,
  prep: OcrPrep = 'clean',
) {
  const { sx, sy, sw, sh } = box;
  let canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * OCR_SCALE);
  canvas.height = Math.round(sh * OCR_SCALE);
  const context = canvas.getContext('2d')!;
  // `filter` works like the CSS property, applied to whatever is drawn next.
  context.filter = prep === 'clean' ? 'grayscale(1) contrast(1.5)' : 'none';
  if (prep === 'flatten') {
    context.filter = 'grayscale(1)';
  }
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if (prep === 'flatten') {
    canvas = flatten(video, box, canvas);
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

// Removes the background from a greyscale crop (`canvas`, of `box`): it's
// compared with a blurred copy of itself (the local background shade), and
// only what differs from it is kept. That works whatever the background's
// shade, and for light text as well as dark. The difference is then
// brightened, and flipped to dark strokes on white, which OCR prefers.
function flatten(
  video: HTMLVideoElement,
  { sx, sy, sw, sh }: VideoRect,
  canvas: HTMLCanvasElement,
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
  const videoMargin = margin / OCR_SCALE;
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
