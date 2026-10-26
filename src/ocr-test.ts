/**
 * OCR in the picker window. Shows the line read automatically by the
 * portrait (text-reader.ts), and has a test button that reads the text
 * region once and shows the image that was read next to what came back.
 */

import { cropForOcr, getClientArea, pngBytes, regionInVideo } from './capture';

const button = document.querySelector<HTMLButtonElement>('#ocr-test-button')!;
const cleanUp = document.querySelector<HTMLInputElement>('#ocr-clean-up')!;
const panel = document.querySelector<HTMLElement>('#ocr-test')!;
const image = document.querySelector<HTMLImageElement>('#ocr-image')!;
const stats = document.querySelector<HTMLElement>('#ocr-stats')!;
const output = document.querySelector<HTMLElement>('#ocr-output')!;
const liveText = document.querySelector<HTMLElement>('#live-text span')!;

// Copies the text region out of the preview, ready for OCR.
async function grabTextRegion(video: HTMLVideoElement, clean: boolean) {
  const clientArea = await getClientArea();
  const { text: region } = await window.vn.getRegions();
  return cropForOcr(video, regionInVideo(video, clientArea, region), clean);
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
    const result = await window.vn.readText(await pngBytes(blob));
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

// The line the portrait's text reader confirmed (see text-reader.ts).
window.vn.onTextLineChanged((line) => {
  liveText.textContent = line || '(waiting for text…)';
  panel.hidden = false;
});
