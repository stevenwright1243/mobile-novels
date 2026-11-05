/**
 * What a drag on the game does in Menus mode (the switch in the Menus sheet's
 * Input Settings): 'zoom' (the default) pinches and drags to zoom in and
 * move around the game (game-zoom.ts); 'game' passes drags to the game
 * instead (game-drag.ts), for its sliders and scroll bars. The zoom pad
 * works either way. Just for now, not saved, like Menus mode itself.
 */

export type DragMode = 'zoom' | 'game';

let mode: DragMode = 'zoom';
const listeners: ((mode: DragMode) => void)[] = [];

export const dragMode = () => mode;

export function setDragMode(value: DragMode) {
  mode = value;
  for (const listener of listeners) {
    listener(mode);
  }
}

// Calls `callback` with the mode whenever it's changed.
export function onDragModeChanged(callback: (mode: DragMode) => void) {
  listeners.push(callback);
}
