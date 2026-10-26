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

// Fixes letters OCR commonly mistakes for "I". A `|` never appears in VN
// text, and a lowercase "l" on its own isn't an English word, so both are
// almost certainly an "I" (e.g. "| wasn't", "l'm"). Telling Tesseract never
// to output `|` doesn't work: it just picks `[` instead.
function fixCommonMistakes(text: string) {
  return (
    text
      .replaceAll('|', 'I')
      // An "l" with no letter or digit right before or after it. `\p{L}` is
      // any letter, `\p{N}` any digit; `(?<!...)` and `(?!...)` check the
      // neighbours without including them in the match.
      .replace(/(?<![\p{L}\p{N}])l(?![\p{L}\p{N}])/gu, 'I')
  );
}

// Reads the text in a PNG image.
export async function readText(png: Uint8Array): Promise<OcrResult> {
  const ocr = await getWorker();
  const start = performance.now();
  const { data } = await ocr.recognize(Buffer.from(png));
  return {
    text: fixCommonMistakes(data.text).trim(),
    confidence: Math.round(data.confidence),
    ms: Math.round(performance.now() - start),
  };
}
