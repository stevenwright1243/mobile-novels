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
  // string), text codes not known yet "�".
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
    for (let at = start; at + this.width <= end; at += this.width) {
      const code = this.codeAt(bytes, at);
      text += this.isText(code) ? (this.characterOf(code) ?? '�') : '\0';
    }
    return text;
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
