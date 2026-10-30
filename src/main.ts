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
import { THEME_STYLES } from './look-options';
import { readText } from './ocr';
import { saveOcrTest, showOcrTests } from './ocr-tests';
import { followPhoneDisplay } from './phone-display';
import { loadSettings, saveSettings, type Settings } from './settings';
import {
  DEFAULT_BACKGROUND_Y,
  DEFAULT_REGIONS,
  DEFAULT_TEXT_STYLE,
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
  blockEdgeSwipesWhenFullScreen,
  windowExists,
} from './win32';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Debug mode, switched on by starting with `npm run start:debug`, which
// passes this flag to the app: OCR reads are logged in the terminal, and the
// picker shows its debug tools (see `is-debug`).
const DEBUG = process.argv.includes('--vn-debug');

// The game window the user picked. Its ID lets the portrait window capture it
// too.
let selectedSource: GameWindow | null = null;
let portraitWindow: BrowserWindow | null = null;

// The size of the portrait's background zone (see `setBackgroundZoneSize`).
let backgroundZoneSize: Size | null = null;

// The game's current line of text, as read by the portrait's text reader.
let textLine = '';
// Who's speaking ('' for narration): the name shown, which only changes
// along with the text (see `set-speaker`), and the name box's latest read.
let speaker = '';
let nameRead = '';

// The history log: the last lines read, oldest first. Cleared when another
// game is picked.
const HISTORY_LENGTH = 30;
let textHistory: HistoryEntry[] = [];
// When the line last changed (from `performance.now()`).
let lineChangedAt = 0;
// The name box and the text box are read separately, so a new speaker can be
// confirmed a moment after their line. A speaker arriving this soon after a
// line (in milliseconds) is taken to be that line's.
const SPEAKER_CATCH_UP = 2000;

// Shows a new speaker: tells the windows, and if the line was just read, it's
// that line's speaker, so its history entry is corrected too.
function changeSpeaker(name: string) {
  speaker = name;
  broadcast('speaker-changed', speaker);
  const last = textHistory.at(-1);
  if (
    last?.line === textLine &&
    performance.now() - lineChangedAt < SPEAKER_CATCH_UP
  ) {
    textHistory = [...textHistory.slice(0, -1), { ...last, speaker }];
  }
}

// The phone's display while the phone is streaming (the portrait is full
// screen on it), or null. See phone-display.ts.
let phoneDisplay: PhoneDisplay | null = null;
// Moves the portrait between the phone's display and the PC. Set once the
// portrait window exists.
let setPortraitOnPhone: ((onPhone: boolean) => void) | null = null;

// App-wide settings (settings.ts), loaded before the windows open.
let settings: Settings;

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
    textStyle: current.textStyle,
    backgroundY: current.backgroundY,
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

// Whether there's anything to save, for the Save buttons (the picker's and
// the portrait's Menus sheet).
const saveState = (): SaveState => ({
  hasGame: profile !== null,
  edited: hasEdits(),
  saved: profileSaved,
});
const sendSaveState = () => broadcast('save-state-changed', saveState());

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
  return mainWindow;
};

// The portrait view that gets streamed to the phone. Coming back from the
// phone, it matches the picker's height.
const createPortraitWindow = (bounds: Rectangle, picker: BrowserWindow) => {
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
  const portrait = portraitWindow;
  // No File / Edit / View menu bar: this window is what the phone sees.
  portrait.removeMenu();
  // On Windows, `focusable: false` also hides the window from the taskbar
  // and Alt+Tab, so it can get lost behind other windows. Put it back in
  // both. The native handle is the window's HWND, stored as 8 bytes.
  const keepInTaskbar = () => {
    showInTaskbar(Number(portrait.getNativeWindowHandle().readBigUInt64LE()));
    portrait.setSkipTaskbar(false);
  };
  keepInTaskbar();
  // On the phone, swiping up to leave Artemis also reaches the PC as a touch
  // swipe up from the screen's bottom edge, which would show the taskbar.
  blockEdgeSwipesWhenFullScreen(
    Number(portrait.getNativeWindowHandle().readBigUInt64LE()),
  );

  // A non-focusable window's title bar doesn't work on Windows: Chromium
  // answers Windows' "should this click activate the window?" question
  // (WM_MOUSEACTIVATE) with "no, and throw the click away", so the title bar
  // can't be clicked to the front or dragged. That question says where the
  // click landed, and it arrives before Chromium answers it, so: for a click
  // on the title bar or borders (anything but the page, HTCLIENT), make the
  // window focusable first. Chromium then says "yes", and the click works
  // like on any window. Clicks on the page are left alone.
  const WM_MOUSEACTIVATE = 0x0021;
  const HTCLIENT = 1;
  portrait.hookWindowMessage(WM_MOUSEACTIVATE, (_wParam, lParam) => {
    // The low 16 bits of lParam say where the click landed.
    const hit = lParam.readUInt16LE(0);
    if (hit !== HTCLIENT && !portrait.isFocusable()) {
      portrait.setFocusable(true);
      portrait.focus();
    }
  });
  // Once focus moves elsewhere (the game, the picker), go back to
  // non-focusable, so taps on the page never take focus from the game.
  // Changing it resets the taskbar settings, so restore those too.
  portrait.on('blur', () => {
    if (portrait.isFocusable()) {
      portrait.setFocusable(false);
      keepInTaskbar();
    }
  });

  portrait.on('closed', () => {
    portraitWindow = null;
  });
  loadPage(portrait, 'portrait.html');

  // While the phone is streaming, the portrait fills the phone's display.
  const placement = followPhoneDisplay(
    portrait,
    (phone) => {
      phoneDisplay = phone;
      broadcast('phone-display-changed', phoneDisplay);
      if (DEBUG) {
        const displays = screen.getAllDisplays().map((display) => ({
          label: display.label,
          bounds: display.bounds,
          scale: display.scaleFactor,
        }));
        console.log('Phone display:', phoneDisplay, 'All displays:', displays);
      }
    },
    () => (picker.isDestroyed() ? null : picker.getNormalBounds()),
    settings.portraitOnPhone,
  );
  setPortraitOnPhone = placement.setOnPhone;
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

  const picker = createMainWindow({ x, y, width: mainWidth, height });
  createPortraitWindow(
    { x: x + mainWidth, y, width: portraitWidth, height },
    picker,
  );
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
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
    broadcast('text-style-changed', profile.textStyle);
    broadcast('background-y-changed', profile.backgroundY);
    // The last game's line no longer applies.
    textLine = '';
    speaker = '';
    nameRead = '';
    textHistory = [];
    broadcast('text-line-changed', textLine);
    broadcast('speaker-changed', speaker);
    sendSaveState();
    return true;
  });

  // The picker's "Save profile" button (or Ctrl+S).
  ipcMain.handle('save-profile', saveCurrentProfile);
  ipcMain.handle('get-save-state', saveState);

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
  //
  // Also notice when the game is closed: forget its window (its profile, and
  // any unsaved edits, stay until another game is picked) and tell the pages,
  // with `null` for "no game window".
  setInterval(() => {
    if (selectedSource) {
      const hwnd = hwndFromSourceId(selectedSource.id);
      if (!windowExists(hwnd)) {
        selectedSource = null;
        textLine = '';
        speaker = '';
        nameRead = '';
        broadcast('source-selected', null);
        broadcast('text-line-changed', textLine);
        broadcast('speaker-changed', speaker);
      } else if (isMinimized(hwnd)) {
        restoreBehind(hwnd);
      }
    }
  }, 1000);

  // Tell the picker when windows open or close, so its lists stay current.
  // Asking for the windows without thumbnails is cheap, so check every 2
  // seconds and compare their IDs; the picker then fetches the full list
  // (with thumbnails) only when something changed. Title changes alone are
  // ignored: some windows (browsers, music players) retitle themselves often.
  let windowIds = '';
  setInterval(async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
    });
    const ids = sources
      .map((source) => source.id)
      .sort()
      .join(' ');
    if (windowIds && ids !== windowIds) {
      broadcast('windows-changed');
    }
    windowIds = ids;
  }, 2000);

  // How taps reach the game (see win32.ts), part of the game's profile.
  ipcMain.handle('get-click-method', () => profile?.clickMethod ?? 'message');
  ipcMain.handle('set-click-method', (_event, method: ClickMethod) => {
    if (profile) {
      profile = { ...profile, clickMethod: method };
      sendSaveState();
    }
  });

  // How the portrait shows the game's text, part of the game's profile.
  // How the text is styled (its size, for now), part of the game's profile.
  ipcMain.handle(
    'get-text-style',
    () => profile?.textStyle ?? DEFAULT_TEXT_STYLE,
  );
  ipcMain.handle('set-text-style', (event, style: TextStyle) => {
    if (profile) {
      profile = { ...profile, textStyle: style };
      broadcast('text-style-changed', style, event.sender);
      sendSaveState();
    }
  });

  // Where the background sits in the portrait, top to bottom, part of the
  // game's profile. The picker changes it; the portrait redraws.
  ipcMain.handle(
    'get-background-y',
    () => profile?.backgroundY ?? DEFAULT_BACKGROUND_Y,
  );
  ipcMain.handle('set-background-y', (event, y: number) => {
    if (profile) {
      profile = { ...profile, backgroundY: y };
      broadcast('background-y-changed', y, event.sender);
      sendSaveState();
    }
  });

  // The portrait's background zone size, passed on to the picker.
  ipcMain.handle('get-background-zone-size', () => backgroundZoneSize);
  ipcMain.handle('set-background-zone-size', (event, size: Size) => {
    backgroundZoneSize = size;
    broadcast('background-zone-size-changed', size, event.sender);
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
  // Whether the app is in debug mode (see `DEBUG`).
  ipcMain.handle('is-debug', () => DEBUG);

  // With `npm run start:debug`, each read is logged to the terminal, to help
  // tune what counts as garbage (see text-reader.ts).
  // OCR test cases, saved from the picker's debug tools (see ocr-tests.ts).
  ipcMain.handle(
    'save-ocr-test',
    (_event, png: Uint8Array, test: Omit<OcrTest, 'game'>) =>
      saveOcrTest(png, { game: profile?.title ?? 'game', ...test }),
  );
  ipcMain.handle('show-ocr-tests', showOcrTests);

  ipcMain.handle('read-text', async (_event, png: Uint8Array) => {
    const result = await readText(png);
    if (DEBUG) {
      const dropped =
        result.dropped.length > 0
          ? ` (dropped: ${result.dropped.join(' ')})`
          : '';
      console.log(
        `OCR ${result.confidence}% ${result.ms}ms:`,
        result.text + dropped,
      );
    }
    return result;
  });

  // The current line: the portrait's text reader sets it, and every window
  // (the portrait included) hears about the change.
  ipcMain.handle('get-text-line', () => textLine);
  ipcMain.handle('set-text-line', (_event, line: string) => {
    if (line !== textLine) {
      lineChangedAt = performance.now();
    }
    textLine = line;
    broadcast('text-line-changed', textLine);
    // Add it to the history log, unless it's empty (no text box showing) or
    // the same line again (the box was hidden and shown again). `.at(-1)` is
    // the last item; `.slice(-N)` keeps the last N.
    if (line && line !== textHistory.at(-1)?.line) {
      textHistory = [...textHistory, { speaker, line }].slice(-HISTORY_LENGTH);
    }
    // The text moved on, so the name box's latest read is now shown.
    if (nameRead !== speaker) {
      changeSpeaker(nameRead);
    }
  });
  ipcMain.handle('get-text-history', () => textHistory);

  // The speaker's name, read from the name box the same way. Every change,
  // a name appearing, going or switching, shows along with the text
  // (`set-text-line` shows the latest read then), so the name always
  // belongs to the line on screen. A name read just after the line changed
  // belongs with that line, so it shows at once.
  ipcMain.handle('get-speaker', () => speaker);
  ipcMain.handle('set-speaker', (_event, name: string) => {
    nameRead = name;
    const justChanged = performance.now() - lineChangedAt < SPEAKER_CATCH_UP;
    if (name !== speaker && justChanged) {
      changeSpeaker(name);
    }
  });

  ipcMain.handle('get-phone-display', () => phoneDisplay);
  // The PC / Phone switch, saved straight away.
  ipcMain.handle('get-portrait-on-phone', () => settings.portraitOnPhone);
  ipcMain.handle('set-portrait-on-phone', async (_event, onPhone: boolean) => {
    settings = { ...settings, portraitOnPhone: onPhone };
    setPortraitOnPhone?.(onPhone);
    await saveSettings(settings);
  });
  // The corner buttons' size. It changes many times a second while the
  // slider is dragged, so it's saved once the slider has been still for a
  // moment, instead of on every change.
  let buttonSizeSaveTimer: NodeJS.Timeout | undefined;
  ipcMain.handle('get-button-size', () => settings.buttonSize);
  ipcMain.handle('set-button-size', (event, size: number) => {
    settings = { ...settings, buttonSize: size };
    broadcast('button-size-changed', size, event.sender);
    clearTimeout(buttonSizeSaveTimer);
    buttonSizeSaveTimer = setTimeout(() => saveSettings(settings), 500);
  });
  // The colour scheme, saved straight away. Sent to every window, the
  // picker included, since both are themed.
  ipcMain.handle('get-theme', () => settings.theme);
  ipcMain.handle('set-theme', async (_event, theme: ThemeName) => {
    settings = { ...settings, theme };
    broadcast('theme-changed', theme);
    // A theme with its own border or arrow picks them too.
    const style = THEME_STYLES[theme];
    if (style) {
      settings = {
        ...settings,
        messageStyle: { ...settings.messageStyle, ...style },
      };
      broadcast('message-style-changed', settings.messageStyle);
    }
    await saveSettings(settings);
  });
  // The message window's border and arrow, saved straight away. Sent back
  // to the sender too: the portrait can change them from its Menus sheet.
  ipcMain.handle('get-message-style', () => settings.messageStyle);
  ipcMain.handle('set-message-style', async (_event, style: MessageStyle) => {
    settings = { ...settings, messageStyle: style };
    broadcast('message-style-changed', style);
    await saveSettings(settings);
  });

  settings = await loadSettings();
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
