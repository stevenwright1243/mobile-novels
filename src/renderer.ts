/**
 * Runs in the page (the "renderer" process). No Node or Electron APIs here;
 * anything from main has to come through `window.vn` (see preload.ts).
 */

// The colour scheme and its fonts (theme.ts).
import './theme';
import './index.css';
import { playCapture, stopCapture } from './capture';
// The "Portrait view" box in the preview, and the "Portrait height" slider.
import { enableBackgroundY } from './background-view';
import './button-size';
import './message-style';
import { enableOcrTest } from './ocr-test';
import './phone-status';
import './preview-zoom';
import { enableRegionEditing } from './region-editor';
import { enableTextStyle } from './text-style';

// The `!` tells TypeScript "this element definitely exists", since
// querySelector would otherwise be typed as possibly null.
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')!;
const windowsSection = document.querySelector<HTMLDetailsElement>('#windows')!;
const windowsSummary = windowsSection.querySelector('summary')!;
const windowList = document.querySelector<HTMLUListElement>('#window-list')!;
const gamesSection = document.querySelector<HTMLDetailsElement>('#games')!;
const gamesSummary = gamesSection.querySelector('summary')!;
const gameList = document.querySelector<HTMLUListElement>('#game-list')!;
const preview = document.querySelector<HTMLVideoElement>('#preview')!;
const sendToBackButton =
  document.querySelector<HTMLButtonElement>('#send-to-back')!;
const clickMethodSelect =
  document.querySelector<HTMLSelectElement>('#click-method')!;

// Picks a window as the game: from its thumbnail, or from its profile card.
// Main may ask about unsaved edits first; if the pick goes ahead, it sends
// `source-selected`, which shows it (below).
function pickWindow(source: GameWindow) {
  window.vn.selectSource(source);
}

// Shows the picked game: picked here, or from the portrait's Menus sheet.
function showPicked(sourceId: string) {
  playCapture(preview, sourceId);
  enableRegionEditing();
  enableOcrTest(preview);
  enableTextStyle();
  enableBackgroundY();
  // Fold the window list away; its summary line still opens it again.
  windowsSection.open = false;
  sendToBackButton.disabled = false;
  clickMethodSelect.disabled = false;
}

async function showWindowList() {
  const sources = await window.vn.listWindows();
  windowsSummary.textContent = `Open windows (${sources.length})`;
  windowList.replaceChildren(
    ...sources.map((source) => {
      const img = document.createElement('img');
      img.src = source.thumbnail;
      const label = document.createElement('span');
      label.textContent = source.name;

      const button = document.createElement('button');
      button.append(img, label);
      button.addEventListener('click', () =>
        pickWindow({ id: source.id, name: source.name }),
      );

      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
}

// --- Your games (saved profiles) ---------------------------------------------

const clickMethodNames: Record<ClickMethod, string> = {
  message: 'Messages',
  mouse: 'Simulated mouse',
};

// "2 hours ago", "yesterday"... in the system's language.
const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto',
});
const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

function timeAgo(isoDate: string) {
  const seconds = (Date.parse(isoDate) - Date.now()) / 1000;
  for (const [unit, size] of TIME_UNITS) {
    if (Math.abs(seconds) >= size) {
      return relativeTime.format(Math.round(seconds / size), unit);
    }
  }
  return 'just now';
}

// Makes an element with a class and text, for building the cards.
function element(tag: string, className: string, text: string) {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = text;
  return created;
}

async function showGameList() {
  const profiles = await window.vn.listProfiles();
  gamesSection.hidden = profiles.length === 0;
  gamesSummary.textContent = `Your games (${profiles.length})`;
  gameList.replaceChildren(
    ...profiles.map((profile) => {
      const exeName = profile.exePath?.split('\\').pop() ?? 'unknown .exe';
      const details = [
        profile.window
          ? `${profile.window.width} × ${profile.window.height}`
          : null,
        clickMethodNames[profile.clickMethod],
        `played ${timeAgo(profile.lastPlayed)}`,
      ]
        .filter(Boolean)
        .join(' · ');

      const button = document.createElement('button');
      button.className = 'game-card';
      button.append(
        element('strong', 'game-title', profile.title),
        element(
          'span',
          profile.isOpen ? 'badge open' : 'badge',
          profile.isOpen ? 'Open' : 'Not running',
        ),
        element('span', 'game-exe', exeName),
        element('span', 'game-details', details),
      );

      const { sourceId } = profile;
      const pick = () => {
        if (sourceId) {
          pickWindow({ id: sourceId, name: profile.title });
        }
      };
      button.addEventListener('click', pick);
      if (!sourceId) {
        // `aria-disabled` rather than `disabled`: it looks and reads as
        // unavailable, but still gets right-clicks (for the menu below).
        button.setAttribute('aria-disabled', 'true');
        button.title = 'Start the game, then click Refresh';
      }

      // Right-click (or the keyboard's Menu key): the profile's options.
      button.addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        const choice = await window.vn.showProfileMenu({
          id: profile.id,
          title: profile.title,
          isOpen: profile.isOpen,
        });
        if (choice === 'pick') {
          pick();
        }
      });

      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
}

function refresh() {
  showWindowList();
  showGameList();
}

refreshButton.addEventListener('click', refresh);
window.vn.onProfilesChanged(showGameList);
// Main says when windows open or close; also refresh on coming back to this
// window, in case something changed while it was in the background.
window.vn.onWindowsChanged(refresh);
window.addEventListener('focus', refresh);
refresh();

// A game was picked (here or in the portrait), or the game was closed (main
// sends `null`): then stop the blank preview and unfold the window list,
// ready to pick the next game.
window.vn.onSourceSelected((sourceId) => {
  if (sourceId !== null) {
    showPicked(sourceId);
  } else {
    stopCapture(preview);
    windowsSection.open = true;
    sendToBackButton.disabled = true;
  }
});

// --- Game controls -------------------------------------------------------------

// Hides the game behind other windows. Use this instead of minimizing, which
// stops the game from being captured (see win32.ts).
sendToBackButton.addEventListener('click', () => window.vn.sendGameToBack());

// Saving is manual: the button shows whether there's anything to save.
const saveButton = document.querySelector<HTMLButtonElement>('#save-profile')!;

window.vn.onSaveStateChanged(({ hasGame, edited, saved }) => {
  // Clickable when there are edits (the button size can be edited with no
  // game picked), or when this game has no profile file yet (to create one,
  // even with the default settings).
  saveButton.disabled = !edited && (!hasGame || saved);
  saveButton.textContent = edited
    ? 'Save changes'
    : saved
      ? 'Saved'
      : 'Save profile';
});

saveButton.addEventListener('click', () => window.vn.saveProfile());

// Ctrl+S saves too, as in most apps.
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!saveButton.disabled) {
      window.vn.saveProfile();
    }
  }
});

// How taps in the portrait are delivered to the game (see win32.ts). Part of
// the game's profile, so main sends its choice when a game is picked.
window.vn.onClickMethodChanged((method) => {
  clickMethodSelect.value = method;
});
clickMethodSelect.addEventListener('change', () => {
  window.vn.setClickMethod(clickMethodSelect.value as ClickMethod);
});
