// Runs before the page loads and is the only bridge between the page and the
// main process. Whatever is exposed here shows up in the page as `window.vn`.
// Both windows use this same preload.
// See: https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vn', {
  listWindows: () => ipcRenderer.invoke('list-windows'),
  selectSource: (source) => ipcRenderer.invoke('select-source', source),
  getSelectedSource: () => ipcRenderer.invoke('get-selected-source'),
  onSourceSelected: (callback) => {
    // Pass on just the ID, so the page never sees Electron's event object.
    ipcRenderer.on('source-selected', (_event, sourceId: string) =>
      callback(sourceId),
    );
  },
  getClientArea: () => ipcRenderer.invoke('get-client-area'),
  getRegions: () => ipcRenderer.invoke('get-regions'),
  setRegion: (name, region) => ipcRenderer.invoke('set-region', name, region),
  onRegionsChanged: (callback) => {
    ipcRenderer.on('regions-changed', (_event, regions: Regions) =>
      callback(regions),
    );
  },
  clickGame: (point) => ipcRenderer.invoke('click-game', point),
  getClickMethod: () => ipcRenderer.invoke('get-click-method'),
  setClickMethod: (method) => ipcRenderer.invoke('set-click-method', method),
  onClickMethodChanged: (callback) => {
    ipcRenderer.on('click-method-changed', (_event, method: ClickMethod) =>
      callback(method),
    );
  },
  getTextMode: () => ipcRenderer.invoke('get-text-mode'),
  setTextMode: (mode) => ipcRenderer.invoke('set-text-mode', mode),
  onTextModeChanged: (callback) => {
    ipcRenderer.on('text-mode-changed', (_event, mode: TextMode) =>
      callback(mode),
    );
  },
  listProfiles: () => ipcRenderer.invoke('list-profiles'),
  onProfilesChanged: (callback) => {
    ipcRenderer.on('profiles-changed', () => callback());
  },
  saveProfile: () => ipcRenderer.invoke('save-profile'),
  showProfileMenu: (card) => ipcRenderer.invoke('show-profile-menu', card),
  onSaveStateChanged: (callback) => {
    ipcRenderer.on('save-state-changed', (_event, state: SaveState) =>
      callback(state),
    );
  },
  sendGameToBack: () => ipcRenderer.invoke('send-game-to-back'),
  readText: (png) => ipcRenderer.invoke('read-text', png),
  getTextLine: () => ipcRenderer.invoke('get-text-line'),
  setTextLine: (line) => ipcRenderer.invoke('set-text-line', line),
  onTextLineChanged: (callback) => {
    ipcRenderer.on('text-line-changed', (_event, line: string) =>
      callback(line),
    );
  },
} satisfies Window['vn']);
