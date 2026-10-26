/**
 * Runs in the page (the "renderer" process). No Node or Electron APIs here;
 * anything from main has to come through `window.vn` (see preload.ts).
 */

import './index.css';
import { playCapture } from './capture';
import { enableRegionEditing } from './region-editor';

// The `!` tells TypeScript "this element definitely exists", since
// querySelector would otherwise be typed as possibly null.
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')!;
const windowList = document.querySelector<HTMLUListElement>('#window-list')!;
const preview = document.querySelector<HTMLVideoElement>('#preview')!;
const sendToBackButton =
  document.querySelector<HTMLButtonElement>('#send-to-back')!;

async function showWindowList() {
  const sources = await window.vn.listWindows();
  windowList.replaceChildren(
    ...sources.map((source) => {
      const img = document.createElement('img');
      img.src = source.thumbnail;
      const label = document.createElement('span');
      label.textContent = source.name;

      const button = document.createElement('button');
      button.append(img, label);
      button.addEventListener('click', () => {
        window.vn.selectSource({ id: source.id, name: source.name });
        playCapture(preview, source.id);
        enableRegionEditing();
        sendToBackButton.disabled = false;
      });

      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
}

refreshButton.addEventListener('click', showWindowList);
showWindowList();

// Hides the game behind other windows. Use this instead of minimizing, which
// stops the game from being captured (see win32.ts).
sendToBackButton.addEventListener('click', () => window.vn.sendGameToBack());

// How taps in the portrait are delivered to the game (see win32.ts).
const clickMethodSelect =
  document.querySelector<HTMLSelectElement>('#click-method')!;
window.vn.getClickMethod().then((method) => {
  clickMethodSelect.value = method;
});
clickMethodSelect.addEventListener('change', () => {
  window.vn.setClickMethod(clickMethodSelect.value as ClickMethod);
});
