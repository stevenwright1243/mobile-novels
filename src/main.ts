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
import {
  getClientArea,
  hwndFromSourceId,
  isMinimized,
  postClick,
  restoreBehind,
  sendClick,
  sendToBack,
  showInTaskbar,
} from './win32';

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

// How taps in the portrait are delivered to the game (see win32.ts). Chosen
// in the picker while we find out which one each game accepts.
let clickMethod: ClickMethod = 'message';

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
    // Tapping the portrait shouldn't take focus away from the game: some
    // games pause or ignore input when they aren't the active window. (This
    // also means keyboard shortcuts like Ctrl+Shift+I don't reach it.)
    focusable: false,
  });
  // On Windows, `focusable: false` also hides the window from the taskbar
  // and Alt+Tab, so it can get lost behind other windows. Put it back in
  // both. The native handle is the window's HWND, stored as 8 bytes.
  showInTaskbar(
    Number(portraitWindow.getNativeWindowHandle().readBigUInt64LE()),
  );
  portraitWindow.setSkipTaskbar(false);
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
    // Thumbnails show at roughly 16rem wide; size them in real pixels for the
    // screen's scaling (e.g. 1.5 at 150%) so they stay sharp.
    const scale = screen.getPrimaryDisplay().scaleFactor;
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: {
        width: Math.round(256 * scale),
        height: Math.round(144 * scale),
      },
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

  // A tap in the portrait, as a point in the game's client area (fractions).
  ipcMain.handle(
    'click-game',
    async (_event, point: { x: number; y: number }) => {
      if (!selectedSource) {
        return;
      }
      const hwnd = hwndFromSourceId(selectedSource.id);
      // A minimized game can't be clicked: restore it first, and give it a
      // moment to start running again so the tap isn't lost.
      if (isMinimized(hwnd)) {
        restoreBehind(hwnd);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return clickMethod === 'mouse'
        ? sendClick(hwnd, point)
        : postClick(hwnd, point);
    },
  );

  // The way to get the game out of sight without minimizing it.
  ipcMain.handle('send-game-to-back', () => {
    if (selectedSource) {
      sendToBack(hwndFromSourceId(selectedSource.id));
    }
  });

  // Minimized games stop drawing and running, so check once a second and
  // quietly restore the selected game behind other windows if needed.
  setInterval(() => {
    if (selectedSource) {
      const hwnd = hwndFromSourceId(selectedSource.id);
      if (isMinimized(hwnd)) {
        restoreBehind(hwnd);
      }
    }
  }, 1000);

  ipcMain.handle('get-click-method', () => clickMethod);
  ipcMain.handle('set-click-method', (_event, method: ClickMethod) => {
    clickMethod = method;
  });

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
