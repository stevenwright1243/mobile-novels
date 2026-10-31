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

// Copies part of the video into a PNG for OCR, as it is: OneOCR reads the
// game's own picture best. (Tesseract needed it enlarged and turned into
// black text on white; that only made OneOCR's reads worse.)
export async function cropBox(
  video: HTMLVideoElement,
  { sx, sy, sw, sh }: VideoRect,
) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const context = canvas.getContext('2d')!;
  // A region's edges fall between pixels, so the crop is resampled even at
  // full size; the better way reads better.
  context.imageSmoothingQuality = 'high';
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  // `toBlob` hands over the PNG through a callback; wrapping it in a Promise
  // lets us `await` it instead.
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('No image'))),
      'image/png',
    ),
  );
}

// The bytes of a PNG, ready to send to main. IPC can carry raw bytes, and a
// Uint8Array is the usual way to send them.
export async function pngBytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
