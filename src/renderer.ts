/**
 * Runs in the page (the "renderer" process). No Node or Electron APIs here;
 * anything from main has to come through `window.vn` (see preload.ts).
 */

import './index.css';

// The `!` tells TypeScript "this element definitely exists", since
// querySelector would otherwise be typed as possibly null.
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')!;
const windowList = document.querySelector<HTMLUListElement>('#window-list')!;
const preview = document.querySelector<HTMLVideoElement>('#preview')!;

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
      button.addEventListener('click', () => startCapture(source.id));

      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
}

async function startCapture(sourceId: string) {
  // Stop the previous capture, if any, before starting a new one.
  const previous = preview.srcObject as MediaStream | null;
  previous?.getTracks().forEach((track) => track.stop());

  // `mandatory.chromeMediaSource` is a Chromium/Electron extension for
  // capturing a specific window by ID. It isn't in TypeScript's built-in
  // types, hence the cast.
  const constraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
    },
  } as MediaTrackConstraints;

  preview.srcObject = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: constraints,
  });
}

refreshButton.addEventListener('click', showWindowList);
showWindowList();
