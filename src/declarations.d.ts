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

// The API that preload.ts exposes on `window.vn`.
interface Window {
  vn: {
    listWindows(): Promise<WindowSource[]>;
    // Tells main which game window was picked, so the portrait window follows
    // and that game's saved regions are loaded.
    selectSource(source: GameWindow): Promise<void>;
    getSelectedSource(): Promise<string | null>;
    onSourceSelected(callback: (sourceId: string) => void): void;
    // Where the game's content is, as fractions of the capture; null if the
    // window can't be measured.
    getClientArea(): Promise<Region | null>;
    getRegions(): Promise<Regions>;
    setRegion(name: RegionName, region: Region): Promise<void>;
    onRegionsChanged(callback: (regions: Regions) => void): void;
  };
}
