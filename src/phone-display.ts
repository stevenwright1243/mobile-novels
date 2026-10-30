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
 */

import { screen, type BrowserWindow, type Display } from 'electron';
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
const describe = (display: Display): PhoneDisplay => ({
  label: display.label,
  width: Math.round(display.size.width * display.scaleFactor),
  height: Math.round(display.size.height * display.scaleFactor),
  scale: display.scaleFactor,
});

// Keeps `window` full screen on the phone's display whenever there is one.
// `onChange` hears about the phone connecting (its display) and
// disconnecting (null).
export function followPhoneDisplay(
  window: BrowserWindow,
  onChange: (phone: PhoneDisplay | null) => void,
) {
  // Where the window was on the PC, to go back to afterwards.
  let pcBounds = window.getNormalBounds();
  // The display the window is full screen on, as "id x,y widthxheight", so
  // a change of size (the phone turned sideways) counts as a new display.
  let placedOn: string | null = null;

  const update = () => {
    const phone = findPhoneDisplay();
    const key = phone
      ? `${phone.id} ${phone.bounds.x},${phone.bounds.y} ` +
        `${phone.bounds.width}x${phone.bounds.height}`
      : null;
    if (key === placedOn) {
      return;
    }

    // Full screen only works on the display the window is on, so: leave
    // full screen, move the window onto the phone's display, then go full
    // screen again there.
    if (window.isFullScreen()) {
      window.setFullScreen(false);
    }
    if (phone) {
      if (placedOn === null) {
        pcBounds = window.getNormalBounds();
      }
      window.setBounds(phone.workArea);
      window.setFullScreen(true);
    } else {
      window.setBounds(pcBounds);
    }
    placedOn = key;
    onChange(phone && describe(phone));
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
}
