/**
 * Parking the cursor on the game (main process). On the phone, a mouse
 * paired with it moves the PC's real cursor, which the stream shows. After a
 * click in the reader, the cursor is moved off the phone's display onto the
 * game itself, just beside its text box: out of the stream, out of the box
 * OCR reads, and somewhere a click still moves the game on. The mouse's next
 * clicks then go straight to the game. They're watched for, so Auto still
 * learns your pace from them (`onClick`, sent to the portrait as
 * `game-clicked`).
 */
import {
  clientSize,
  cursorOverClient,
  cursorWidth,
  leftButtonDown,
  parkCursor,
} from './win32';

// Room left between the cursor's picture and the box (pixels).
const CLEARANCE = 4;
// How often (ms) clicks on the game are looked for while the cursor is
// parked on it.
const WATCH_EVERY = 30;

/**
 * Where to park the cursor, in pixels of the game's client area. The
 * cursor's picture is drawn right of and below the spot it points at, up to
 * `cursor` pixels wide, so the spot is far enough left of the box (or right
 * of it, or under it) that none of it reaches in.
 */
export function parkSpot(
  regions: Regions,
  park: ParkSpot,
  size: { width: number; height: number },
  cursor: number,
) {
  const box = regions[park];
  const left = box.x * size.width;
  const right = (box.x + box.w) * size.width;
  const top = box.y * size.height;
  const bottom = (box.y + box.h) * size.height;
  const last = { x: size.width - 1, y: size.height - 1 };
  const inGame = (x: number, y: number) => ({
    x: Math.round(Math.min(x, last.x)),
    y: Math.round(Math.min(y, last.y)),
  });

  // Full-screen text covers nearly all of the game: just past the page's
  // bottom-right corner, with the picture outside it (or off the game).
  if (park === 'page') {
    return inGame(right + CLEARANCE, bottom + CLEARANCE);
  }
  const middle = (top + bottom) / 2;
  if (left - cursor - CLEARANCE >= 0) {
    return inGame(left - cursor - CLEARANCE, middle);
  }
  if (right + CLEARANCE <= last.x) {
    return inGame(right + CLEARANCE, middle);
  }
  if (bottom + CLEARANCE <= last.y) {
    return inGame((left + right) / 2, bottom + CLEARANCE);
  }
  return last;
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
  parkCursor(hwnd, parkSpot(regions, park, size, cursorWidth()));
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
