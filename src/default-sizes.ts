/**
 * The portrait's default sizes, picked by the user: what a game starts with
 * before it's set its own (profiles.ts; also laid over older profiles for
 * any value they don't have yet), the button size's default (settings.ts),
 * and what the Menus sheet's Default button sets (menus-sheet.ts). One list,
 * so those can't drift apart. No Node or Electron here: both processes use
 * it.
 */

import { BACKGROUND_VIEW } from './zone-view';

// Text and name at their normal size, the message window hanging under the
// picture, with no extra padding.
export const DEFAULT_TEXT_STYLE: TextStyle = {
  size: 1,
  nameSize: 1,
  position: 'top',
  padding: 0,
};

// The background sits 20% of the way down, with three quarters of its width
// showing (see `BACKGROUND_VIEW`).
export const DEFAULT_BACKGROUND_Y = BACKGROUND_VIEW.y;
export const DEFAULT_BACKGROUND_WIDTH = BACKGROUND_VIEW.width!;

// The corner buttons at their normal size (an app setting).
export const DEFAULT_BUTTON_SIZE = 1;
