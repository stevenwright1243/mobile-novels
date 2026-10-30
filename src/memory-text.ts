/**
 * Exact text from the game's own memory (main process). Games keep the line
 * they're showing in memory, often in one buffer they write every line into.
 * Its address changes each time the game starts, so it's found again each
 * time, with OCR's read as the guide:
 *
 *  1. A line comes from OCR. Its memory is searched (read only, nothing is
 *     changed or injected) for runs of its words, as UTF-16 and UTF-8 text.
 *     Every copy found is a candidate, with what it holds then.
 *  2. A later line comes. A candidate that has changed to it is the game's
 *     line buffer (only a changed one: OCR reads the same line a little
 *     differently each time, and a copy that never changes, like the game's
 *     script, matches every read of it).
 *  3. From then on the buffer leads: it's checked every `POLL_EVERY`, and
 *     each new line written to it shows straight away, exactly, even when
 *     OCR can't read it. OCR's reads are then only used for text that isn't
 *     in the buffer: a clearly different line, read a while after the
 *     buffer last changed.
 *
 * Menus and other text in memory never show: only the one buffer is read,
 * and it was found by matching what OCR saw in the text box. A new line is
 * written over the start of the last one, so the buffer can hold the end of
 * a longer, earlier line after it (The Colorful World's: "You don't?~ take
 * school too seriously.~"): the line ends where the old text's leftovers
 * begin. The mark after a line when the buffer was found (that game's "~")
 * is its end mark, taken off the end; inside a line it's the game's own line
 * break ("I think I~finally"), so a space.
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
// must be to be the same line: OCR gets a letter or two wrong.
const MATCH = 0.6;
// Once the buffer leads, an OCR read this alike to its line is that line,
// read badly ("Vow dem" for "You don't?").
const LOOSE_MATCH = 0.4;
// And any read this soon after the buffer changed is OCR catching up with
// the new line, in milliseconds.
const OCR_CATCH_UP = 3000;
// Nor is a read with fewer letters than this a line the buffer missed: it's
// junk from a scene change ("A 4").
const MIN_OCR_ONLY_LETTERS = 8;
// How often the buffer is checked once found, in milliseconds. A change
// shows once two checks in a row agree, so a half-written line never does.
const POLL_EVERY = 150;
// The most text read from a spot, in characters.
const MAX_LINE = 1024;
// How alike two reads must be to count as the same line read again.
const SAME_LINE = 0.85;
// Searches for a name allowed without finding its copy, per run of the
// game: each reads all its memory.
const MAX_SEARCHES = 6;
// Line searches in a row that find no copy of the line before the game's
// memory stops being searched (it doesn't keep its lines as UTF-16 or
// UTF-8 text: Steins;Gate). Each reads all of it, 0.15 to 1 s in the
// background, and 5 s in Steins;Gate's 839 MB.
const MAX_EMPTY_SEARCHES = 5;
// OCR reads in a row with more of the line than the followed copies hold,
// before they're dropped for good this run (see `lineForRead`).
const MAX_WRONG_FOLLOWS = 2;
// OCR lines in a row that aren't in the buffer before it's dropped and
// searched for again (the game may have moved it).
const MAX_MISSES = 5;
// Checks in a row a copy can't be read before it's dropped (freed).
const MAX_FAILED_READS = 5;
// How long the other copies get to change to a new line one copy has, in
// milliseconds, before the ones that didn't are dropped.
const FOLLOW_WAIT = 600;
// The most candidates kept from one search.
const MAX_CANDIDATES = 300;
// Runs of this many letters or more are searched for, or this many when
// OCR got so many words wrong that there's no longer run ("in for them" in
// "eventual1y c0me as a fami1y, but I'm fi1ling in for them t0day").
const MIN_NEEDLE = 12;
const MIN_SHORT_NEEDLE = 8;
// Reads with fewer letters than this (a line of "......") aren't matched
// against memory: every text with as few letters is alike to them.
const MIN_LETTERS = 2;
// Runs searched for per line: several, since OCR may have got any word
// wrong ("fTndnanage te get a single questieh": only "get a single" is
// right).
const NEEDLES = 8;

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

// Each new line the buffer gets, once it's found.
let lineListener: (line: string) => void = () => {};
export const onMemoryLine = (listener: (line: string) => void) =>
  (lineListener = listener);
// The game's own text for a line OCR read, found a moment after the read
// (see `search`), while no buffer is followed.
let correctionListener: (read: string, line: string) => void = () => {};
export const onMemoryCorrection = (
  listener: (read: string, line: string) => void,
) => (correctionListener = listener);

// Debug mode prints what the reader finds.
let debug = false;
export const setMemoryTextDebug = (on: boolean) => (debug = on);
const log = (...parts: unknown[]) =>
  debug && console.log('[memory text]', ...parts);

// One copy of the line the reader follows: its text at the last line, and
// a different text seen once, since `seenAt` (taken when a check agrees).
interface Copy {
  spot: Spot;
  raw: string;
  pending: string | null;
  seenAt: number;
  // Whether the last check agreed with `pending`.
  steady: boolean;
  failedReads: number;
}

// The game's line, once found: every copy that changed to it (the game may
// keep it in a fixed-size buffer that cuts long lines short, and in a
// string it moves elsewhere when a line needs more room), and what's known
// about it.
interface LineBuffer {
  copies: Copy[];
  // The mark after each line ('' if none was seen).
  end: string;
  // The line shown, and when it changed (`performance.now()`), and the line
  // as it is in memory (for finding it in the speakers list).
  line: string;
  changedAt: number;
  inMemory: string;
  // The writing systems seen in its lines (see `writingSystem`).
  systems: Set<string>;
  timer: ReturnType<typeof setInterval>;
}

// What's known about the running game's memory.
interface GameMemory {
  processId: number;
  // A handle to read its memory.
  process: number;
  // Spots that held the line last searched for (`searchedFor`).
  candidates: Spot[];
  searchedFor: string;
  buffer: LineBuffer | null;
  misses: number;
  searches: number;
  emptySearches: number;
  // Followed copies that held less than OCR read, in a row, and whether
  // copies are no longer followed this run (see `lineForRead`).
  wrongFollows: number;
  noFollowing: boolean;
  // The last line corrected from its copies, and OCR's read of it, so a
  // re-read of it (OCR reads it a little differently each time) keeps it.
  corrected: { read: string; line: string } | null;
  searching: boolean;
  // The speaker's name copies (see "Speakers"), and finding them.
  names: Spot[];
  nameCandidates: Spot[];
  nameSearchedFor: string;
  nameSearches: number;
  nameMisses: number;
  findingName: boolean;
}
let game: GameMemory | null = null;

// Stops reading the game's memory (another game was picked, the game
// closed, or the reader was switched off).
export function forgetGame() {
  if (game) {
    dropBuffer(game);
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
      emptySearches: 0,
      wrongFollows: 0,
      noFollowing: false,
      corrected: null,
      searching: false,
      names: [],
      nameCandidates: [],
      nameSearchedFor: '',
      nameSearches: 0,
      nameMisses: 0,
      findingName: false,
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

// Where the line in `text` ends, as matched against OCR's read: as much of
// it as best matches the read (the rest is left over from an earlier,
// longer line), with any closing marks right after.
function endFor(text: string, read: string) {
  // A "~" that isn't on screen is a line break (see the top), so a space.
  const compared = read.includes('~') ? text : text.replaceAll('~', ' ');
  // Only as far as a little past the read's length can match.
  const nearby = compared.slice(0, Math.round(read.length * 1.5) + 20);
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
  return best + (CLOSING.exec(compared.slice(best))?.[0].length ?? 0);
}

// Formatting codes engines mix into their text: Unity's rich text
// ("<alpha=#f8>", "<color=#fff>…</color>", its typewriter effect redrawing
// the line with them) and Ren'Py's ("{w}", "{i}…{/i}").
const MARKUP = /<\/?[a-z][^<>]{0,40}>|\{\/?[a-z]+(?:=[^{}]{0,20})?\}/gi;
// Characters no game shows: undecodable bytes (a length byte just before
// a UTF-8 line), half of a UTF-16 pair, invisible formatting and
// private-use characters.
const JUNK = /[\uFFFD\p{Cs}\p{Cf}\p{Co}]/gu;
const clean = (text: string) => text.replace(MARKUP, '').replace(JUNK, '');

// A line as shown: formatting codes out, the end mark off its end, the same
// mark inside it a space, and spacing tidied.
function tidy(line: string, end: string) {
  let text = clean(line);
  if (end) {
    while (text.endsWith(end)) {
      text = text.slice(0, -end.length);
    }
    text = text.replaceAll(end, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

const isWordCharacter = (character: string | undefined) =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

// The new line in the buffer's text `now`, written over `before`, as it is
// in memory: where the two stop agreeing, counting back from the end, is
// about where the new line ends (the rest is the old text's leftovers). The
// new line may happen to end like the old one ("…for me.~" over "…in
// here.~" agrees back to the "e"), so it runs on to the next end mark; with
// none known, to the end of the word and its closing marks. A text of a
// different length has no leftovers: all of it is new. `ended` says whether
// the end mark came after it; a line without one was cut off (The Colorful
// World's buffer holds about 94 characters), and `mark` is the mark the
// leftovers start with, if any (to learn the end mark from).
function newLine(now: string, before: string, end: string) {
  let stop = now.length;
  let mark = '';
  if (now.length === before.length) {
    while (stop > 0 && now[stop - 1] === before[stop - 1]) {
      stop--;
    }
    const last = now[stop - 1];
    if (last && !/[\p{L}\p{N}\s]/u.test(last) && !CLOSING.test(last)) {
      mark = last;
    }
    const at = end ? now.indexOf(end, Math.max(0, stop - end.length)) : -1;
    if (at !== -1) {
      return { piece: now.slice(0, at), ended: true, mark };
    }
    while (isWordCharacter(now[stop - 1]) && isWordCharacter(now[stop])) {
      stop++;
    }
    stop += CLOSING.exec(now.slice(stop))?.[0].length ?? 0;
    return { piece: now.slice(0, stop), ended: !end, mark };
  }
  const ended = !end || now.endsWith(end);
  return { piece: ended && end ? now.slice(0, -end.length) : now, ended, mark };
}

// The whole of a line the buffer only holds the start of: the shortest
// longer copy in memory starting with it (the game keeps the whole line
// elsewhere too, and its script has it; a reused buffer can hold leftovers
// after it, so it's never the shortest).
async function wholeLine(memory: GameMemory, start: string) {
  const spots = await findSpots(memory, [start.slice(0, 40)]);
  let whole: string | null = null;
  for (const { found } of spots) {
    if (
      found.length > start.length &&
      found.startsWith(start) &&
      (whole === null || found.length < whole.length)
    ) {
      whole = found;
    }
  }
  return whole;
}

/**
 * What to show for a line OCR read: the game's own text when it's in the
 * buffer, OCR's read otherwise, or null to leave the line shown as it is
 * (once the buffer leads: OCR read nothing, or the same line, or is still
 * catching up with a new one). While the buffer isn't found, each line also
 * searches for it, in the background.
 */
export function lineForRead(processId: number, read: string): string | null {
  const memory = memoryOf(processId);
  if (!memory) {
    return read;
  }
  const { buffer } = memory;
  if (buffer && isPartOf(buffer.line, read)) {
    // OCR read clearly more of the line than the followed copies hold:
    // they're not the game's line buffer but its typewriter
    // effect (Ren'Py builds the line a letter at a time as new strings, and
    // they can reuse the same memory: "I ponder the meaning of the note,
    // the snowfall graduall" for "As I ponder … thickens."). After
    // `MAX_WRONG_FOLLOWS`, copies are no longer followed this run, and lines
    // are matched one by one instead, from this one on.
    memory.wrongFollows++;
    log(`OCR read "${read}"; the followed copies hold "${buffer.line}"`);
    if (memory.wrongFollows >= MAX_WRONG_FOLLOWS) {
      log(
        'the followed copies only hold parts of lines; matching lines instead',
      );
      memory.noFollowing = true;
      dropBuffer(memory);
      void search(memory, read);
    }
    // OCR's read has more of the line.
    return read;
  } else if (buffer) {
    memory.wrongFollows = 0;
  }
  if (buffer) {
    if (
      letters(read).length < MIN_OCR_ONLY_LETTERS ||
      alike(read, buffer.line) >= LOOSE_MATCH ||
      performance.now() - buffer.changedAt < OCR_CATCH_UP
    ) {
      memory.misses = 0;
      return null;
    }
    log(`"${read}" isn't in the buffer ("${buffer.line}"): OCR's shows`);
    memory.misses++;
    if (memory.misses >= MAX_MISSES) {
      log('lost the buffer; searching again');
      dropBuffer(memory);
    }
    return read;
  }
  if (letters(read).length < MIN_LETTERS) {
    return read;
  }
  const { corrected } = memory;
  if (corrected && alike(read, corrected.read) >= SAME_LINE) {
    return corrected.line;
  }
  // Checking the last search's candidates happens straight away, so the
  // buffer may be found for this very line; a new search runs on its own.
  void search(memory, read);
  const found = memory.buffer as LineBuffer | null;
  return found ? found.line : read;
}

// Whether a line from memory holds all of what OCR read: not clearly
// shorter, and starting the same way (OCR's mistakes aside).
function holdsWhole(line: string, read: string) {
  const fromMemory = letters(line);
  const fromOcr = letters(read);
  if (fromOcr.length < MIN_OCR_ONLY_LETTERS) {
    return true;
  }
  // No letters from a writing system the read doesn't use (data before the
  // string read as text: "䭠ᑏshy, joyous…" for "A shy, joyous…").
  const systems = writingSystems(read);
  return (
    [...writingSystems(line)].every((system) => systems.has(system)) &&
    fromOcr.length <= fromMemory.length * 1.05 + 1 &&
    similarity(fromOcr.slice(0, 10), fromMemory.slice(0, 10)) >= 0.8
  );
}

// Whether a line from memory is clearly only part of what OCR read: OCR
// has much more, and memory's matches the start of it (allowing a word or
// so missing there). Junk OCR adds to a read doesn't count, since it seldom
// lines up with memory's line like that.
function isPartOf(line: string, read: string) {
  const fromMemory = letters(line);
  const fromOcr = letters(read);
  if (fromOcr.length <= fromMemory.length * 1.15 + 3) {
    return false;
  }
  return similarity(fromOcr.slice(0, fromMemory.length + 4), fromMemory) >= 0.8;
}

// Starts following the copies that changed to `read` as the game's line.
function useBuffer(memory: GameMemory, spots: Spot[], read: string) {
  const [first] = spots;
  const raw = textAt(memory, first) ?? '';
  const stop = endFor(raw, read);
  // The mark after the line, if it's one (a letter or space isn't), or
  // what's left when that's only a mark or two (The Colorful World's UTF-8
  // copy ends each line with "A"). With nothing after it, the line may have
  // been cut off (see `newLine`), and the end mark is learned from a later
  // line.
  const after = raw.slice(stop);
  let end = '';
  if (after.length > 0 && after.length <= 2) {
    end = after;
  } else if (after.length > 2 && !/[\p{L}\p{N}\s]/u.test(after[0])) {
    end = after[0];
  }
  const line = tidy(raw.slice(0, stop), end);
  const buffer: LineBuffer = {
    copies: spots.map((spot) => ({
      spot,
      raw: textAt(memory, spot) ?? '',
      pending: null,
      seenAt: 0,
      steady: false,
      failedReads: 0,
    })),
    end,
    line,
    changedAt: performance.now(),
    inMemory: raw.slice(0, stop),
    systems: new Set(writingSystems(line)),
    timer: setInterval(() => checkBuffer(memory), POLL_EVERY),
  };
  memory.buffer = buffer;
  memory.candidates = [];
  memory.misses = 0;
  const where = spots
    .map((spot) => `0x${spot.address.toString(16)} (${spot.encoding})`)
    .join(', ');
  log(`found the line at ${where}, lines end with "${end}": "${line}"`);
  setStatus('found');
  // OCR read clearly more than the copy holds: it was cut off.
  if (letters(read).length > letters(line).length * 1.1) {
    void showWhole(memory, buffer, raw.slice(0, stop));
  }
}

// The writing system of each letter in a text: Latin, Han, Hiragana and so
// on. Punctuation, digits and spaces belong to none. Invisible and unknown
// characters count as "junk", which no game writes.
const SYSTEMS = [
  'Latin',
  'Greek',
  'Cyrillic',
  'Han',
  'Hiragana',
  'Katakana',
  'Hangul',
  'Thai',
  'Arabic',
  'Hebrew',
].map((name) => ({ name, pattern: new RegExp(`\\p{Script=${name}}`, 'u') }));
function writingSystems(text: string) {
  const systems = new Set<string>();
  for (const character of text) {
    if (/[\p{Cf}\p{Co}\p{Cn}�]/u.test(character)) {
      systems.add('junk');
    } else if (/[\p{L}]/u.test(character)) {
      systems.add(
        SYSTEMS.find(({ pattern }) => pattern.test(character))?.name ?? 'other',
      );
    }
  }
  return systems;
}

// Whether a line is in the writing systems the game's lines use. A copy the
// game has moved away from gets other data written over it, which read as
// text is a jumble of letters from elsewhere ("慮猧猠畱物" in an English
// game, from bytes that aren't UTF-16 text).
const familiar = (buffer: LineBuffer, line: string) =>
  [...writingSystems(line)].every((system) => buffer.systems.has(system));

// Finds the whole of a cut-off line and shows it, if the line hasn't moved
// on meanwhile.
async function showWhole(
  memory: GameMemory,
  buffer: LineBuffer,
  start: string,
) {
  const cut = buffer.line;
  const whole = await wholeLine(memory, start);
  if (memory.buffer !== buffer || buffer.line !== cut) {
    return;
  }
  if (whole === null) {
    log(`only the start of the line is in memory: "${cut}"`);
  } else {
    // A whole line ends with the end mark, if no line has shown it yet.
    const last = whole.at(-1) ?? '';
    if (
      !buffer.end &&
      !isWordCharacter(last) &&
      !/[\s.!?…,"'”’)\]」』】]/u.test(last)
    ) {
      buffer.end = last;
      log(`lines end with "${last}"`);
    }
    buffer.line = tidy(whole, buffer.end);
    buffer.inMemory = whole;
    log(`whole line: "${buffer.line}"`);
  }
  showLine(memory, buffer);
}

// Passes on the buffer's new line.
function showLine(memory: GameMemory, buffer: LineBuffer) {
  memory.misses = 0;
  lineListener(buffer.line);
}

function dropBuffer(memory: GameMemory) {
  if (memory.buffer) {
    clearInterval(memory.buffer.timer);
    memory.buffer = null;
    memory.candidates = [];
    memory.searchedFor = '';
    memory.searches = 0;
    memory.misses = 0;
    if (game === memory) {
      setStatus('searching');
    }
  }
}

// Looks for a new line in the copies, and passes it on once they agree on
// it. A copy changes once two checks in a row see the same new text. When
// only some change, the others get `FOLLOW_WAIT` to follow, and then the
// ones that went their own way are dropped: a copy the game moved away from
// changes alone, or not at all. Of copies that disagree, the most that agree
// win, if their line is in the game's writing systems.
function checkBuffer(memory: GameMemory) {
  const buffer = memory.buffer;
  if (!buffer) {
    return;
  }
  const now = performance.now();
  for (const copy of buffer.copies) {
    const raw = textAt(memory, copy.spot);
    if (raw === null) {
      copy.failedReads++;
      continue;
    }
    copy.failedReads = 0;
    if (raw === copy.raw) {
      copy.pending = null;
      copy.steady = false;
    } else if (raw === copy.pending) {
      copy.steady = true;
    } else {
      copy.pending = raw;
      copy.seenAt = now;
      copy.steady = false;
    }
  }
  buffer.copies = buffer.copies.filter(
    (copy) => copy.failedReads < MAX_FAILED_READS,
  );
  const changed = buffer.copies.filter((copy) => copy.steady);
  if (changed.length === 0) {
    if (buffer.copies.length === 0) {
      log('the line can no longer be read; searching again');
      dropBuffer(memory);
    }
    return;
  }
  const others = buffer.copies.filter((copy) => !copy.steady);
  const firstSeen = Math.min(...changed.map((copy) => copy.seenAt));
  if (others.length > 0 && now - firstSeen < FOLLOW_WAIT) {
    return;
  }
  // Each changed copy's new line, grouped by how it starts.
  const groups = new Map<
    string,
    { copies: Copy[]; piece: string; ended: boolean; mark: string }
  >();
  for (const copy of changed) {
    const found = newLine(copy.pending!, copy.raw, buffer.end);
    const key = letters(found.piece).slice(0, 24);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { copies: [copy], ...found });
    } else {
      group.copies.push(copy);
      // A whole line beats a cut-off one.
      if (
        (found.ended && !group.ended) ||
        (found.ended === group.ended && found.piece.length > group.piece.length)
      ) {
        Object.assign(group, found);
      }
    }
  }
  const best = [...groups.values()]
    .filter((group) => familiar(buffer, tidy(group.piece, buffer.end)))
    .sort((a, b) => b.copies.length - a.copies.length)[0];
  const kept = best?.copies ?? [];
  const dropped = buffer.copies.length - kept.length;
  if (dropped > 0) {
    log(`dropped ${dropped} of ${buffer.copies.length} copies`);
  }
  buffer.copies = kept;
  if (!best) {
    log('no copy holds a line; searching again');
    dropBuffer(memory);
    return;
  }
  for (const copy of kept) {
    copy.raw = copy.pending!;
    copy.pending = null;
    copy.steady = false;
  }
  if (!buffer.end && best.mark) {
    buffer.end = best.mark;
    log(`lines end with "${best.mark}"`);
  }
  const line = tidy(best.piece, buffer.end);
  if (!line || line === buffer.line) {
    return;
  }
  // Writing systems only the more trusted lines teach: ones two copies
  // agree on.
  if (kept.length > 1) {
    for (const system of writingSystems(line)) {
      buffer.systems.add(system);
    }
  }
  buffer.line = line;
  buffer.changedAt = now;
  buffer.inMemory = best.piece;
  memory.misses = 0;
  if (best.ended) {
    log(`new line: "${line}"`);
    showLine(memory, buffer);
  } else {
    void showWhole(memory, buffer, best.piece);
  }
}

// --- Speakers ------------------------------------------------------------------
//
// The game keeps the speaker's name in memory too, written over at each new
// speaker like the line (The Colorful World: "  Kana~" in UTF-16, then
// "  Yuuma~"). It's found the same way, guided by the name box's OCR read:
// copies of a name OCR read, then the ones that changed to the next,
// different name it read. But a name copy keeps the last speaker during
// narration, so OCR still says whether a name shows (the name box reads
// nothing during narration, which OCR gets right); memory gives its exact
// spelling. When the two clearly disagree, OCR's read shows.

// A name as it is in a copy: up to the end mark (its leftovers follow),
// without the spaces the game pads it with.
function nameIn(text: string, end: string) {
  const cut = end ? text.split(end)[0] : text;
  return cut.replace(/[^\p{L}\p{N}?!)\]]+$/u, '').trim();
}

// The longest name, in characters.
const MAX_NAME = 32;

// Every place in memory holding `name` as a whole string (spaces and an
// end mark allowed around it), with what it holds, at most `MAX_CANDIDATES`.
async function findNameCopies(memory: GameMemory, name: string, end: string) {
  const copies: Spot[] = [];
  for (const region of writableRegions(memory.process)) {
    const bytes = await readMemoryAsync(
      memory.process,
      region.address,
      region.size,
    );
    if (!bytes) {
      continue;
    }
    for (const encoding of ['utf16le', 'utf8'] as const) {
      await breather();
      const needle = Buffer.from(name, encoding);
      for (
        let at = bytes.indexOf(needle);
        at !== -1 && copies.length < MAX_CANDIDATES;
        at = bytes.indexOf(needle, at + 1)
      ) {
        const start = startOfText(bytes, at, encoding);
        // Its text, up to the first control character, from the bytes at
        // hand (reading each of many copies one by one would be slow).
        let stop = at + needle.length;
        const step = width(encoding);
        while (
          stop + step <= bytes.length &&
          stop - start < MAX_NAME * 2 * step &&
          (step === 2 ? bytes.readUInt16LE(stop) : bytes[stop]) >= 0x20
        ) {
          stop += step;
        }
        const found = bytes.toString(encoding, start, stop);
        if (nameIn(found, end) === name) {
          copies.push({ address: region.address + start, encoding, found });
        }
      }
    }
  }
  return copies;
}

/**
 * The name to show for a name the name box's OCR read: '' when it read
 * none (narration), the game's own spelling when its name copy is found and
 * agrees (`MATCH`), OCR's read otherwise. While the copy isn't found, names
 * read also search for it, in the background.
 */
export function nameForRead(processId: number, read: string): string {
  const memory = memoryOf(processId);
  const buffer = memory?.buffer;
  if (!memory || !buffer || letters(read).length < MIN_LETTERS) {
    return read;
  }
  if (memory.names.length > 0) {
    const names = memory.names
      .map((spot) => textAt(memory, spot))
      .map((text) => (text === null ? '' : nameIn(text, buffer.end)))
      .filter((name) => name && familiar(buffer, name));
    const name = names.find((candidate) => alike(candidate, read) >= MATCH);
    if (name !== undefined) {
      memory.nameMisses = 0;
      if (name !== read) {
        log(`name "${read}" → "${name}"`);
      }
      return name;
    }
    log(`the name box reads "${read}"; memory has "${names[0] ?? ''}"`);
    memory.nameMisses++;
    if (memory.nameMisses >= MAX_MISSES) {
      log('lost the name; searching again');
      memory.names = [];
      memory.nameCandidates = [];
      memory.nameSearches = 0;
    }
    return read;
  }
  void findName(memory, buffer, read);
  return read;
}

// Finds the name copies: the candidates from the last search that changed
// to this name, or else searches for copies of this name.
async function findName(memory: GameMemory, buffer: LineBuffer, read: string) {
  if (memory.findingName) {
    return;
  }
  const changed = memory.nameCandidates.filter((spot) => {
    const text = textAt(memory, spot);
    return (
      text !== null && text !== spot.found && nameIn(text, buffer.end) === read
    );
  });
  if (changed.length > 0) {
    memory.names = changed;
    memory.nameCandidates = [];
    memory.nameMisses = 0;
    const where = changed
      .map((spot) => `0x${spot.address.toString(16)} (${spot.encoding})`)
      .join(', ');
    log(`found the name at ${where}: "${read}"`);
    return;
  }
  // The same name again, or out of searches.
  if (read === memory.nameSearchedFor || memory.nameSearches >= MAX_SEARCHES) {
    return;
  }
  memory.findingName = true;
  memory.nameSearches++;
  try {
    memory.nameCandidates = await findNameCopies(memory, read, buffer.end);
    memory.nameSearchedFor = read;
    log(
      `name search ${memory.nameSearches}: ${memory.nameCandidates.length} copies of "${read}"`,
    );
  } finally {
    memory.findingName = false;
  }
}

// Finds the buffer: checks whether a candidate from the last search has
// changed to this line; if none has, searches for this line instead.
async function search(memory: GameMemory, read: string) {
  if (memory.searching) {
    return;
  }
  if (memory.candidates.length > 0 && !memory.noFollowing) {
    // (None changing is no sign of the same line: in engines that make a
    // new string for every line, none ever changes.)
    const changed = memory.candidates.filter(
      (spot) => textAt(memory, spot) !== spot.found,
    );
    // Every copy that changed to all of this line is followed (see
    // `LineBuffer`), UTF-16 ones first: in The Colorful World those are the
    // ones the game draws from (its UTF-8 one is followed by a stray "A").
    const holding = changed
      .filter((spot) => {
        const text = textAt(memory, spot);
        const line = text?.slice(0, endFor(text, read)) ?? '';
        return alike(line, read) >= MATCH && holdsWhole(line, read);
      })
      .sort(
        (a, b) =>
          Number(b.encoding === 'utf16le') - Number(a.encoding === 'utf16le'),
      );
    log(
      `${changed.length} of ${memory.candidates.length} copies changed; ${holding.length} hold "${read}"`,
    );
    if (holding.length > 0) {
      useBuffer(memory, holding, read);
      return;
    }
  }
  // The same line again (read a little differently): searching for it
  // would find the same copies.
  if (alike(read, memory.searchedFor) >= SAME_LINE) {
    return;
  }
  if (memory.emptySearches >= MAX_EMPTY_SEARCHES) {
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
    // Until a buffer is followed, each line is matched with its copies
    // straight away: in engines where every line is a new string (Unity,
    // Ren'Py), none is ever rewritten for the next line.
    const exact = bestCopy(memory.candidates, read, needles);
    log(
      `search ${memory.searches}: ${memory.candidates.length} copies of "${read}" in ${Math.round(performance.now() - started)} ms${exact === null ? '' : `: "${exact}"`}`,
    );
    if (exact === null) {
      memory.emptySearches++;
      if (memory.emptySearches >= MAX_EMPTY_SEARCHES && !memory.buffer) {
        log('lines are not found in memory; leaving them to OCR');
        setStatus('not-found');
      }
    } else {
      memory.emptySearches = 0;
      if (!memory.buffer) {
        memory.corrected = { read, line: exact };
        setStatus('matching');
        correctionListener(read, exact);
      }
    }
  } finally {
    memory.searching = false;
  }
}

// The line OCR read as the game has it: of the copies found, the one that
// best matches the read (`MATCH`), formatting codes left out, or null. A
// copy can have other text before and after the line (a script with every
// language's version in a row), so the line's start is looked for around
// where a run of its words puts it, and its end where it best matches.
function bestCopy(copies: Spot[], read: string, needles: string[]) {
  let best: string | null = null;
  let bestScore = MATCH;
  // The read's writing systems: a letter from another just before the line
  // is data before the string read as text (Ren'Py's "踁This is…"), not a
  // word the line starts inside of, and it's trimmed off the line's ends.
  const systems = writingSystems(read);
  const known = (character: string | undefined) =>
    character !== undefined &&
    [...writingSystems(character)].every((system) => systems.has(system));
  // Many copies are the same text: each stretch is tried once.
  const tried = new Set<string>();
  for (const { found } of copies) {
    const text = clean(found);
    const needle = needles.find(
      (run) => text.includes(run) && read.includes(run),
    );
    if (needle === undefined) {
      continue;
    }
    const guess = text.indexOf(needle) - read.indexOf(needle);
    const stretch = text.slice(
      Math.max(0, guess - 8),
      guess + read.length * 1.5 + 20,
    );
    if (tried.has(stretch)) {
      continue;
    }
    tried.add(stretch);
    for (let start = Math.max(0, guess - 8); start <= guess + 8; start++) {
      // Not from inside a word.
      if (
        isWordCharacter(text[start - 1]) &&
        known(text[start - 1]) &&
        isWordCharacter(text[start])
      ) {
        continue;
      }
      const rest = text.slice(start);
      let line = tidy(rest.slice(0, endFor(rest, read)), '');
      const characters = [...line];
      while (characters.length > 0 && !known(characters[0])) {
        characters.shift();
      }
      while (characters.length > 0 && !known(characters.at(-1))) {
        characters.pop();
      }
      line = characters.join('').trim();
      if (!read.includes('~')) {
        line = line.replaceAll('~', ' ').replace(/\s+/g, ' ');
      }
      const score = alike(line, read);
      if (score > bestScore) {
        best = line;
        bestScore = score;
      }
    }
  }
  return best === null ? null : withQuotes(best, read);
}

// The quote marks at a line's ends as OCR saw them: Ren'Py adds them as it
// draws a character's line, so memory has the line without them, and a
// copy can have a stray one from what's stored before it.
const QUOTE = /["“”'‘’「」『』]/u;
function withQuotes(line: string, read: string) {
  let quoted = line;
  const first = read[0] ?? '';
  if (QUOTE.test(first) !== QUOTE.test(quoted[0] ?? '')) {
    quoted = QUOTE.test(first) ? first + quoted : quoted.slice(1);
  }
  const last = read.at(-1) ?? '';
  if (QUOTE.test(last) !== QUOTE.test(quoted.at(-1) ?? '')) {
    quoted = QUOTE.test(last) ? quoted + last : quoted.slice(0, -1);
  }
  return quoted;
}

// Runs of whole words from the read to search for, at least `MIN_NEEDLE`
// long (or `MIN_SHORT_NEEDLE` if there are none), from different parts of
// the line. Only plain letters: OCR's punctuation may be wrong, and games
// may write apostrophes curly. A word's punctuation is left off, but ends
// the run there ("too seriously." gives "too seriously").
function needlesFrom(read: string) {
  const runs = runsOf(read, MIN_NEEDLE);
  return runs.length > 0 ? runs : runsOf(read, MIN_SHORT_NEEDLE);
}

function runsOf(read: string, minLength: number) {
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
      if (run.join(' ').length >= minLength) {
        runs.push(run.join(' '));
        break;
      }
      if (word.after) {
        break;
      }
    }
  }
  // Spread out over the line.
  const unique = [...new Set(runs)];
  const step = Math.max(1, unique.length / NEEDLES);
  return Array.from(
    { length: Math.min(NEEDLES, unique.length) },
    (_, i) => unique[Math.floor(i * step)],
  );
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
      // Looking through a big stretch takes a while, so the main process
      // gets a turn between runs (its windows' requests wait meanwhile).
      await breather();
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

// Lets the main process handle what's waiting before going on.
const breather = () => new Promise((resolve) => setImmediate(resolve));

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
