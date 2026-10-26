/**
 * OCR test (picker window): grabs the text region from the live preview,
 * sends it to main for reading, and shows the image that was read next to
 * the text that came back. A stepping stone to reading text automatically.
 */

import { getClientArea } from './capture';

const button = document.querySelector<HTMLButtonElement>('#ocr-test-button')!;
const cleanUp = document.querySelector<HTMLInputElement>('#ocr-clean-up')!;
const panel = document.querySelector<HTMLElement>('#ocr-test')!;
const image = document.querySelector<HTMLImageElement>('#ocr-image')!;
const stats = document.querySelector<HTMLElement>('#ocr-stats')!;
const output = document.querySelector<HTMLElement>('#ocr-output')!;

// OCR reads small text better when it's enlarged first.
const SCALE = 2;

// Copies the text region out of the video into a PNG. With `clean`, the copy
// is made greyscale with stronger contrast, which usually helps OCR.
async function grabTextRegion(video: HTMLVideoElement, clean: boolean) {
  const clientArea = await getClientArea();
  const { text: region } = await window.vn.getRegions();

  // The region in the video's pixels (same maths as portrait.ts).
  const contentWidth = clientArea.w * video.videoWidth;
  const contentHeight = clientArea.h * video.videoHeight;
  const sx = clientArea.x * video.videoWidth + region.x * contentWidth;
  const sy = clientArea.y * video.videoHeight + region.y * contentHeight;
  const sw = region.w * contentWidth;
  const sh = region.h * contentHeight;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * SCALE);
  canvas.height = Math.round(sh * SCALE);
  const context = canvas.getContext('2d')!;
  // `filter` works like the CSS property, applied to whatever is drawn next.
  context.filter = clean ? 'grayscale(1) contrast(1.5)' : 'none';
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  // `toBlob` hands over the PNG through a callback; wrapping it in a Promise
  // lets us `await` it instead.
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('No image'))),
      'image/png',
    ),
  );
  return blob;
}

// The live preview to read from; set once a game is picked.
let video: HTMLVideoElement | null = null;

export function enableOcrTest(preview: HTMLVideoElement) {
  video = preview;
  button.disabled = false;
  cleanUp.disabled = false;
}

button.addEventListener('click', async () => {
  if (!video || video.videoWidth === 0) {
    return;
  }
  button.disabled = true;
  button.textContent = 'Reading…';
  try {
    const blob = await grabTextRegion(video, cleanUp.checked);
    URL.revokeObjectURL(image.src);
    image.src = URL.createObjectURL(blob);
    // IPC can carry raw bytes; a Uint8Array is the usual way to send them.
    const png = new Uint8Array(await blob.arrayBuffer());
    const result = await window.vn.readText(png);
    stats.textContent = `Confidence ${result.confidence}% · ${result.ms} ms`;
    output.textContent = result.text || '(no text found)';
    console.log('OCR result:', result);
  } catch (error) {
    stats.textContent = 'OCR failed';
    output.textContent = String(error);
  } finally {
    panel.hidden = false;
    button.disabled = false;
    button.textContent = 'Read text (OCR test)';
  }
});
