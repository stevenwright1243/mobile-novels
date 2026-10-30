/**
 * The Sizes panel, in the portrait's Menus sheet (a drop-down) and on the
 * picker's Style page: a small copy of the reader screen (drawn by
 * sizes-sample.ts) beside sliders for the text size, name size, portrait
 * height and width, button size and text padding, in 5% steps, and the
 * Text position switch; under them Save, Reset and Default. Each page has
 * an empty `#sizes .sizes-body` that this fills, so the panel is written
 * once (styled by settings-panel.css). The sizes are shared through
 * portrait-sizes.ts, so a change here reaches main and the other window.
 */

import {
  DEFAULT_BACKGROUND_WIDTH,
  DEFAULT_BACKGROUND_Y,
  DEFAULT_BUTTON_SIZE,
  DEFAULT_TEXT_STYLE,
} from './default-sizes';
import {
  backgroundWidth,
  backgroundY,
  backgroundYCap,
  buttonSize,
  textStyle,
} from './portrait-sizes';

const body = document.querySelector<HTMLElement>('#sizes .sizes-body')!;

// A slider: its name and value on a row, the slider below.
const slider = (id: string, name: string, min: number, max: number) => `
  <label class="slider">
    <span>${name}</span>
    <output></output>
    <input type="range" id="${id}" min="${min}" max="${max}" step="0.05" />
  </label>`;

// `inert`: the sample is only a picture, nothing in it can be clicked or
// focused. Its corner buttons are the Menus and Log buttons, as on the
// reader screen.
body.innerHTML = `
  <div id="sizes-sample" aria-hidden="true" inert>
    <div class="sample-screen">
      <canvas></canvas>
      <span class="corner-button glass sample-left">
        <svg viewBox="0 0 24 24"><path d="M3 5h18v12H3zM8 21h8M12 17v4" /></svg>
        Menus
      </span>
      <span class="corner-button glass sample-right">
        <svg viewBox="0 0 24 24">
          <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 3" />
        </svg>
        Log
      </span>
      <div class="text-zone">
        <div class="name-tag"><span class="name-text"></span></div>
        <p class="message-window glass"></p>
        <span class="next-arrow"></span>
      </div>
    </div>
  </div>
  <div class="sliders">
    ${slider('sheet-text-size', 'Text size', 0.6, 2)}
    ${slider('sheet-name-size', 'Name size', 0.5, 2)}
    ${slider('sheet-background-y', 'Portrait height', 0, 1)}
    ${slider('sheet-background-width', 'Portrait width', 0.5, 1)}
    ${slider('sheet-button-size', 'Button size', 0.5, 1.5)}
    ${slider('sheet-text-padding', 'Text padding', 0, 1)}
    <div class="toggle-row">
      <span id="text-position-label">Text position</span>
      <span class="toggle">
        <span class="toggle-side">Bot</span>
        <button
          id="text-position"
          class="toggle-switch"
          role="switch"
          aria-checked="false"
          aria-labelledby="text-position-label"
        >
          <span class="toggle-knob"></span>
        </button>
        <span class="toggle-side">Top</span>
      </span>
    </div>
  </div>
  <p class="sheet-note">
    Text size, name size, portrait height and width, text padding and text
    position are this game's; button size is for every game. Changes show at
    once, and are kept when you save.
  </p>
  <div id="sheet-actions" class="sheet-actions">
    <button class="chip save-button" disabled>Save</button>
    <button class="chip reset-button" disabled>Reset</button>
    <button id="sheet-default" class="chip" disabled>Default</button>
  </div>`;

// Wires a slider to a size: it shows the size (as a percent, in its
// <output>) and changes it while dragged. The slider moves in 5% steps;
// a size set more exactly shows as it is until moved.
function linkSlider(
  id: string,
  get: () => number,
  set: (value: number) => void,
  listen: (callback: () => void) => void,
) {
  const slider = body.querySelector<HTMLInputElement>(`#${id}`)!;
  const output = slider.parentElement!.querySelector('output')!;
  const show = () => {
    const value = get();
    slider.value = String(value);
    output.value = `${Math.round(value * 100)}%`;
    // How far along the track the thumb is, for the filled part of the
    // track in settings-panel.css.
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
// Portrait height stops at its cap (see `backgroundYCap`): it shows the
// height in effect, and can't be dragged past it.
linkSlider(
  'sheet-background-y',
  () => Math.min(backgroundY.get(), backgroundYCap.get()),
  (y) => backgroundY.set(Math.min(y, backgroundYCap.get())),
  (callback) => {
    backgroundY.listen(callback);
    backgroundYCap.listen(callback);
  },
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
// Extra space on the side the text box grows from (see `TextStyle`).
linkSlider(
  'sheet-text-padding',
  () => textStyle.get().padding ?? 0,
  (padding) => textStyle.set({ ...textStyle.get(), padding }),
  textStyle.listen,
);

// Text position: a switch, on for "top" (see `TextStyle`). Clicking the
// words beside it works too.
const positionSwitch = body.querySelector<HTMLButtonElement>('#text-position')!;
const togglePosition = () => {
  if (!positionSwitch.disabled) {
    textStyle.set({
      ...textStyle.get(),
      position: textStyle.get().position === 'top' ? 'bottom' : 'top',
    });
  }
};
positionSwitch.addEventListener('click', togglePosition);
for (const side of positionSwitch.parentElement!.querySelectorAll(
  '.toggle-side',
)) {
  side.addEventListener('click', togglePosition);
}
textStyle.listen((style) =>
  positionSwitch.setAttribute('aria-checked', String(style.position === 'top')),
);

// The sizes are only saved when asked (the button size too, though it's
// for every game), so Save and Reset can be pressed while there are
// changes: Reset puts back the values as last saved. The game's sliders
// and switch are disabled while no game is picked.
const saveButton = body.querySelector<HTMLButtonElement>('.save-button')!;
const resetButton = body.querySelector<HTMLButtonElement>('.reset-button')!;
const gameControls = body.querySelectorAll<HTMLInputElement>(
  '#sheet-text-size, #sheet-name-size, #sheet-background-y, #sheet-background-width, #sheet-text-padding, #text-position',
);
function showSaveState({ hasGame, edited }: SaveState) {
  saveButton.disabled = !edited;
  resetButton.disabled = !edited;
  for (const control of gameControls) {
    control.disabled = !hasGame;
  }
}
saveButton.addEventListener('click', () => window.vn.saveProfile());
resetButton.addEventListener('click', () => window.vn.revertEdits());
window.vn.onSaveStateChanged(showSaveState);
window.vn.getSaveState().then(showSaveState);

// The Default button sets the default sizes (default-sizes.ts, also what a
// new game starts with), as unsaved changes, like moving the sliders: Save
// keeps them, Reset undoes them. It can be pressed while any size differs
// from these.
const defaultButton = body.querySelector<HTMLButtonElement>('#sheet-default')!;
defaultButton.addEventListener('click', () => {
  textStyle.set({ ...DEFAULT_TEXT_STYLE });
  backgroundY.set(DEFAULT_BACKGROUND_Y);
  backgroundWidth.set(DEFAULT_BACKGROUND_WIDTH);
  buttonSize.set(DEFAULT_BUTTON_SIZE);
});
function showDefaultState() {
  const style = textStyle.get();
  const atDefaults =
    style.size === DEFAULT_TEXT_STYLE.size &&
    style.nameSize === DEFAULT_TEXT_STYLE.nameSize &&
    style.position === DEFAULT_TEXT_STYLE.position &&
    (style.padding ?? 0) === DEFAULT_TEXT_STYLE.padding &&
    backgroundY.get() === DEFAULT_BACKGROUND_Y &&
    backgroundWidth.get() === DEFAULT_BACKGROUND_WIDTH &&
    buttonSize.get() === DEFAULT_BUTTON_SIZE;
  defaultButton.disabled = atDefaults;
}
textStyle.listen(showDefaultState);
backgroundY.listen(showDefaultState);
backgroundWidth.listen(showDefaultState);
buttonSize.listen(showDefaultState);
