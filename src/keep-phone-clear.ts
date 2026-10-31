/**
 * Keeps every other program's windows off the phone's display (main
 * process), so the phone only ever shows the portrait. While Apollo's
 * display exists, each window that reaches onto it (other than the
 * portrait's) is moved onto a real monitor: the one it's mostly on already,
 * or, if it's wholly on the phone's, the "Open on" monitor or the main
 * display. It's shrunk to fit that monitor if it's bigger, so no window
 * spans two monitors with part of it on the phone; maximized windows are
 * maximized again there. Checked every second while the app is open.
 *
 * Windows of programs run as admin (Task Manager, say) can't be moved by a
 * program that isn't, so those stay put.
 */
import { screen, type Display, type Rectangle } from 'electron';
import { findPhoneDisplay } from './phone-display';
import {
  isMaximized,
  maximize,
  placeWindow,
  programWindows,
  restore,
  visibleBounds,
  windowBounds,
} from './win32';

// How far onto the phone's display a window has to reach to be moved, in
// real pixels: past window shadows and rounding at a shared edge.
const MIN_OVERLAP = 16;

const overlap = (a: Rectangle, b: Rectangle) => {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? { width, height } : null;
};

const reachesOnto = (window: Rectangle, display: Rectangle) => {
  const shared = overlap(window, display);
  return (
    shared !== null && shared.width > MIN_OVERLAP && shared.height > MIN_OVERLAP
  );
};

// Electron's positions are scaled for each display's scaling; Win32's are
// real pixels.
const inPixels = (rect: Rectangle) => screen.dipToScreenRect(null, rect);

/** Starts checking. `allowed` gives the windows that may be on the phone's
 * display (the portrait's), `fallback` the monitor for windows wholly on it
 * (null for the main display). */
export function keepPhoneDisplayClear(
  allowed: () => number[],
  fallback: () => Display | null,
) {
  setInterval(() => {
    const phone = findPhoneDisplay();
    if (!phone) {
      return;
    }
    const phoneRect = inPixels(phone.bounds);
    const monitors = screen
      .getAllDisplays()
      .filter((display) => display.id !== phone.id);
    if (monitors.length === 0) {
      return;
    }
    const keep = new Set(allowed());
    for (const hwnd of programWindows()) {
      const shown = visibleBounds(hwnd);
      if (keep.has(hwnd) || !shown || !reachesOnto(shown, phoneRect)) {
        continue;
      }
      moveOff(hwnd, shown, monitors, fallback());
    }
  }, 1000);
}

function moveOff(
  hwnd: number,
  shown: Rectangle,
  monitors: Display[],
  fallback: Display | null,
) {
  // The monitor it's mostly on, if any of it is on one.
  let best: Display | null = null;
  let bestArea = 0;
  for (const display of monitors) {
    const shared = overlap(shown, inPixels(display.bounds));
    const area = shared ? shared.width * shared.height : 0;
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  const display = best ?? fallback ?? screen.getPrimaryDisplay();
  const area = inPixels(display.workArea);

  const wasMaximized = isMaximized(hwnd);
  if (wasMaximized) {
    restore(hwnd);
  }
  // Placed by what shows, then the invisible borders Windows adds around
  // it put back on (they're part of the size Windows is given).
  const visible = (wasMaximized ? visibleBounds(hwnd) : shown) ?? shown;
  const whole = windowBounds(hwnd) ?? visible;
  const width = Math.min(visible.width, area.width);
  const height = Math.min(visible.height, area.height);
  // Wholly on the phone's display: centered. Partly: nudged just enough to
  // be inside the monitor.
  const x = best
    ? Math.min(Math.max(visible.x, area.x), area.x + area.width - width)
    : area.x + Math.round((area.width - width) / 2);
  const y = best
    ? Math.min(Math.max(visible.y, area.y), area.y + area.height - height)
    : area.y + Math.round((area.height - height) / 2);
  placeWindow(hwnd, {
    x: x - (visible.x - whole.x),
    y: y - (visible.y - whole.y),
    width: width + (whole.width - visible.width),
    height: height + (whole.height - visible.height),
  });
  if (wasMaximized) {
    maximize(hwnd);
  }
}
