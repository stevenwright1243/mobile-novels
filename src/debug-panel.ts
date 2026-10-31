/**
 * Debug, in the portrait's Menus sheet (a drop-down, only with `npm run
 * start:debug`): the picker's Debug tools, made for the phone.
 *
 *  - Save as OCR test: the game's frame and regions, saved in one tap with
 *    what the app shows (ocr-tests.ts). The portrait can't be typed in (it
 *    never takes focus, so taps don't take it from the game), so the right
 *    text can't be put in here: the test is marked `unchecked`, and the
 *    bench skips it until its text is filled in on the PC, from the frame.
 *  - Read the text box now: one OCR read, showing the image that was read
 *    and what came back, as the picker's test button does.
 *  - Log OCR reads: whether each read is printed in the PC's terminal.
 */

import { latestPage } from './auto-page';
import { grabClientArea, readTextBoxOnce } from './ocr-debug';
import { isPageMode } from './page-mode';

const container = document.querySelector<HTMLDetailsElement>('#debug')!;
const body = container.querySelector<HTMLElement>('.debug-body')!;

body.innerHTML = `
  <p class="sheet-note">
    Tools for when the text reads wrong. Shown only when the app is started
    with <code>npm run start:debug</code>.
  </p>
  <div class="sheet-actions">
    <button id="debug-save" class="chip save-button">Save as OCR test</button>
  </div>
  <p class="sheet-note" id="debug-save-status">
    Saves the game's picture with what the app shows now, for
    <code>npm run ocr-bench</code>. The right text is filled in later on the
    PC, from the picture.
  </p>
  <div class="sheet-actions">
    <button id="debug-read" class="chip">Read the text box now</button>
  </div>
  <figure id="debug-read-result" hidden>
    <img alt="The image that was read" />
    <figcaption>
      <p class="sheet-note debug-stats"></p>
      <p class="debug-text"></p>
    </figcaption>
  </figure>
  <div class="toggle-row">
    <span id="debug-log-ocr-label">Log OCR reads in the PC's terminal</span>
    <span class="toggle">
      <span class="toggle-side">Off</span>
      <button
        id="debug-log-ocr"
        class="toggle-switch"
        role="switch"
        aria-checked="true"
        aria-labelledby="debug-log-ocr-label"
      >
        <span class="toggle-knob"></span>
      </button>
      <span class="toggle-side">On</span>
    </span>
  </div>`;

const saveButton = body.querySelector<HTMLButtonElement>('#debug-save')!;
const saveStatus = body.querySelector<HTMLElement>('#debug-save-status')!;
const readButton = body.querySelector<HTMLButtonElement>('#debug-read')!;
const result = body.querySelector<HTMLElement>('#debug-read-result')!;
const image = result.querySelector<HTMLImageElement>('img')!;
const stats = result.querySelector<HTMLElement>('.debug-stats')!;
const text = result.querySelector<HTMLElement>('.debug-text')!;
const logOcr = body.querySelector<HTMLButtonElement>('#debug-log-ocr')!;

const isOn = (toggle: HTMLButtonElement) =>
  toggle.getAttribute('aria-checked') === 'true';
const setOn = (toggle: HTMLButtonElement, on: boolean) =>
  toggle.setAttribute('aria-checked', String(on));

// A switch flips when it or a word beside it is tapped.
for (const toggle of [logOcr]) {
  for (const target of toggle.closest('.toggle')!.children) {
    target.addEventListener('click', () => {
      setOn(toggle, !isOn(toggle));
      toggle.dispatchEvent(new Event('change'));
    });
  }
}

/** Starts the panel, reading from the portrait's capture of the game. */
export function startDebugPanel(video: HTMLVideoElement) {
  saveButton.addEventListener('click', async () => {
    if (video.videoWidth === 0) {
      saveStatus.textContent = 'No game to save: pick one first.';
      return;
    }
    saveButton.disabled = true;
    try {
      // The frame is taken first, before the game can move on.
      const [png, regions, shownText, shownName] = await Promise.all([
        grabClientArea(video),
        window.vn.getRegions(),
        window.vn.getTextLine(),
        window.vn.getSpeaker(),
      ]);
      const page = isPageMode();
      const path = await window.vn.saveOcrTest(png, {
        savedAt: new Date().toISOString(),
        // In full-screen text, the page is what's being read.
        text: page ? null : regions.text,
        name: page ? null : regions.name,
        expectedText: shownText,
        expectedName: shownName,
        // `...` adds these only in full-screen text.
        ...(page && { page: regions.page, expectedPage: latestPage() }),
        shownText,
        shownName,
        unchecked: true,
      });
      // Just the file's name, e.g. "aokana-2026-10-31-14-02-55".
      const name = path.replace(/^.*[\\/]|\.png$/g, '');
      saveStatus.textContent = `Saved ${name}. Its right text still needs filling in on the PC.`;
    } catch (error) {
      saveStatus.textContent = `Couldn't save: ${String(error)}`;
    } finally {
      saveButton.disabled = false;
    }
  });

  readButton.addEventListener('click', async () => {
    if (video.videoWidth === 0) {
      stats.textContent = 'No game to read: pick one first.';
      text.textContent = '';
      result.hidden = false;
      return;
    }
    readButton.disabled = true;
    readButton.textContent = 'Reading…';
    try {
      const read = await readTextBoxOnce(video);
      URL.revokeObjectURL(image.src);
      image.src = URL.createObjectURL(read.image);
      stats.textContent = read.stats;
      text.textContent = read.text || '(no text found)';
    } catch (error) {
      stats.textContent = 'OCR failed';
      text.textContent = String(error);
    } finally {
      result.hidden = false;
      readButton.disabled = false;
      readButton.textContent = 'Read the text box now';
    }
  });

  logOcr.addEventListener('change', () => window.vn.setLogOcr(isOn(logOcr)));
  // The picker can change it too: read each time the drop-down opens.
  const showLogOcr = () =>
    window.vn.getLogOcr().then((on) => setOn(logOcr, on));
  container.addEventListener('toggle', () => {
    if (container.open) {
      void showLogOcr();
    }
  });
  void showLogOcr();

  window.vn.isDebug().then((debug) => {
    container.hidden = !debug;
  });
}
