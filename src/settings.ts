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
};

const DEFAULT_SETTINGS: Settings = { portraitOnPhone: true };

const file = () => path.join(app.getPath('userData'), 'settings.json');

// The saved settings laid over the defaults, so settings added later get
// their default. All defaults if there's no file yet (or it can't be read).
export async function loadSettings(): Promise<Settings> {
  try {
    const saved = JSON.parse(await fs.readFile(file(), 'utf8'));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings) {
  await fs.writeFile(file(), JSON.stringify(settings, null, 2));
}
