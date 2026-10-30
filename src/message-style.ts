/**
 * The picker's Style settings: the portrait message window's border and
 * "tap to continue" arrow. An app setting, the same for every game. Changes
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
