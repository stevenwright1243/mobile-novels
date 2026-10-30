/**
 * Puts the portrait window full screen on the phone's display while one is
 * connected (main process).
 *
 * When Artemis (the phone) connects, Apollo adds a virtual display the size
 * of the phone's screen and streams only that display. So the portrait
 * filling that display is exactly what the phone shows. When the phone
 * disconnects, Apollo removes the display, and the window goes back to where
 * it was on the PC.
 *
 * The phone's display is recognized by what drives it: Apollo's virtual
 * display driver, SudoVDA (by SudoMaker). Not by its shape (a monitor can be
 * turned to portrait too) or its name (Apollo names it after the phone).
 *
 * Leaving Artemis without quitting only pauses the stream, and Apollo keeps
 * the display while paused, so the portrait would stay out of sight on it.
 * The picker's PC / Phone switch (`setOnPhone`, saved in settings.ts) keeps
 * it on the PC instead.
 */

import {
  screen,
  type BrowserWindow,
  type Display,
  type Rectangle,
} from 'electron';
import { displayAdapterAt } from './win32';

const VIRTUAL_DISPLAY_ADAPTER = /SudoMaker|SudoVDA/i;

const isPhoneDisplay = (display: Display) => {
  const { x, y, width, height } = display.bounds;
  // Electron's positions are scaled for each display's scaling; Windows
  // wants real pixels. The middle of the display is safely inside it.
  const middle = screen.dipToScreenPoint({
    x: x + width / 2,
    y: y + height / 2,
  });
  return VIRTUAL_DISPLAY_ADAPTER.test(displayAdapterAt(middle) ?? '');
};

// The phone's display, if one is connected.
const findPhoneDisplay = () =>
  screen.getAllDisplays().find(isPhoneDisplay) ?? null;

// What the picker shows about it. Sizes are in real pixels: Electron gives
// them scaled down by the display's scaling (e.g. ÷3 at 300%).
const describe = (
  display: Display,
  portraitOnPhone: boolean,
): PhoneDisplay => ({
  label: display.label,
  width: Math.round(display.size.width * display.scaleFactor),
  height: Math.round(display.size.height * display.scaleFactor),
  scale: display.scaleFactor,
  portraitOnPhone,
});

// A display as "id x,y widthxheight", so a change of size (the phone turned
// sideways) counts as a new display.
const keyOf = (display: Display) =>
  `${display.id} ${display.bounds.x},${display.bounds.y} ` +
  `${display.bounds.width}x${display.bounds.height}`;

// `bounds` resized to the guide's top edge and height, keeping its left edge
// and its shape (width to height). Unchanged without a guide.
const toHeightOf = (bounds: Rectangle, guide: Rectangle | null): Rectangle =>
  guide
    ? {
        x: bounds.x,
        y: guide.y,
        width: Math.round((bounds.width * guide.height) / bounds.height),
        height: guide.height,
      }
    : bounds;

// Keeps `window` full screen on the phone's display whenever there is one,
// if `onPhone` (the picker's PC / Phone switch) says so. `onChange` hears
// about the phone connecting (its display) and disconnecting (null), and
// about the portrait moving between the phone and the PC. Back on the PC,
// the window takes the top edge and height of `heightGuide()` (the picker),
// if it gives one. Returns `setOnPhone`, to flip the switch.
export function followPhoneDisplay(
  window: BrowserWindow,
  onChange: (phone: PhoneDisplay | null) => void,
  heightGuide: () => Rectangle | null,
  onPhone: boolean,
) {
  // Where the window was on the PC, to go back to afterwards.
  let pcBounds = window.getNormalBounds();
  // The phone display the window is full screen on (see `keyOf`), or null
  // while it's on the PC.
  let placedOn: string | null = null;
  // What `onChange` last heard, so it only hears about changes.
  let reported: string | null = null;

  const update = () => {
    const phone = findPhoneDisplay();
    const target = phone && onPhone ? phone : null;
    const key = target && keyOf(target);

    if (key !== placedOn) {
      // Full screen only works on the display the window is on, so: leave
      // full screen, move the window onto the phone's display, then go full
      // screen again there.
      if (window.isFullScreen()) {
        window.setFullScreen(false);
      }
      if (target) {
        if (placedOn === null) {
          pcBounds = window.getNormalBounds();
        }
        window.setBounds(target.workArea);
        window.setFullScreen(true);
      } else {
        // Twice, on purpose: the phone's display and the PC's monitor can
        // have different scaling (100% and 150%, say). Crossing between
        // them, Windows rescales the window to the new scaling on top of the
        // size asked for, so the first call leaves it the wrong size. The
        // second, made on the right monitor, gets it exact.
        const bounds = toHeightOf(pcBounds, heightGuide());
        window.setBounds(bounds);
        window.setBounds(bounds);
      }
      placedOn = key;
    }

    const state = phone && `${keyOf(phone)} ${onPhone}`;
    if (state !== reported) {
      reported = state;
      onChange(phone && describe(phone, onPhone));
    }
  };

  // Displays come and go in bursts (added, then resized, then moved), so
  // wait for things to settle before acting.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const updateSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 500);
  };
  screen.on('display-added', updateSoon);
  screen.on('display-removed', updateSoon);
  screen.on('display-metrics-changed', updateSoon);
  window.on('closed', () => {
    clearTimeout(timer);
    screen.off('display-added', updateSoon);
    screen.off('display-removed', updateSoon);
    screen.off('display-metrics-changed', updateSoon);
  });

  update();

  return {
    setOnPhone(value: boolean) {
      onPhone = value;
      update();
    },
  };
}
