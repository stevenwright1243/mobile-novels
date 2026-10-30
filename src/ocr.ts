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
      // A stammered "I" read as ones: "1-1" is "I-I" (and "1-1-1" "I-I-I").
      // Numbers are written with a dash between them far less often than
      // a stammer.
      .replace(/(?<![\p{L}\p{N}-])1(?:-1)+(?![\p{L}\p{N}-])/gu, (ones) =>
        ones.replaceAll('1', 'I'),
      )
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
      // Some fonts' "?" reads as a "7" (Katawa Shoujo's "???" as "777" or
      // "7?"). A word of only 7s and question marks is a run of "?"s, if it
      // has a "?" in it or three or more 7s (so a "77" stays a number).
      .replace(/(?<![\p{L}\p{N}])[7?]{2,}(?![\p{L}\p{N}])/gu, (run) =>
        run.includes('?') || run.length >= 3 ? '?'.repeat(run.length) : run,
      )
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

// --- Dropping words that aren't there ------------------------------------------
//
// Marks in the art or the box's frame can be read as "words". Judging each
// word on its own beats judging the whole line: one stray word no longer
// costs the whole line, and the real words keep it. Height is the main test:
// real words share a height, while junk is a sliver (a frame edge, 2-3 px)
// or a blob of art (2-4 times as tall). Confidence alone can't tell them
// apart (Katawa Shoujo's "Hi..." was read right at 20%), but it helps: blobs
// of art read at 0-34%, while a real word made taller by something touching
// it (the mouse pointer under "the") stays sure.

// Words at least this sure set the line's usual height (if there are any),
// so a junk word can't shift it. A word this sure is never too tall.
const SURE_WORD = 50;
// How much shorter or taller than the usual height a word can be. Words with
// no tall letters ("one") are about half the height of ones with them.
const MIN_WORD_HEIGHT = 0.35;
const MAX_WORD_HEIGHT = 1.8;
// A line of its own made only of unsure words this short is a mark, not
// text: the box's "next" arrow (▼ read as "wv"), the mouse pointer.
const MAX_MARK_HEIGHT = 0.6;
// So is a line of its own that lies entirely in this share of the box at its
// right: where the "next" arrow sits (Miyuki's Realm's ▼ read as "h 4", the
// "4" at 94%). A real line, even one wrapped word, starts at the left.
const ARROW_ZONE = 0.2;
// A word of only punctuation ("...", "—") can be tiny, so it's only checked
// for being too tall.
const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;
// If more of the read than this is dropped (counting letters), the real text
// was probably misread too, not just junk added: what's left is part of the
// line. Then the read keeps Tesseract's score for the whole of it, so a part
// line isn't shown as if it were sure.
const MAX_DROPPED_SHARE = 1 / 3;
// Words in a line are a space apart; a gap wider than this many times the
// usual word height splits the line, and only its part with the most
// letters is kept (the leftmost, if two tie). Art seen through a
// see-through box is read on the same line as the text, far from it: in
// Katawa Shoujo a pale bed pole and rails beside "react to this?" read as
// "react to this? I _ _" (several hundred pixels on; spaces are about a
// third of the height).
const MAX_WORD_GAP = 3;

// `left` and `right` are where the word starts and ends, in pixels from the
// image's left edge.
type Word = {
  text: string;
  confidence: number;
  height: number;
  left: number;
  right: number;
};
// A line's words, and its top and bottom edges in pixels.
type Line = { words: Word[]; top: number; bottom: number };

// --- Paragraphs ----------------------------------------------------------------
//
// Full-screen text is laid out in paragraphs with a bigger gap between them
// than between the lines of one. In Katawa Shoujo, lines 38 px tall are 8-9
// px apart inside a paragraph and 25-27 px apart between paragraphs (60+
// where there's a blank line). A gap of more than this share of the usual
// line height starts a new paragraph.
const PARAGRAPH_GAP = 0.4;

function splitParagraphs(lines: Line[]) {
  const usual = median(lines.map((line) => line.bottom - line.top));
  const paragraphs: Word[][] = [];
  lines.forEach((line, i) => {
    const gap = i === 0 ? Infinity : line.top - lines[i - 1].bottom;
    if (gap > PARAGRAPH_GAP * usual) {
      paragraphs.push([]);
    }
    paragraphs.at(-1)!.push(...line.words);
  });
  return paragraphs.map((paragraph) =>
    fixCommonMistakes(
      withoutLoneEnd(paragraph)
        .map((word) => word.text)
        .join(' '),
    ).trim(),
  );
}

// --- A lone letter after a sentence ends ---------------------------------------
//
// Text never ends on a letter on its own, with no punctuation, right after
// a sentence has ended: "I tried to read them. I". That letter is a mark
// read as one (any upright stroke reads as "I": a pole in the art, the
// box's edge, the mouse pointer), so it's dropped. Only at the very end of
// the text (or of a paragraph): in the middle, it's a sentence going on to
// the next line ("them. I / wanted to..."). A "|" counts, since it's how an
// "I" is often read before `fixCommonMistakes` turns it into one.
const LONE_LETTER = /^[\p{L}|]$/u;
// A word ending a sentence: ".", "!", "?" or "…", maybe followed by a
// closing quote or bracket.
const SENTENCE_END = /[.!?…]["'”’)\]]*$/u;

function withoutLoneEnd(words: Word[]) {
  const n = words.length;
  const loneEnd =
    n >= 2 &&
    LONE_LETTER.test(words[n - 1].text) &&
    SENTENCE_END.test(words[n - 2].text);
  return loneEnd ? words.slice(0, -1) : words;
}

function median(values: number[]) {
  return values.slice().sort((a, b) => a - b)[values.length >> 1];
}

// Reads the text in a PNG image.
export async function readText(png: Uint8Array): Promise<OcrResult> {
  const ocr = await getWorker();
  const start = performance.now();
  // `blocks: true` also returns each line and word, with its confidence and
  // position (`bbox`, its bounding box).
  const { data } = await ocr.recognize(Buffer.from(png), {}, { blocks: true });
  const allLines: Line[] = (data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({
        top: line.bbox.y0,
        bottom: line.bbox.y1,
        words: line.words.map((word) => ({
          text: word.text,
          confidence: word.confidence,
          height: word.bbox.y1 - word.bbox.y0,
          left: word.bbox.x0,
          right: word.bbox.x1,
        })),
      })),
    ),
  );
  const lines = allLines.map((line) => line.words);
  const words = lines.flat();
  // The image's width: a PNG stores it in bytes 16-19 (in its "IHDR" part).
  const width = Buffer.from(png).readUInt32BE(16);
  const sure = words.filter((word) => word.confidence >= SURE_WORD);
  const usual = median((sure.length > 0 ? sure : words).map((w) => w.height));
  const fits = ({ text, height, confidence }: Word) =>
    (height <= MAX_WORD_HEIGHT * usual || confidence >= SURE_WORD) &&
    (PUNCTUATION_ONLY.test(text) || height >= MIN_WORD_HEIGHT * usual);
  const isMark = (line: Word[]) =>
    lines.length > 1 &&
    (line.every(
      (word) =>
        word.confidence < SURE_WORD && word.height < MAX_MARK_HEIGHT * usual,
    ) ||
      line.every((word) => word.left >= (1 - ARROW_ZONE) * width));
  // The words kept, line by line.
  // A line's part with the most letters, where wide gaps split it (see
  // `MAX_WORD_GAP`).
  const mainPart = (line: Word[]) => {
    const parts: Word[][] = [];
    line.forEach((word, i) => {
      const gap = i === 0 ? Infinity : word.left - line[i - 1].right;
      if (gap > MAX_WORD_GAP * usual) {
        parts.push([]);
      }
      parts.at(-1)!.push(word);
    });
    const letters = (part: Word[]) =>
      part.reduce((sum, word) => sum + word.text.length, 0);
    return parts.reduce(
      (best, part) => (letters(part) > letters(best) ? part : best),
      parts[0] ?? [],
    );
  };
  const keptLines = lines.map((line) =>
    isMark(line) ? [] : mainPart(line.filter(fits)),
  );
  // A lone letter at the very end, after a sentence ends, is dropped (see
  // `withoutLoneEnd`). It's always on the last line with words.
  const last = keptLines.findLastIndex((line) => line.length > 0);
  if (last >= 0) {
    const ends = keptLines.flat();
    if (withoutLoneEnd(ends).length < ends.length) {
      keptLines[last] = keptLines[last].slice(0, -1);
    }
  }

  const kept = keptLines.flat();
  const dropped = words.filter((word) => !kept.includes(word));
  const letters = (list: Word[]) =>
    list.reduce((sum, word) => sum + word.text.length, 0);
  const tooMuchDropped = letters(dropped) > MAX_DROPPED_SHARE * letters(words);
  const text = keptLines
    .map((line) => line.map((word) => word.text).join(' '))
    .filter((line) => line !== '')
    .join('\n');
  // Tesseract's own score for a read is the average of its words' scores, so
  // it's worked out again from the words kept.
  let confidence =
    kept.length > 0
      ? kept.reduce((sum, word) => sum + word.confidence, 0) / kept.length
      : 0;
  if (tooMuchDropped) {
    confidence = Math.min(confidence, data.confidence);
  }
  return {
    text: fixCommonMistakes(text).trim(),
    confidence: Math.round(confidence),
    ms: Math.round(performance.now() - start),
    dropped: dropped.map((word) => word.text),
    paragraphs: splitParagraphs(
      allLines
        .map((line, i) => ({ ...line, words: keptLines[i] }))
        .filter((line) => line.words.length > 0),
    ),
  };
}
