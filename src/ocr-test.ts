/**
 * OCR in the picker window. Shows the speaker's name and the line read
 * automatically by the portrait (text-reader.ts), and, in debug mode, has a test button that
 * reads the text region once and shows the image that was read next to what
 * came back.
 */

import { grabClientArea, readTextBoxOnce } from './ocr-debug';

const debugTools = document.querySelector<HTMLElement>('#debug-tools')!;
const button = document.querySelector<HTMLButtonElement>('#ocr-test-button')!;
const cleanUp = document.querySelector<HTMLInputElement>('#ocr-clean-up')!;
const panel = document.querySelector<HTMLElement>('#ocr-test')!;
const image = document.querySelector<HTMLImageElement>('#ocr-image')!;
const stats = document.querySelector<HTMLElement>('#ocr-stats')!;
const output = document.querySelector<HTMLElement>('#ocr-output')!;
const liveName = document.querySelector<HTMLElement>('#live-name span')!;
const liveText = document.querySelector<HTMLElement>('#live-text span')!;

// The live preview to read from; set once a game is picked.
let video: HTMLVideoElement | null = null;

export function enableOcrTest(preview: HTMLVideoElement) {
  video = preview;
  button.disabled = false;
  cleanUp.disabled = false;
  saveTestButton.disabled = false;
}

// --- Saving OCR test cases ------------------------------------------------------
// When the reader gets a line wrong, the frame can be saved as a test (see
// ocr-tests.ts), with what it should have read, for `npm run ocr-bench`.

const saveTestButton =
  document.querySelector<HTMLButtonElement>('#save-ocr-test')!;
const showTestsButton =
  document.querySelector<HTMLButtonElement>('#show-ocr-tests')!;
const testDialog =
  document.querySelector<HTMLDialogElement>('#ocr-test-dialog')!;
const expectedText =
  document.querySelector<HTMLTextAreaElement>('#expected-text')!;
const expectedName =
  document.querySelector<HTMLInputElement>('#expected-name')!;
const testNameBox = document.querySelector<HTMLInputElement>('#test-name-box')!;
// Full-screen text: the page region, tested only when ticked.
const testPage = document.querySelector<HTMLInputElement>('#test-page')!;
const expectedPage =
  document.querySelector<HTMLTextAreaElement>('#expected-page')!;

saveTestButton.addEventListener('click', async () => {
  if (!video || video.videoWidth === 0) {
    return;
  }
  // The frame is taken now, before the game can move on, and the boxes are
  // filled in with what the app shows, to be corrected.
  const [png, regions, shownText, shownName] = await Promise.all([
    grabClientArea(video),
    window.vn.getRegions(),
    window.vn.getTextLine(),
    window.vn.getSpeaker(),
  ]);
  expectedText.value = shownText;
  expectedName.value = shownName;
  // Escape leaves `returnValue` as it was, so a last "save" would repeat.
  testDialog.returnValue = '';
  testDialog.showModal();
  // `close` fires once the dialog is closed, by a button or Escape.
  testDialog.addEventListener(
    'close',
    async () => {
      if (testDialog.returnValue !== 'save') {
        return;
      }
      const path = await window.vn.saveOcrTest(png, {
        savedAt: new Date().toISOString(),
        text: regions.text,
        name: testNameBox.checked ? regions.name : null,
        expectedText: expectedText.value.trim(),
        expectedName: expectedName.value.trim(),
        // `...` adds these only when the page is tested.
        ...(testPage.checked && {
          page: regions.page,
          expectedPage: expectedPage.value.trim(),
        }),
        shownText,
        shownName,
      });
      stats.textContent = `Saved OCR test: ${path}`;
      panel.hidden = false;
    },
    { once: true },
  );
});

showTestsButton.addEventListener('click', () => window.vn.showOcrTests());

// Whether each OCR read is printed in the terminal (on until the app
// restarts, or this is unticked).
const logOcr = document.querySelector<HTMLInputElement>('#log-ocr')!;
logOcr.addEventListener('change', () => window.vn.setLogOcr(logOcr.checked));
window.vn.getLogOcr().then((on) => (logOcr.checked = on));

button.addEventListener('click', async () => {
  if (!video || video.videoWidth === 0) {
    return;
  }
  button.disabled = true;
  button.textContent = 'Reading…';
  try {
    const read = await readTextBoxOnce(video, cleanUp.checked);
    URL.revokeObjectURL(image.src);
    image.src = URL.createObjectURL(read.image);
    stats.textContent = read.stats;
    output.textContent = read.text || '(no text found)';
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
