/**
 * Input Settings, in the portrait's Menus sheet (a drop-down) and on the
 * picker's Style page: how taps reach the game, a switch between sending
 * messages (off) and simulating the mouse (on) (see win32.ts's `postClick`
 * and `sendClick`), and whether lines are read exactly from the game's
 * memory (memory-text.ts), with how finding them is going. Both are part of
 * the game's profile, so they're unsaved edits until Save, with their own
 * Save and Reset. Under them, buttons that bring
 * the game's window to the front or send it to the back. Each page has an
 * empty `#input-settings .input-body` that this fills, so the panel is
 * written once (styled by settings-panel.css).
 */

const container = document.querySelector<HTMLElement>('#input-settings')!;
const body = container.querySelector<HTMLElement>('.input-body')!;

body.innerHTML = `
  <div class="toggle-row">
    <span id="click-method-label">Taps click by</span>
    <span class="toggle">
      <span class="toggle-side">Messages</span>
      <button
        id="click-method"
        class="toggle-switch"
        role="switch"
        aria-checked="false"
        aria-labelledby="click-method-label"
        disabled
      >
        <span class="toggle-knob"></span>
      </button>
      <span class="toggle-side">Mouse</span>
    </span>
  </div>
  <p class="sheet-note">
    Messages click without moving the mouse or taking the game to the front;
    some games ignore them. Mouse moves the real pointer and clicks, which
    works in more games. This is the game's own setting, kept when you save.
  </p>
  <div class="toggle-row">
    <span id="text-from-memory-label">Exact text from the game</span>
    <span class="toggle">
      <span class="toggle-side">Off</span>
      <button
        id="text-from-memory"
        class="toggle-switch"
        role="switch"
        aria-checked="false"
        aria-labelledby="text-from-memory-label"
        disabled
      >
        <span class="toggle-knob"></span>
      </button>
      <span class="toggle-side">On</span>
    </span>
  </div>
  <p class="sheet-note">
    Reads each line from the game's memory once it's found there, so it's
    spelled exactly right, but only when it matches what's in the text box,
    so menus and other text never show. It takes two lines to find.
    <span id="memory-text-status"></span>
  </p>
  <div class="sheet-actions">
    <button class="chip save-button" disabled>Save</button>
    <button class="chip reset-button" disabled>Reset</button>
  </div>
  <div class="sheet-actions" id="game-window-actions">
    <button id="game-to-front" class="chip" disabled>Bring game to front</button>
    <button id="game-to-back" class="chip" disabled>Send game to back</button>
  </div>`;

const methodSwitch = body.querySelector<HTMLButtonElement>('#click-method')!;
const memorySwitch =
  body.querySelector<HTMLButtonElement>('#text-from-memory')!;
const memoryStatus = body.querySelector<HTMLElement>('#memory-text-status')!;

const isOn = (toggle: HTMLButtonElement) =>
  toggle.getAttribute('aria-checked') === 'true';

// A switch flips with a click on it or on the words beside it.
function onToggle(toggle: HTMLButtonElement, flip: () => void) {
  toggle.addEventListener('click', flip);
  for (const side of toggle.parentElement!.querySelectorAll('.toggle-side')) {
    side.addEventListener('click', () => {
      if (!toggle.disabled) {
        flip();
      }
    });
  }
}

const showMethod = (method: ClickMethod) =>
  methodSwitch.setAttribute('aria-checked', String(method === 'mouse'));

// Main sends the change back to every window, this one included.
onToggle(methodSwitch, () =>
  window.vn.setClickMethod(isOn(methodSwitch) ? 'message' : 'mouse'),
);

const showTextFromMemory = (on: boolean) =>
  memorySwitch.setAttribute('aria-checked', String(on));
onToggle(memorySwitch, () => window.vn.setTextFromMemory(!isOn(memorySwitch)));
window.vn.onTextFromMemoryChanged(showTextFromMemory);
window.vn.getTextFromMemory().then(showTextFromMemory);

// How finding the text is going.
const statusNotes: Record<MemoryTextStatus, string> = {
  found: 'Found: lines now come from the game.',
  searching: 'Looking for it…',
  'not-found': 'Not found in this game: lines come from OCR.',
  off: '',
};
const showMemoryStatus = (status: MemoryTextStatus) =>
  (memoryStatus.textContent = statusNotes[status]);
window.vn.onMemoryTextStatusChanged(showMemoryStatus);
window.vn.getMemoryTextStatus().then(showMemoryStatus);

body
  .querySelector('#game-to-front')!
  .addEventListener('click', () => window.vn.bringGameToFront());
body
  .querySelector('#game-to-back')!
  .addEventListener('click', () => window.vn.sendGameToBack());

window.vn.onClickMethodChanged(showMethod);
window.vn.getClickMethod().then(showMethod);

// Save and Reset while there are edits (the sizes' count too: they're all
// the game's unsaved edits); the switch and the window buttons need a game.
const saveButton = body.querySelector<HTMLButtonElement>('.save-button')!;
const resetButton = body.querySelector<HTMLButtonElement>('.reset-button')!;
const gameControls = body.querySelectorAll<HTMLButtonElement>(
  '#click-method, #text-from-memory, #game-to-front, #game-to-back',
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

// In the Menus sheet it's a drop-down, scrolled into view when opened.
if (container instanceof HTMLDetailsElement) {
  container.addEventListener('toggle', () => {
    if (container.open) {
      // Picking another game changes it too, which main sends as well; this
      // only catches up in case of a missed message.
      window.vn.getClickMethod().then(showMethod);
      window.vn.getTextFromMemory().then(showTextFromMemory);
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}
