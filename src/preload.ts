// Runs before the page loads and is the only bridge between the page and the
// main process. Whatever is exposed here shows up in the page as `window.vn`.
// See: https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vn', {
  listWindows: () => ipcRenderer.invoke('list-windows'),
} satisfies Window['vn']);
