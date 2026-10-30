/**
 * OCR in the picker window. Shows the speaker's name and the line read
 * automatically by the portrait (text-reader.ts), and, in debug mode, has a test button that
 * reads the text region once and shows the image that was read next to what
 * came back.
 */

import {
  cropForOcr,
  getClientArea,
  ocrScale,
  pngBytes,
  regionInVideo,
} from './capture';

const debugTools = document.querySelector<HTMLElement>('#debug-tools')!;
const button = document.querySelector<HTMLButtonElement>('#ocr-test-button')!;
const cleanUp = document.querySelector<HTMLInputElement>('#ocr-clean-up')!;
const panel = document.querySelector<HTMLElement>('#ocr-test')!;
const image = document.querySelector<HTMLImageElement>('#ocr-image')!;
const stats = document.querySelector<HTMLElement>('#ocr-stats')!;
const output = document.querySelector<HTMLElement>('#ocr-output')!;
const liveName = document.querySelector<HTMLElement>('#live-name span')!;
const liveText = document.querySelector<HTMLElement>('#live-text span')!;

// Copies the text region out of the preview, ready for OCR, with how much it
// was enlarged (see `ocrScale()`).
async function grabTextRegion(video: HTMLVideoElement, clean: boolean) {
  const clientArea = await getClientArea();
  const { text: region } = await window.vn.getRegions();
  const box = regionInVideo(video, clientArea, region);
  const scale = ocrScale(video, box);
  const blob = await cropForOcr(video, box, clean ? 'clean' : 'none', scale);
  return { blob, scale };
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
    const { blob, scale } = await grabTextRegion(video, cleanUp.checked);
    URL.revokeObjectURL(image.src);
    image.src = URL.createObjectURL(blob);
    const result = await window.vn.readText(await pngBytes(blob));
    // e.g. "3× hard edges (letters 11 px)".
    const letters = scale.letterHeight
      ? `letters ${scale.letterHeight} px`
      : 'no text measured';
    const enlarged = `${+scale.scale.toFixed(2)}×${scale.hardEdges ? ' hard edges' : ''} (${letters})`;
    stats.textContent = `Confidence ${result.confidence}% · ${result.ms} ms · ${enlarged}`;
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

// The name shown on the portrait's name tag, which changes along with the
// line (see `setSpeaker` in main.ts). Empty means narration.
function showName(name: string) {
  liveName.textContent = name || '(none: narration)';
}
window.vn.onSpeakerChanged(showName);
window.vn.getSpeaker().then(showName);

// The test button and its checkbox are debug tools: only shown when the app
// was started with `npm run start:debug`.
window.vn.isDebug().then((debug) => {
  debugTools.hidden = !debug;
});
