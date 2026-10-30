// Main process only: finding a game's Steam app ID, so it can be started
// through Steam. A Steam game started from its .exe asks Steam to start it
// and quits, and Steam's copy can then fail with "already running" while the
// first is still closing (Aokana did).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// The Steam app ID of the game at `exePath`, or null if it isn't in a Steam
// library. Games live in `<library>\steamapps\common\<installdir>\…`, and
// each has an `appmanifest_<id>.acf` in `steamapps` naming its installdir.
export async function steamAppIdOf(exePath: string): Promise<string | null> {
  const parts = path.resolve(exePath).split(path.sep);
  const common = parts.findIndex(
    (part, i) =>
      part.toLowerCase() === 'common' &&
      parts[i - 1]?.toLowerCase() === 'steamapps',
  );
  const installDir = parts[common + 1];
  if (common < 0 || !installDir) {
    return null;
  }
  const steamapps = parts.slice(0, common).join(path.sep);
  try {
    for (const file of await readdir(steamapps)) {
      const id = /^appmanifest_(\d+)\.acf$/i.exec(file)?.[1];
      if (!id) {
        continue;
      }
      const manifest = await readFile(path.join(steamapps, file), 'utf8');
      const dir = /"installdir"\s+"([^"]*)"/i.exec(manifest)?.[1];
      if (dir?.toLowerCase() === installDir.toLowerCase()) {
        return id;
      }
    }
  } catch {
    // An unreadable library: start the .exe instead.
  }
  return null;
}
