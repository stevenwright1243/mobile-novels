import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell,
  type Rectangle,
  type WebContents,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { readText } from './ocr';
import {
  DEFAULT_REGIONS,
  deleteProfile,
  listProfiles,
  loadProfile,
  profileFile,
  profileId,
  saveProfile,
} from './profiles';
import {
  clientSize,
  exePathOf,
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

// Debug logging, switched on by starting with `npm run start:debug`, which
// passes this flag to the app.
const DEBUG_OCR = process.argv.includes('--debug-ocr');

// The game window the user picked. Its ID lets the portrait window capture it
// too.
let selectedSource: GameWindow | null = null;
let portraitWindow: BrowserWindow | null = null;

// The game's current line of text, as read by the portrait's text reader.
let textLine = '';

// The picked game's profile: its regions, click method and so on (see
// profiles.ts). Null until a game is picked. Changes apply live, but are only
// written to its file when the user clicks "Save profile".
let profile: GameProfile | null = null;
// Whether this game has a profile file yet.
let profileSaved = false;
// A pre-profile file to delete once this profile is first saved.
let legacyFile: string | null = null;
// The editable parts of the profile as last saved or loaded, to tell whether
// there are unsaved edits.
let savedSnapshot = '';

const snapshot = (current: GameProfile) =>
  JSON.stringify({
    regions: current.regions,
    clickMethod: current.clickMethod,
    textMode: current.textMode,
  });

const hasEdits = () => profile !== null && snapshot(profile) !== savedSnapshot;

// Sends a message to every window, except `skip`: the window that made the
// change, which already knows.
const broadcast = (channel: string, value?: unknown, skip?: WebContents) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents !== skip) {
      window.webContents.send(channel, value);
    }
  }
};

// Tells the picker whether there's anything to save, for its Save button.
const sendSaveState = () => {
  const state: SaveState = {
    hasGame: profile !== null,
    edited: hasEdits(),
    saved: profileSaved,
  };
  broadcast('save-state-changed', state);
};

const saveCurrentProfile = async () => {
  if (!profile) {
    return;
  }
  await saveProfile(profile, legacyFile);
  profileSaved = true;
  legacyFile = null;
  savedSnapshot = snapshot(profile);
  sendSaveState();
  broadcast('profiles-changed');
};

// If there are unsaved edits, asks whether to save them before they'd be
// lost. Returns false if the user picks Cancel.
const resolveUnsavedEdits = async (parent: BrowserWindow | null) => {
  if (!profile || !hasEdits()) {
    return true;
  }
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Save changes to ${profile.title}?`,
    detail: "This game's region and click settings have unsaved changes.",
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (response === 2) {
    return false;
  }
  if (response === 0) {
    await saveCurrentProfile();
  } else {
    // "Don't save": treat the edits as dealt with, so we don't ask again.
    savedSnapshot = snapshot(profile);
  }
  return true;
};

// Asks before deleting a game's profile file, since it can't be undone.
const confirmDeleteProfile = async (
  parent: BrowserWindow | null,
  card: Pick<ProfileSummary, 'id' | 'title'>,
) => {
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Delete the profile for ${card.title}?`,
    detail:
      "Its saved regions and click settings will be removed. This can't be undone.",
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) {
    return;
  }
  await deleteProfile(card.id);
  // If it's the game being edited, its settings stay as they are on screen,
  // but now count as never saved (so the Save button offers to save again).
  if (profile?.id === card.id) {
    profileSaved = false;
    legacyFile = null;
    sendSaveState();
  }
  broadcast('profiles-changed');
};

// Set when the whole app is quitting (e.g. File → Quit), rather than just the
// picker window closing.
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

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

  // Closing the picker with unsaved edits asks first. `preventDefault()`
  // stops the close; the window is closed for real (`destroy()`, which skips
  // this check) once the user has chosen.
  mainWindow.on('close', async (event) => {
    if (!hasEdits()) {
      return;
    }
    event.preventDefault();
    if (await resolveUnsavedEdits(mainWindow)) {
      if (quitting) {
        app.quit();
      } else {
        mainWindow.destroy();
      }
    } else {
      quitting = false;
    }
  });
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
  // No File / Edit / View menu bar: this window is what the phone sees.
  portraitWindow.removeMenu();
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
  // profile and pass it on. `handle` + `invoke` is a request/response pair,
  // while `webContents.send` is a one-way message from main to a page.
  // Returns false if the user cancelled (when asked about unsaved edits).
  ipcMain.handle('select-source', async (event, source: GameWindow) => {
    if (source.id === selectedSource?.id) {
      // Already picked: keep the profile (and any unsaved edits) as is.
      return true;
    }
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (!(await resolveUnsavedEdits(parent))) {
      return false;
    }
    selectedSource = source;

    const hwnd = hwndFromSourceId(source.id);
    const exePath = exePathOf(hwnd);
    const loaded = await loadProfile(
      profileId(exePath, source.name),
      exePath,
      source.name,
    );
    // Refresh what may have changed since the game was last played. These
    // details are written along with everything else when you save.
    profile = {
      ...loaded.profile,
      exePath: exePath ?? loaded.profile.exePath,
      title: source.name,
      window: clientSize(hwnd) ?? loaded.profile.window,
      lastPlayed: new Date().toISOString(),
    };
    profileSaved = loaded.saved;
    legacyFile = loaded.legacyFile;
    savedSnapshot = snapshot(profile);

    portraitWindow?.webContents.send('source-selected', source.id);
    broadcast('regions-changed', profile.regions);
    broadcast('click-method-changed', profile.clickMethod);
    broadcast('text-mode-changed', profile.textMode);
    // The last game's line no longer applies.
    textLine = '';
    broadcast('text-line-changed', textLine);
    sendSaveState();
    return true;
  });

  // The picker's "Save profile" button (or Ctrl+S).
  ipcMain.handle('save-profile', saveCurrentProfile);

  // Right-clicking a game card shows a native Windows menu. Resolves to
  // 'pick' if the user chose to pick the game (the picker does that part),
  // otherwise null; the other actions are handled here.
  ipcMain.handle(
    'show-profile-menu',
    (event, card: Pick<ProfileSummary, 'id' | 'title' | 'isOpen'>) => {
      const parent = BrowserWindow.fromWebContents(event.sender);
      // A Promise we resolve ourselves: with the choice when an item is
      // clicked, or with null when the menu closes. Only the first counts.
      return new Promise<'pick' | null>((resolve) => {
        const menu = Menu.buildFromTemplate([
          {
            label: 'Pick this game',
            enabled: card.isOpen,
            click: () => resolve('pick'),
          },
          {
            label: 'Show profile file in folder',
            click: () => shell.showItemInFolder(profileFile(card.id)),
          },
          { type: 'separator' },
          {
            label: 'Delete profile…',
            click: () => confirmDeleteProfile(parent, card),
          },
        ]);
        menu.popup({
          window: parent ?? undefined,
          callback: () => resolve(null),
        });
      });
    },
  );

  // The saved profiles for the picker's "Your games" list, each marked with
  // whether that game is running now (matched by .exe against open windows).
  ipcMain.handle('list-profiles', async (): Promise<ProfileSummary[]> => {
    const [profiles, sources] = await Promise.all([
      listProfiles(),
      desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
      }),
    ]);
    // The first open window for each profile ID. A `Map` is a lookup table:
    // `set(key, value)` stores, `get(key)` finds.
    const openWindows = new Map<string, GameWindow>();
    for (const source of sources) {
      const exePath = exePathOf(hwndFromSourceId(source.id));
      const id = profileId(exePath, source.name);
      if (!openWindows.has(id)) {
        openWindows.set(id, { id: source.id, name: source.name });
      }
    }
    return profiles.map((saved) => {
      const open = openWindows.get(saved.id);
      return {
        id: saved.id,
        exePath: saved.exePath,
        // A running game shows its current title, which may have changed.
        title: open?.name ?? saved.title,
        clickMethod: saved.clickMethod,
        window: saved.window,
        lastPlayed: saved.lastPlayed,
        isOpen: open !== undefined,
        sourceId: open?.id,
      };
    });
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
      return profile?.clickMethod === 'mouse'
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

  // How taps reach the game (see win32.ts), part of the game's profile.
  ipcMain.handle('get-click-method', () => profile?.clickMethod ?? 'message');
  ipcMain.handle('set-click-method', (_event, method: ClickMethod) => {
    if (profile) {
      profile = { ...profile, clickMethod: method };
      sendSaveState();
    }
  });

  // How the portrait shows the game's text, part of the game's profile.
  ipcMain.handle('get-text-mode', () => profile?.textMode ?? 'text');
  ipcMain.handle('set-text-mode', (event, mode: TextMode) => {
    if (profile) {
      profile = { ...profile, textMode: mode };
      broadcast('text-mode-changed', mode, event.sender);
      sendSaveState();
    }
  });

  // The picker changes one region; main keeps the current set, forwards it
  // to the other windows. It's saved with the profile when you click Save.
  ipcMain.handle('get-regions', () => profile?.regions ?? DEFAULT_REGIONS);
  ipcMain.handle('set-region', (event, name: RegionName, region: Region) => {
    if (!profile) {
      return;
    }
    profile = { ...profile, regions: { ...profile.regions, [name]: region } };
    broadcast('regions-changed', profile.regions, event.sender);
    sendSaveState();
  });

  // OCR: the picker sends a PNG of the text box, main reads it.
  // With `npm run start:debug`, each read is logged to the terminal, to help
  // tune what counts as garbage (see text-reader.ts).
  ipcMain.handle('read-text', async (_event, png: Uint8Array) => {
    const result = await readText(png);
    if (DEBUG_OCR) {
      console.log(`OCR ${result.confidence}% ${result.ms}ms:`, result.text);
    }
    return result;
  });

  // The current line: the portrait's text reader sets it, and every window
  // (the portrait included) hears about the change.
  ipcMain.handle('get-text-line', () => textLine);
  ipcMain.handle('set-text-line', (_event, line: string) => {
    textLine = line;
    broadcast('text-line-changed', textLine);
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
