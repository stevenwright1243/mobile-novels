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
  sendGameToBack: () => ipcRenderer.invoke('send-game-to-back'),
} satisfies Window['vn']);
