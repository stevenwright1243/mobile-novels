/**
 * How big a game started from the app should open on the "Open on" monitor
 * (open-on-display.ts). Some games remember their last window size and
 * sometimes open absurdly small (Aokana once at 432×243 on a 4K monitor),
 * which makes the portrait blurry and OCR worse.
 */

/** The least part of the monitor's width a game's picture fills. */
export const GAME_WIDTH = 0.98;

interface Size {
  width: number;
  height: number;
}

/**
 * The client size (the game's picture, without title bar and borders) to
 * widen a game to, keeping its shape: `GAME_WIDTH` of the monitor's width,
 * or less where the window would be taller than the monitor. Null if it's
 * already that wide or wider. All sizes are real pixels; `frame` is what
 * the title bar and borders add to the client size.
 */
export function widenedClient(
  client: Size,
  frame: Size,
  area: Size,
): Size | null {
  if (client.width <= 0 || client.height <= 0) {
    return null;
  }
  const shape = client.width / client.height;
  const width = Math.floor(
    Math.min(
      area.width * GAME_WIDTH,
      area.width - frame.width,
      (area.height - frame.height) * shape,
    ),
  );
  if (width <= client.width) {
    return null;
  }
  return { width, height: Math.round(width / shape) };
}
