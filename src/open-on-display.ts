/**
 * The picker's "Open on" setting (main process): while it's on, this app's
 * windows and the games it starts open on the chosen monitor instead of
 * Windows' main display (for a main display that's an OLED, turned off while
 * the PC is left on). The monitor is remembered by its name (Electron's
 * `label`, e.g. "HP 727pq"), since display IDs can change when monitors are
 * turned off and on. Apollo's virtual display (the phone's) is never listed.
 */
import {
  screen,
  type BrowserWindow,
  type Display,
  type Rectangle,
} from 'electron';
import { isPhoneDisplay } from './phone-display';
import { widenedClient } from './game-size';
import {
  clientSize,
  isMaximized,
  isResizable,
  moveWindow,
  placeWindow,
  windowBounds,
} from './win32';

/** The monitors that can be picked, main display first. */
export function monitors(): Monitor[] {
  const primary = screen.getPrimaryDisplay();
  return screen
    .getAllDisplays()
    .filter((display) => !isPhoneDisplay(display))
    .map((display) => ({
      name: display.label || `Display ${display.id}`,
      main: display.id === primary.id,
    }))
    .sort((a, b) => Number(b.main) - Number(a.main));
}

/** The monitor to open on, or null to use Windows' main display (the
 * setting is off, or that monitor isn't connected). */
export function openOnDisplay(setting: OpenOn): Display | null {
  if (!setting.on) {
    return null;
  }
  return (
    screen
      .getAllDisplays()
      .find(
        (display) =>
          (display.label || `Display ${display.id}`) === setting.monitor &&
          !isPhoneDisplay(display),
      ) ?? null
  );
}

/** Moves windows of this app onto `display`, keeping their sizes and where
 * they are to each other, centered as a group (and shrunk if the group is
 * bigger than the monitor). Windows already on it stay where they are. */
export function moveAppWindows(windows: BrowserWindow[], display: Display) {
  const area = display.workArea;
  const away = windows.filter(
    (window) =>
      screen.getDisplayMatching(window.getNormalBounds()).id !== display.id,
  );
  if (away.length === 0) {
    return;
  }
  const bounds = away.map((window) => window.getNormalBounds());
  const left = Math.min(...bounds.map((b) => b.x));
  const top = Math.min(...bounds.map((b) => b.y));
  const width = Math.max(...bounds.map((b) => b.x + b.width)) - left;
  const height = Math.max(...bounds.map((b) => b.y + b.height)) - top;
  const scale = Math.min(1, area.width / width, area.height / height);
  const x = area.x + Math.round((area.width - width * scale) / 2);
  const y = area.y + Math.round((area.height - height * scale) / 2);
  away.forEach((window, i) => {
    const b = bounds[i];
    const moved: Rectangle = {
      x: x + Math.round((b.x - left) * scale),
      y: y + Math.round((b.y - top) * scale),
      width: Math.round(b.width * scale),
      height: Math.round(b.height * scale),
    };
    if (window.isMaximized()) {
      window.unmaximize();
    }
    // Twice, as in phone-display.ts: monitors with different scaling make
    // Windows rescale the window after the first move.
    window.setBounds(moved);
    window.setBounds(moved);
  });
}

/** Moves a game's window onto `display`, centered, if it isn't on it, and
 * widens it if it's resizable and narrower than `GAME_WIDTH` of the
 * monitor (game-size.ts). */
export function moveGameWindow(hwnd: number, display: Display) {
  const bounds = windowBounds(hwnd);
  if (!bounds) {
    return;
  }
  // Win32 works in real pixels; Electron's positions are scaled per display.
  const area = screen.dipToScreenRect(null, display.workArea);
  const client = clientSize(hwnd);
  const widened =
    client && isResizable(hwnd) && !isMaximized(hwnd)
      ? widenedClient(
          client,
          {
            width: bounds.width - client.width,
            height: bounds.height - client.height,
          },
          area,
        )
      : null;
  if (client && widened) {
    const width = bounds.width - client.width + widened.width;
    const height = bounds.height - client.height + widened.height;
    const to = {
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height,
    };
    // Twice, as in moveAppWindows: moving onto a monitor with different
    // scaling makes Windows rescale the window after the first move.
    placeWindow(hwnd, to);
    placeWindow(hwnd, to);
    return;
  }
  const middle = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const inside =
    middle.x >= area.x &&
    middle.x < area.x + area.width &&
    middle.y >= area.y &&
    middle.y < area.y + area.height;
  if (inside) {
    return;
  }
  moveWindow(hwnd, {
    x: area.x + Math.max(0, Math.round((area.width - bounds.width) / 2)),
    y: area.y + Math.max(0, Math.round((area.height - bounds.height) / 2)),
  });
}
