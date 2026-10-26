/**
 * Reads text from images with tesseract.js (OCR), in the main process. Main
 * process only: tesseract.js runs its work in a Node worker thread, so
 * reading doesn't freeze the app.
 */

import { app } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createWorker, type Worker } from 'tesseract.js';

// Started on the first read and reused after that, since starting one
// (loading the English language data) takes a second or two.
let worker: Promise<Worker> | null = null;

function getWorker() {
  worker ??= (async () => {
    // tesseract.js downloads its English data on first use and keeps a copy
    // here, so later starts work offline. Bundling it with the app instead
    // is a TODO for packaged builds.
    const cachePath = path.join(app.getPath('userData'), 'tessdata');
    await mkdir(cachePath, { recursive: true });
    return createWorker('eng', undefined, { cachePath });
  })();
  return worker;
}

// Reads the text in a PNG image.
export async function readText(png: Uint8Array): Promise<OcrResult> {
  const ocr = await getWorker();
  const start = performance.now();
  const { data } = await ocr.recognize(Buffer.from(png));
  return {
    text: data.text.trim(),
    confidence: Math.round(data.confidence),
    ms: Math.round(performance.now() - start),
  };
}
