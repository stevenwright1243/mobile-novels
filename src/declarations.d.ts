/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

// A capturable window, as sent from main to the renderer.
interface WindowSource {
  id: string;
  name: string;
  // PNG data URL, usable directly as an <img> src.
  thumbnail: string;
}

// The API that preload.ts exposes on `window.vn`.
interface Window {
  vn: {
    listWindows(): Promise<WindowSource[]>;
  };
}
