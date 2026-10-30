/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

// A capturable window, as sent from main to the renderer.
interface WindowSource {
  id: string;
  name: string;
  // PNG data URL, usable directly as an <img> src.
  thumbnail: string;
}

// The picked game window: just the ID and title, without the thumbnail.
// `Pick<T, K>` makes a type with only the listed properties of T.
type GameWindow = Pick<WindowSource, 'id' | 'name'>;

// A rectangle as fractions (0 to 1) of what it's inside. Saved regions are
// fractions of the game's content (its client area, without the title bar).
interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The named regions the portrait view draws: the background, the text box,
// the name box (the speaker's name), and the page: where the text goes in
// games that fill the screen with it (read in full-screen text mode).
// `Record<K, V>` is an object with exactly the keys K, each holding a V.
type RegionName = 'background' | 'text' | 'name' | 'page';
type Regions = Record<RegionName, Region>;

// A spot in the game, as fractions (0 to 1) of its client area, like a
// region's corner.
interface GamePoint {
  x: number;
  y: number;
}

// The spots the Menus sheet's q.Save and q.Load buttons tap for the player:
// the game's own quick save and quick load buttons. Each is placed in the
// picker, and is null until then.
type PointName = 'quickSave' | 'quickLoad';
type Points = Record<PointName, GamePoint | null>;

// How a tap is delivered to the game: 'message' posts click messages to its
// window; 'mouse' simulates real mouse input (see win32.ts).
type ClickMethod = 'message' | 'mouse';

// How reading the game's lines from its memory is going (memory-text.ts):
// following its line buffer, matching each line OCR reads with its copies
// (engines that never rewrite a buffer), still looking, gave up, or not in
// use.
type MemoryTextStatus =
  | 'found'
  | 'matching'
  | 'searching'
  | 'not-found'
  | 'off';

// How the text is styled in the portrait's message window. `size` scales
// the text (1 = normal, 1.5 = half as big again); the window grows with it.
// `nameSize` scales
// the speaker's name tag the same way (1 = normal, which is a little smaller
// than the text); it's relative to `size`, so it follows the text.
// `position` is where the message window sits: 'bottom' of the screen,
// growing upward with the text, or 'top', hanging just under the picture,
// growing downward. `padding` adds space on the side it grows from (below
// it at the bottom, above it under the picture), 0 to 1, where 1 is a fifth
// of the screen's height; 0 keeps the usual gaps.
interface TextStyle {
  size: number;
  nameSize: number;
  position: TextPosition;
  padding: number;
}
type TextPosition = 'bottom' | 'top';

// The colour scheme of both windows (the picker's Style settings, an app
// setting). Each is a block of variables in theme.css.
type ThemeName =
  | 'aokana'
  | 'kimikano'
  | 'katawa-shoujo'
  | 'mahoyo'
  | 'hoshimemo'
  | 'steins-gate'
  | 'ddlc'
  | 'miside'
  | 'miyuki';

// The look of the portrait's message window (the picker's Style settings,
// an app setting): the effect around its edge, and the "tap to continue"
// arrow in its corner.
type MessageBorder = 'halo' | 'rim' | 'ribbon' | 'none';
type NextArrow =
  | 'chevron'
  | 'dots'
  | 'triangle'
  | 'hearts'
  | 'ember'
  | 'drop'
  | 'knife'
  | 'none';
interface MessageStyle {
  border: MessageBorder;
  arrow: NextArrow;
}

// How a region sits in its portrait zone (zone-view.ts). `fill` zooms from 0
// (the whole region fits, with space around it) to 1 (it fills the zone,
// with its edges trimmed). `x` and `y` line it up: 0 = left / top, 0.5 =
// middle, 1 = right / bottom. When it's trimmed, that chooses which part
// shows; when there's space around it, where in that space it sits.
// `width`, when set, zooms by how much of the region's width shows instead
// (1 = all of it, 0.75 = three quarters; the portrait's background, the
// game's `backgroundWidth`).
interface ZoneView {
  fill?: number;
  width?: number;
  x: number;
  y: number;
}

// One line in the history log, with who said it ('' for narration).
interface HistoryEntry {
  speaker: string;
  line: string;
}

// A size in pixels.
interface Size {
  width: number;
  height: number;
}

// What OCR read from an image (ocr.ts).
interface OcrResult {
  text: string;
  // Tesseract's own guess at how right it is, 0 to 100.
  confidence: number;
  // How long the reading took, in milliseconds.
  ms: number;
  // Words left out as junk (the wrong height for the line; see ocr.ts),
  // logged in debug mode.
  dropped: string[];
  // The text split into paragraphs where the gap between lines is bigger
  // than usual, each joined into one line (for full-screen text).
  paragraphs: string[];
}

// An OCR test case (ocr-tests.ts), saved next to a frame of the game. The
// regions are fractions of that frame, which is the game's client area.
interface OcrTest {
  game: string;
  // When it was saved, as an ISO date.
  savedAt: string;
  // null when that box isn't tested.
  text: Region | null;
  name: Region | null;
  // Full-screen text: where the page is, and what it should read, its
  // paragraphs separated by a blank line. Only in tests of full-screen text.
  page?: Region;
  expectedPage?: string;
  // What the reader should read ('' for nothing, e.g. narration's name).
  expectedText: string;
  expectedName: string;
  // What the app was showing when the test was saved, for reference.
  shownText: string;
  shownName: string;
}

// Everything the app remembers about one game, saved as JSON (profiles.ts).
interface GameProfile {
  version: 3;
  // The .exe name, e.g. "totono_steam.exe" (or "title:..." as a fallback).
  id: string;
  exePath: string | null;
  // The window title when last played.
  title: string;
  // A shorter name to show for the game in the Menus sheet's Visual Novels
  // (e.g. "YOU and ME and HER" for "YOU and ME and HER: A Love Story
  // ver1.00"), if set; otherwise the title shows. Set in the picker's Name
  // box.
  name?: string;
  clickMethod: ClickMethod;
  // Whether its lines are read from its memory, exactly, when they match
  // OCR's read (memory-text.ts). On for new games.
  textFromMemory: boolean;
  textStyle: TextStyle;
  // Where the background sits in the portrait, top (0) to bottom (1): the
  // `y` of its `ZoneView` (the zoom and left/right are fixed).
  backgroundY: number;
  // How much of the background's width the portrait shows, 0.5 to 1 (the
  // "Portrait width" sliders).
  backgroundWidth: number;
  regions: Regions;
  points: Points;
  // The game's content size in pixels when last played.
  window: Size | null;
  // When last picked, as an ISO date string.
  lastPlayed: string;
}

// A profile as listed in the picker: `Omit<T, K>` is T without the listed
// properties. `isOpen` and `sourceId` say whether (and where) it's running,
// `openedAt` when it was first seen running this session and `pickedAt`
// when it was last picked (milliseconds). `icon` is its .exe's icon, as a
// `data:` URL (none if it can't be read).
type ProfileSummary = Omit<
  GameProfile,
  | 'version'
  | 'regions'
  | 'points'
  | 'textFromMemory'
  | 'textStyle'
  | 'backgroundY'
  | 'backgroundWidth'
> & {
  isOpen: boolean;
  sourceId?: string;
  openedAt?: number;
  pickedAt?: number;
  icon?: string;
};

// The phone's display, added by Apollo while the phone is streaming (see
// phone-display.ts). Width and height are in real pixels; `scale` is the
// display's Windows scaling (e.g. 3 for 300%). `portraitOnPhone` is false
// while the picker's PC / Phone switch keeps the portrait on the PC.
interface PhoneDisplay {
  label: string;
  width: number;
  height: number;
  scale: number;
  portraitOnPhone: boolean;
}

// For the picker's Save button: whether a game is picked, whether its profile
// has unsaved edits, and whether it has a profile file at all yet.
interface SaveState {
  hasGame: boolean;
  edited: boolean;
  saved: boolean;
}

// The API that preload.ts exposes on `window.vn`.
interface Window {
  vn: {
    listWindows(): Promise<WindowSource[]>;
    // Tells main which game window was picked, so the portrait window follows
    // and that game's profile is loaded. Resolves to false if the user
    // cancelled when asked about unsaved edits.
    selectSource(source: GameWindow): Promise<boolean>;
    getSelectedSource(): Promise<string | null>;
    // The game window to capture, or null when the game was closed.
    onSourceSelected(callback: (sourceId: string | null) => void): void;
    // Windows opened or closed (see main.ts), so lists should refresh.
    onWindowsChanged(callback: () => void): void;
    // Where the game's content is, as fractions of the capture; null if the
    // window can't be measured.
    getClientArea(): Promise<Region | null>;
    getRegions(): Promise<Regions>;
    setRegion(name: RegionName, region: Region): Promise<void>;
    onRegionsChanged(callback: (regions: Regions) => void): void;
    // The quick save and quick load spots, part of the game's profile like
    // its regions.
    getPoints(): Promise<Points>;
    setPoint(name: PointName, point: GamePoint): Promise<void>;
    onPointsChanged(callback: (points: Points) => void): void;
    // Clicks the game at a point given as fractions of its client area.
    clickGame(point: GamePoint): Promise<void>;
    // Has Steam screenshot the game (presses its F12 key in the game).
    screenshotGame(): Promise<void>;
    getClickMethod(): Promise<ClickMethod>;
    setClickMethod(method: ClickMethod): Promise<void>;
    onClickMethodChanged(callback: (method: ClickMethod) => void): void;
    getTextFromMemory(): Promise<boolean>;
    setTextFromMemory(on: boolean): Promise<void>;
    onTextFromMemoryChanged(callback: (on: boolean) => void): void;
    getMemoryTextStatus(): Promise<MemoryTextStatus>;
    onMemoryTextStatusChanged(
      callback: (status: MemoryTextStatus) => void,
    ): void;
    // The picked game's short name ('' for none), part of its profile.
    getGameName(): Promise<string>;
    setGameName(name: string): Promise<void>;
    onGameNameChanged(callback: (name: string) => void): void;
    getTextStyle(): Promise<TextStyle>;
    setTextStyle(style: TextStyle): Promise<void>;
    onTextStyleChanged(callback: (style: TextStyle) => void): void;
    getBackgroundY(): Promise<number>;
    setBackgroundY(y: number): Promise<void>;
    onBackgroundYChanged(callback: (y: number) => void): void;
    // How much of the background's width the portrait shows, part of the
    // game's profile like its height.
    getBackgroundWidth(): Promise<number>;
    setBackgroundWidth(width: number): Promise<void>;
    onBackgroundWidthChanged(callback: (width: number) => void): void;
    // The size of the portrait's background zone, sent by the portrait so
    // the picker can outline the part of the background that's shown.
    getBackgroundZoneSize(): Promise<Size | null>;
    setBackgroundZoneSize(size: Size): Promise<void>;
    onBackgroundZoneSizeChanged(callback: (size: Size) => void): void;
    // Saved game profiles, marked with whether each game is running now.
    listProfiles(): Promise<ProfileSummary[]>;
    onProfilesChanged(callback: () => void): void;
    // The right-click menu for a game card. Resolves to 'pick' if the user
    // chose to pick that game; main handles the other choices itself.
    showProfileMenu(
      card: Pick<ProfileSummary, 'id' | 'title' | 'isOpen'>,
    ): Promise<'pick' | null>;
    // Starts a saved game that isn't running, from its .exe, and picks it
    // once its window opens. Resolves to false if it has no .exe saved.
    launchGame(id: string): Promise<boolean>;
    // Force-closes a running game, without asking it to save.
    closeGame(id: string): Promise<void>;
    // Writes the picked game's profile to its file.
    saveProfile(): Promise<void>;
    getSaveState(): Promise<SaveState>;
    // Undoes the unsaved edits (the game's settings and the button size).
    revertEdits(): Promise<void>;
    onSaveStateChanged(callback: (state: SaveState) => void): void;
    // Puts the game behind all other windows without minimizing it.
    sendGameToBack(): Promise<void>;
    // Brings the game in front of all other windows, focused.
    bringGameToFront(): Promise<void>;
    // Whether the app was started in debug mode (`npm run start:debug`).
    isDebug(): Promise<boolean>;
    // Reads the text in a PNG image with OCR (ocr.ts).
    readText(png: Uint8Array): Promise<OcrResult>;
    // Saves an OCR test case (a frame of the game and what it should read;
    // ocr-tests.ts). `game` is filled in by main. Returns the frame's path.
    saveOcrTest(png: Uint8Array, test: Omit<OcrTest, 'game'>): Promise<string>;
    // Opens the folder of OCR test cases in Explorer.
    showOcrTests(): Promise<void>;
    // The game's current line of text, as read by OCR (text-reader.ts).
    // Main keeps it and passes changes on to every window.
    getTextLine(): Promise<string>;
    setTextLine(line: string): Promise<void>;
    onTextLineChanged(callback: (line: string) => void): void;
    // Who's speaking, read by OCR from the name box (text-reader.ts), or ''
    // when the name box is empty (narration). Kept by main like the line.
    getSpeaker(): Promise<string>;
    setSpeaker(name: string): Promise<void>;
    onSpeakerChanged(callback: (name: string) => void): void;
    // The history log: the last 30 lines read, oldest first, each with its
    // speaker.
    getTextHistory(): Promise<HistoryEntry[]>;
    // The phone's display while one is connected (the portrait is full
    // screen on it), or null.
    getPhoneDisplay(): Promise<PhoneDisplay | null>;
    onPhoneDisplayChanged(callback: (phone: PhoneDisplay | null) => void): void;
    // The PC / Phone switch: whether the portrait goes on the phone's display
    // (true) or stays on the PC (false). Saved as an app setting.
    getPortraitOnPhone(): Promise<boolean>;
    setPortraitOnPhone(onPhone: boolean): Promise<void>;
    // The size of the portrait's corner buttons, as a multiple of normal.
    // Saved as an app setting.
    getButtonSize(): Promise<number>;
    setButtonSize(size: number): Promise<void>;
    onButtonSizeChanged(callback: (size: number) => void): void;
    // The colour scheme of both windows. Saved as an app setting.
    getTheme(): Promise<ThemeName>;
    setTheme(theme: ThemeName): Promise<void>;
    onThemeChanged(callback: (theme: ThemeName) => void): void;
    // The message window's border and arrow. Saved as an app setting.
    getMessageStyle(): Promise<MessageStyle>;
    setMessageStyle(style: MessageStyle): Promise<void>;
    onMessageStyleChanged(callback: (style: MessageStyle) => void): void;
  };
}
