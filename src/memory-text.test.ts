/**
 * Tests for memory-text.ts's checks of a line from the game's memory
 * against what OCR read. Run with `npm test`.
 *
 * memory-text.ts reads the game's memory through win32.ts, which loads
 * Windows' own DLLs through koffi. These tests never read memory, so
 * win32.ts is swapped for an empty stand-in (`vi.mock` below).
 */

import { describe, expect, it, vi } from 'vitest';
import { isPartOf, withoutJunkAfter } from './memory-text';

vi.mock('./win32', () => ({}));

describe('isPartOf', () => {
  it("finds memory's line only part of a longer read (Ren'Py's typewriter)", () => {
    expect(
      isPartOf(
        'I ponder the meaning of the note, the snowfall graduall',
        'As I ponder the meaning of the note, the snowfall gradually thickens.',
      ),
    ).toBe(true);
  });

  it('keeps a whole line when OCR reads junk after it', () => {
    expect(
      isPartOf(
        'Asuka looks around the cramped store interior with her mouth wide open.',
        'Asuka looks around the cramped store interior with her mouth wide open. Y MIZUKI YMIZUIKI',
      ),
    ).toBe(false);
  });

  it('keeps a whole line ending in a closing quote', () => {
    expect(
      isPartOf('“Is that so?”', '“Is that so?” MIZUKI MIZUKI MIZUKI'),
    ).toBe(false);
  });

  it('ignores a read about as long as the line', () => {
    expect(isPartOf('Is that so', 'Is that so?')).toBe(false);
  });
});

describe('withoutJunkAfter', () => {
  it('leaves out junk OCR read after a whole line', () => {
    expect(withoutJunkAfter('Cool.', 'Cool. ÝMIZUKI')).toBe('Cool.');
  });

  it('allows for OCR misreading the line itself', () => {
    expect(
      withoutJunkAfter(
        'She just gave me a call and said I should pick out some good ones for you.',
        'She iust gave me a cal and said I should pick out some good ones for you. YMIZUKI',
      ),
    ).toBe(
      'She iust gave me a cal and said I should pick out some good ones for you.',
    );
  });

  it('keeps the whole read when there is nothing after the line', () => {
    expect(withoutJunkAfter('Cool.', 'Cool.')).toBe('Cool.');
  });

  it("keeps the read when memory's line doesn't end a sentence", () => {
    expect(withoutJunkAfter('Cool, so', 'Cool, so we go')).toBe(
      'Cool, so we go',
    );
  });

  it("keeps the read when it isn't the line", () => {
    expect(withoutJunkAfter('Cool.', 'Fine by me.')).toBe('Fine by me.');
  });
});
