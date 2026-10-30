/**
 * Reads text from images with tesseract.js (OCR), in the main process. Main
 * process only: tesseract.js runs its work in a Node worker thread, so
 * reading doesn't freeze the app.
 */

import { app } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createWorker, PSM, type Worker } from 'tesseract.js';

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
    const ocr = await createWorker('eng', undefined, { cachePath });
    // By default Tesseract expects a scanned page and looks for columns and
    // paragraphs. A text box or name box is one block of text, so it's told
    // so. It's also told the resolution, instead of guessing it each read.
    // Both boxes share this worker, so these stay the same for every read.
    await ocr.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      user_defined_dpi: '300',
    });
    return ocr;
  })();
  return worker;
}

// Fixes letters OCR commonly mistakes for "I". A `|` never appears in VN
// text, and a lowercase "l" on its own isn't an English word, so both are
// almost certainly an "I" (e.g. "| wasn't", "l'm"). A "1" is only changed
// where a number can't be: before "'m" and the like, or in a stammer
// ("I-1 did it"). Likewise a "0" only inside a word of letters. Telling Tesseract never
// to output `|` doesn't work: it just picks `[` instead.
function fixCommonMistakes(text: string) {
  return (
    text
      .replaceAll('|', 'I')
      // An "l" with no letter or digit right before or after it. `\p{L}` is
      // any letter, `\p{N}` any digit; `(?<!...)` and `(?!...)` check the
      // neighbours without including them in the match.
      .replace(/(?<![\p{L}\p{N}])l(?![\p{L}\p{N}])/gu, 'I')
      // A "0" in a word that's otherwise letters is an "o": "so00000000"
      // is a drawn-out "sooooooooo". Capital "O" in a capitalised word
      // ("NO0O"). Words with other digits ("2000s", "10am") stay as they are,
      // and so does "0th".
      .replace(/[\p{L}\p{N}]+/gu, (word) => {
        if (
          !word.includes('0') ||
          /[1-9]/.test(word) ||
          /^0(?:st|nd|rd|th)$/i.test(word)
        ) {
          return word;
        }
        const letters = word.replace(/\P{L}/gu, '');
        if (!letters) {
          return word;
        }
        const capital = letters.length > 1 && letters === letters.toUpperCase();
        return word.replaceAll('0', capital ? 'O' : 'o');
      })
      // A "1" before an apostrophe and a letter: "1'm", "1'll", "1've".
      .replace(/(?<![\p{L}\p{N}])1(?=['’]\p{L})/gu, 'I')
      // A stammered "I" with a "1" in it: "I-1 did it", "1-I", "I-I-1".
      // Only when it has a real "I" in it or runs into an apostrophe, so a
      // score like "1-1" stays as it is.
      .replace(
        /(?<![\p{L}\p{N}])[I1](?:[-–—][I1])+(?![\p{L}\p{N}])(['’])?/gu,
        (stammer, apostrophe) =>
          stammer.includes('I') || apostrophe
            ? stammer.replaceAll('1', 'I')
            : stammer,
      )
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
