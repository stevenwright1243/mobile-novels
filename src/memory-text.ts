/**
 * Exact text from the game's own memory (main process). Games keep the line
 * they're showing in memory, often in one buffer they write every line into.
 * Its address changes each time the game starts, so it's found again each
 * time, with OCR's read as the guide:
 *
 *  1. A line comes from OCR. Its memory is searched (read only, nothing is
 *     changed or injected) for runs of its words, as UTF-16 and UTF-8 text.
 *     Every copy found is a candidate.
 *  2. The next, different line comes. Candidates now holding that line are
 *     the game's line buffer; the best one is kept.
 *  3. From then on each line OCR confirms is read from that buffer, and used
 *     in place of OCR's read when the two match closely enough.
 *
 * OCR stays in charge of when a line shows and whether it's a line at all:
 * the buffer's text is only used when it matches what OCR sees in the text
 * box, so menu or other text in memory can never show. A buffer can hold
 * the end of a longer, earlier line after the current one (The Colorful
 * World's: "You don't?~ take school too seriously.~"), so the line ends
 * where it best matches OCR's read, plus any closing punctuation right after
 * (OCR often misreads a line's last mark). Not at a fixed end mark: that
 * game's "~" is also its line break inside lines ("I think I~finally"),
 * which becomes a space.
 */

import { prefixDistances, similarity } from './text-similarity';
import {
  closeProcess,
  openForReading,
  readMemory,
  readMemoryAsync,
  writableRegions,
} from './win32';

type Encoding = 'utf16le' | 'utf8';

// A place in the game's memory that may hold its line, and the text it
// held when found.
interface Spot {
  address: number;
  encoding: Encoding;
  found: string;
}

// How alike (letters and digits only) the memory's text and OCR's read
// must be for the memory's to be used: OCR gets a letter or two wrong.
const MATCH = 0.6;
// The most text read from a spot, in characters.
const MAX_LINE = 1024;
// How alike two reads must be to count as the same line read again.
const SAME_LINE = 0.85;
// Searches allowed without finding the buffer, per run of the game: each
// reads all its memory, so a game that doesn't keep its line in one place
// stops being searched.
const MAX_SEARCHES = 6;
// Lines in a row that don't match the buffer before it's dropped and
// searched for again (the game may have moved it).
const MAX_MISSES = 10;
// The most candidates kept from one search.
const MAX_CANDIDATES = 300;
// Runs of this many letters or more are searched for.
const MIN_NEEDLE = 12;
// Reads with fewer letters than this (a line of "......") are left as they
// are: every text with as few letters is alike to them.
const MIN_LETTERS = 2;
// Runs searched for per line.
const NEEDLES = 3;

// Found, still looking, gave up, or not in use (switched off, no game, or
// the game's memory can't be read).
let status: MemoryTextStatus = 'off';
let statusListener: (status: MemoryTextStatus) => void = () => {};
export const onMemoryTextStatus = (
  listener: (status: MemoryTextStatus) => void,
) => (statusListener = listener);
export const memoryTextStatus = () => status;
function setStatus(next: MemoryTextStatus) {
  if (next !== status) {
    status = next;
    statusListener(status);
  }
}

// Debug mode prints what the reader finds.
let debug = false;
export const setMemoryTextDebug = (on: boolean) => (debug = on);
const log = (...parts: unknown[]) =>
  debug && console.log('[memory text]', ...parts);

// What's known about the running game's memory.
interface GameMemory {
  processId: number;
  // A handle to read its memory.
  process: number;
  // Spots that held the line last searched for (`searchedFor`).
  candidates: Spot[];
  searchedFor: string;
  // The game's line buffer, once found.
  buffer: Spot | null;
  misses: number;
  searches: number;
  searching: boolean;
}
let game: GameMemory | null = null;

// Stops reading the game's memory (another game was picked, the game
// closed, or the reader was switched off).
export function forgetGame() {
  if (game) {
    closeProcess(game.process);
    game = null;
  }
  setStatus('off');
}

// Starts reading a game's memory (its status shows as searching until the
// buffer is found). Lines also start it.
export const startReading = (processId: number) => void memoryOf(processId);

function memoryOf(processId: number) {
  if (game?.processId !== processId) {
    forgetGame();
    const process = openForReading(processId);
    if (!process) {
      log('can not read the memory of process', processId);
      setStatus('not-found');
      return null;
    }
    game = {
      processId,
      process,
      candidates: [],
      searchedFor: '',
      buffer: null,
      misses: 0,
      searches: 0,
      searching: false,
    };
    setStatus('searching');
  }
  return game;
}

// Text with only its letters and digits, lowercase, for comparing: OCR's
// mistakes are mostly in punctuation and spacing.
const letters = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const alike = (a: string, b: string) => similarity(letters(a), letters(b));

// Bytes per character for searching and reading.
const width = (encoding: Encoding) => (encoding === 'utf16le' ? 2 : 1);

// The text at a spot, up to its first control character (a zero ends
// strings in memory).
function textAt(memory: GameMemory, spot: Spot) {
  const bytes = readMemory(
    memory.process,
    spot.address,
    MAX_LINE * width(spot.encoding),
  );
  if (!bytes) {
    return null;
  }
  const text = bytes.toString(spot.encoding);
  let end = 0;
  while (end < text.length && text.charCodeAt(end) >= 0x20) {
    end++;
  }
  return text.slice(0, end);
}

// Marks that close a sentence or quote, taken along after a line's end.
const CLOSING = /^[.!?…,"'”’)\]」』】]+/;

// The line at a spot, as matched against OCR's read: as much of the text as
// best matches the read (the rest is left over from an earlier, longer
// line), with any closing marks right after.
function lineAt(memory: GameMemory, spot: Spot, read: string) {
  let text = textAt(memory, spot);
  if (text === null) {
    return null;
  }
  // A "~" that isn't on screen is the game's own line break (The Colorful
  // World's "I think I~finally"), so it's a space.
  if (!read.includes('~')) {
    text = text.replaceAll('~', ' ');
  }
  // Only as far as a little past the read's length can match.
  const nearby = text.slice(0, Math.round(read.length * 1.5) + 20);
  const distances = prefixDistances(read.toLowerCase(), nearby.toLowerCase());
  let best = 0;
  let bestScore = -1;
  for (let j = 1; j < distances.length; j++) {
    const score = 1 - distances[j] / Math.max(read.length, j);
    // Strictly better only, so a tie keeps the shorter: OCR often reads a
    // line's last mark as some other mark, which closing marks then add.
    if (score > bestScore) {
      best = j;
      bestScore = score;
    }
  }
  const closing = CLOSING.exec(text.slice(best))?.[0] ?? '';
  return tidy(text.slice(0, best + closing.length));
}

const tidy = (line: string) => line.replace(/\s+/g, ' ').trim();

/**
 * The game's own text for a line OCR read, or null if it isn't known (yet):
 * the buffer isn't found, or it doesn't hold this line. While the buffer
 * isn't found, each line also searches for it, in the background.
 */
export function exactLine(processId: number, read: string) {
  if (letters(read).length < MIN_LETTERS) {
    return null;
  }
  const memory = memoryOf(processId);
  if (!memory) {
    return null;
  }
  if (!memory.buffer) {
    // Checking the last search's candidates happens straight away, so the
    // buffer may be found for this very line; a new search runs on its own.
    void search(memory, read);
    if (!memory.buffer) {
      return null;
    }
  }
  const line = lineAt(memory, memory.buffer, read);
  if (line !== null && alike(line, read) >= MATCH) {
    memory.misses = 0;
    if (line !== read) {
      log(`"${read}" → "${line}"`);
    }
    return line;
  }
  log(`no match for "${read}" (memory has "${line ?? ''}")`);
  memory.misses++;
  if (memory.misses >= MAX_MISSES) {
    log('lost the buffer; searching again');
    memory.buffer = null;
    memory.candidates = [];
    memory.searches = 0;
    setStatus('searching');
  }
  return null;
}

// Finds the buffer: checks whether a candidate from the last search has
// changed to this line; if none has, searches for this line instead. Only
// a changed one counts: OCR reads the same line a little differently each
// time, and a copy that never changes (the game's script) matches every
// read of it.
async function search(memory: GameMemory, read: string) {
  if (memory.searching) {
    return;
  }
  if (memory.candidates.length > 0) {
    const changed = memory.candidates.filter(
      (spot) => textAt(memory, spot) !== spot.found,
    );
    if (changed.length === 0) {
      // Still the line searched for: nothing to learn yet.
      return;
    }
    let best: Spot | null = null;
    let bestScore = MATCH;
    for (const spot of changed) {
      const line = lineAt(memory, spot, read);
      const score = line === null ? 0 : alike(line, read);
      if (score >= bestScore) {
        best = spot;
        bestScore = score;
      }
    }
    log(
      `${changed.length} of ${memory.candidates.length} copies changed; ${best ? 'one' : 'none'} holds "${read}"`,
    );
    if (best) {
      memory.buffer = best;
      memory.candidates = [];
      log(
        `found the line buffer at 0x${best.address.toString(16)} (${best.encoding})`,
      );
      setStatus('found');
      return;
    }
  }
  // The same line again (read a little differently): searching for it
  // would find the same copies.
  if (alike(read, memory.searchedFor) >= SAME_LINE) {
    return;
  }
  if (memory.searches >= MAX_SEARCHES) {
    setStatus('not-found');
    return;
  }
  const needles = needlesFrom(read);
  if (needles.length === 0) {
    return;
  }
  memory.searching = true;
  memory.searches++;
  const started = performance.now();
  try {
    memory.candidates = await findSpots(memory, needles);
    memory.searchedFor = read;
    log(
      `search ${memory.searches}: ${memory.candidates.length} copies of "${read}" in ${Math.round(performance.now() - started)} ms`,
    );
  } finally {
    memory.searching = false;
  }
}

// Runs of whole words from the read to search for, at least `MIN_NEEDLE`
// long, from different parts of the line. Only plain letters: OCR's
// punctuation may be wrong, and games may write apostrophes curly. A word's
// punctuation is left off, but ends the run there ("too seriously." gives
// "too seriously").
function needlesFrom(read: string) {
  const words = read.split(/\s+/).map((word) => ({
    letters: word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''),
    before: /^[^A-Za-z]/.test(word),
    after: /[^A-Za-z]$/.test(word),
  }));
  const runs: string[] = [];
  for (let start = 0; start < words.length; start++) {
    const run: string[] = [];
    for (let i = start; i < words.length; i++) {
      const word = words[i];
      if (!/^[A-Za-z]+$/.test(word.letters) || (i > start && word.before)) {
        break;
      }
      run.push(word.letters);
      if (run.join(' ').length >= MIN_NEEDLE) {
        runs.push(run.join(' '));
        break;
      }
      if (word.after) {
        break;
      }
    }
  }
  // Spread out: the first, the middle and the last.
  const picks = [0, runs.length >> 1, runs.length - 1].map((i) => runs[i]);
  return [...new Set(picks)].filter(Boolean).slice(0, NEEDLES);
}

// Every place in the game's memory holding one of the runs, as the start of
// the text around it.
async function findSpots(memory: GameMemory, needles: string[]) {
  const searches = needles.flatMap((needle) =>
    (['utf16le', 'utf8'] as const).map((encoding) => ({
      encoding,
      bytes: Buffer.from(needle, encoding),
    })),
  );
  const spots = new Map<string, Spot>();
  for (const region of writableRegions(memory.process)) {
    const bytes = await readMemoryAsync(
      memory.process,
      region.address,
      region.size,
    );
    if (!bytes) {
      continue;
    }
    for (const { encoding, bytes: needle } of searches) {
      for (
        let at = bytes.indexOf(needle);
        at !== -1 && spots.size < MAX_CANDIDATES;
        at = bytes.indexOf(needle, at + 1)
      ) {
        const start = startOfText(bytes, at, encoding);
        const address = region.address + start;
        spots.set(`${encoding}:${address}`, { address, encoding, found: '' });
      }
    }
  }
  // What each holds now, to tell later which ones change.
  for (const spot of spots.values()) {
    spot.found = textAt(memory, spot) ?? '';
  }
  return [...spots.values()];
}

// Where the text around `at` starts: back to just after a control character
// (a zero, usually), at most a line's length back.
function startOfText(bytes: Buffer, at: number, encoding: Encoding) {
  const step = width(encoding);
  let start = at;
  for (let i = 0; i < MAX_LINE && start - step >= 0; i++) {
    const code =
      step === 2 ? bytes.readUInt16LE(start - step) : bytes[start - step];
    if (code < 0x20) {
      break;
    }
    start -= step;
  }
  return start;
}
