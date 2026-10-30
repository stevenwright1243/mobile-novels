/**
 * Text style settings (picker window): the size of the text in the
 * portrait's message window, and the size of the speaker's name tag (see
 * `TextStyle`). Each is a slider with an exact percent field. Changes
 * go to main, which passes them on to the portrait. Bigger text makes the
 * window taller, over the background picture; the picture itself never
 * moves because of the text.
 */

const sizeSlider = document.querySelector<HTMLInputElement>('#text-size')!;
const sizeField =
  document.querySelector<HTMLInputElement>('#text-size-percent')!;
const nameSlider = document.querySelector<HTMLInputElement>('#name-size')!;
const nameField =
  document.querySelector<HTMLInputElement>('#name-size-percent')!;

// Keeps a size within a slider's limits (its `min` and `max`).
const clampTo = (slider: HTMLInputElement, size: number) =>
  Math.min(Number(slider.max), Math.max(Number(slider.min), size));
const clampSize = (size: number) => clampTo(sizeSlider, size);

let style: TextStyle = { size: 1, nameSize: 1 };
// Whether a game is picked, so there's something to adjust.
let enabled = false;

export function enableTextStyle() {
  enabled = true;
  showStyle();
}

// Shows the current style in the controls. `except` skips a field the user
// is typing in, so it isn't rewritten under them.
function showStyle(except?: HTMLInputElement) {
  sizeSlider.value = String(style.size);
  nameSlider.value = String(style.nameSize);
  if (sizeField !== except) {
    sizeField.value = String(Math.round(style.size * 100));
  }
  if (nameField !== except) {
    nameField.value = String(Math.round(style.nameSize * 100));
  }

  sizeSlider.disabled = !enabled;
  sizeField.disabled = !enabled;
  nameSlider.disabled = !enabled;
  nameField.disabled = !enabled;
}

function applyStyle(newStyle: TextStyle, except?: HTMLInputElement) {
  style = newStyle;
  window.vn.setTextStyle(style);
  showStyle(except);
}

// Wires up a slider and its percent field to one size setting. `input` fires
// continuously while dragging, so the portrait follows live.
//
// Typing applies as you go, but only values in range: on the way to "150",
// the "1" and "15" typed first are out of range and are skipped, instead of
// jumping the text to the smallest size. Pressing Enter or leaving the field
// (`change`) applies what's there, kept in range, and tidies the field.
function linkSizeControls(
  slider: HTMLInputElement,
  field: HTMLInputElement,
  apply: (size: number, except?: HTMLInputElement) => void,
) {
  slider.addEventListener('input', () => apply(slider.valueAsNumber));
  field.addEventListener('input', () => {
    const size = field.valueAsNumber / 100;
    if (size >= Number(slider.min) && size <= Number(slider.max)) {
      apply(size, field);
    }
  });
  field.addEventListener('change', () => {
    if (Number.isFinite(field.valueAsNumber)) {
      apply(field.valueAsNumber / 100);
    }
    showStyle();
  });
}

linkSizeControls(sizeSlider, sizeField, (size, except) =>
  applyStyle({ ...style, size: clampSize(size) }, except),
);

linkSizeControls(nameSlider, nameField, (size, except) =>
  applyStyle({ ...style, nameSize: clampTo(nameSlider, size) }, except),
);

// A game's saved style arrives from main when it's picked.
function receiveStyle(newStyle: TextStyle) {
  style = newStyle;
  showStyle();
}
window.vn.onTextStyleChanged(receiveStyle);
window.vn.getTextStyle().then(receiveStyle);
