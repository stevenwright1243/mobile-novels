/**
 * The colour scheme (both windows): applies the theme picked in the picker's
 * Style settings by setting `data-theme` on <html>, which theme.css styles
 * by. Also loads every theme's font, bundled with the app so they work
 * offline (a font file is only read once a theme uses it).
 */

import '@fontsource-variable/nunito';
import '@fontsource-variable/eb-garamond';
import '@fontsource/share-tech-mono';

const listeners: ((theme: ThemeName) => void)[] = [];

// Calls `callback` after each theme change, for anything that reads the
// theme's colours in code rather than CSS (the portrait's backdrop tint).
export function onThemeApplied(callback: (theme: ThemeName) => void) {
  listeners.push(callback);
}

function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  for (const listener of listeners) {
    listener(theme);
  }
}

window.vn.onThemeChanged(applyTheme);
window.vn.getTheme().then(applyTheme);
