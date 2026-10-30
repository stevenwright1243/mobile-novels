/**
 * OCR test cases, saved from the picker in debug mode ("Save as OCR test"):
 * a frame of the game where the reader went wrong, its regions, and what it
 * should have read. `npm run ocr-bench` (tools/ocr-bench) reads every one
 * of them, to check a change to OCR fixes things without breaking others.
 * Main process only. They're kept with the app's data, not in the repo,
 * since the repo is public and the frames are the games' art.
 */

import { app, shell } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ocrTestsFolder = () =>
  path.join(app.getPath('userData'), 'ocr-tests');

// Saves a test as two files with the same name: the frame (`.png`) and the
// rest (`.json`). Returns the frame's path.
export async function saveOcrTest(png: Uint8Array, test: OcrTest) {
  const folder = ocrTestsFolder();
  await mkdir(folder, { recursive: true });
  // e.g. "aokana-2026-10-30-04-52-13": the game, then when.
  const game =
    test.game
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'game';
  const when = test.savedAt.slice(0, 19).replace(/[^0-9]+/g, '-');
  const base = path.join(folder, `${game}-${when}`);
  await writeFile(`${base}.png`, png);
  await writeFile(`${base}.json`, JSON.stringify(test, null, 2));
  return `${base}.png`;
}

// Opens the tests' folder in Explorer (made first, if no test is saved yet).
export async function showOcrTests() {
  await mkdir(ocrTestsFolder(), { recursive: true });
  await shell.openPath(ocrTestsFolder());
}
