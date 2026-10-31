/**
 * Auto (portrait window): the reader's top-right button. While it's on, the
 * game is moved on from each line by itself, once you'd have read it, at
 * your own pace, learned from how you read.
 *
 * Learning: whenever you tap on from a line yourself (with Auto off), how
 * long it showed and how many letters it had are noted (a `ReadingSample`;
 * the last `MAX_SAMPLES` are kept in settings.json, so it carries on
 * learning from one session to the next). From those, `fitPace` works out
 * your pace as a pause every line takes plus a time per letter, the line
 * that fits them best. Taps much quicker than anyone reads (skipping a
 * scene you've seen), long waits (you looked away) and lines you went to
 * Menus during are left out, so they don't skew it.
 *
 * Playing: each new line is clicked on `waitFor` its letters after it
 * appeared, with a bar along the bottom of the button filling up until
 * then. In full-screen text the wait counts every paragraph added since the
 * last click. If a click doesn't bring a new line (the game didn't take it,
 * or the next line is the same text), it's clicked again, at most
 * `MAX_CLICKS` times in all. Auto rests in Menus mode and while the text box
 * is empty (a scene change, a choice), and is off whenever the app starts.
 */

import { similarity } from './text-similarity';

// A reading pace: a pause every line takes, plus a time per letter (ms).
interface Pace {
  pause: number;
  perLetter: number;
}

// Auto's pace before it has learned yours: about 18 letters a second, plus
// a little over a second for each line.
const DEFAULT_PACE: Pace = { pause: 1200, perLetter: 55 };
// How many lines' worth the default counts as: with 5 learned it's half
// yours, with 20 four-fifths, so a few odd lines early on don't swing it.
const DEFAULT_WEIGHT = 5;
// The last lines learned from: enough to settle, few enough that it follows
// how you read now.
const MAX_SAMPLES = 60;
// What the pace is kept within, whatever was learned.
const PAUSE_RANGE = [300, 5000];
const PER_LETTER_RANGE = [15, 200];

// Taps to leave out of learning: quicker than this (ms) is skipping, and so
// is under `SKIM_PER_LETTER` a letter (over 65 letters a second); slower
// than `MAX_SAMPLE` you were probably away.
const MIN_SAMPLE = 400;
const SKIM_PER_LETTER = 15;
const MAX_SAMPLE = 60_000;
// Two lines' letter counts must differ by this many for the pair to say
// anything about the time per letter.
const MIN_LETTER_SPREAD = 10;
// Pairs needed before the time per letter is learned (until then the
// default's is used, and only the pause is learned).
const MIN_PAIRS = 6;

// Auto's waits are kept within these (ms). `MIN_LEFT`: the shortest time
// left before a click, so switching Auto on after reading a line a while
// still shows the bar fill before the game moves on.
const MIN_WAIT = 800;
const MAX_WAIT = 30_000;
const MIN_LEFT = 1000;
// A click that brings no new line is tried again after this long (ms),
// `MAX_CLICKS` times in all.
const RETRY_AFTER = 3000;
const MAX_CLICKS = 3;
// A changed read this alike to the last one is the same line, corrected
// (memory's exact text replacing OCR's) or read again.
const SAME_LINE = 0.6;

const button = document.querySelector<HTMLButtonElement>('#auto-button')!;
const progress = button.querySelector<HTMLElement>('.auto-progress')!;

// The middle value of a list of numbers (sorted copy).
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2
    ? sorted[Math.floor(middle)]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const clamp = (value: number, [low, high]: number[]) =>
  Math.min(high, Math.max(low, value));

// The pace that best fits the samples. The time per letter is the median of
// the slopes between every pair of lines (the Theil–Sen estimator), and the
// pause the median of what's left of each line's time once its letters are
// taken off: medians, so a few odd lines barely move it, where an average
// would follow them. Then blended with the default by how many lines there
// are to go on.
function fitPace(samples: ReadingSample[]): Pace {
  if (samples.length === 0) {
    return DEFAULT_PACE;
  }
  const slopes: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const spread = samples[j].letters - samples[i].letters;
      if (Math.abs(spread) >= MIN_LETTER_SPREAD) {
        slopes.push((samples[j].ms - samples[i].ms) / spread);
      }
    }
  }
  const perLetter = clamp(
    slopes.length >= MIN_PAIRS ? median(slopes) : DEFAULT_PACE.perLetter,
    PER_LETTER_RANGE,
  );
  const pause = clamp(
    median(samples.map(({ letters, ms }) => ms - perLetter * letters)),
    PAUSE_RANGE,
  );
  const share = samples.length / (samples.length + DEFAULT_WEIGHT);
  const blend = (learned: number, start: number) =>
    start + (learned - start) * share;
  return {
    pause: blend(pause, DEFAULT_PACE.pause),
    perLetter: blend(perLetter, DEFAULT_PACE.perLetter),
  };
}

const lettersIn = (text: string) => text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

// How long Auto gives a line of this many letters (ms).
const waitFor = (letters: number) =>
  clamp(pace.pause + pace.perLetter * letters, [MIN_WAIT, MAX_WAIT]);

let samples: ReadingSample[] = [];
let pace = DEFAULT_PACE;
window.vn.getReadingSamples().then((saved) => {
  samples = saved;
  pace = fitPace(samples);
  describe();
});

// Moves the game on (portrait.ts: clicks the text box, or the page's
// corner); false if there's no game to click.
let moveOn: () => boolean = () => false;
let on = false;
// Menus mode: Auto doesn't click.
let paused = false;

// What's shown since the game was last moved on: when it appeared
// (`performance.now()`), its letters (every paragraph's, in full-screen
// text) and the latest text.
let shownAt = 0;
let letters = 0;
let lastText = '';
// Whether the text box went empty (a scene change), so the line showing
// again starts a fresh wait.
let blank = false;
// Whether its time isn't a fair sample: Auto was on or switched, Menus was
// opened, or it went away and came back.
let unfair = true;
// The last tap or click while it showed (0 for none), whether it was Auto's,
// and how many clicks Auto has made on it.
let tappedAt = 0;
let tapByAuto = false;
let clicks = 0;
let timer: number | undefined;

function startLine(now: number, count: number) {
  shownAt = now;
  letters = count;
  tappedAt = 0;
  clicks = 0;
  unfair = on || paused;
}

// Notes a line of reading: how long you took on `letters` letters.
function learn(ms: number) {
  if (ms < MIN_SAMPLE || ms > MAX_SAMPLE || ms < letters * SKIM_PER_LETTER) {
    return;
  }
  samples = [...samples, { letters, ms: Math.round(ms) }].slice(-MAX_SAMPLES);
  pace = fitPace(samples);
  describe();
  void window.vn.setReadingSamples(samples);
}

// The button's hover text and label for screen readers: what it does, and
// the pace learned so far.
function describe() {
  const perSecond = Math.round(1000 / pace.perLetter);
  const pause = (pace.pause / 1000).toFixed(1);
  const learned = samples.length
    ? `learned from your last ${samples.length} lines`
    : 'until it learns yours from the lines you tap through';
  const label = `Auto: plays at about ${perSecond} letters a second, plus ${pause} s each line (${learned})`;
  button.title = label;
  button.setAttribute('aria-label', label);
}

// The bar along the button's bottom: filled from how far into the wait the
// line is, to full when the click comes.
function showCountdown(left: number, wait: number) {
  progress.getAnimations().forEach((animation) => animation.cancel());
  progress.animate(
    [{ scale: `${Math.max(0, 1 - left / wait)} 1` }, { scale: '1 1' }],
    { duration: left, easing: 'linear', fill: 'forwards' },
  );
}

function stop() {
  clearTimeout(timer);
  timer = undefined;
  progress.getAnimations().forEach((animation) => animation.cancel());
}

// Sets the next click for what's showing: its wait after it appeared, or
// `RETRY_AFTER` after Auto's last click.
function schedule() {
  stop();
  if (!on || paused || blank || letters === 0 || clicks >= MAX_CLICKS) {
    return;
  }
  const now = performance.now();
  const wait = clicks ? RETRY_AFTER : waitFor(letters);
  const from = clicks ? tappedAt : shownAt;
  const left = Math.max(clicks ? 0 : MIN_LEFT, from + wait - now);
  showCountdown(left, wait);
  timer = window.setTimeout(click, left);
}

function click() {
  timer = undefined;
  if (!on || paused || !moveOn()) {
    stop();
    return;
  }
  tappedAt = performance.now();
  tapByAuto = true;
  clicks++;
  schedule();
}

/** A new line (or paragraph, in full-screen text) was shown. */
export function noteText(text: string, page: boolean) {
  const count = lettersIn(text);
  if (count === 0) {
    // Nothing to read: wait for the next line.
    blank = true;
    unfair = true;
    stop();
    return;
  }
  const now = performance.now();
  const tapped = tappedAt > shownAt;
  // Auto's own click always brings on a new line, but a tap of yours may
  // only have finished one being typed out.
  const sameLine =
    !page &&
    lastText !== '' &&
    !(tapped && tapByAuto) &&
    (text.startsWith(lastText) ||
      lastText.startsWith(text) ||
      similarity(text, lastText) >= SAME_LINE);
  if (sameLine) {
    letters = count;
    if (blank) {
      // Back after a scene change or a menu: a fresh wait.
      shownAt = now;
      unfair = true;
    }
  } else if (tapped) {
    if (!tapByAuto && !unfair) {
      learn(tappedAt - shownAt);
    }
    startLine(now, count);
  } else if (page && !blank) {
    // More of the page, which you read along with the rest.
    letters += count;
  } else {
    startLine(now, count);
  }
  blank = false;
  lastText = text;
  schedule();
}

/** You tapped the game in the reader, which moves it on in most VNs. */
export function noteTap() {
  // A tap with Auto on moves on early: not a fair sample of your pace,
  // since Auto only lets you go faster than it, never slower.
  if (on) {
    unfair = true;
  }
  tappedAt = performance.now();
  tapByAuto = false;
}

/** Menus mode (true) or back to the reader (false). */
export function setAutoPaused(value: boolean) {
  paused = value;
  unfair = true;
  if (!paused) {
    // Back from Menus: a fresh wait for the line you're on.
    shownAt = performance.now();
    clicks = 0;
  }
  schedule();
}

/** How Auto moves the game on (portrait.ts); false if it couldn't. */
export function setAutoMoveOn(callback: () => boolean) {
  moveOn = callback;
}

button.addEventListener('click', () => {
  on = !on;
  button.setAttribute('aria-pressed', String(on));
  unfair = true;
  clicks = 0;
  schedule();
});

describe();
