/**
 * The ways a game's text can be stored in memory (main process, for
 * memory-text.ts): UTF-16 and UTF-8, which most engines use, and a game's
 * own alphabet, learned from its memory when its lines aren't in either
 * (Steins;Gate's MAGES engine stores each character as a 2-byte number into
 * its font, 0x80xx; see memory-text.ts's `learnAlphabet`).
 */

export interface Codec {
  name: string;
  // Bytes per character.
  width: 1 | 2;
  // The character code at a byte offset.
  codeAt(bytes: Buffer, at: number): number;
  // Whether a code is part of a string (not a control code, or the bytes
  // between strings).
  isText(code: number): boolean;
  // The text as bytes, or null if a character has no known code.
  encode(text: string): Buffer | null;
  // The bytes as text: codes that aren't text become "\u0000" (which ends a
  // string), text codes not known yet "\uFFFD".
  decode(bytes: Buffer, start?: number, end?: number): string;
}

export const UTF16: Codec = {
  name: 'utf16le',
  width: 2,
  codeAt: (bytes, at) => bytes.readUInt16LE(at),
  isText: (code) => code >= 0x20,
  encode: (text) => Buffer.from(text, 'utf16le'),
  decode: (bytes, start = 0, end = bytes.length) =>
    bytes.toString('utf16le', start, end),
};

export const UTF8: Codec = {
  name: 'utf8',
  width: 1,
  codeAt: (bytes, at) => bytes[at],
  isText: (code) => code >= 0x20,
  encode: (text) => Buffer.from(text, 'utf8'),
  decode: (bytes, start = 0, end = bytes.length) =>
    bytes.toString('utf8', start, end),
};

/**
 * A game's own alphabet: its characters' codes, as learned. Letters come in
 * order in a font, so each case (and the digits) is one offset from its
 * ASCII code; spaces and punctuation have codes of their own. Saved per game
 * (settings.json), so it's learned once.
 */
export interface Alphabet {
  width: 1 | 2;
  bigEndian: boolean;
  // Code minus ASCII code for "a"–"z", "A"–"Z" and "0"–"9" (null: not seen
  // yet).
  lower: number;
  upper: number | null;
  digit: number | null;
  // Other characters' codes (space, punctuation), as [code, character].
  extra: [number, string][];
}

// The fewest and most codes in a run of markup inside a line (see
// `markupEnd`).
const MIN_MARKUP = 2;
const MAX_MARKUP = 3;

const isLower = (c: string) => c >= 'a' && c <= 'z';
const isUpper = (c: string) => c >= 'A' && c <= 'Z';
const isDigit = (c: string) => c >= '0' && c <= '9';

// The codec of a learned alphabet. It reads the alphabet each time, so
// characters learned later (`learn`) apply straight away.
export class AlphabetCodec implements Codec {
  name = 'learned';
  width: 1 | 2;
  private extraByCode = new Map<number, string>();
  private codeByExtra = new Map<string, number>();
  // The high byte all of a 2-byte alphabet's letters share (0x80 in
  // Steins;Gate): codes with it count as text even before they're known.
  private block: number;

  constructor(public alphabet: Alphabet) {
    this.width = alphabet.width;
    this.block = (alphabet.lower + 0x61) >> 8;
    for (const [code, character] of alphabet.extra) {
      this.extraByCode.set(code, character);
      this.codeByExtra.set(character, code);
    }
  }

  codeAt(bytes: Buffer, at: number) {
    if (this.width === 1) {
      return bytes[at];
    }
    return this.alphabet.bigEndian
      ? bytes.readUInt16BE(at)
      : bytes.readUInt16LE(at);
  }

  // The character of a code, or null if it isn't known.
  characterOf(code: number) {
    const { lower, upper, digit } = this.alphabet;
    const extra = this.extraByCode.get(code);
    if (extra !== undefined) {
      return extra;
    }
    for (const [offset, from, to] of [
      [lower, 0x61, 0x7a],
      [upper, 0x41, 0x5a],
      [digit, 0x30, 0x39],
    ] as const) {
      if (offset !== null && code - offset >= from && code - offset <= to) {
        return String.fromCharCode(code - offset);
      }
    }
    return null;
  }

  isText(code: number) {
    if (this.characterOf(code) !== null) {
      return true;
    }
    return this.width === 2 ? code >> 8 === this.block : code >= 0x20;
  }

  encode(text: string) {
    const codes: number[] = [];
    const { lower, upper, digit } = this.alphabet;
    for (const character of text) {
      const extra = this.codeByExtra.get(character);
      const ascii = character.charCodeAt(0);
      if (extra !== undefined) {
        codes.push(extra);
      } else if (isLower(character)) {
        codes.push(lower + ascii);
      } else if (isUpper(character) && upper !== null) {
        codes.push(upper + ascii);
      } else if (isDigit(character) && digit !== null) {
        codes.push(digit + ascii);
      } else {
        return null;
      }
    }
    const bytes = Buffer.alloc(codes.length * this.width);
    codes.forEach((code, i) => {
      if (this.width === 1) {
        bytes[i] = code;
      } else if (this.alphabet.bigEndian) {
        bytes.writeUInt16BE(code, i * 2);
      } else {
        bytes.writeUInt16LE(code, i * 2);
      }
    });
    return bytes;
  }

  decode(bytes: Buffer, start = 0, end = bytes.length) {
    let text = '';
    for (let at = start; at + this.width <= end; ) {
      const code = this.codeAt(bytes, at);
      if (this.isText(code)) {
        text += this.characterOf(code) ?? '\uFFFD';
        at += this.width;
        continue;
      }
      const runEnd = this.markupEnd(bytes, at, end);
      if (runEnd !== null) {
        at = runEnd;
        continue;
      }
      text += '\0';
      at += this.width;
    }
    return text;
  }

  // Where a run of codes that aren't text, starting at `at`, ends if it's
  // markup inside a line, or null if it ends the line. Engines put codes in
  // a line to change how part of it looks (Steins;Gate colours a word with
  // 0x0482 0x0000 before it and 0x0480 0x0000 after). Markup is a short run
  // (`MIN_MARKUP` to `MAX_MARKUP` codes) between text, after a letter,
  // digit, space or comma: a line's end usually comes after its closing
  // mark ("…move!?”" 0x03ff), and a lone code is a line's end too, so a
  // line ending in a letter or comma ("…and I," 0x03ff "…") isn't joined
  // to the next.
  markupEnd(bytes: Buffer, at: number, end = bytes.length) {
    const before =
      at - this.width >= 0
        ? this.characterOf(this.codeAt(bytes, at - this.width))
        : null;
    if (before === null || !/[\p{L}\p{N} ,-]/u.test(before)) {
      return null;
    }
    let runEnd = at;
    // Zeros alone are the gap between two strings, not a command.
    let command = false;
    for (let i = 0; i < MAX_MARKUP; i++) {
      if (runEnd + this.width > end) {
        return null;
      }
      const code = this.codeAt(bytes, runEnd);
      if (this.isText(code)) {
        break;
      }
      command ||= code !== 0;
      runEnd += this.width;
    }
    if (
      runEnd - at < MIN_MARKUP * this.width ||
      !command ||
      runEnd + this.width > end
    ) {
      return null;
    }
    return this.characterOf(this.codeAt(bytes, runEnd)) !== null
      ? runEnd
      : null;
  }

  // Where the string around `at` starts: back to just after a code that
  // isn't text and isn't markup (see `markupEnd`), at most `limit` codes.
  stringStart(bytes: Buffer, at: number, limit: number) {
    let start = at;
    for (let i = 0; i < limit && start - this.width >= 0; i++) {
      const before = start - this.width;
      if (this.isText(this.codeAt(bytes, before))) {
        start = before;
        continue;
      }
      // Back over a run of markup, if that's what it is.
      let runStart = before;
      while (
        runStart - this.width >= 0 &&
        (before - runStart) / this.width < MAX_MARKUP - 1 &&
        !this.isText(this.codeAt(bytes, runStart - this.width))
      ) {
        runStart -= this.width;
      }
      if (this.markupEnd(bytes, runStart) === start) {
        start = runStart;
        continue;
      }
      break;
    }
    return start;
  }

  // Where the string from `at` ends (see `stringStart`), at most `limit`
  // codes on.
  stringEnd(bytes: Buffer, at: number, limit: number) {
    let end = at;
    for (let i = 0; i < limit && end + this.width <= bytes.length; i++) {
      if (this.isText(this.codeAt(bytes, end))) {
        end += this.width;
        continue;
      }
      const runEnd = this.markupEnd(bytes, end);
      if (runEnd === null) {
        break;
      }
      end = runEnd;
    }
    return end;
  }

  // The text codes from `start` to `end`, markup left out: one per
  // character `decode` gives, to line a string's codes up with its text.
  textCodes(bytes: Buffer, start: number, end: number) {
    const codes: number[] = [];
    for (let at = start; at + this.width <= end; ) {
      const code = this.codeAt(bytes, at);
      if (this.isText(code)) {
        codes.push(code);
        at += this.width;
        continue;
      }
      const runEnd = this.markupEnd(bytes, at, end);
      if (runEnd === null) {
        break;
      }
      at = runEnd;
    }
    return codes;
  }

  // Learns a character's code (first seen wins: a later, different guess
  // from a misread doesn't replace it). Returns whether it was new.
  learn(code: number, character: string) {
    if (this.characterOf(code) !== null) {
      return false;
    }
    const { alphabet } = this;
    const ascii = character.charCodeAt(0);
    if (isUpper(character) && alphabet.upper === null) {
      alphabet.upper = code - ascii;
    } else if (isDigit(character) && alphabet.digit === null) {
      alphabet.digit = code - ascii;
    } else if (
      !isLower(character) &&
      !isUpper(character) &&
      !isDigit(character) &&
      !this.codeByExtra.has(character)
    ) {
      alphabet.extra.push([code, character]);
      this.extraByCode.set(code, character);
      this.codeByExtra.set(character, code);
    } else {
      return false;
    }
    return true;
  }
}
