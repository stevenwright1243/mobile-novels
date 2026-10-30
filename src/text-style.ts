/**
 * Text style settings (picker window): the size of the text in the
 * portrait's message window, and the size for lines too long to fit at it
 * (see `TextStyle`). Each is a slider with an exact percent field. Changes
 * go to main, which passes them on to the portrait. Bigger text makes the
 * window taller, over the background picture; the picture itself never
 * moves because of the text.
 */

const sizeSlider = document.querySelector<HTMLInputElement>('#text-size')!;
const sizeField =
  document.querySelector<HTMLInputElement>('#text-size-percent')!;
const oversizedSlider =
  document.querySelector<HTMLInputElement>('#oversized-size')!;
const oversizedField = document.querySelector<HTMLInputElement>(
  '#oversized-size-percent',
)!;
const oversizedAuto =
  document.querySelector<HTMLInputElement>('#oversized-auto')!;
const shrinkNote = document.querySelector<HTMLElement>('#text-shrink-note')!;

// The size limits, matching the sliders' `min` and `max`.
const MIN_SIZE = Number(sizeSlider.min);
const MAX_SIZE = Number(sizeSlider.max);
const clampSize = (size: number) =>
  Math.min(MAX_SIZE, Math.max(MIN_SIZE, size));

let style: TextStyle = { size: 1, oversizedSize: null };
// The long-line size to go back to when "Auto" is unticked.
let lastOversizedSize = 0.8;
// Whether a game is picked, so there's something to adjust.
let enabled = false;

export function enableTextStyle() {
  enabled = true;
  showStyle();
}

// Shows the current style in the controls. `except` skips a field the user
// is typing in, so it isn't rewritten under them.
function showStyle(except?: HTMLInputElement) {
  const oversized = style.oversizedSize ?? lastOversizedSize;
  sizeSlider.value = String(style.size);
  oversizedSlider.value = String(oversized);
  if (sizeField !== except) {
    sizeField.value = String(Math.round(style.size * 100));
  }
  if (oversizedField !== except) {
    oversizedField.value = String(Math.round(oversized * 100));
  }
  oversizedAuto.checked = style.oversizedSize === null;

  sizeSlider.disabled = !enabled;
  sizeField.disabled = !enabled;
  oversizedAuto.disabled = !enabled;
  // With "Auto" ticked, the long-line size isn't used.
  oversizedSlider.disabled = !enabled || oversizedAuto.checked;
  oversizedField.disabled = !enabled || oversizedAuto.checked;
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
    if (size >= MIN_SIZE && size <= MAX_SIZE) {
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
linkSizeControls(oversizedSlider, oversizedField, (size, except) => {
  lastOversizedSize = clampSize(size);
  applyStyle({ ...style, oversizedSize: lastOversizedSize }, except);
});

oversizedAuto.addEventListener('change', () => {
  applyStyle({
    ...style,
    oversizedSize: oversizedAuto.checked ? null : lastOversizedSize,
  });
});

// A game's saved style arrives from main when it's picked.
function receiveStyle(newStyle: TextStyle) {
  style = newStyle;
  lastOversizedSize = style.oversizedSize ?? lastOversizedSize;
  showStyle();
}
window.vn.onTextStyleChanged(receiveStyle);
window.vn.getTextStyle().then(receiveStyle);

// A note while the portrait shows the current line smaller than the text
// size because it's too long. It goes away by itself with the next line
// that fits.
function showShrink(size: number | null) {
  shrinkNote.hidden = size === null;
  if (size !== null) {
    shrinkNote.textContent = `Long line: shown at ${Math.round(size * 100)}%`;
    shrinkNote.title =
      'This line is too long for the message window at your text size, so ' +
      'it was made smaller. The next line goes back to your size.';
  }
}
window.vn.onTextShrinkChanged(showShrink);
window.vn.getTextShrink().then(showShrink);
