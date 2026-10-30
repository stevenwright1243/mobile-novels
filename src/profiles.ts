// Game profiles: one JSON file per game with everything the app remembers
// about it (regions, click method, window size...). Main process only, since
// it uses the file system.
import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

// Used for a game that has no saved regions yet.
export const DEFAULT_REGIONS: Regions = {
  background: { x: 0, y: 0, w: 1, h: 0.7 },
  text: { x: 0, y: 0.7, w: 1, h: 0.3 },
};

// Normal-sized text.
export const DEFAULT_TEXT_STYLE: TextStyle = { size: 1, oversizedSize: null };

// The file format's version. 1 measured regions against the whole window
// (title bar included), 2 against the game's content and was keyed by window
// title, 3 is the full profile keyed by .exe.
const VERSION = 3;

// %APPDATA%\mobile-novel\games on Windows.
const folder = () => path.join(app.getPath('userData'), 'games');

// Replaces characters Windows doesn't allow in file names.
function safeFileName(name: string) {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[. ]+$/, '')
      .slice(0, 100) || 'untitled'
  );
}

const fileFor = (name: string) =>
  path.join(folder(), `${safeFileName(name)}.json`);

// A game is identified by its .exe name (lowercase, since Windows file names
// ignore case), which stays the same even if the window title changes. If the
// .exe can't be read, fall back to the title.
export function profileId(exePath: string | null, title: string) {
  return exePath
    ? path.win32.basename(exePath).toLowerCase()
    : `title:${title}`;
}

// Reads a JSON file, or returns null if it's missing or unreadable.
async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// A loaded profile, plus whether it has a profile file yet, and the
// pre-profile file it was upgraded from (to delete once saved), if any.
export interface LoadedProfile {
  profile: GameProfile;
  saved: boolean;
  legacyFile: string | null;
}

// Loads a game's profile without writing anything: nothing is saved until
// the user clicks "Save profile".
export async function loadProfile(
  id: string,
  exePath: string | null,
  title: string,
): Promise<LoadedProfile> {
  const saved = await readJson(fileFor(id));
  if (saved?.version === VERSION) {
    // Laid over the defaults, so a file that's missing a field still works.
    const profile = {
      ...newProfile(id, exePath, title),
      ...saved,
      // Settings made of several values are laid over their defaults too,
      // so a value added since the file was saved gets its default.
      regions: { ...DEFAULT_REGIONS, ...saved.regions },
      textStyle: { ...DEFAULT_TEXT_STYLE, ...saved.textStyle },
    };
    // The background's zoom and position used to be saved per game; they're
    // fixed now (see `BACKGROUND_VIEW`), so drop any old saved ones.
    delete profile.backgroundView;
    return { profile, saved: true, legacyFile: null };
  }

  const profile = newProfile(id, exePath, title);
  // Upgrade a file from before profiles (version 2, named after the window
  // title). Its regions are already measured the same way, so they carry
  // over unchanged. The old file is removed when the profile is saved.
  const oldFile = fileFor(title);
  const old = await readJson(oldFile);
  if (old?.version === 2) {
    profile.regions = { ...DEFAULT_REGIONS, ...old.regions };
    return { profile, saved: false, legacyFile: oldFile };
  }
  return { profile, saved: false, legacyFile: null };
}

function newProfile(
  id: string,
  exePath: string | null,
  title: string,
): GameProfile {
  return {
    version: VERSION,
    id,
    exePath,
    title,
    clickMethod: 'message',
    textMode: 'text',
    textStyle: DEFAULT_TEXT_STYLE,
    regions: DEFAULT_REGIONS,
    window: null,
    lastPlayed: new Date().toISOString(),
  };
}

// Writes the profile's file, then removes the pre-profile file it was
// upgraded from, if there was one.
export async function saveProfile(
  profile: GameProfile,
  legacyFile: string | null = null,
) {
  await fs.mkdir(folder(), { recursive: true });
  await fs.writeFile(fileFor(profile.id), JSON.stringify(profile, null, 2));
  if (legacyFile) {
    await fs.rm(legacyFile, { force: true });
  }
}

// Where a profile's file is, e.g. for showing it in Explorer.
export const profileFile = (id: string) => fileFor(id);

export async function deleteProfile(id: string) {
  await fs.rm(fileFor(id), { force: true });
}

// Every saved profile, most recently played first.
export async function listProfiles(): Promise<GameProfile[]> {
  let files: string[];
  try {
    files = await fs.readdir(folder());
  } catch {
    return [];
  }
  const profiles: GameProfile[] = [];
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const profile = await readJson(path.join(folder(), file));
    if (profile?.version === VERSION) {
      profiles.push(profile);
    }
  }
  return profiles.sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
}
