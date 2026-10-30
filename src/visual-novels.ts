/**
 * The Menus sheet's "Visual Novels" drop-down: the saved game profiles
 * (the picker's "Your games"), one button each. Tapping a running game
 * makes it the game being played, as clicking its card in the picker does;
 * tapping one that isn't running starts it from its saved .exe (main picks
 * it once its window opens). The Close button at the bottom force-closes
 * the running game that was opened first this session.
 */

const dropdown = document.querySelector<HTMLDetailsElement>('#visual-novels')!;
const chips = document.querySelector<HTMLElement>('#game-chips')!;
const closeGameButton =
  document.querySelector<HTMLButtonElement>('#close-game')!;

// Games started from here whose window hasn't opened yet, shown as
// "Starting…" until it does (or for a minute, as main gives up then too).
const starting = new Map<string, number>();
const STARTING_FOR = 60_000;

// The game the Close button closes, if any.
let toClose: ProfileSummary | undefined;

// Makes an element with a class and text, for building the buttons.
function element(tag: string, className: string, text: string) {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = text;
  return created;
}

// What a game's button says under its title.
function stateOf(profile: ProfileSummary, selected: string | null) {
  if (profile.sourceId) {
    return profile.sourceId === selected ? 'Playing' : 'Open';
  }
  if (!profile.exePath) {
    return "Can't start: no .exe saved";
  }
  const since = starting.get(profile.id);
  return since !== undefined && Date.now() - since < STARTING_FOR
    ? 'Starting…'
    : 'Tap to start';
}

async function showGames() {
  const [profiles, selected] = await Promise.all([
    window.vn.listProfiles(),
    window.vn.getSelectedSource(),
  ]);
  chips.replaceChildren(
    ...profiles.map((profile) => {
      const { sourceId } = profile;
      if (sourceId) {
        starting.delete(profile.id);
      }
      const button = document.createElement('button');
      button.className = 'chip game-chip';
      button.setAttribute('role', 'radio');
      button.setAttribute(
        'aria-checked',
        String(sourceId !== undefined && sourceId === selected),
      );
      button.disabled = !sourceId && !profile.exePath;
      const state = element('span', 'game-state', stateOf(profile, selected));
      button.append(element('strong', 'game-title', profile.title), state);
      button.addEventListener('click', async () => {
        if (sourceId) {
          // Main may ask about unsaved edits first; the list follows either
          // way, from `onSourceSelected` below.
          window.vn.selectSource({ id: sourceId, name: profile.title });
        } else if (await window.vn.launchGame(profile.id)) {
          starting.set(profile.id, Date.now());
          state.textContent = 'Starting…';
        }
      });
      return button;
    }),
  );
  if (profiles.length === 0) {
    chips.append(element('p', 'sheet-note', 'No saved games yet.'));
  }

  // The running game opened first (smallest `openedAt`).
  toClose = profiles
    .filter((profile) => profile.isOpen)
    .sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0))[0];
  closeGameButton.disabled = !toClose;
  closeGameButton.textContent = toClose
    ? `Close ${toClose.title}`
    : 'Close game';
}

closeGameButton.addEventListener('click', () => {
  if (toClose) {
    window.vn.closeGame(toClose.id);
    closeGameButton.disabled = true;
  }
});

// Kept up to date while it's open; filled again each time it opens.
dropdown.addEventListener('toggle', () => {
  if (dropdown.open) {
    showGames();
    dropdown.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
const refresh = () => {
  if (dropdown.open) {
    showGames();
  }
};
window.vn.onProfilesChanged(refresh);
window.vn.onWindowsChanged(refresh);
window.vn.onSourceSelected(refresh);
