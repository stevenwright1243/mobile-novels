/**
 * The Menus sheet's "Visual Novels" drop-down: the saved game profiles
 * (the picker's "Your games"), one button each. Tapping a running game
 * makes it the game being played, as clicking its card in the picker does;
 * games that aren't running are shown but can't be picked.
 */

const dropdown = document.querySelector<HTMLDetailsElement>('#visual-novels')!;
const chips = document.querySelector<HTMLElement>('#game-chips')!;

// Makes an element with a class and text, for building the buttons.
function element(tag: string, className: string, text: string) {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = text;
  return created;
}

async function showGames() {
  const [profiles, selected] = await Promise.all([
    window.vn.listProfiles(),
    window.vn.getSelectedSource(),
  ]);
  chips.replaceChildren(
    ...profiles.map((profile) => {
      const { sourceId } = profile;
      const button = document.createElement('button');
      button.className = 'chip game-chip';
      button.setAttribute('role', 'radio');
      button.setAttribute(
        'aria-checked',
        String(sourceId !== undefined && sourceId === selected),
      );
      button.disabled = !sourceId;
      button.append(
        element('strong', 'game-title', profile.title),
        element('span', 'game-state', sourceId ? 'Open' : 'Not running'),
      );
      if (sourceId) {
        // Main may ask about unsaved edits first; the list follows either
        // way, from `onSourceSelected` below.
        button.addEventListener('click', () =>
          window.vn.selectSource({ id: sourceId, name: profile.title }),
        );
      }
      return button;
    }),
  );
  if (profiles.length === 0) {
    chips.append(element('p', 'sheet-note', 'No saved games yet.'));
  }
}

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
