/**
 * The debug tools' OCR work, shared by the picker's Debug page (ocr-test.ts)
 * and the Menus sheet's Debug drop-down (debug-panel.ts): reading the text
 * box once, to see what OCR makes of it, and grabbing a frame to save as an
 * OCR test (ocr-tests.ts).
 */

import {
  cropForOcr,
  getClientArea,
  ocrScale,
  pngBytes,
  regionInVideo,
} from './capture';

// Copies the text region out of the video, ready for OCR, with how much it
// was enlarged (see `ocrScale()`).
async function grabTextRegion(video: HTMLVideoElement, clean: boolean) {
  const clientArea = await getClientArea();
  const { text: region } = await window.vn.getRegions();
  const box = regionInVideo(video, clientArea, region);
  const scale = ocrScale(video, box);
  const blob = await cropForOcr(video, box, clean ? 'clean' : 'none', scale);
  return { blob, scale };
}

/** Reads the text box once: the image that was read, the text ('' for
 * none), and a line about the read ("Confidence 91% · 240 ms · 2× (letters
 * 27 px)"). */
export async function readTextBoxOnce(video: HTMLVideoElement, clean: boolean) {
  const { blob, scale } = await grabTextRegion(video, clean);
  const result = await window.vn.readText(await pngBytes(blob));
  const letters = scale.letterHeight
    ? `letters ${scale.letterHeight} px`
    : 'no text measured';
  const enlarged = `${+scale.scale.toFixed(2)}× (${letters})`;
  console.log('OCR result:', result);
  return {
    image: blob,
    text: result.text,
    stats: `Confidence ${result.confidence}% · ${result.ms} ms · ${enlarged}`,
  };
}

/** The game's content (its client area) as a PNG, at the capture's full
 * size. */
export async function grabClientArea(video: HTMLVideoElement) {
  const area = await getClientArea();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(area.w * video.videoWidth);
  canvas.height = Math.round(area.h * video.videoHeight);
  canvas
    .getContext('2d')!
    .drawImage(
      video,
      area.x * video.videoWidth,
      area.y * video.videoHeight,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  return pngBytes(
    await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No image')))),
    ),
  );
}
