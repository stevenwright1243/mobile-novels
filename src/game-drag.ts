/**
 * Drags passed to the game, in Menus mode with drags set to the game
 * (drag-mode.ts): a finger (or the mouse) dragged on the game holds the
 * game's mouse button down and moves it, so its sliders and scroll bars
 * follow. A tap is still an ordinary click (portrait.ts): the press is only
 * sent once the pointer has moved far enough to be a drag, at the spot it
 * started from. Only the first finger counts; a second is ignored.
 */
import { DRAG_START } from './game-zoom';

// `active`: whether drags go to the game now. `toGame`: where a pointer is
// in the game, as fractions of its client area, or null off the game.
export function dragOnGame(
  canvas: HTMLCanvasElement,
  active: () => boolean,
  toGame: (event: MouseEvent) => GamePoint | null,
) {
  // The pointer being followed, where it went down (CSS pixels, and in the
  // game), and the last spot in the game it was over.
  let pointerId: number | null = null;
  let start = { x: 0, y: 0 };
  let startInGame: GamePoint = { x: 0, y: 0 };
  let last: GamePoint = { x: 0, y: 0 };
  let dragging = false;
  // True once a drag ended in this press: its click is no tap.
  let dragged = false;

  canvas.addEventListener('pointerdown', (event) => {
    if (pointerId !== null) {
      return;
    }
    dragged = false;
    if (!active() || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    const point = toGame(event);
    if (!point) {
      return;
    }
    pointerId = event.pointerId;
    start = { x: event.clientX, y: event.clientY };
    startInGame = last = point;
    dragging = false;
    // Keeps the moves coming here even if the finger leaves the canvas.
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }
    if (!dragging) {
      const distance = Math.hypot(
        event.clientX - start.x,
        event.clientY - start.y,
      );
      if (distance <= DRAG_START) {
        return;
      }
      dragging = true;
      window.vn.dragGame('down', startInGame);
    }
    // Off the game (past the slot's edge), the button stays held where it
    // last was.
    const point = toGame(event);
    if (point) {
      last = point;
      window.vn.dragGame('move', point);
    }
  });

  const lift = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) {
      return;
    }
    pointerId = null;
    if (dragging) {
      dragging = false;
      dragged = true;
      window.vn.dragGame('up', last);
    }
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  // A click that ends a drag stops here, before the tap handler sees it, so
  // the game isn't clicked as well. `capture` runs this first.
  canvas.addEventListener(
    'click',
    (event) => {
      if (dragged) {
        event.stopImmediatePropagation();
        dragged = false;
      }
    },
    { capture: true },
  );
}
