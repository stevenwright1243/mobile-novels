/**
 * Full-screen text mode (the portrait's Menus sheet): for games that fill
 * the screen with text (NVL), whose text is read from the page region
 * instead of the text box, and shown as a page (page-view.ts). Off, On, or
 * Auto (the default), where auto-page.ts switches it as the game does. Just
 * for now, not saved, like Menus mode itself.
 */

export type PageModeChoice = 'off' | 'auto' | 'on';

let choice: PageModeChoice = 'auto';
// What Auto has found the game showing.
let autoOn = false;
let on = false;
const listeners: ((on: boolean) => void)[] = [];
const choiceListeners: ((choice: PageModeChoice) => void)[] = [];

export const isPageMode = () => on;
export const pageModeChoice = () => choice;

function update() {
  const next = choice === 'on' || (choice === 'auto' && autoOn);
  if (next !== on) {
    on = next;
    for (const listener of listeners) {
      listener(on);
    }
  }
}

export function setPageModeChoice(value: PageModeChoice) {
  choice = value;
  for (const listener of choiceListeners) {
    listener(choice);
  }
  update();
}

// What Auto found: whether the game is showing full-screen text.
export function setAutoPageMode(value: boolean) {
  autoOn = value;
  update();
}

// Calls `callback` with the mode whenever it changes.
export function onPageModeChanged(callback: (on: boolean) => void) {
  listeners.push(callback);
}

// Calls `callback` with the choice (Off, Auto or On) whenever it's picked.
export function onPageModeChoiceChanged(
  callback: (choice: PageModeChoice) => void,
) {
  choiceListeners.push(callback);
}
