import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  type Rectangle,
  type WebContents,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { DEFAULT_REGIONS, loadRegions, saveRegions } from './game-config';
import { getClientArea, hwndFromSourceId } from './win32';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// The game window the user picked. Its ID lets the portrait window capture it
// too; its title identifies the game for saving settings.
let selectedSource: GameWindow | null = null;
let portraitWindow: BrowserWindow | null = null;

// The regions of the game window the portrait view shows, loaded per game.
let regions: Regions = DEFAULT_REGIONS;

// Tells every window about the current regions, except `skip`: the window
// that made the change, which already has them.
const sendRegions = (skip?: WebContents) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents !== skip) {
      window.webContents.send('regions-changed', regions);
    }
  }
};

// A drag sends many updates, so wait until they've stopped for half a second,
// then write the file once.
let saveTimer: NodeJS.Timeout | undefined;
const scheduleSave = (title: string, regionsToSave: Regions) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveRegions(title, regionsToSave).catch((error) =>
      console.error('Saving regions failed:', error),
    );
  }, 500);
};

// Loads one of the renderer's HTML pages: from the Vite dev server in
// development, or from the built files when packaged.
const loadPage = (window: BrowserWindow, page: string) => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(new URL(page, MAIN_WINDOW_VITE_DEV_SERVER_URL).href);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/${page}`),
    );
  }
};

// `bounds` is the window's position and size ({ x, y, width, height }).
const createMainWindow = (bounds: Rectangle) => {
  const mainWindow = new BrowserWindow({
    ...bounds,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  loadPage(mainWindow, 'index.html');
};

// The portrait view that gets streamed to the phone.
const createPortraitWindow = (bounds: Rectangle) => {
  portraitWindow = new BrowserWindow({
    ...bounds,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // This window is what gets streamed, so keep it drawing at full speed
      // even when it's covered or not focused.
      backgroundThrottling: false,
    },
  });
  portraitWindow.on('closed', () => {
    portraitWindow = null;
  });
  loadPage(portraitWindow, 'portrait.html');
};

// For now, open the two windows docked side by side and centered on the main
// screen: the picker on the left, the portrait view on the right at a
// phone-like 9:16. Sizes are capped so they fit smaller screens.
const createWindows = () => {
  const area = screen.getPrimaryDisplay().workArea;
  const height = Math.round(Math.min(900, area.height * 0.85));
  const portraitWidth = Math.round((height * 9) / 16);
  const mainWidth = Math.round(
    Math.min(1000, area.width * 0.9 - portraitWidth),
  );

  const x = area.x + Math.round((area.width - mainWidth - portraitWidth) / 2);
  const y = area.y + Math.round((area.height - height) / 2);

  createMainWindow({ x, y, width: mainWidth, height });
  createPortraitWindow({ x: x + mainWidth, y, width: portraitWidth, height });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // The renderer can't use desktopCapturer, so it asks for the window list
  // here over IPC (see preload.ts for the other end).
  ipcMain.handle('list-windows', async (): Promise<WindowSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }));
  });

  // The main window reports which game window was picked: load that game's
  // saved regions and pass both on. `handle` + `invoke` is a request/response
  // pair, while `webContents.send` is a one-way message from main to a page.
  ipcMain.handle('select-source', async (_event, source: GameWindow) => {
    selectedSource = source;
    regions = await loadRegions(source.name);
    portraitWindow?.webContents.send('source-selected', source.id);
    sendRegions();
  });

  // Lets a portrait window that (re)loads later catch up on the current pick.
  ipcMain.handle('get-selected-source', () => selectedSource?.id ?? null);

  // Where the game's content is inside the capture (without the title bar).
  ipcMain.handle('get-client-area', () =>
    selectedSource ? getClientArea(hwndFromSourceId(selectedSource.id)) : null,
  );

  // The picker changes one region; main keeps the current set, forwards it
  // to the other windows, and saves it for this game.
  ipcMain.handle('get-regions', () => regions);
  ipcMain.handle('set-region', (event, name: RegionName, region: Region) => {
    // A new object rather than changing the old one, so a save that's still
    // waiting keeps the regions it was given.
    regions = { ...regions, [name]: region };
    sendRegions(event.sender);
    if (selectedSource) {
      scheduleSave(selectedSource.name, regions);
    }
  });

  createWindows();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
