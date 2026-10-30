/**
 * The settings sheet under the game in the portrait's Menus mode: the
 * full-screen text switch (page-mode.ts), the sizes (portrait-sizes.ts),
 * and the look
 * (theme, "tap to continue" arrow, border), picked with big buttons that
 * each show what they pick, and a sample message window in the current
 * look. The same app settings as the picker's Style settings: changes go
 * to main, which saves them and sends them to both windows.
 */

import { ARROWS, BORDERS, THEMES } from './look-options';
import { isPageMode, onPageModeChanged, setPageMode } from './page-mode';
import {
  backgroundWidth,
  backgroundY,
  buttonSize,
  textStyle,
} from './portrait-sizes';

// The current border and arrow, kept up to date by main.
let style: MessageStyle = { border: 'halo', arrow: 'chevron' };

// The shapes of every arrow, copied from the message window's own arrow
// (portrait.html), so there's one copy of them in the page's source.
const ARROW_SHAPES = document.querySelector('#next-arrow')!.innerHTML;

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

// Full-screen text: off or on.
const showPageMode = makeChips(
  document.querySelector('#page-mode-chips')!,
  [
    ['off', 'Off'],
    ['on', 'On'],
  ] as const,
  (button, _value, label) => {
    button.textContent = label;
  },
  (value) => setPageMode(value === 'on'),
);
const pageModeChanged = (on: boolean) => showPageMode(on ? 'on' : 'off');
onPageModeChanged(pageModeChanged);
pageModeChanged(isPageMode());

// --- Sizes ---------------------------------------------------------------------

// Wires a slider to a size: it shows the size (as a percent, in its
// <output>) and changes it while dragged. The slider moves in 5% steps;
// a size set more exactly in the picker shows as it is until moved.
function linkSlider(
  id: string,
  get: () => number,
  set: (value: number) => void,
  listen: (callback: () => void) => void,
) {
  const slider = document.querySelector<HTMLInputElement>(`#${id}`)!;
  const output = slider.parentElement!.querySelector('output')!;
  const show = () => {
    const value = get();
    slider.value = String(value);
    output.value = `${Math.round(value * 100)}%`;
    // How far along the track the thumb is, for the filled part of the
    // track in portrait.css.
    const min = Number(slider.min);
    const share = (value - min) / (Number(slider.max) - min);
    slider.style.setProperty('--fill', `${Math.round(share * 100)}%`);
  };
  // Rounded to whole percents: steps of 0.05 can add up to 0.6500000001.
  slider.addEventListener('input', () =>
    set(Math.round(slider.valueAsNumber * 100) / 100),
  );
  listen(show);
}

linkSlider(
  'sheet-text-size',
  () => textStyle.get().size,
  (size) => textStyle.set({ ...textStyle.get(), size }),
  textStyle.listen,
);
linkSlider(
  'sheet-name-size',
  () => textStyle.get().nameSize,
  (nameSize) => textStyle.set({ ...textStyle.get(), nameSize }),
  textStyle.listen,
);
linkSlider(
  'sheet-background-y',
  backgroundY.get,
  backgroundY.set,
  backgroundY.listen,
);
linkSlider(
  'sheet-background-width',
  backgroundWidth.get,
  backgroundWidth.set,
  backgroundWidth.listen,
);
linkSlider(
  'sheet-button-size',
  buttonSize.get,
  buttonSize.set,
  buttonSize.listen,
);

// Text position: a switch, on for "top" (see `TextStyle`). Tapping the
// words beside it works too.
const positionSwitch =
  document.querySelector<HTMLButtonElement>('#text-position')!;
const togglePosition = () =>
  textStyle.set({
    ...textStyle.get(),
    position: textStyle.get().position === 'top' ? 'bottom' : 'top',
  });
positionSwitch.addEventListener('click', togglePosition);
for (const side of document.querySelectorAll('.toggle-side')) {
  side.addEventListener('click', togglePosition);
}
textStyle.listen((style) =>
  positionSwitch.setAttribute('aria-checked', String(style.position === 'top')),
);

// The sizes are only saved when asked (as in the picker; the button size
// too, though it's for every game), so while there are changes, Save and
// Reset show: Reset puts back the values as last saved. The game's sliders
// are disabled while no game is picked.
const actions = document.querySelector<HTMLElement>('#sheet-actions')!;
const gameSliders = document.querySelectorAll<HTMLInputElement>(
  '#sheet-text-size, #sheet-name-size, #sheet-background-y, #sheet-background-width, #text-position',
);
function showSaveState({ hasGame, edited }: SaveState) {
  actions.hidden = !edited;
  for (const slider of gameSliders) {
    slider.disabled = !hasGame;
  }
}
document
  .querySelector('#sheet-save')!
  .addEventListener('click', () => window.vn.saveProfile());
document
  .querySelector('#sheet-reset')!
  .addEventListener('click', () => window.vn.revertEdits());
window.vn.onSaveStateChanged(showSaveState);
window.vn.getSaveState().then(showSaveState);

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
