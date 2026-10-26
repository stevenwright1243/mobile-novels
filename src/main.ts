import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  type Rectangle,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// The game window the user picked, so the portrait window can capture it too.
let selectedSourceId: string | null = null;
let portraitWindow: BrowserWindow | null = null;

// The regions of the game window the portrait view shows. These defaults are
// used until you set them (the text zone in the picker now; per-game saving
// comes in milestone 2).
const regions: Regions = {
  background: { x: 0, y: 0, w: 1, h: 0.7 },
  text: { x: 0, y: 0.7, w: 1, h: 0.3 },
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

  // The main window reports which game window was picked; pass it on to the
  // portrait window. `handle` + `invoke` is a request/response pair, while
  // `webContents.send` is a one-way message from main to a page.
  ipcMain.handle('select-source', (_event, sourceId: string) => {
    selectedSourceId = sourceId;
    portraitWindow?.webContents.send('source-selected', sourceId);
  });

  // Lets a portrait window that (re)loads later catch up on the current pick.
  ipcMain.handle('get-selected-source', () => selectedSourceId);

  // Same pattern for regions: the picker changes one, main keeps the
  // current set and forwards it to the portrait window.
  ipcMain.handle('get-regions', () => regions);
  ipcMain.handle('set-region', (_event, name: RegionName, region: Region) => {
    regions[name] = region;
    portraitWindow?.webContents.send('regions-changed', regions);
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
