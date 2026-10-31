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
 * Engines that make a new string for every line (Unity, Ren'Py) never
 * rewrite a buffer, but still note which string is on screen: a pointer to
 * it, set to each new line's string. Those are found and followed the same
 * way (see "Following a pointer to the line"), so memory leads there too.
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

import {
  type Alphabet,
  AlphabetCodec,
  type Codec,
  UTF16,
  UTF8,
} from './text-codec';
import { prefixDistances, similarity } from './text-similarity';
import {
  closeProcess,
  openForReading,
  pointerSizeOf,
  readMemory,
  readMemoryAsync,
  writableRegions,
} from './win32';

// A place in the game's memory that may hold its line, how its text is
// stored there (text-codec.ts), and the text it held when found. With
// `pointer`, `address` holds a pointer instead (`size` bytes), and the text
// is `offset` bytes past where it points (past the string's header).
interface Spot {
  address: number;
  codec: Codec;
  found: string;
  pointer?: { size: 4 | 8; offset: number };
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
// Runs searched for first across all of memory, where lines are matched
// one by one (see `copiesOf`).
const FIRST_NEEDLES = 2;
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
  // The latest line OCR read while a search ran, looked up once it's done
  // (else a line shown during a slow search would never be corrected).
  waiting: string | null;
  // The speaker's name copies (see "Speakers"), and finding them.
  names: Spot[];
  nameCandidates: Spot[];
  nameSearchedFor: string;
  nameSearches: number;
  nameMisses: number;
  findingName: boolean;
  // The game's own alphabet, once learned or loaded (see "Learning a game's
  // own alphabet"), and learning it.
  alphabet: AlphabetCodec | null;
  learning: boolean;
  learnTries: number;
  // Whether a copy has ever been found in UTF-16 or UTF-8 (if not, a game
  // with its own alphabet is only searched in that), and the stretches of
  // memory copies were last found in, searched first.
  standardFound: boolean;
  alphabetFound: boolean;
  // Whether `alphabetFound` is only taken on trust (a saved alphabet that
  // hasn't found text yet this run): an empty search then ends the trust.
  alphabetAssumed: boolean;
  hotRegions: number[];
  // Where the last line matched one by one starts in memory, to look for
  // the next one right after it (see `nextInScript`).
  lastLine: { codec: Codec; address: number } | null;
  // Pointers to the strings holding the last line matched one by one (see
  // "Following a pointer to the line"), looking for them, and how many
  // looks found none that followed the line.
  pointerSize: 4 | 8;
  pointerCandidates: Spot[];
  findingPointers: boolean;
  pointerSearches: number;
}
let game: GameMemory | null = null;

// Whether a game's memory is no longer the one read (another game was
// picked, or the reader switched off): its handle is closed, and Windows
// may give the same handle to the next process opened, so work still under
// way for it stops before reading memory or reporting anything (else a
// search could save its alphabet under the next game's profile).
const stale = (memory: GameMemory) => game !== memory;

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

// The alphabet saved for the game being read, if it has one.
let savedAlphabet: Alphabet | null = null;

// Starts reading a game's memory (its status shows as searching until the
// buffer is found), with the alphabet saved for it, if any. Lines also
// start it.
export function startReading(processId: number, alphabet: Alphabet | null) {
  savedAlphabet = alphabet;
  if (game?.processId === processId && !game.alphabet && alphabet) {
    game.alphabet = new AlphabetCodec(alphabet);
  }
  void memoryOf(processId);
}

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
      waiting: null,
      names: [],
      nameCandidates: [],
      nameSearchedFor: '',
      nameSearches: 0,
      nameMisses: 0,
      findingName: false,
      alphabet: savedAlphabet ? new AlphabetCodec(savedAlphabet) : null,
      learning: false,
      learnTries: 0,
      standardFound: false,
      // A saved alphabet is taken to be the game's, until it finds nothing.
      alphabetFound: savedAlphabet !== null,
      alphabetAssumed: savedAlphabet !== null,
      hotRegions: [],
      lastLine: null,
      pointerSize: pointerSizeOf(process),
      pointerCandidates: [],
      findingPointers: false,
      pointerSearches: 0,
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

// The ways the game's text may be stored: UTF-16, UTF-8, and its own
// alphabet once learned (see "Learning a game's own alphabet").
function codecsOf(memory: GameMemory) {
  if (!memory.alphabet) {
    return [UTF16, UTF8];
  }
  // Only the alphabet once it has found text this run and UTF-16 and UTF-8
  // haven't (a saved alphabet may belong to another game with the same .exe
  // name: "Game.exe").
  return memory.alphabetFound && !memory.standardFound
    ? [memory.alphabet]
    : [UTF16, UTF8, memory.alphabet];
}

// Where a pointer spot's text is now: past the header of the string it
// points to. Null if it can't be read or points nowhere.
function pointedTo(memory: GameMemory, spot: Spot) {
  const { size, offset } = spot.pointer!;
  const bytes = readMemory(memory.process, spot.address, size);
  if (!bytes || bytes.length < size) {
    return null;
  }
  const target =
    size === 4
      ? bytes.readUInt32LE(0)
      : bytes.readUInt32LE(4) * 2 ** 32 + bytes.readUInt32LE(0);
  return target === 0 ? null : target + offset;
}

// The text at a spot, up to its first control character (a zero ends
// strings in memory).
function textAt(memory: GameMemory, spot: Spot) {
  const address = spot.pointer ? pointedTo(memory, spot) : spot.address;
  if (address === null) {
    return null;
  }
  const bytes = readMemory(
    memory.process,
    address,
    MAX_LINE * spot.codec.width,
  );
  if (!bytes) {
    return null;
  }
  const text = spot.codec.decode(bytes);
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
// Control characters, data mixed into a string; those that are spacing
// (tabs, line breaks) are kept, since a game may break its lines with them.
const CONTROL = /\p{Cc}/gu;
const clean = (text: string) =>
  text
    .replace(MARKUP, '')
    .replace(JUNK, '')
    .replace(CONTROL, (character) => (/\s/.test(character) ? character : ''));

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
  // Copies from the last search that changed to this line are the game's
  // line buffer, followed from now on so memory leads (finding the line as
  // the next in the script instead would never get that far).
  if (!memory.searching && followChangedCopies(memory, read)) {
    return (memory.buffer as LineBuffer | null)?.line ?? read;
  }
  // Most often the line after the last one: no search needed, and it works
  // even when OCR reads only the start ("“What!?" with the rest in red).
  const next = nextInScript(memory, read);
  if (next !== null) {
    memory.corrected = { read, line: next };
    memory.emptySearches = 0;
    setStatus('matching');
    log(`next in the script: "${read}" → "${next}"`);
    lookForPointers(memory, next);
    return next;
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
  // A pointer leads to a string of just the line (see `findPointers`).
  const stop = first.pointer ? raw.length : endFor(raw, read);
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
  memory.pointerCandidates = [];
  memory.misses = 0;
  if (first.pointer) {
    memory.pointerSearches = 0;
  }
  const where = spots
    .map(
      (spot) =>
        `0x${spot.address.toString(16)} (${spot.pointer ? 'pointer to ' : ''}${spot.codec.name})`,
    )
    .join(', ');
  log(`found the line at ${where}, lines end with "${end}": "${line}"`);
  setStatus('found');
  // OCR read clearly more than the copy holds: it was cut off (never a
  // pointer's string, which is the whole line).
  if (!first.pointer && letters(read).length > letters(line).length * 1.1) {
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
    memory.pointerCandidates = [];
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
    // A pointer's new string is all new: nothing of the old line is left in
    // it.
    const found = copy.spot.pointer
      ? { piece: copy.pending!, ended: true, mark: '' }
      : newLine(copy.pending!, copy.raw, buffer.end);
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

// --- Telling the game's text from other text ---------------------------------

// The fewest letters a paragraph needs to be checked, and the most
// paragraphs checked: short bits (a menu's "Save", "Load") are in memory too
// as the game's own words, so only sentence-sized text counts.
const MIN_CHECKED_LETTERS = 25;
const MAX_CHECKED_PARAGRAPHS = 3;

/**
 * Whether text OCR read is the game's story text: one of its sentence-sized
 * paragraphs is in the game's memory (a menu's or the art's isn't). Null
 * when that can't be told: the game's memory isn't read (switched off, or
 * its text isn't kept as UTF-16 or UTF-8, like Steins;Gate's).
 */
export async function isGameText(
  processId: number,
  text: string,
): Promise<boolean | null> {
  const memory = memoryOf(processId);
  if (!memory || status === 'not-found' || status === 'off') {
    return null;
  }
  const paragraphs = text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => letters(paragraph).length >= MIN_CHECKED_LETTERS)
    .slice(0, MAX_CHECKED_PARAGRAPHS);
  for (const paragraph of paragraphs) {
    const needles = needlesFrom(paragraph);
    if (needles.length === 0) {
      continue;
    }
    const { match } = await copiesOf(memory, paragraph, needles);
    if (match !== null) {
      log(`game text: "${paragraph}"`);
      return true;
    }
  }
  log(`not game text: "${text.replace(/\s+/g, ' ')}"`);
  return false;
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
    // Another game picked meanwhile: its handle is closed (see `stale`).
    if (stale(memory)) {
      return [];
    }
    const bytes = await readMemoryAsync(
      memory.process,
      region.address,
      region.size,
    );
    if (!bytes) {
      continue;
    }
    for (const codec of codecsOf(memory)) {
      await breather();
      const needle = codec.encode(name);
      if (!needle) {
        continue;
      }
      for (
        let at = bytes.indexOf(needle);
        at !== -1 && copies.length < MAX_CANDIDATES;
        at = bytes.indexOf(needle, at + 1)
      ) {
        const start = startOfText(bytes, at, codec);
        // Its text, up to the first control character, from the bytes at
        // hand (reading each of many copies one by one would be slow).
        const step = codec.width;
        let stop = at + needle.length;
        if (codec instanceof AlphabetCodec) {
          stop = codec.stringEnd(bytes, stop, MAX_NAME * 2);
        } else {
          while (
            stop + step <= bytes.length &&
            stop - start < MAX_NAME * 2 * step &&
            codec.isText(codec.codeAt(bytes, stop))
          ) {
            stop += step;
          }
        }
        const found = codec.decode(bytes, start, stop);
        if (nameIn(found, end) === name) {
          copies.push({ address: region.address + start, codec, found });
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
      .map((spot) => `0x${spot.address.toString(16)} (${spot.codec.name})`)
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

// Follows the copies from the last search that changed to this line, if any
// did: the game's line buffer. Returns whether it found them.
function followChangedCopies(memory: GameMemory, read: string) {
  const candidates = [...memory.candidates, ...memory.pointerCandidates];
  if (candidates.length === 0 || memory.noFollowing) {
    return false;
  }
  // (None changing is no sign of the same line: in engines that make a
  // new string for every line, none ever changes.)
  const changed = candidates.filter(
    (spot) => textAt(memory, spot) !== spot.found,
  );
  // Every copy that changed to all of this line is followed (see
  // `LineBuffer`), UTF-16 ones first: in The Colorful World those are the
  // ones the game draws from (its UTF-8 one is followed by a stray "A").
  // A pointer's string must be just the line, nothing after it (a pointer
  // to the script's entry, with every language's version, isn't followed).
  const holding = changed
    .filter((spot) => {
      const text = textAt(memory, spot);
      if (text === null) {
        return false;
      }
      const stop = endFor(text, read);
      const line = text.slice(0, stop);
      return (
        alike(line, read) >= MATCH &&
        holdsWhole(line, read) &&
        (!spot.pointer || letters(text.slice(stop)) === '')
      );
    })
    .sort((a, b) => Number(b.codec === UTF16) - Number(a.codec === UTF16));
  log(
    `${changed.length} of ${candidates.length} copies changed; ${holding.length} hold "${read}"`,
  );
  if (holding.length === 0) {
    return false;
  }
  useBuffer(memory, holding, read);
  return true;
}

// Finds the buffer: checks whether a candidate from the last search has
// changed to this line; if none has, searches for this line instead.
async function search(memory: GameMemory, read: string) {
  if (memory.searching) {
    memory.waiting = read;
    return;
  }
  if (followChangedCopies(memory, read)) {
    return;
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
    // Until a buffer is followed, each line is matched with its copies
    // straight away: in engines where every line is a new string (Unity,
    // Ren'Py), none is ever rewritten for the next line.
    const found = await copiesOf(memory, read, needles);
    if (stale(memory)) {
      return;
    }
    let exact = found.match?.line ?? null;
    memory.candidates = found.copies;
    memory.searchedFor = read;
    // A line in the game's own alphabet can teach it codes it didn't know
    // yet ("can't" before its apostrophe was known): then it's decoded again.
    if (
      exact !== null &&
      memory.alphabet &&
      refineAlphabet(memory, memory.alphabet, read)
    ) {
      for (const spot of memory.candidates) {
        spot.found = textAt(memory, spot) ?? spot.found;
      }
      exact = bestCopy(memory.candidates, read, needles)?.line ?? exact;
    }
    // Where the line is, to look for the next one right after it.
    if (found.match) {
      memory.lastLine = {
        codec: found.match.spot.codec,
        address: found.match.spot.address,
      };
    }
    log(
      `search ${memory.searches}: ${memory.candidates.length} copies of "${read}" in ${Math.round(performance.now() - started)} ms${exact === null ? '' : `: "${exact}"`}`,
    );
    if (exact === null) {
      memory.emptySearches++;
      // (Only a saved alphabet not yet proven this run: one that has found
      // text keeps its quick searches through a line OCR garbled.)
      if (memory.alphabetAssumed) {
        memory.alphabetFound = false;
        memory.alphabetAssumed = false;
      }
      // Not in UTF-16 or UTF-8: maybe in the game's own alphabet.
      if (memory.emptySearches >= EMPTY_SEARCHES_TO_LEARN) {
        void learnAlphabet(memory, read);
      }
      if (
        memory.emptySearches >= MAX_EMPTY_SEARCHES &&
        !memory.buffer &&
        !memory.learning
      ) {
        log('lines are not found in memory; leaving them to OCR');
        setStatus('not-found');
      }
    } else {
      memory.emptySearches = 0;
      if (!memory.buffer) {
        memory.corrected = { read, line: exact };
        setStatus('matching');
        correctionListener(read, exact);
        lookForPointers(memory, exact);
      }
    }
  } finally {
    memory.searching = false;
    catchUp(memory, read);
  }
}

// Looks up the line OCR read while a search ran: the next in the script
// from the line just found, or else searched for.
function catchUp(memory: GameMemory, searched: string) {
  const read = memory.waiting;
  memory.waiting = null;
  if (read === null || stale(memory) || alike(read, searched) >= SAME_LINE) {
    return;
  }
  if (followChangedCopies(memory, read)) {
    if (memory.buffer) {
      correctionListener(read, memory.buffer.line);
    }
    return;
  }
  const next = nextInScript(memory, read);
  if (next === null) {
    void search(memory, read);
    return;
  }
  memory.corrected = { read, line: next };
  memory.emptySearches = 0;
  setStatus('matching');
  log(`next in the script (after the search): "${read}" → "${next}"`);
  correctionListener(read, next);
  lookForPointers(memory, next);
}

// The line OCR read as the game has it: of the copies found, the one that
// best matches the read (`MATCH`), formatting codes left out, or null. A
// copy can have other text before and after the line (a script with every
// language's version in a row), so the line's start is looked for around
// where a run of its words puts it, and its end where it best matches.
function bestCopy(copies: Spot[], read: string, needles: string[]) {
  let best: string | null = null;
  let bestSpot: Spot | null = null;
  let bestScore = MATCH;
  const known = knownTo(read);
  // Many copies are the same text: each stretch is tried once.
  const tried = new Set<string>();
  for (const spot of copies) {
    const { found } = spot;
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
      const line = polish(rest.slice(0, endFor(rest, read)), read);
      const score = alike(line, read);
      if (score > bestScore) {
        best = line;
        bestSpot = spot;
        bestScore = score;
      }
    }
  }
  return best === null || bestSpot === null
    ? null
    : { line: withQuotes(best, read), spot: bestSpot };
}

// Whether a character is in the writing systems of the read: a letter from
// another just before a line is data before the string read as text
// (Ren'Py's "踁This is…"), not a word the line starts inside of, and it's
// trimmed off a line's ends.
function knownTo(read: string) {
  const systems = writingSystems(read);
  return (character: string | undefined) =>
    character !== undefined &&
    [...writingSystems(character)].every((system) => systems.has(system));
}

// Marks no line starts with: the end of a speaker's name stored before it
// ("【Girl】：Also, this is…" in Aokana), or a code ("`You do know…" in The
// Colorful World).
const NOT_A_START = /[\s】」』）)\]：:;,、。`]/u;
// Symbols belong to no writing system, so data just before a line can read
// as one (Aokana: "␂Pretty sure…", U+2402, which separates each language's
// version of a line in its script, drawn as a small "STX"). One only starts
// a line when OCR's read starts with it too.
const SYMBOL = /\p{S}/u;

// A line from memory made ready to show for OCR's read: formatting codes
// and junk out, characters from other writing systems (and symbols OCR
// didn't see) off its start, others off its end, and a "~" OCR didn't see
// (a line break) a space.
function polish(text: string, read: string) {
  const known = knownTo(read);
  const characters = [...tidy(text, '')];
  while (
    characters.length > 0 &&
    (!known(characters[0]) ||
      NOT_A_START.test(characters[0]) ||
      (SYMBOL.test(characters[0]) && !read.startsWith(characters[0])))
  ) {
    characters.shift();
  }
  while (characters.length > 0 && !known(characters.at(-1))) {
    characters.pop();
  }
  const line = characters.join('').trim();
  return read.includes('~')
    ? line
    : line.replaceAll('~', ' ').replace(/\s+/g, ' ');
}

// --- Following the script ------------------------------------------------------
//
// A game keeps its lines in story order, often one string after another
// (Steins;Gate: "…anyway." 0x03ff "“What!? …”" 0x03ff "I open my eyes…"),
// so once a line has been matched, the next one is usually the next string
// in memory. It's checked before any search: instant, and it works even
// when OCR reads only the start of the line.

// How many strings after the last line are checked.
const NEXT_LINES = 4;
// The most bytes read after the last line to find them.
const NEXT_BYTES = 4096;

// The last line matched or one just after it, if OCR's read is it (or its
// start).
function nextInScript(memory: GameMemory, read: string) {
  const last = memory.lastLine;
  if (!last) {
    return null;
  }
  const { codec } = last;
  const bytes = readMemory(memory.process, last.address, NEXT_BYTES);
  if (!bytes) {
    return null;
  }
  // The last line itself first (OCR read more of it as it was typed out),
  // then the ones after it.
  let at = 0;
  for (let i = 0; i <= NEXT_LINES; i++) {
    // On to the next string's start.
    while (
      at + codec.width <= bytes.length &&
      !codec.isText(codec.codeAt(bytes, at))
    ) {
      at += codec.width;
    }
    if (at + codec.width > bytes.length) {
      return null;
    }
    const end = endOfString(bytes, at, codec);
    // A game's own alphabet ends each string with a code (Steins;Gate's
    // 0x03ff); in UTF-16 and UTF-8 a string can be followed by what's left
    // of an older, longer one ("rude?#8c> handmade soba…" in Aokana), so the
    // line is cut where it best matches the read, and must match all of it.
    const ended = codec instanceof AlphabetCodec;
    let raw = codec.decode(bytes, at, end).split('\0')[0];
    if (!ended) {
      raw = raw.slice(0, endFor(raw, read));
    }
    // The last line itself only when it's clearly the same line (a new line
    // can be much like the last: "Is that true?" after "Is that so?").
    const matches =
      i === 0
        ? alike(polish(raw, read), read) >= SAME_LINE
        : isNextLine(polish(raw, read), read, ended);
    if (matches) {
      memory.lastLine = { codec, address: last.address + at };
      // OCR's read of it (even just its start) can teach a game's own
      // alphabet codes it didn't know yet ("“What!?"), from the string's
      // own codes (markup left out, nothing past its end).
      if (raw.includes('\uFFFD') && codec instanceof AlphabetCodec) {
        const codes = codec.textCodes(bytes, at, end);
        let learned = learnFromLine(codec, codes, read);
        raw = codec.decode(bytes, at, end).split('\0')[0];
        learned = learnClosingQuote(codec, bytes, end, raw) || learned;
        if (learned) {
          log(`learned more of the alphabet from "${read}"`);
          alphabetListener(codec.alphabet);
          raw = codec.decode(bytes, at, end).split('\0')[0];
        }
      }
      const line = polish(raw, read);
      // When OCR read only the start, the end is as memory has it.
      return withQuotes(line, read, alike(line, read) >= MATCH);
    }
    at = end;
  }
  return null;
}

// The closing mark of each opening quote mark.
const CLOSING_QUOTE: Record<string, string> = {
  '“': '”',
  '"': '"',
  '‘': '’',
  '「': '」',
  '『': '』',
};

// Learns a closing quote mark OCR didn't read (it read only the line's
// start): a line that opens a quote and ends a sentence, then a code not
// known yet, ends with the closing mark. (Not after a letter or a mark that
// trails off: "“Wait, I—" ends on its dash, learned the wrong way for good.)
// Returns whether it was new.
function learnClosingQuote(
  codec: AlphabetCodec,
  bytes: Buffer,
  end: number,
  raw: string,
) {
  const closing = CLOSING_QUOTE[raw[0]];
  if (
    closing === undefined ||
    raw.slice(1).includes(closing) ||
    !/[.!?…]/u.test(raw.at(-2) ?? '') ||
    !raw.endsWith('\uFFFD') ||
    end < codec.width
  ) {
    return false;
  }
  return codec.learn(codec.codeAt(bytes, end - codec.width), closing);
}

// Where the string from `at` ends (markup inside it included, in a game's
// own alphabet).
function endOfString(bytes: Buffer, at: number, codec: Codec) {
  if (codec instanceof AlphabetCodec) {
    return codec.stringEnd(bytes, at, MAX_LINE);
  }
  let end = at;
  while (
    end + codec.width <= bytes.length &&
    codec.isText(codec.codeAt(bytes, end))
  ) {
    end += codec.width;
  }
  return end;
}

// Whether a line is the one OCR read: alike, or (`startOnly`) OCR read
// only its start (part of it in a colour OCR misses, or the rest still
// being typed).
function isNextLine(line: string, read: string, startOnly: boolean) {
  const fromMemory = letters(line);
  const fromOcr = letters(read);
  if (fromOcr.length < MIN_LETTERS || fromMemory.length === 0) {
    return false;
  }
  if (alike(line, read) >= MATCH) {
    return true;
  }
  return (
    startOnly &&
    fromOcr.length >= 4 &&
    fromOcr.length < fromMemory.length &&
    similarity(fromOcr, fromMemory.slice(0, fromOcr.length)) >= 0.85
  );
}

// The quote marks at a line's ends as OCR saw them: Ren'Py adds them as it
// draws a character's line, so memory has the line without them, and a
// copy can have a stray one from what's stored before it. `atEnd`: the end
// too (not when OCR read only the line's start).
const QUOTE = /["“”'‘’「」『』]/u;
function withQuotes(line: string, read: string, atEnd = true) {
  let quoted = line;
  const first = read[0] ?? '';
  if (QUOTE.test(first) !== QUOTE.test(quoted[0] ?? '')) {
    quoted = QUOTE.test(first) ? first + quoted : quoted.slice(1);
  }
  const last = read.at(-1) ?? '';
  if (atEnd && QUOTE.test(last) !== QUOTE.test(quoted.at(-1) ?? '')) {
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

// --- Following a pointer to the line --------------------------------------------
//
// Engines that make a new string for every line (Unity, Ren'Py) never
// rewrite one buffer, but the game still notes which string is on screen:
// a field holding a pointer to it, set to each new line's string (Aokana
// has three: two to the English line, one to the script's entry with every
// language). Once a line is matched one by one, the strings holding just
// that line are found, then every pointer to them. A pointer that has moved
// on to the next line OCR reads is followed like a buffer
// (`followChangedCopies`), its text read through it, so memory leads: every
// line exact as soon as it shows, even ones OCR can't read ("......").
//
// Nothing here is one engine's: the pointer's size is the game's (4 bytes
// in a 32-bit game, 8 in a 64-bit one), and the string's header, between
// where the pointer points and its text, is learned (Mono's is 12 bytes in
// a 32-bit game, 20 in a 64-bit one; Python's longer).

// The longest string header allowed for, in bytes.
const MAX_HEADER = 64;
// Looks for pointers that found none that followed the line, per run of the
// game, before it stops looking (each reads all its memory, about a second
// in the background). Reset once one is followed, so a pointer lost at a
// scene change is looked for again.
const MAX_POINTER_SEARCHES = 5;

// A line was matched one by one: look for pointers to it, if that may
// still find one.
function lookForPointers(memory: GameMemory, line: string) {
  if (
    memory.buffer ||
    memory.noFollowing ||
    memory.findingPointers ||
    memory.pointerSearches >= MAX_POINTER_SEARCHES ||
    needlesFrom(line).length === 0
  ) {
    return;
  }
  void findPointers(memory, line);
}

// Where a string found in memory starts. Text found by walking back from a
// run of its words (`startOfText`) can begin with the string's length,
// read as a character ("%I almost drop…": a length of 37, "%" in UTF-16):
// a first character whose code is the length of the rest is skipped.
function textStart(spot: Spot) {
  const code = spot.found.codePointAt(0);
  const rest = spot.found.length - 1;
  return code !== undefined && rest > 0 && (code === rest || code === rest * 2)
    ? spot.codec.width
    : 0;
}

// Finds the strings holding just this line, and every pointer to them, as
// the pointer candidates (replacing the last line's).
async function findPointers(memory: GameMemory, line: string) {
  memory.findingPointers = true;
  memory.pointerSearches++;
  const started = performance.now();
  try {
    const needles = needlesFrom(line).slice(0, FIRST_NEEDLES);
    const spots = await findSpots(memory, needles);
    if (stale(memory) || memory.buffer) {
      return;
    }
    // Strings of just the line, not ones with more around it (the script,
    // the backlog) or formatting codes (Unity's typewriter effect), where
    // their text starts.
    const wanted = letters(line);
    const texts = spots.flatMap((spot) => {
      const skip = textStart(spot);
      return letters(spot.found.slice(skip / spot.codec.width)) === wanted
        ? [{ codec: spot.codec, at: spot.address + skip }]
        : [];
    });
    if (texts.length === 0) {
      log(
        `pointer search ${memory.pointerSearches}: no string of just "${line}"`,
      );
      return;
    }
    // Every value a pointer to one of them could hold: its text, or up to
    // `MAX_HEADER` before it, in steps of the pointer's size (headers are
    // whole pointers long).
    const size = memory.pointerSize;
    const targets = new Map<number, { codec: Codec; offset: number }>();
    for (const { codec, at } of texts) {
      for (let offset = 0; offset <= MAX_HEADER; offset += 4) {
        targets.set(at - offset, { codec, offset });
      }
    }
    const values = [...targets.keys()];
    const low = Math.min(...values);
    const high = Math.max(...values);
    const pointers: Spot[] = [];
    for (const region of writableRegions(memory.process)) {
      if (stale(memory) || pointers.length >= MAX_CANDIDATES) {
        break;
      }
      const read = await readMemoryAsync(
        memory.process,
        region.address,
        region.size,
      );
      if (!read) {
        continue;
      }
      await breather();
      // Read as 4-byte numbers (copied if they don't start on a multiple of
      // 4, which typed arrays need).
      const bytes = read.byteOffset % 4 === 0 ? read : Buffer.from(read);
      const words = new Uint32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.length >> 2,
      );
      const step = size / 4;
      for (let i = 0; i + step <= words.length; i += step) {
        const value = size === 4 ? words[i] : words[i + 1] * 2 ** 32 + words[i];
        if (value < low || value > high) {
          continue;
        }
        const target = targets.get(value);
        if (target) {
          pointers.push({
            address: region.address + i * 4,
            codec: target.codec,
            found: '',
            pointer: { size, offset: target.offset },
          });
        }
      }
    }
    if (stale(memory) || memory.buffer) {
      return;
    }
    // What each leads to now, to tell later which ones move on.
    for (const spot of pointers) {
      spot.found = textAt(memory, spot) ?? '';
    }
    memory.pointerCandidates = pointers;
    log(
      `pointer search ${memory.pointerSearches}: ${pointers.length} pointers to ${texts.length} strings of "${line}" in ${Math.round(performance.now() - started)} ms`,
    );
  } finally {
    memory.findingPointers = false;
  }
}

// --- Learning a game's own alphabet --------------------------------------------
//
// Some engines store text in their own codes rather than UTF-16 or UTF-8:
// Steins;Gate's (MAGES) stores each character as a 2-byte number into its
// font, "t" as 0x80b7. Fonts keep the letters in order, though, so a word
// leaves the same pattern of steps between codes however they're numbered
// ("towards": o is 5 before t, w 3 after it…). A "relative search", as
// translators of old games call it, looks for that pattern in memory with
// a long word OCR read, in 1-byte and 2-byte codes, either byte order. Where
// it's found, the codes around it are lined up with OCR's whole line: if
// its other lowercase letters fit too, that's the game's text, and the line
// gives the codes of capitals, digits, spaces and punctuation (more are
// learned from later lines, `refineAlphabet`). Saved per game, so it's
// learned once (`onAlphabetLearned`).

// Line searches with no copy found before the alphabet is looked for, and
// times it's looked for per run of the game (each reads all memory a few
// times over: about 10 s for Steins;Gate's 839 MB, in the background).
const EMPTY_SEARCHES_TO_LEARN = 2;
const MAX_LEARN_TRIES = 3;
// The shortest word searched for, and how many of the line's lowercase
// letters must fit for a find to count.
const MIN_LEARN_WORD = 6;
const MIN_FIT = 0.85;

let alphabetListener: (alphabet: Alphabet) => void = () => {};
export const onAlphabetLearned = (listener: (alphabet: Alphabet) => void) =>
  (alphabetListener = listener);

// The ways codes may be stored, most likely first.
const LAYOUTS = [
  { width: 2, bigEndian: true },
  { width: 2, bigEndian: false },
  { width: 1, bigEndian: false },
] as const;

type Layout = (typeof LAYOUTS)[number];

const codeIn = (bytes: Buffer, at: number, layout: Layout) =>
  layout.width === 1
    ? bytes[at]
    : layout.bigEndian
      ? (bytes[at] << 8) | bytes[at + 1]
      : bytes[at] | (bytes[at + 1] << 8);

async function learnAlphabet(memory: GameMemory, read: string) {
  if (
    memory.alphabet ||
    memory.learning ||
    memory.learnTries >= MAX_LEARN_TRIES
  ) {
    return;
  }
  // Long lowercase words, longest first (OCR may have got one wrong).
  const words = [
    ...new Set(
      read
        .split(/\s+/)
        .map((word) => word.replace(/^[^a-z]+|[^a-z]+$/g, ''))
        .filter(
          (word) => /^[a-z]+$/.test(word) && word.length >= MIN_LEARN_WORD,
        ),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  if (words.length === 0) {
    return;
  }
  memory.learning = true;
  memory.learnTries++;
  const started = performance.now();
  try {
    for (const layout of LAYOUTS) {
      for (const word of words) {
        const found = await relativeSearch(memory, read, word, layout);
        if (stale(memory)) {
          return;
        }
        if (found) {
          memory.alphabet = new AlphabetCodec(found);
          log(
            `learned the game's alphabet in ${Math.round(performance.now() - started)} ms: ${found.width} bytes, ${found.bigEndian ? 'big' : 'little'}-endian, "a" = 0x${(found.lower + 0x61).toString(16)}, ${found.extra.length} other characters`,
          );
          alphabetListener(found);
          memory.emptySearches = 0;
          memory.searchedFor = '';
          setStatus('searching');
          void search(memory, read);
          return;
        }
      }
    }
    log(
      `no alphabet found for "${read}" in ${Math.round(performance.now() - started)} ms`,
    );
  } finally {
    memory.learning = false;
  }
}

// Looks through memory for the word's pattern of steps in one layout, and
// returns the alphabet of the first find that fits the whole line.
async function relativeSearch(
  memory: GameMemory,
  read: string,
  word: string,
  layout: Layout,
) {
  const steps = [...word].map((c) => c.charCodeAt(0) - word.charCodeAt(0));
  const length = steps.length * layout.width;
  for (const region of writableRegions(memory.process)) {
    if (stale(memory)) {
      return null;
    }
    const bytes = await readMemoryAsync(
      memory.process,
      region.address,
      region.size,
    );
    await breather();
    if (!bytes || stale(memory)) {
      continue;
    }
    const last = bytes.length - length;
    for (let at = 0; at <= last; at++) {
      const first = codeIn(bytes, at, layout);
      let fits = true;
      for (let i = 1; i < steps.length; i++) {
        if (codeIn(bytes, at + i * layout.width, layout) - first !== steps[i]) {
          fits = false;
          break;
        }
      }
      // Plain text would have been found already.
      const lower = first - word.charCodeAt(0);
      if (!fits || lower === 0) {
        continue;
      }
      const alphabet = fitLine(bytes, at, read, word, { ...layout, lower });
      if (alphabet) {
        return alphabet;
      }
    }
  }
  return null;
}

// Lines the codes around a find up with OCR's line; if most of its
// lowercase letters fit (`MIN_FIT`), the alphabet, with what the line shows
// of the other characters.
function fitLine(
  bytes: Buffer,
  at: number,
  read: string,
  word: string,
  { width, bigEndian, lower }: Layout & { lower: number },
): Alphabet | null {
  const start = at - read.indexOf(word) * width;
  if (start < 0 || start + read.length * width > bytes.length) {
    return null;
  }
  const layout = { width, bigEndian } as Layout;
  const codes = [...read].map((_, i) =>
    codeIn(bytes, start + i * width, layout),
  );
  let lowercase = 0;
  let fitting = 0;
  [...read].forEach((character, i) => {
    if (character >= 'a' && character <= 'z') {
      lowercase++;
      if (codes[i] - lower === character.charCodeAt(0)) {
        fitting++;
      }
    }
  });
  if (lowercase === 0 || fitting / lowercase < MIN_FIT) {
    return null;
  }
  const alphabet: Alphabet = {
    width,
    bigEndian,
    lower,
    upper: null,
    digit: null,
    extra: [],
  };
  learnFromLine(new AlphabetCodec(alphabet), codes, read);
  return alphabet;
}

// Learns the codes of the characters in a line lined up with its codes:
// each one next to a character whose code is already known and fits (so
// the two are in step). Passes repeat while they learn something, so
// knowing spreads from the letters to the spaces next to them and on to a
// lone capital ("I bypass…").
function learnFromLine(codec: AlphabetCodec, codes: number[], read: string) {
  const characters = [...read];
  const fits = (i: number) =>
    characters[i] !== undefined &&
    codes[i] !== undefined &&
    codec.characterOf(codes[i]) === characters[i];
  let learned = false;
  for (let pass = 0; pass < 4; pass++) {
    let learnedNow = false;
    characters.forEach((character, i) => {
      if (codes[i] === undefined || codes[i] < 0 || fits(i)) {
        return;
      }
      if (fits(i - 1) || fits(i + 1)) {
        learnedNow = codec.learn(codes[i], character) || learnedNow;
      }
    });
    learned = learned || learnedNow;
    if (!learnedNow) {
      break;
    }
  }
  return learned;
}

// Learns characters from a later line matched in the game's alphabet whose
// copy still has codes not known yet ("can\uFFFDt"), and saves the alphabet
// if any were. Returns whether any were.
function refineAlphabet(
  memory: GameMemory,
  codec: AlphabetCodec,
  read: string,
) {
  // Words to line the copy up with the read by, longest first: any word
  // OCR got right will do ("that" in "Who was that on the ph0ne?").
  const words = [...new Set(read.match(/[a-z]{3,}/g) ?? [])].sort(
    (a, b) => b.length - a.length,
  );
  for (const spot of memory.candidates) {
    if (spot.codec !== codec || !spot.found.includes('\uFFFD')) {
      continue;
    }
    // The copy's codes, one per character of `found` (markup left out, so
    // a coloured word before the line doesn't put them out of step).
    const bytes = readMemory(
      memory.process,
      spot.address,
      MAX_LINE * codec.width,
    );
    if (!bytes) {
      continue;
    }
    const stringCodes = codec.textCodes(
      bytes,
      0,
      codec.stringEnd(bytes, 0, MAX_LINE),
    );
    for (const word of words) {
      const start = spot.found.indexOf(word) - read.indexOf(word);
      if (spot.found.indexOf(word) === -1 || start < 0) {
        continue;
      }
      const codes = [...read].map((_, i) => stringCodes[start + i] ?? -1);
      // Only lined up right if most of the read's lowercase letters fit.
      const lowercase = [...read]
        .map((character, i) => ({ character, code: codes[i] }))
        .filter(({ character }) => character >= 'a' && character <= 'z');
      const fitting = lowercase.filter(
        ({ character, code }) => codec.characterOf(code) === character,
      ).length;
      if (lowercase.length === 0 || fitting / lowercase.length < MIN_FIT) {
        continue;
      }
      if (learnFromLine(codec, codes, read)) {
        log(`learned more of the alphabet from "${read}"`);
        alphabetListener(codec.alphabet);
        return true;
      }
      return false;
    }
  }
  return false;
}

// Every place in the game's memory holding one of the runs, as the start of
// the text around it.
async function findSpots(
  memory: GameMemory,
  needles: string[],
  // Only these stretches of memory (by address), if given.
  only?: number[],
) {
  const searches = needles.flatMap((needle) =>
    codecsOf(memory).flatMap((codec) => {
      const bytes = codec.encode(needle);
      return bytes ? [{ codec, bytes }] : [];
    }),
  );
  const spots = new Map<string, Spot>();
  const hot = new Set<number>();
  for (const region of writableRegions(memory.process)) {
    if (only && !only.includes(region.address)) {
      continue;
    }
    // Enough copies, or another game picked meanwhile (see `stale`).
    if (spots.size >= MAX_CANDIDATES) {
      break;
    }
    if (stale(memory)) {
      return [];
    }
    const bytes = await readMemoryAsync(
      memory.process,
      region.address,
      region.size,
    );
    if (!bytes) {
      continue;
    }
    for (const { codec, bytes: needle } of searches) {
      // Looking through a big stretch takes a while, so the main process
      // gets a turn between runs (its windows' requests wait meanwhile).
      await breather();
      for (
        let at = bytes.indexOf(needle);
        at !== -1 && spots.size < MAX_CANDIDATES;
        at = bytes.indexOf(needle, at + 1)
      ) {
        const start = startOfText(bytes, at, codec);
        const address = region.address + start;
        spots.set(`${codec.name}:${address}`, { address, codec, found: '' });
        hot.add(region.address);
        if (codec === UTF16 || codec === UTF8) {
          memory.standardFound = true;
        } else {
          memory.alphabetFound = true;
          memory.alphabetAssumed = false;
        }
      }
    }
  }
  if (stale(memory)) {
    return [];
  }
  if (hot.size > 0) {
    memory.hotRegions = [...hot];
  }
  // What each holds now, to tell later which ones change.
  for (const spot of spots.values()) {
    spot.found = textAt(memory, spot) ?? '';
  }
  return [...spots.values()];
}

// The copies of a line OCR read, and the one that matches it (`bestCopy`),
// if any. Where lines are matched one by one (no buffer will be followed),
// the stretches of memory copies were last found in are searched first:
// the game keeps its lines together, so that's usually enough, and far
// faster in a game with a lot of memory (Steins;Gate: 5 s for all of it).
async function copiesOf(memory: GameMemory, read: string, needles: string[]) {
  const matchingOnly = memory.noFollowing || memory.alphabet !== null;
  if (matchingOnly && memory.hotRegions.length > 0) {
    const copies = await findSpots(memory, needles, memory.hotRegions);
    const match = bestCopy(copies, read, needles);
    if (match !== null) {
      return { copies, match };
    }
  }
  // All of memory: with a couple of the runs first, which usually find the
  // line (each run is a pass over all of it), then the rest if they don't.
  if (matchingOnly && needles.length > FIRST_NEEDLES) {
    const first = needles.slice(0, FIRST_NEEDLES);
    const firstCopies = await findSpots(memory, first);
    const match = bestCopy(firstCopies, read, first);
    if (match !== null) {
      return { copies: firstCopies, match };
    }
    // The rest only (the first ones' copies are at hand), keeping where
    // both found copies as the stretches to search first.
    const firstHot = firstCopies.length > 0 ? memory.hotRegions : [];
    const rest = await findSpots(memory, needles.slice(FIRST_NEEDLES));
    if (rest.length > 0) {
      memory.hotRegions = [...new Set([...firstHot, ...memory.hotRegions])];
    }
    const copies = [
      ...new Map(
        [...firstCopies, ...rest].map((spot) => [
          `${spot.codec.name}:${spot.address}`,
          spot,
        ]),
      ).values(),
    ].slice(0, MAX_CANDIDATES);
    return { copies, match: bestCopy(copies, read, needles) };
  }
  const copies = await findSpots(memory, needles);
  return { copies, match: bestCopy(copies, read, needles) };
}

// Lets the main process handle what's waiting before going on.
const breather = () => new Promise((resolve) => setImmediate(resolve));

// Where the text around `at` starts: back to just after a control character
// (a zero, usually), at most a line's length back.
function startOfText(bytes: Buffer, at: number, codec: Codec) {
  // A game's own alphabet steps back over markup inside a line too.
  if (codec instanceof AlphabetCodec) {
    return codec.stringStart(bytes, at, MAX_LINE);
  }
  const step = codec.width;
  let start = at;
  for (let i = 0; i < MAX_LINE && start - step >= 0; i++) {
    if (!codec.isText(codec.codeAt(bytes, start - step))) {
      break;
    }
    start -= step;
  }
  return start;
}
