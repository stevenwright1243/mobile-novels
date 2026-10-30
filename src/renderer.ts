/**
 * Runs in the page (the "renderer" process). No Node or Electron APIs here;
 * anything from main has to come through `window.vn` (see preload.ts).
 *
 * The picker: a sidebar of saved games and open windows, and the picked
 * game's settings on the right, a page at a time (Regions, Sizes, Look,
 * Input, and Debug in debug mode).
 */

// The colour scheme and its fonts (theme.ts).
import './theme';
import './index.css';
import { playCapture, stopCapture } from './capture';
// The "Portrait view" box in the preview.
import './background-view';
import './input-settings';
import './message-style';
import { enableOcrTest } from './ocr-test';
import './phone-status';
import { refreshSizesPage } from './picker-sizes';
import './theme-picker';
import './preview-zoom';
import { enableRegionEditing } from './region-editor';

// The `!` tells TypeScript "this element definitely exists", since
// querySelector would otherwise be typed as possibly null.
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh')!;
const windowsSection = document.querySelector<HTMLDetailsElement>('#windows')!;
const windowsCount = windowsSection.querySelector('.count')!;
const windowList = document.querySelector<HTMLUListElement>('#window-list')!;
const gamesSection = document.querySelector<HTMLElement>('#games')!;
const gamesCount = gamesSection.querySelector('.count')!;
const gameList = document.querySelector<HTMLUListElement>('#game-list')!;
const preview = document.querySelector<HTMLVideoElement>('#preview')!;
const previewEmpty = document.querySelector<HTMLElement>('#preview-empty')!;
const gameHeading = document.querySelector<HTMLElement>('#game-heading')!;
const gameSubtitle = document.querySelector<HTMLElement>('#game-subtitle')!;
const gameNameInput = document.querySelector<HTMLInputElement>('#game-name')!;

// The picked game's window, or null.
let selectedId: string | null = null;

// Picks a window as the game: from its thumbnail, or from its game row.
// Main may ask about unsaved edits first; if the pick goes ahead, it sends
// `source-selected`, which shows it (below).
function pickWindow(source: GameWindow) {
  window.vn.selectSource(source);
}

// Shows the picked game: picked here, or from the portrait's Menus sheet.
function showPicked(sourceId: string) {
  selectedId = sourceId;
  playCapture(preview, sourceId);
  previewEmpty.hidden = true;
  enableRegionEditing();
  enableOcrTest(preview);
  // Fold the window list away; its summary line still opens it again.
  windowsSection.open = false;
  gameNameInput.disabled = false;
  refresh();
}

async function showWindowList() {
  const sources = await window.vn.listWindows();
  windowsCount.textContent = String(sources.length);
  windowList.replaceChildren(
    ...sources.map((source) => {
      const img = document.createElement('img');
      img.src = source.thumbnail;
      img.alt = '';
      const label = document.createElement('span');
      label.textContent = source.name;

      const button = document.createElement('button');
      button.className = 'window-row';
      button.title = source.name;
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

// Makes an element with a class and text, for building the rows.
function element(tag: string, className: string, text: string) {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = text;
  return created;
}

// The game's short name if it has one, else its window title.
const nameOf = (profile: ProfileSummary) => profile.name ?? profile.title;

// Games started from here (or the portrait) whose window hasn't opened yet,
// shown as "Starting…" until it does (or for a minute, as main gives up
// then too).
const starting = new Map<string, number>();
const STARTING_FOR = 60_000;

// What a game's row says under its name. Main mutes every running game but
// the one being played (see `muteOtherGames`).
function stateOf(profile: ProfileSummary) {
  if (profile.sourceId) {
    if (profile.sourceId === selectedId) {
      return 'Playing';
    }
    return selectedId ? 'Open · muted' : 'Open';
  }
  if (!profile.exePath) {
    return "Can't start: no .exe saved";
  }
  const since = starting.get(profile.id);
  return since !== undefined && Date.now() - since < STARTING_FOR
    ? 'Starting…'
    : 'Not running · click to start';
}

// A small square with the game's own icon (its .exe's), like a server
// icon, or its first letter if it has none.
function iconOf(profile: ProfileSummary) {
  const icon = element('span', 'game-icon', '');
  icon.setAttribute('aria-hidden', 'true');
  if (profile.icon) {
    const image = document.createElement('img');
    image.src = profile.icon;
    image.alt = '';
    icon.classList.add('has-icon');
    icon.append(image);
  } else {
    icon.textContent = nameOf(profile).trim()[0] ?? '?';
  }
  return icon;
}

async function showGameList() {
  const profiles = await window.vn.listProfiles();
  gamesSection.hidden = profiles.length === 0;
  gamesCount.textContent = String(profiles.length);
  gameList.replaceChildren(
    ...profiles.map((profile) => {
      const { sourceId } = profile;
      if (sourceId) {
        starting.delete(profile.id);
      }
      const exeName = profile.exePath?.split('\\').pop() ?? 'unknown .exe';
      const playing = sourceId !== undefined && sourceId === selectedId;
      if (playing) {
        showHeading(profile, exeName);
      }

      const button = document.createElement('button');
      button.className = 'game-row';
      button.dataset.state = playing ? 'playing' : sourceId ? 'open' : 'closed';
      if (playing) {
        button.setAttribute('aria-current', 'true');
      }
      const text = element('span', 'game-text', '');
      const state = element('span', 'game-state', stateOf(profile));
      text.append(element('strong', 'game-title', nameOf(profile)), state);
      button.append(iconOf(profile), text);
      button.title = [
        profile.title,
        exeName,
        profile.window
          ? `${profile.window.width} × ${profile.window.height}`
          : null,
        clickMethodNames[profile.clickMethod],
        `played ${timeAgo(profile.lastPlayed)}`,
      ]
        .filter(Boolean)
        .join('\n');

      const pick = () => {
        if (sourceId) {
          pickWindow({ id: sourceId, name: profile.title });
        }
      };
      // A running game is picked; one that isn't running is started, and
      // main picks it once its window opens.
      button.addEventListener('click', async () => {
        if (sourceId) {
          pick();
        } else if (await window.vn.launchGame(profile.id)) {
          starting.set(profile.id, Date.now());
          state.textContent = 'Starting…';
        }
      });
      if (!sourceId && !profile.exePath) {
        // `aria-disabled` rather than `disabled`: it looks and reads as
        // unavailable, but still gets right-clicks (for the menu below).
        button.setAttribute('aria-disabled', 'true');
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
      // A running game can be closed (force-closed, as the portrait's Close
      // button does, without asking).
      if (profile.isOpen) {
        const close = document.createElement('button');
        close.className = 'icon-button close-game';
        close.title = `Close ${nameOf(profile)} (force-quits it)`;
        close.setAttribute('aria-label', close.title);
        close.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>';
        close.addEventListener('click', () => {
          close.disabled = true;
          window.vn.closeGame(profile.id);
        });
        item.append(close);
      }
      return item;
    }),
  );

  // A window picked that isn't a saved game yet: its title until it's
  // saved.
  const pickedId = selectedId;
  if (pickedId && !profiles.some((profile) => profile.sourceId === pickedId)) {
    const sources = await window.vn.listWindows();
    gameHeading.textContent =
      sources.find((source) => source.id === pickedId)?.name ?? 'New game';
    gameSubtitle.textContent = 'New game: Save to keep its settings.';
  }
}

// The top bar: the game being played, and what's saved about it.
function showHeading(profile: ProfileSummary, exeName: string) {
  gameHeading.textContent = nameOf(profile);
  gameSubtitle.textContent = [
    exeName,
    profile.window
      ? `${profile.window.width} × ${profile.window.height}`
      : null,
    `taps by ${clickMethodNames[profile.clickMethod].toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function refresh() {
  showWindowList();
  showGameList();
}

// Inside the "Open windows" line, so it mustn't fold the list too.
refreshButton.addEventListener('click', (event) => {
  event.preventDefault();
  refresh();
});
window.vn.onProfilesChanged(showGameList);
// Main says when windows open or close; also refresh on coming back to this
// window, in case something changed while it was in the background.
window.vn.onWindowsChanged(refresh);
window.addEventListener('focus', refresh);
window.vn.getSelectedSource().then((sourceId) => {
  if (sourceId) {
    showPicked(sourceId);
  } else {
    refresh();
  }
});

// A game was picked (here or in the portrait), or the game was closed (main
// sends `null`): then stop the blank preview and unfold the window list,
// ready to pick the next game.
window.vn.onSourceSelected((sourceId) => {
  if (sourceId !== null) {
    showPicked(sourceId);
    return;
  }
  selectedId = null;
  stopCapture(preview);
  previewEmpty.hidden = false;
  windowsSection.open = true;
  gameHeading.textContent = 'No game picked';
  gameSubtitle.textContent = 'The game was closed. Pick another on the left.';
  refresh();
});

// --- Pages ---------------------------------------------------------------------

// The tabs above the pages: one page shows at a time.
const tabs = document.querySelectorAll<HTMLButtonElement>('#tabs [role="tab"]');
function showPage(name: string) {
  for (const tab of tabs) {
    const shown = tab.dataset.page === name;
    tab.setAttribute('aria-selected', String(shown));
    document.querySelector<HTMLElement>(`#page-${tab.dataset.page}`)!.hidden =
      !shown;
  }
  if (name === 'style') {
    refreshSizesPage();
  }
}
for (const tab of tabs) {
  tab.addEventListener('click', () => showPage(tab.dataset.page!));
}

// The Debug page, only in debug mode (`npm run start:debug`).
window.vn.isDebug().then((debug) => {
  document.querySelector<HTMLElement>('[data-page="debug"]')!.hidden = !debug;
});

// --- Saving --------------------------------------------------------------------

// Saving is manual: the button shows whether there's anything to save.
const saveButton = document.querySelector<HTMLButtonElement>('#save-profile')!;

function showSaveState({ hasGame, edited, saved }: SaveState) {
  // Clickable when there are edits (the button size can be edited with no
  // game picked), or when this game has no profile file yet (to create one,
  // even with the default settings).
  saveButton.disabled = !edited && (!hasGame || saved);
  saveButton.textContent = edited
    ? 'Save changes'
    : saved
      ? 'Saved'
      : 'Save profile';
}
window.vn.onSaveStateChanged(showSaveState);
window.vn.getSaveState().then(showSaveState);

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

// The game's short name for the portrait's Visual Novels, part of its
// profile like its other settings: empty shows the window title.
window.vn.onGameNameChanged((name) => {
  gameNameInput.value = name;
});
gameNameInput.addEventListener('input', () => {
  window.vn.setGameName(gameNameInput.value);
});
