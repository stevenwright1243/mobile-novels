/**
 * Scrolling a box by dragging it (the portrait's full-screen page and, with
 * text position "top", its message window). A finger can drag a box that
 * scrolls, but on the phone, taps and drags may arrive as mouse input
 * (through Artemis and Apollo), and a mouse can only scroll a box with its
 * wheel, so dragging with the mouse scrolls it too. A drag isn't a tap: its
 * click is cancelled, so it doesn't move the game on.
 *
 * It also marks the box's scroll position with classes, for portrait.css:
 * `scrolled` once there's text above, `reading-back` while it isn't at the
 * end (the "tap to continue" arrow hides then, as it would sit over the
 * text).
 */

// How far (in CSS pixels) the pointer must move before it's a drag.
const DRAG_START = 8;

// Sets `scrolled` and `reading-back` on a box from where it's scrolled to.
// Call it after changing what's in the box, too: that doesn't fire `scroll`.
export function updateScrollState(box: HTMLElement) {
  const { scrollTop, scrollHeight, clientHeight } = box;
  box.classList.toggle('scrolled', scrollTop > 1);
  box.classList.toggle(
    'reading-back',
    scrollTop < scrollHeight - clientHeight - 1,
  );
}

export function dragToScroll(box: HTMLElement) {
  let drag: { y: number; top: number; moved: boolean } | null = null;
  let dragged = false;

  box.addEventListener('pointerdown', (event) => {
    // A new press: a drag that ended without a click (it can) mustn't
    // swallow this one's.
    dragged = false;
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return;
    }
    drag = { y: event.clientY, top: box.scrollTop, moved: false };
    // Keeps the moves coming here even if the pointer leaves the box.
    box.setPointerCapture(event.pointerId);
  });

  box.addEventListener('pointermove', (event) => {
    if (!drag) {
      return;
    }
    const moved = event.clientY - drag.y;
    drag.moved ||= Math.abs(moved) > DRAG_START;
    if (drag.moved) {
      box.scrollTop = drag.top - moved;
    }
  });

  const endDrag = () => {
    dragged = drag?.moved ?? false;
    drag = null;
  };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  // A click that ends a drag stops here, before any tap handler sees it,
  // whether it's on the box itself or around it. `capture` runs this first.
  box.addEventListener(
    'click',
    (event) => {
      if (dragged) {
        event.stopImmediatePropagation();
        dragged = false;
      }
    },
    { capture: true },
  );

  box.addEventListener('scroll', () => updateScrollState(box));
}
