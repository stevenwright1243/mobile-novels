/**
 * The zoom pad at the top of the Menus sheet: zoom in and out on the left,
 * a d-pad on the right to move around the zoomed-in game a step per tap
 * (the steps are in game-zoom.ts), and in its middle the zoom level, which
 * goes back to the whole game when tapped. Buttons that would do nothing
 * (zoom out at 1×, a direction at that edge of the game) are disabled.
 */

import {
  moveStep,
  onZoomChanged,
  resetZoom,
  zoomState,
  zoomStep,
} from './game-zoom';

const zoomIn = document.querySelector<HTMLButtonElement>('#zoom-in')!;
const zoomOut = document.querySelector<HTMLButtonElement>('#zoom-out')!;
const zoomLevel = document.querySelector<HTMLButtonElement>('#zoom-level')!;
// The d-pad's arrows: each moves `data-x` / `data-y` steps, and is named by
// `data-way`, the way it moves (as in `zoomState()`).
type Way = 'left' | 'right' | 'up' | 'down';
const moves = [
  ...document.querySelectorAll<HTMLButtonElement>('#zoom-pad [data-way]'),
];

zoomIn.addEventListener('click', () => zoomStep(1));
zoomOut.addEventListener('click', () => zoomStep(-1));
zoomLevel.addEventListener('click', resetZoom);
for (const button of moves) {
  button.addEventListener('click', () =>
    moveStep(Number(button.dataset.x), Number(button.dataset.y)),
  );
}

function update() {
  const state = zoomState();
  zoomIn.disabled = !state.zoomIn;
  zoomOut.disabled = !state.zoomOut;
  zoomLevel.disabled = !state.zoomOut;
  // 1×, 1.4×, 2×, 2.8×, 4×.
  zoomLevel.textContent = `${Math.round(state.scale * 10) / 10}×`;
  for (const button of moves) {
    button.disabled = !state[button.dataset.way as Way];
  }
}
onZoomChanged(update);
update();
