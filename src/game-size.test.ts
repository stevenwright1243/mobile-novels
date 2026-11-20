import { describe, expect, it } from 'vitest';
import { widenedClient } from './game-size';

// Aokana as found: a 648×364 picture in a 681×449 window, on the HP
// monitor turned upright (2160×3840).
const frame = { width: 33, height: 85 };
const upright = { width: 2160, height: 3840 };

describe('widenedClient', () => {
  it('widens a small game to 98% of the monitor, keeping its shape', () => {
    expect(widenedClient({ width: 648, height: 364 }, frame, upright)).toEqual({
      width: 2116,
      height: 1189,
    });
  });

  it('leaves a game alone that is already that wide', () => {
    expect(
      widenedClient({ width: 2120, height: 1192 }, frame, upright),
    ).toBeNull();
  });

  it("keeps the window's borders on the monitor", () => {
    const thickFrame = { width: 80, height: 85 };
    expect(
      widenedClient({ width: 648, height: 364 }, thickFrame, upright)?.width,
    ).toBe(2080);
  });

  it('stops where the window would be taller than the monitor', () => {
    const wide = { width: 5120, height: 2160 };
    expect(widenedClient({ width: 1280, height: 720 }, frame, wide)).toEqual({
      width: 3688,
      height: 2075,
    });
  });

  it('skips a window with no picture (minimized)', () => {
    expect(widenedClient({ width: 0, height: 0 }, frame, upright)).toBeNull();
  });
});
