// Saving and loading each game's settings. Main process only, since it uses
// the file system.
import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

// Used for a game that has no saved settings yet.
export const DEFAULT_REGIONS: Regions = {
  background: { x: 0, y: 0, w: 1, h: 0.7 },
  text: { x: 0, y: 0.7, w: 1, h: 0.3 },
};

// What's stored in each game's JSON file. `version` lets a future change to
// the format recognize old files. Version 1 measured regions against the
// whole window, title bar included; version 2 against the game's content.
const VERSION = 2;
interface GameConfig {
  version: typeof VERSION;
  title: string;
  regions: Regions;
}

// One file per game, in the app's per-user data folder
// (%APPDATA%\mobile-novel\games on Windows), named after the window title
// with the characters Windows doesn't allow in file names replaced.
function configPath(title: string) {
  const fileName =
    title
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[. ]+$/, '')
      .slice(0, 100) || 'untitled';
  return path.join(app.getPath('userData'), 'games', `${fileName}.json`);
}

export async function loadRegions(title: string): Promise<Regions> {
  try {
    const json = await fs.readFile(configPath(title), 'utf8');
    const config: GameConfig = JSON.parse(json);
    if (config.version !== VERSION) {
      // An older format: its regions would land in the wrong place.
      return DEFAULT_REGIONS;
    }
    // Laid over the defaults, so a file that's missing a region still works.
    return { ...DEFAULT_REGIONS, ...config.regions };
  } catch {
    // No file yet (a new game), or one that can't be read: use the defaults.
    return DEFAULT_REGIONS;
  }
}

export async function saveRegions(title: string, regions: Regions) {
  const file = configPath(title);
  const config: GameConfig = { version: VERSION, title, regions };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2));
}
