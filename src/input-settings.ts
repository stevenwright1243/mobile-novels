/**
 * The Menus sheet's "Input Settings" drop-down: how taps reach the game, a
 * switch between sending messages (off) and simulating the mouse (on). The
 * same setting as the picker's "Taps click by" (see win32.ts's `postClick`
 * and `sendClick`), part of the game's profile, so it's an unsaved edit
 * until Save. Its Save and Reset buttons are wired with Sizes' in
 * menus-sheet.ts, which also disables the switch while no game is picked.
 */

const inputDropdown =
  document.querySelector<HTMLDetailsElement>('#input-settings')!;
const methodSwitch =
  document.querySelector<HTMLButtonElement>('#click-method')!;

const showMethod = (method: ClickMethod) =>
  methodSwitch.setAttribute('aria-checked', String(method === 'mouse'));

// Main sends the change back to every window, this one included.
const toggleMethod = () =>
  window.vn.setClickMethod(
    methodSwitch.getAttribute('aria-checked') === 'true' ? 'message' : 'mouse',
  );
methodSwitch.addEventListener('click', toggleMethod);
for (const side of methodSwitch.parentElement!.querySelectorAll(
  '.toggle-side',
)) {
  side.addEventListener('click', () => {
    if (!methodSwitch.disabled) {
      toggleMethod();
    }
  });
}

window.vn.onClickMethodChanged(showMethod);
window.vn.getClickMethod().then(showMethod);

inputDropdown.addEventListener('toggle', () => {
  if (inputDropdown.open) {
    // Picking another game changes it too, which main sends as well; this
    // only catches up in case of a missed message.
    window.vn.getClickMethod().then(showMethod);
    inputDropdown.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
