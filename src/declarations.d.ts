/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

// A capturable window, as sent from main to the renderer.
interface WindowSource {
  id: string;
  name: string;
  // PNG data URL, usable directly as an <img> src.
  thumbnail: string;
}

// A rectangle inside the game window, as fractions (0 to 1) of its size.
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
    // Tells main which game window was picked, so the portrait window follows.
    selectSource(sourceId: string): Promise<void>;
    getSelectedSource(): Promise<string | null>;
    onSourceSelected(callback: (sourceId: string) => void): void;
    getRegions(): Promise<Regions>;
    setRegion(name: RegionName, region: Region): Promise<void>;
    onRegionsChanged(callback: (regions: Regions) => void): void;
  };
}
