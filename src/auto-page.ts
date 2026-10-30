/**
 * Auto full-screen text (page-mode.ts's Auto): switches to the page when
 * the game fills the screen with text, and back to the text box when it
 * doesn't, by glancing at whichever region isn't in use and asking main
 * whether what's there is the game's own text (memory-text.ts: it's in the
 * game's memory; art and menus read by OCR aren't, or not as sentences).
 *
 *  - Text box in use: once the box has been empty for `QUIET_BOX`, the page
 *    region is read too (`probesPage`). Game text there means full-screen
 *    text.
 *  - Page in use: the text box is still read (`probesBox`). A line of game
 *    text there that isn't part of the page means the game is back to its
 *    text box, and so does the page staying empty for `QUIET_PAGE`.
 *
 * Where the game's memory can't be read (Steins;Gate keeps its text in its
 * own codes), a page read counts if it's clearly prose: several lines, many
 * letters.
 */

import { isPageMode, pageModeChoice, setAutoPageMode } from './page-mode';

// How long the text box must stay empty before the page is looked at, and
// how long the page must stay empty before the text box is used again, in
// milliseconds: scene changes empty both for a moment.
const QUIET_BOX = 800;
const QUIET_PAGE = 1500;
// Without the game's memory: the least a page read needs to count.
const MIN_PROSE_LINES = 2;
const MIN_PROSE_LETTERS = 80;

const letters = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

let boxEmptySince: number | null = null;
let pageEmptySince: number | null = null;
let pageText = '';
// One check with main at a time, and the latest read that came during one
// (checked next); the last text checked, so it's not asked about again
// until the mode changes.
let checking = false;
let waiting: { text: string; decide: (isGame: boolean) => void } | null = null;
let lastChecked = '';

const auto = () => pageModeChoice() === 'auto';

// Whether the page region should be read although the text box is in use.
export const probesPage = () =>
  auto() &&
  !isPageMode() &&
  boxEmptySince !== null &&
  performance.now() - boxEmptySince >= QUIET_BOX;

// Whether the text box should be read although the page is in use.
export const probesBox = () => auto() && isPageMode();

// A confirmed read of the text box ('' when it's empty). Returns whether
// it's the text box's line to show (false while the page is in use).
export function boxRead(line: string) {
  if (!isPageMode()) {
    boxEmptySince = line ? null : (boxEmptySince ?? performance.now());
    return true;
  }
  if (line && !isPartOfPage(line)) {
    void check(line, (isGame) => {
      if (isGame && isPageMode() && auto()) {
        boxEmptySince = null;
        switchTo(false);
        window.vn.setTextLine(line);
      }
    });
  }
  return false;
}

// A confirmed read of the page region ('' when it's empty). Returns whether
// it's the page to show (false while the text box is in use).
export function pageRead(text: string) {
  if (isPageMode()) {
    pageText = text;
    pageEmptySince = text ? null : (pageEmptySince ?? performance.now());
    return true;
  }
  if (text) {
    void check(text, (isGame) => {
      if (isGame && !isPageMode() && auto()) {
        pageText = text;
        pageEmptySince = null;
        switchTo(true);
      }
    });
  }
  return false;
}

// The page read when Auto switched to it (the page reader won't send it
// again, so it's shown from here).
export const latestPage = () => pageText;

function switchTo(page: boolean) {
  lastChecked = '';
  setAutoPageMode(page);
}

// Switches back to the text box once the page has been empty long enough.
setInterval(() => {
  if (
    auto() &&
    isPageMode() &&
    pageEmptySince !== null &&
    performance.now() - pageEmptySince >= QUIET_PAGE
  ) {
    pageEmptySince = null;
    boxEmptySince = performance.now();
    switchTo(false);
  }
}, 300);

// Asks main whether the text is the game's (see the top), once per text.
async function check(text: string, decide: (isGame: boolean) => void) {
  if (text === lastChecked) {
    return;
  }
  if (checking) {
    waiting = { text, decide };
    return;
  }
  checking = true;
  lastChecked = text;
  try {
    const isGame = await window.vn.isGameText(text);
    decide(isGame ?? looksLikeProse(text));
  } finally {
    checking = false;
  }
  if (waiting) {
    const next = waiting;
    waiting = null;
    void check(next.text, next.decide);
  }
}

const looksLikeProse = (text: string) =>
  text.split(/\n+/).filter((line) => line.trim()).length >= MIN_PROSE_LINES &&
  letters(text).length >= MIN_PROSE_LETTERS;

// Whether a line read from the text box is part of the page: in games whose
// page covers the text box, the box shows a bit of the page. Most of its
// longer words are on the page.
function isPartOfPage(line: string) {
  const page = letters(pageText);
  const words = line
    .split(/\s+/)
    .map(letters)
    .filter((word) => word.length >= 4);
  if (words.length === 0) {
    return true;
  }
  const found = words.filter((word) => page.includes(word)).length;
  return found / words.length >= 0.6;
}
