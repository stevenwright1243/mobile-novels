// Stands in for the app's preload (src/preload.ts): the reader only needs
// `window.vn.readText`.
const { ipcRenderer } = require('electron');

window.vn = { readText: (png) => ipcRenderer.invoke('read-text', png) };
