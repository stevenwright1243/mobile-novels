/**
 * Full-screen text mode (the portrait's Menus sheet): for games that fill
 * the screen with text (NVL), whose text is read from the page region
 * instead of the text box, and shown as a page (page-view.ts). Just for
 * now, not saved, like Menus mode itself: games switch between full-screen
 * text and a text box as they go.
 */

let on = false;
const listeners: ((on: boolean) => void)[] = [];

export const isPageMode = () => on;

export function setPageMode(value: boolean) {
  on = value;
  for (const listener of listeners) {
    listener(on);
  }
}

// Calls `callback` with the mode whenever it's switched.
export function onPageModeChanged(callback: (on: boolean) => void) {
  listeners.push(callback);
}
