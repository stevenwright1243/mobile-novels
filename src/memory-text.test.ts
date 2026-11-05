/**
 * Tests for memory-text.ts's checks of a line from the game's memory
 * against what OCR read. Run with `npm test`.
 *
 * memory-text.ts reads the game's memory through win32.ts, which loads
 * Windows' own DLLs through koffi. These tests never read memory, so
 * win32.ts is swapped for an empty stand-in (`vi.mock` below).
 */

import { describe, expect, it, vi } from 'vitest';
import { isPartOf } from './memory-text';

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
