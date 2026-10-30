/**
 * The picker's Style settings: the colour scheme of both windows (applied
 * by theme.ts), and the portrait message window's border and "tap to
 * continue" arrow. An app setting, the same for every game. Changes
 * go to main, which passes them on to the portrait and saves them.
 */

const border = document.querySelector<HTMLSelectElement>('#message-border')!;
const arrow = document.querySelector<HTMLSelectElement>('#message-arrow')!;

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

window.vn.getMessageStyle().then(showStyle);

// The theme. Main sends the change to every window, this one included.
// Themes that come with their own border or arrow, picked along with the
// theme (they can still be changed after). `Partial` means "some of".
const THEME_STYLES: Partial<Record<ThemeName, Partial<MessageStyle>>> = {
  kimikano: { border: 'none', arrow: 'chevron' },
  miside: { arrow: 'hearts' },
  miyuki: { border: 'none', arrow: 'triangle' },
};

const theme = document.querySelector<HTMLSelectElement>('#theme')!;
theme.addEventListener('change', () => {
  window.vn.setTheme(theme.value as ThemeName);
  const style = THEME_STYLES[theme.value as ThemeName];
  if (style) {
    border.value = style.border ?? border.value;
    arrow.value = style.arrow ?? arrow.value;
    styleChanged();
  }
});
window.vn.onThemeChanged((name) => (theme.value = name));
window.vn.getTheme().then((name) => (theme.value = name));
