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

// The named regions the portrait view draws. `Record<K, V>` is an object
// with exactly the keys K, each holding a V.
type RegionName = 'background' | 'text';
type Regions = Record<RegionName, Region>;

// How a tap is delivered to the game: 'message' posts click messages to its
// window; 'mouse' simulates real mouse input (see win32.ts).
type ClickMethod = 'message' | 'mouse';

// How the portrait's text zone shows the game's text: 'text' is the line
// read by OCR, restyled for phones; 'image' is the picture of the game's text
// box (the fallback for games OCR reads badly).
type TextMode = 'text' | 'image';

// What OCR read from an image (ocr.ts).
interface OcrResult {
  text: string;
  // Tesseract's own guess at how right it is, 0 to 100.
  confidence: number;
  // How long the reading took, in milliseconds.
  ms: number;
}

// Everything the app remembers about one game, saved as JSON (profiles.ts).
interface GameProfile {
  version: 3;
  // The .exe name, e.g. "totono_steam.exe" (or "title:..." as a fallback).
  id: string;
  exePath: string | null;
  // The window title when last played.
  title: string;
  clickMethod: ClickMethod;
  textMode: TextMode;
  regions: Regions;
  // The game's content size in pixels when last played.
  window: { width: number; height: number } | null;
  // When last picked, as an ISO date string.
  lastPlayed: string;
}

// A profile as listed in the picker: `Omit<T, K>` is T without the listed
// properties. `isOpen` and `sourceId` say whether (and where) it's running.
type ProfileSummary = Omit<GameProfile, 'version' | 'regions' | 'textMode'> & {
  isOpen: boolean;
  sourceId?: string;
};

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
    onSourceSelected(callback: (sourceId: string) => void): void;
    // Where the game's content is, as fractions of the capture; null if the
    // window can't be measured.
    getClientArea(): Promise<Region | null>;
    getRegions(): Promise<Regions>;
    setRegion(name: RegionName, region: Region): Promise<void>;
    onRegionsChanged(callback: (regions: Regions) => void): void;
    // Clicks the game at a point given as fractions of its client area.
    clickGame(point: { x: number; y: number }): Promise<void>;
    getClickMethod(): Promise<ClickMethod>;
    setClickMethod(method: ClickMethod): Promise<void>;
    onClickMethodChanged(callback: (method: ClickMethod) => void): void;
    getTextMode(): Promise<TextMode>;
    setTextMode(mode: TextMode): Promise<void>;
    onTextModeChanged(callback: (mode: TextMode) => void): void;
    // Saved game profiles, marked with whether each game is running now.
    listProfiles(): Promise<ProfileSummary[]>;
    onProfilesChanged(callback: () => void): void;
    // The right-click menu for a game card. Resolves to 'pick' if the user
    // chose to pick that game; main handles the other choices itself.
    showProfileMenu(
      card: Pick<ProfileSummary, 'id' | 'title' | 'isOpen'>,
    ): Promise<'pick' | null>;
    // Writes the picked game's profile to its file.
    saveProfile(): Promise<void>;
    onSaveStateChanged(callback: (state: SaveState) => void): void;
    // Puts the game behind all other windows without minimizing it.
    sendGameToBack(): Promise<void>;
    // Reads the text in a PNG image with OCR (ocr.ts).
    readText(png: Uint8Array): Promise<OcrResult>;
    // The game's current line of text, as read by OCR (text-reader.ts).
    // Main keeps it and passes changes on to every window.
    getTextLine(): Promise<string>;
    setTextLine(line: string): Promise<void>;
    onTextLineChanged(callback: (line: string) => void): void;
  };
}
