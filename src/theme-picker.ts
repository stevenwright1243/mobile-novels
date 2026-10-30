/**
 * The picker's Theme button, above the phone status at the bottom of its
 * sidebar: it shows the current theme (its name, beside a swatch of its
 * colours) and opens a menu with a button per theme, each drawn in its own
 * theme's colours and font, as in the portrait's Menus sheet. The same app
 * setting as the Look page's select: main saves it and sends it to both
 * windows (applied by theme.ts).
 */

import { THEMES } from './look-options';

const nameLabel = document.querySelector<HTMLElement>('#theme-name')!;
const menu = document.querySelector<HTMLElement>('#theme-menu')!;
const chips = document.querySelector<HTMLElement>('#theme-chips')!;

// `.theme-sample` takes that theme's variables (theme.css), so each button
// shows its own theme whatever the current one is.
const buttons = THEMES.map(([value, label]) => {
  const chip = document.createElement('button');
  chip.className = 'chip theme-sample';
  chip.dataset.theme = value;
  chip.setAttribute('role', 'radio');
  chip.textContent = label;
  chip.addEventListener('click', () => {
    window.vn.setTheme(value);
    menu.hidePopover();
  });
  chips.append(chip);
  return chip;
});

// Main sends the change to every window, this one included.
function showTheme(theme: ThemeName) {
  for (const chip of buttons) {
    chip.setAttribute('aria-checked', String(chip.dataset.theme === theme));
  }
  nameLabel.textContent =
    THEMES.find(([value]) => value === theme)?.[1] ?? theme;
}
window.vn.onThemeChanged(showTheme);
window.vn.getTheme().then(showTheme);

// Opening it moves the keyboard to the theme in use.
menu.addEventListener('toggle', (event) => {
  if ((event as ToggleEvent).newState === 'open') {
    buttons.find((chip) => chip.ariaChecked === 'true')?.focus();
  }
});
