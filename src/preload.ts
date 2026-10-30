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
    ipcRenderer.on('source-selected', (_event, sourceId: string | null) =>
      callback(sourceId),
    );
  },
  onWindowsChanged: (callback) => {
    ipcRenderer.on('windows-changed', () => callback());
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
  getTextStyle: () => ipcRenderer.invoke('get-text-style'),
  setTextStyle: (style) => ipcRenderer.invoke('set-text-style', style),
  onTextStyleChanged: (callback) => {
    ipcRenderer.on('text-style-changed', (_event, style: TextStyle) =>
      callback(style),
    );
  },
  getBackgroundY: () => ipcRenderer.invoke('get-background-y'),
  setBackgroundY: (y) => ipcRenderer.invoke('set-background-y', y),
  onBackgroundYChanged: (callback) => {
    ipcRenderer.on('background-y-changed', (_event, y: number) => callback(y));
  },
  getBackgroundZoneSize: () => ipcRenderer.invoke('get-background-zone-size'),
  setBackgroundZoneSize: (size) =>
    ipcRenderer.invoke('set-background-zone-size', size),
  onBackgroundZoneSizeChanged: (callback) => {
    ipcRenderer.on('background-zone-size-changed', (_event, size: Size) =>
      callback(size),
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
  isDebug: () => ipcRenderer.invoke('is-debug'),
  readText: (png) => ipcRenderer.invoke('read-text', png),
  saveOcrTest: (png, test) => ipcRenderer.invoke('save-ocr-test', png, test),
  showOcrTests: () => ipcRenderer.invoke('show-ocr-tests'),
  getTextLine: () => ipcRenderer.invoke('get-text-line'),
  getTextHistory: () => ipcRenderer.invoke('get-text-history'),
  setTextLine: (line) => ipcRenderer.invoke('set-text-line', line),
  onTextLineChanged: (callback) => {
    ipcRenderer.on('text-line-changed', (_event, line: string) =>
      callback(line),
    );
  },
  getSpeaker: () => ipcRenderer.invoke('get-speaker'),
  setSpeaker: (name) => ipcRenderer.invoke('set-speaker', name),
  onSpeakerChanged: (callback) => {
    ipcRenderer.on('speaker-changed', (_event, name: string) => callback(name));
  },
  getPhoneDisplay: () => ipcRenderer.invoke('get-phone-display'),
  onPhoneDisplayChanged: (callback) => {
    ipcRenderer.on(
      'phone-display-changed',
      (_event, phone: PhoneDisplay | null) => callback(phone),
    );
  },
  getPortraitOnPhone: () => ipcRenderer.invoke('get-portrait-on-phone'),
  setPortraitOnPhone: (onPhone) =>
    ipcRenderer.invoke('set-portrait-on-phone', onPhone),
  getButtonSize: () => ipcRenderer.invoke('get-button-size'),
  setButtonSize: (size) => ipcRenderer.invoke('set-button-size', size),
  onButtonSizeChanged: (callback) => {
    ipcRenderer.on('button-size-changed', (_event, size: number) =>
      callback(size),
    );
  },
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (_event, theme: ThemeName) =>
      callback(theme),
    );
  },
  getMessageStyle: () => ipcRenderer.invoke('get-message-style'),
  setMessageStyle: (style) => ipcRenderer.invoke('set-message-style', style),
  onMessageStyleChanged: (callback) => {
    ipcRenderer.on('message-style-changed', (_event, style: MessageStyle) =>
      callback(style),
    );
  },
} satisfies Window['vn']);
