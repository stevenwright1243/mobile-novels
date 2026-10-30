/**
 * The settings sheet under the game in the portrait's Menus mode: the
 * full-screen text switch (page-mode.ts), the screenshot button, the sizes
 * (sizes-panel.ts), and the look
 * (theme, "tap to continue" arrow, border), picked with big buttons that
 * each show what they pick, and a sample message window in the current
 * look. The same app settings as the picker's Style settings: changes go
 * to main, which saves them and sends them to both windows.
 */

import { ARROW_SHAPES } from './arrow-shapes';
import { ARROWS, BORDERS, THEMES } from './look-options';
import {
  onPageModeChoiceChanged,
  pageModeChoice,
  setPageModeChoice,
} from './page-mode';
// The Sizes drop-down (sizes-panel.ts, via sizes-sample.ts, which draws its
// sample; portrait.ts sets the sample up).
import './sizes-sample';

// The current border and arrow, kept up to date by main.
let style: MessageStyle = { border: 'halo', arrow: 'chevron' };

const previewArrow = document.querySelector<HTMLElement>(
  '#look-preview .next-arrow',
)!;
const previewWindow = document.querySelector<HTMLElement>(
  '#look-preview .message-window',
)!;
previewArrow.innerHTML = ARROW_SHAPES;

// A row of buttons, one per option, that act like radio buttons: the
// picked one is marked with `aria-checked`, which portrait.css styles.
function makeChips<T extends string>(
  row: HTMLElement,
  options: readonly (readonly [T, string])[],
  // Fills in a button for an option: what it shows.
  draw: (button: HTMLButtonElement, value: T, label: string) => void,
  pick: (value: T) => void,
) {
  const buttons = new Map<T, HTMLButtonElement>();
  for (const [value, label] of options) {
    const button = document.createElement('button');
    button.className = 'chip';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', label);
    draw(button, value, label);
    button.addEventListener('click', () => pick(value));
    row.append(button);
    buttons.set(value, button);
  }
  // Marks the picked option.
  return (picked: T) => {
    for (const [value, button] of buttons) {
      button.setAttribute('aria-checked', String(value === picked));
    }
  };
}

// Full-screen text: off, on, or Auto (auto-page.ts), the default.
const showPageMode = makeChips(
  document.querySelector('#page-mode-chips')!,
  [
    ['off', 'Off'],
    ['auto', 'Auto'],
    ['on', 'On'],
  ] as const,
  (button, _value, label) => {
    button.textContent = label;
  },
  setPageModeChoice,
);
onPageModeChoiceChanged(showPageMode);
showPageMode(pageModeChoice());

// Screenshot: Steam takes it, on its screenshot key (F12) pressed in the
// game. The button says "Taken" for a moment after.
const screenshotButton =
  document.querySelector<HTMLButtonElement>('#screenshot-button')!;
const screenshotLabel = screenshotButton.querySelector('span')!;
screenshotButton.addEventListener('click', async () => {
  await window.vn.screenshotGame();
  screenshotLabel.textContent = 'Taken';
  setTimeout(() => {
    screenshotLabel.textContent = 'Take';
  }, 1500);
});

// --- Look ----------------------------------------------------------------------

// Themes: each button is drawn in its own theme (`.theme-sample` takes that
// theme's variables in theme.css), with its name in the theme's font.
const showTheme = makeChips(
  document.querySelector('#theme-chips')!,
  THEMES,
  (button, value, label) => {
    button.classList.add('theme-sample');
    button.dataset.theme = value;
    button.textContent = label;
  },
  (value) => window.vn.setTheme(value),
);

// Arrows: each button shows its arrow, moving.
const showArrow = makeChips(
  document.querySelector('#arrow-chips')!,
  ARROWS,
  (button, value, label) => {
    if (value === 'none') {
      button.textContent = label;
      return;
    }
    const arrow = document.createElement('span');
    arrow.className = 'next-arrow';
    arrow.dataset.arrow = value;
    arrow.innerHTML = ARROW_SHAPES;
    button.append(arrow);
  },
  (arrow) => window.vn.setMessageStyle({ ...style, arrow }),
);

// Borders: each button is a small message window with that border.
const showBorder = makeChips(
  document.querySelector('#border-chips')!,
  BORDERS,
  (button, value, label) => {
    const sample = document.createElement('span');
    sample.className = 'message-window glass';
    sample.dataset.border = value;
    sample.textContent = label;
    button.append(sample);
  },
  (border) => window.vn.setMessageStyle({ ...style, border }),
);

function showStyle(newStyle: MessageStyle) {
  style = newStyle;
  previewWindow.dataset.border = style.border;
  previewArrow.dataset.arrow = style.arrow;
  showArrow(style.arrow);
  showBorder(style.border);
}
window.vn.onMessageStyleChanged(showStyle);
window.vn.getMessageStyle().then(showStyle);

window.vn.onThemeChanged(showTheme);
window.vn.getTheme().then(showTheme);
