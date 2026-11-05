/**
 * The history log (portrait window): a pop-up that shows the last lines read
 * (kept by main, up to 30), each with who said it, one at a time, with big buttons to step back and
 * forward. It opens on the line before the newest (the newest is still showing
 * in the text box). Opening it takes a snapshot, so new
 * lines arriving while you read don't shift what you're looking at.
 */

const logButton = document.querySelector<HTMLButtonElement>('#log-button')!;
const log = document.querySelector<HTMLDialogElement>('#log')!;
const closeButton = document.querySelector<HTMLButtonElement>('#log-close')!;
const olderButton = document.querySelector<HTMLButtonElement>('#log-older')!;
const newerButton = document.querySelector<HTMLButtonElement>('#log-newer')!;
const count = document.querySelector<HTMLElement>('#log-count')!;
const speaker = document.querySelector<HTMLElement>('#log-speaker')!;
const text = document.querySelector<HTMLElement>('#log-text')!;

// The lines as they were when the log was opened, oldest first, and which
// one is showing.
let lines: HistoryEntry[] = [];
let index = 0;

function showLine() {
  if (lines.length === 0) {
    count.textContent = '';
    speaker.textContent = '';
    text.textContent = 'Nothing yet: lines appear here once they’ve been read.';
  } else {
    count.textContent = `${index + 1} / ${lines.length}`;
    // Empty for narration, which hides the name (portrait.css).
    speaker.textContent = lines[index].speaker;
    text.textContent = lines[index].line;
    // The same gentle fade-in as the message window.
    text.animate(
      [
        { opacity: 0, translate: '0 0.3rem' },
        { opacity: 1, translate: '0 0' },
      ],
      { duration: 180, easing: 'ease-out' },
    );
  }
  olderButton.disabled = index <= 0;
  newerButton.disabled = index >= lines.length - 1;
}

logButton.addEventListener('click', async () => {
  lines = await window.vn.getTextHistory();
  // Open on the line before the newest: the newest is still on screen in the
  // text box, so the one before it is the one you'd want to look back at.
  // Math.max keeps it at 0 when there are fewer than two lines.
  index = Math.max(0, lines.length - 2);
  showLine();
  // `showModal()` opens the dialog on top of everything, with a backdrop, and
  // blocks taps to the page underneath (so nothing reaches the game).
  log.showModal();
});

olderButton.addEventListener('click', () => {
  index = Math.max(0, index - 1);
  showLine();
});

newerButton.addEventListener('click', () => {
  index = Math.min(lines.length - 1, index + 1);
  showLine();
});

closeButton.addEventListener('click', () => log.close());
