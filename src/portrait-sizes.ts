/**
 * The portrait's sizes, shared by the portrait (portrait.ts) and its Menus
 * sheet (menus-sheet.ts), which can both change them: the text and name
 * size and the picture's height (the game's profile; saved with the
 * picker's Save button) and the corner buttons' size (an app setting, saved
 * by main). Main passes a change on to the other windows only, not back to
 * the one that made it, so a change made here is passed on to this page's
 * own listeners here.
 */

import { BACKGROUND_VIEW } from './zone-view';

interface Shared<T> {
  get(): T;
  // Calls `callback` with the value now, and again whenever it changes.
  listen(callback: (value: T) => void): void;
  // Changes it here and in main.
  set(value: T): void;
}

function shared<T>(
  initial: T,
  getFromMain: () => Promise<T>,
  onChangedInMain: (callback: (value: T) => void) => void,
  setInMain: (value: T) => Promise<void>,
): Shared<T> {
  let value = initial;
  const listeners: ((value: T) => void)[] = [];
  const update = (newValue: T) => {
    value = newValue;
    for (const listener of listeners) {
      listener(value);
    }
  };
  onChangedInMain(update);
  getFromMain().then(update);
  return {
    get: () => value,
    listen(callback) {
      listeners.push(callback);
      callback(value);
    },
    set(newValue) {
      update(newValue);
      setInMain(newValue);
    },
  };
}

export const textStyle = shared<TextStyle>(
  { size: 1, nameSize: 1, position: 'bottom' },
  () => window.vn.getTextStyle(),
  (callback) => window.vn.onTextStyleChanged(callback),
  (style) => window.vn.setTextStyle(style),
);

// Where the background sits, top to bottom (the game's `backgroundY`).
export const backgroundY = shared<number>(
  BACKGROUND_VIEW.y,
  () => window.vn.getBackgroundY(),
  (callback) => window.vn.onBackgroundYChanged(callback),
  (y) => window.vn.setBackgroundY(y),
);

export const buttonSize = shared<number>(
  1,
  () => window.vn.getButtonSize(),
  (callback) => window.vn.onButtonSizeChanged(callback),
  (size) => window.vn.setButtonSize(size),
);
