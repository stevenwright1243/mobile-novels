/**
 * The picker's Style settings: the colour scheme of both windows (applied
 * by theme.ts), and the portrait message window's border and "tap to
 * continue" arrow. An app setting, the same for every game. Changes
 * go to main, which passes them on to the portrait and saves them. They can
 * also be changed in the portrait's Menus sheet, so these follow main.
 */

import { ARROWS, BORDERS, THEMES } from './look-options';

const theme = document.querySelector<HTMLSelectElement>('#theme')!;
const border = document.querySelector<HTMLSelectElement>('#message-border')!;
const arrow = document.querySelector<HTMLSelectElement>('#message-arrow')!;

// The options come from look-options.ts, shared with the portrait.
function fillOptions(
  select: HTMLSelectElement,
  options: readonly (readonly [string, string])[],
) {
  for (const [value, label] of options) {
    select.append(new Option(label, value));
  }
}
fillOptions(theme, THEMES);
fillOptions(border, BORDERS);
fillOptions(arrow, ARROWS);

function showStyle(style: MessageStyle) {
  border.value = style.border;
  arrow.value = style.arrow;
}

function styleChanged() {
  window.vn.setMessageStyle({
    // `as` tells TypeScript the value is one of the options: it can't know
    // what's in the HTML.
    border: border.value as MessageBorder,
    arrow: arrow.value as NextArrow,
  });
}

border.addEventListener('change', styleChanged);
arrow.addEventListener('change', styleChanged);

window.vn.onMessageStyleChanged(showStyle);
window.vn.getMessageStyle().then(showStyle);

// The theme. Main sends the change to every window, this one included, and
// picks the theme's own border or arrow, if it has them (`THEME_STYLES`).
theme.addEventListener('change', () => {
  window.vn.setTheme(theme.value as ThemeName);
});
window.vn.onThemeChanged((name) => (theme.value = name));
window.vn.getTheme().then((name) => (theme.value = name));
