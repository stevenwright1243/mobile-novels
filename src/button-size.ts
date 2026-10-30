/**
 * The "Button size" slider (picker window): the size of the portrait's
 * corner buttons (Menus and Log), as a multiple of normal. An app setting,
 * the same for every game, so it works before a game is picked. Changes go
 * to main, which passes them on to the portrait and saves them.
 */

const slider = document.querySelector<HTMLInputElement>('#button-size')!;
const percent = document.querySelector<HTMLOutputElement>(
  '#button-size-percent',
)!;

function showSize(size: number) {
  slider.value = String(size);
  percent.value = `${Math.round(size * 100)}%`;
}

// `input` fires continuously while dragging, so the portrait follows live.
slider.addEventListener('input', () => {
  showSize(slider.valueAsNumber);
  window.vn.setButtonSize(slider.valueAsNumber);
});

// It can also be changed in the portrait's Menus sheet.
window.vn.onButtonSizeChanged(showSize);
window.vn.getButtonSize().then(showSize);
