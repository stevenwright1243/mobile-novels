/**
 * Parking the cursor on the game (main process). On the phone, a mouse
 * paired with it moves the PC's real cursor, which the stream shows. After a
 * click in the reader, the cursor is moved off the phone's display onto the
 * game itself, just inside its text box's bottom-right corner: out of the
 * stream, and where a click moves the game on (taps click the box too). The
 * cursor's picture is drawn right of and below the spot it points at, so
 * from there it lies outside the box OCR reads, but for its very tip. (Just
 * left of the box was tried first: a game's quick menu popped up there on
 * hover, over the text, and the next click could have hit Exit.) The
 * mouse's next clicks then go straight to the game. They're watched for, so
 * Auto still learns your pace from them (`onClick`, sent to the portrait as
 * `game-clicked`).
 */
import {
  clientSize,
  cursorOverClient,
  leftButtonDown,
  parkCursor,
} from './win32';

// How far inside the box's bottom-right corner the cursor points (pixels):
// enough that the click lands in the box though its edges fall between
// pixels.
const INSET = 2;
// How often (ms) clicks on the game are looked for while the cursor is
// parked on it.
const WATCH_EVERY = 30;

/** Where to park the cursor, in pixels of the game's client area: just
 * inside the bottom-right corner of the text box (or full-screen text's
 * page). */
export function parkSpot(
  regions: Regions,
  park: ParkSpot,
  size: { width: number; height: number },
) {
  const box = regions[park];
  const corner = (start: number, length: number, pixels: number) =>
    Math.max(
      Math.ceil(start * pixels),
      Math.min(pixels, Math.floor((start + length) * pixels)) - 1 - INSET,
    );
  return {
    x: corner(box.x, box.w, size.width),
    y: corner(box.y, box.h, size.height),
  };
}

let watch: ReturnType<typeof setInterval> | undefined;
// Clicks main is making itself (click-game) right now, which aren't yours.
let ownClicks = 0;

/** Runs one of main's own clicks on the game, so the watch ignores it. */
export async function asOwnClick<T>(click: () => Promise<T>) {
  ownClicks++;
  try {
    return await click();
  } finally {
    ownClicks--;
  }
}

/** Parks the cursor beside the game's text box (or page), and watches for
 * clicks on the game until the cursor leaves it. */
export function parkOnGame(
  hwnd: number,
  regions: Regions,
  park: ParkSpot,
  onClick: () => void,
) {
  const size = clientSize(hwnd);
  if (!size) {
    return;
  }
  parkCursor(hwnd, parkSpot(regions, park, size));
  stopWatching();
  let wasDown = leftButtonDown();
  watch = setInterval(() => {
    // Moved away (by the mouse, or onto the portrait by a tap on the
    // phone), or the game closed.
    if (!cursorOverClient(hwnd)) {
      stopWatching();
      return;
    }
    const down = leftButtonDown();
    if (down && !wasDown && ownClicks === 0) {
      onClick();
    }
    wasDown = down;
  }, WATCH_EVERY);
}

export function stopWatching() {
  clearInterval(watch);
  watch = undefined;
}
