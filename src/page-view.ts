/**
 * The page of full-screen text in the portrait: every paragraph read from
 * the game's page region, with the ones already read dimmed and the new ones
 * bright, scrolled to the newest. Each new paragraph also goes to main as a
 * line, so the history log gets it once (see `whatsNew`).
 */

const pageText = document.querySelector<HTMLElement>('#page-text')!;

// The paragraphs on the page, as last read, and where the new ones start.
let shown: string[] = [];
let newFrom = 0;

// How many letters must change to turn one text into the other (the "edit
// distance"), worked out a row at a time.
function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[b.length];
}

// Whether two reads are the same paragraph: each read of a page can differ
// by a letter or two (OCR), so they only have to be this alike.
const SAME_PARAGRAPH = 0.85;
const alike = (a: string, b: string) =>
  1 - distance(a, b) / Math.max(a.length, b.length, 1) >= SAME_PARAGRAPH;

// What's new on the page since the last read: the index of the first new
// paragraph, and the new text as history entries, one per paragraph.
//  - The old paragraphs are all still there: the rest are new (the game
//    added a paragraph, the usual case).
//  - The last old one grew: the game added to that paragraph, and only the
//    added part is new.
//  - Anything else is a new page: all of it is new.
function whatsNew(old: string[], page: string[]) {
  let same = 0;
  while (
    same < old.length &&
    same < page.length &&
    alike(old[same], page[same])
  ) {
    same++;
  }
  if (same === old.length) {
    return { from: same, entries: page.slice(same) };
  }
  const last = old[same];
  const grown = page[same] ?? '';
  if (
    same === old.length - 1 &&
    grown.length > last.length &&
    alike(last, grown.slice(0, last.length))
  ) {
    return {
      from: same,
      entries: [grown.slice(last.length).trim(), ...page.slice(same + 1)],
    };
  }
  return { from: 0, entries: page };
}

// Shows a read of the page: its paragraphs separated by a blank line, as
// the page reader sends them ('' when the page is empty).
export function showPage(text: string) {
  const page = text === '' ? [] : text.split('\n\n');
  const { from, entries } = whatsNew(shown, page);
  for (const entry of entries.filter((entry) => entry !== '')) {
    window.vn.setTextLine(entry);
  }
  // A read with nothing new (the same page again) keeps what was bright.
  if (entries.length > 0 || page.length < shown.length) {
    newFrom = from;
  }
  shown = page;
  draw();
}

function draw() {
  const paragraphs = shown.map((text, i) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    paragraph.classList.toggle('read', i < newFrom);
    return paragraph;
  });
  pageText.replaceChildren(...paragraphs);
  const first = paragraphs[newFrom];
  if (!first) {
    return;
  }
  // The new paragraphs fade in, like the message window's lines.
  for (const paragraph of paragraphs.slice(newFrom)) {
    paragraph.animate(
      [
        { opacity: 0, translate: '0 0.3rem' },
        { opacity: 1, translate: '0 0' },
      ],
      { duration: 220, easing: 'ease-out' },
    );
  }
  // Scrolled to the bottom, unless the new text doesn't fit: then to where
  // it starts, so it's read from its beginning.
  const bottom = pageText.scrollHeight - pageText.clientHeight;
  const newTop =
    first.offsetTop - parseFloat(getComputedStyle(pageText).paddingTop);
  pageText.scrollTo({ top: Math.min(bottom, newTop), behavior: 'smooth' });
}

// --- Scrolling by dragging ----------------------------------------------------
//
// When the page is taller than its box, it scrolls. A finger can drag it,
// but on the phone, taps and drags may arrive as mouse input (through
// Artemis and Apollo), and a mouse can only scroll a box with its wheel, so
// dragging with the mouse scrolls it too. A drag isn't a tap: its click is
// cancelled, so it doesn't move the game on.

// How far (in CSS pixels) the pointer must move before it's a drag.
const DRAG_START = 8;
let drag: { y: number; top: number; moved: boolean } | null = null;
let dragged = false;

pageText.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0) {
    return;
  }
  drag = { y: event.clientY, top: pageText.scrollTop, moved: false };
  // Keeps the moves coming here even if the pointer leaves the page.
  pageText.setPointerCapture(event.pointerId);
});

pageText.addEventListener('pointermove', (event) => {
  if (!drag) {
    return;
  }
  const moved = event.clientY - drag.y;
  drag.moved ||= Math.abs(moved) > DRAG_START;
  if (drag.moved) {
    pageText.scrollTop = drag.top - moved;
  }
});

const endDrag = () => {
  dragged = drag?.moved ?? false;
  drag = null;
};
pageText.addEventListener('pointerup', endDrag);
pageText.addEventListener('pointercancel', endDrag);

// A click that ends a drag stops here, before the page's tap handler
// (portrait.ts) sees it. `capture` runs this first.
pageText.addEventListener(
  'click',
  (event) => {
    if (dragged) {
      event.stopPropagation();
      dragged = false;
    }
  },
  { capture: true },
);

// The fade at the top edge, while there's text above, and no arrow while
// scrolled back from the end (it would sit over the text; portrait.css).
const textZone = document.querySelector<HTMLElement>('#text-zone')!;
pageText.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = pageText;
  pageText.classList.toggle('scrolled', scrollTop > 1);
  textZone.classList.toggle(
    'reading-back',
    scrollTop < scrollHeight - clientHeight - 1,
  );
});

// Drawn again when the page comes into view, as it can't be scrolled while
// it's hidden.
export const redrawPage = draw;
