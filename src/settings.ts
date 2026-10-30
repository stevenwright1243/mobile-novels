/**
 * App-wide settings, the same for every game (main process). Saved as
 * `settings.json` in the app's data folder as soon as they change: unlike
 * game profiles, there's no Save button for these.
 */

import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

export type Settings = {
  // The picker's PC / Phone switch: whether the portrait goes full screen on
  // the phone's display while there is one.
  portraitOnPhone: boolean;
  // The size of the portrait's corner buttons, as a multiple of normal (the
  // picker's "Button size" slider).
  buttonSize: number;
  // The colour scheme of both windows (the picker's Style settings).
  theme: ThemeName;
  // The message window's border and arrow (the picker's Style settings).
  messageStyle: MessageStyle;
};

const DEFAULT_SETTINGS: Settings = {
  portraitOnPhone: true,
  buttonSize: 1,
  theme: 'aokana',
  messageStyle: { border: 'halo', arrow: 'chevron' },
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

// The saved settings laid over the defaults, so settings added later get
// their default. All defaults if there's no file yet (or it can't be read).
export async function loadSettings(): Promise<Settings> {
  try {
    const saved = JSON.parse(await fs.readFile(file(), 'utf8'));
    // `messageStyle` is laid over its defaults too, so parts added to it
    // later get theirs.
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      messageStyle: { ...DEFAULT_SETTINGS.messageStyle, ...saved.messageStyle },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings) {
  await fs.writeFile(file(), JSON.stringify(settings, null, 2));
}
