/**
 * Reads text from images (OCR), in the main process: OneOCR reads the
 * words (oneocr.ts), and this tidies what it read, for the ways it reads VN
 * text a little wrong.
 *
 * (The app used Tesseract before, which needed many more rules: dropping
 * words of the wrong height, marks in the arrow's corner, art far along the
 * line, and fixing digits read for letters. OneOCR doesn't make those
 * mistakes, on any of the OCR tests made for them, so they were taken out.)
 */

import { type OcrLine, type OcrWord, recognize } from './oneocr';

// --- Marks read as words of their own -------------------------------------------
//
// OneOCR reads trailing-off dots and a quote mark at the end of a line as
// words of their own: "Ah ...", "... I see", "mmph... "". In VN text dots
// belong to the word before them ("Ah...", "Hi... Hisao"), or, starting a
// line, to the word after them ("...I see"); a quote mark ending a line to
// the word before it, and one starting a line to the word after it.
const DOTS = /^(?:\.{2,}|…)[.!?…"'”’)\]]*$/u;
const DOTS_ONLY = /^(?:\.{2,}|…)$/u;
const QUOTES_ONLY = /^["'“”‘’]+$/u;

function join(first: OcrWord, second: OcrWord): OcrWord {
  return {
    ...first,
    text: first.text + second.text,
    top: Math.min(first.top, second.top),
    bottom: Math.max(first.bottom, second.bottom),
    right: second.right,
  };
}

function joinMarks(words: OcrWord[]) {
  const joined: OcrWord[] = [];
  words.forEach((word, i) => {
    const before = joined.at(-1);
    const endingQuote = i === words.length - 1 && QUOTES_ONLY.test(word.text);
    if (before && (DOTS.test(word.text) || endingQuote)) {
      joined[joined.length - 1] = join(before, word);
    } else {
      joined.push(word);
    }
  });
  const [first, second] = joined;
  if (second && (DOTS_ONLY.test(first.text) || QUOTES_ONLY.test(first.text))) {
    // The dots or quote go with the next word, which keeps its own
    // confidence (a lone mark's is often low: a "“" at 8%).
    joined.splice(0, 2, {
      ...join(first, second),
      confidence: second.confidence,
    });
  }
  return joined;
}

// --- Lines read twice -----------------------------------------------------------
//
// Text right at the top of the box is sometimes read twice: once whole and
// once in part, as a line of its own lying over it ("Most" over "Most
// people? Who's most people?", The Colorful World at 80%). Lines of real
// text never overlap, so of two lines overlapping by more than this share
// of the shorter's height, only the one with more letters is kept.
const MAX_LINE_OVERLAP = 0.5;

const letters = (line: OcrLine) =>
  line.words.reduce((sum, word) => sum + word.text.length, 0);

function withoutDoubles(lines: OcrLine[]) {
  return lines.filter((line) =>
    lines.every((other) => {
      if (other === line) {
        return true;
      }
      const overlap =
        Math.min(line.bottom, other.bottom) - Math.max(line.top, other.top);
      const shorter = Math.min(
        line.bottom - line.top,
        other.bottom - other.top,
      );
      const doubled = overlap > MAX_LINE_OVERLAP * shorter;
      // Of two the same length, the first is kept.
      return (
        !doubled ||
        letters(line) > letters(other) ||
        (letters(line) === letters(other) &&
          lines.indexOf(line) < lines.indexOf(other))
      );
    }),
  );
}

// --- Common misreads ------------------------------------------------------------
//
// A `|` never appears in VN text, and a lowercase "l" on its own isn't an
// English word, so both are almost certainly an "I" ("I-l did it", Aokana).
// And two dots are a misread "...": OneOCR reads "N..." as "N.." at times,
// and VN text never has two.
function fixCommonMistakes(text: string) {
  return (
    text
      .replaceAll('|', 'I')
      // An "l" with no letter or digit right before or after it. `\p{L}` is
      // any letter, `\p{N}` any digit; `(?<!...)` and `(?!...)` check the
      // neighbours without including them in the match.
      .replace(/(?<![\p{L}\p{N}])l(?![\p{L}\p{N}])/gu, 'I')
      .replace(/(?<![.…])\.\.(?![.…])/gu, '...')
  );
}

// --- Paragraphs -----------------------------------------------------------------
//
// Full-screen text is laid out in paragraphs with a bigger gap between them
// than between the lines of one. In Katawa Shoujo, OneOCR's lines are 0 to
// 0.15 of a line's height apart inside a paragraph and 0.42 to 0.53 apart
// between paragraphs (1.5 where there's a blank line), at any size. A gap of
// more than this share of the usual line height starts a new paragraph.
const PARAGRAPH_GAP = 0.3;

function splitParagraphs(lines: OcrLine[]) {
  const usual = median(lines.map((line) => line.bottom - line.top));
  const paragraphs: OcrWord[][] = [];
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

// --- A lone letter or mark after a sentence ends -------------------------------
//
// Text never ends on a letter on its own, with no punctuation, right after
// a sentence has ended: "I tried to read them. I". That letter is a mark
// read as one (an upright stroke reads as "I": a pole in the art, the box's
// edge, the mouse pointer), so it's dropped. Only at the very end of the
// text (or of a paragraph): in the middle, it's a sentence going on to the
// next line ("them. I / wanted to..."). A "|" counts, since it's how an "I"
// can be read before `fixCommonMistakes` turns it into one.
const LONE_LETTER = /^[\p{L}|]$/u;
// Nor does it end on a word of only dashes, commas, tildes and the like
// after a sentence has ended: "to answer. -." (The Colorful World, art
// beside the line read as "-.", "-" or "~~"). A word of only ".", "!",
// "?", "…", quotes and brackets is kept: it can end a line ("Huh? ...!").
const STRAY_MARK = /^[\p{P}\p{S}]+$/u;
const ENDING_MARKS = /^[.!?…"'“”‘’()[\]]+$/u;
// A word ending a sentence: ".", "!", "?" or "…", maybe followed by a
// closing quote or bracket.
const SENTENCE_END = /[.!?…]["'”’)\]]*$/u;

function withoutLoneEnd(words: OcrWord[]) {
  const n = words.length;
  const end = words[n - 1]?.text ?? '';
  const loneEnd =
    n >= 2 &&
    (LONE_LETTER.test(end) ||
      (STRAY_MARK.test(end) && !ENDING_MARKS.test(end))) &&
    SENTENCE_END.test(words[n - 2].text);
  return loneEnd ? words.slice(0, -1) : words;
}

function median(values: number[]) {
  return values.slice().sort((a, b) => a - b)[values.length >> 1];
}

// Reads the text in a PNG image.
export async function readText(png: Uint8Array): Promise<OcrResult> {
  const start = performance.now();
  const read = (await recognize(png))
    .map((line) => ({ ...line, words: joinMarks(line.words) }))
    .filter((line) => line.words.length > 0);
  const lines = withoutDoubles(read);
  // A lone letter or mark at the very end, after a sentence ends, is dropped
  // (see `withoutLoneEnd`). It's always on the last line.
  const last = lines.at(-1);
  if (last) {
    const words = lines.flatMap((line) => line.words);
    if (withoutLoneEnd(words).length < words.length) {
      lines[lines.length - 1] = { ...last, words: last.words.slice(0, -1) };
    }
  }

  const kept = lines.flatMap((line) => line.words);
  const dropped = read
    .flatMap((line) => line.words)
    .filter((word) => !kept.includes(word));
  const text = lines
    .map((line) => line.words.map((word) => word.text).join(' '))
    .filter((line) => line !== '')
    .join('\n');
  // How sure the read is: its words' average.
  const confidence =
    kept.length > 0
      ? kept.reduce((sum, word) => sum + word.confidence, 0) / kept.length
      : 0;
  return {
    text: fixCommonMistakes(text).trim(),
    confidence: Math.round(confidence),
    ms: Math.round(performance.now() - start),
    dropped: dropped.map((word) => word.text),
    paragraphs: splitParagraphs(lines.filter((line) => line.words.length > 0)),
  };
}
