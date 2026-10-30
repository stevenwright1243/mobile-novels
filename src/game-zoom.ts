/**
 * Zooming into the whole game in Menus mode: pinch with two fingers (or
 * turn the mouse wheel) to zoom in on part of it, and drag to move around,
 * so small menu text and buttons can be shown big. portrait.ts draws the
 * game and maps taps through `zoomedPlace()`, so taps land on what's shown.
 *
 * On the phone, two fingers only arrive as two touches when Artemis is in
 * touchscreen mode; in its trackpad mode, a two-finger drag arrives as the
 * mouse wheel, which zooms too.
 *
 * Just for now, not saved: portrait.ts resets it when Menus mode is left or
 * another game is picked.
 */

// How far in it can zoom, as times the whole-game size.
const MAX_ZOOM = 4;
// How far (in CSS pixels) a finger or the mouse must move before it's a
// drag rather than a tap.
const DRAG_START = 8;
// How much the wheel zooms, per pixel of its `deltaY`.
const WHEEL_ZOOM = 0.002;
// The zoom pad's steps (zoom-pad.ts): each zoom tap zooms by √2, so two
// taps double it and four go from the whole game to the most (4×); each
// move tap goes half of what's shown, so part of the last view stays in
// sight and you don't lose your place.
const ZOOM_STEP = Math.SQRT2;
const MOVE_STEP = 0.5;

// How far in (1 = the whole game), and the point of the game (as fractions
// of it) at the middle of the slot.
let zoom = { scale: 1, cx: 0.5, cy: 0.5 };

// Where the game is now, from portrait.ts (see `zoomByGestures`).
let currentPlace: () => Place | null = () => null;

const listeners: (() => void)[] = [];

// Called whenever the zoom or the part shown changes.
export function onZoomChanged(listener: () => void) {
  listeners.push(listener);
}

function setZoom(next: typeof zoom) {
  zoom = next;
  for (const listener of listeners) {
    listener();
  }
}

export function resetZoom() {
  setZoom({ scale: 1, cx: 0.5, cy: 0.5 });
}

// A box on the canvas, in its pixels.
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Where the game lands in the slot's `box` at the current zoom, given its
// size at 1× (`dw` × `dh`, the whole game fitted in). Zoomed in, it's never
// moved so far that space shows beside it in the slot.
export function zoomedPlace(box: Box, dw: number, dh: number, at = zoom) {
  const width = dw * at.scale;
  const height = dh * at.scale;
  return {
    dx: box.x + along(box.width, width, at.cx),
    dy: box.y + along(box.height, height, at.cy),
    dw: width,
    dh: height,
  };
}

// Where a picture `size` long starts in `room`, with the point `middle` of
// the way along it at the room's middle: centered when it fits, otherwise
// held so it always covers the room.
function along(room: number, size: number, middle: number) {
  if (size <= room) {
    return (room - size) / 2;
  }
  return Math.min(0, Math.max(room - size, room / 2 - middle * size));
}

// Where the game is now (from portrait.ts): the slot's box and the game's
// place in it, in canvas pixels.
export interface Place {
  box: Box;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

interface Point {
  x: number;
  y: number;
}

// Zooms by `factor` and moves, so the point of the game that was at `from`
// (canvas pixels) ends up at `to`. Panning is a factor of 1; the wheel zooms
// with `from` and `to` the same.
function moveZoom(place: Place, from: Point, to: Point, factor: number) {
  const { box, dx, dy, dw, dh } = place;
  // The game's size at 1×.
  const baseWidth = dw / zoom.scale;
  const baseHeight = dh / zoom.scale;
  // The point of the game under `from`, as fractions of it.
  const gx = (from.x - dx) / dw;
  const gy = (from.y - dy) / dh;
  let scale = Math.min(MAX_ZOOM, Math.max(1, zoom.scale * factor));
  // Steps of √2 don't land exactly back on 1× or on the most (rounding).
  if (scale < 1.001) {
    scale = 1;
  } else if (scale > MAX_ZOOM - 0.001) {
    scale = MAX_ZOOM;
  }
  const width = baseWidth * scale;
  const height = baseHeight * scale;
  // Put that point at `to`, and see which point that leaves in the middle
  // of the slot.
  const middleX = box.x + box.width / 2;
  const middleY = box.y + box.height / 2;
  const wanted = {
    scale,
    cx: (middleX - (to.x - gx * width)) / width,
    cy: (middleY - (to.y - gy * height)) / height,
  };
  // Moved past an edge, the picture is held there (`along`), so keep the
  // middle point it's really held at: otherwise dragging back would first
  // have to undo the overshoot.
  const held = zoomedPlace(box, baseWidth, baseHeight, wanted);
  setZoom({
    scale,
    cx: (middleX - held.dx) / held.dw,
    cy: (middleY - held.dy) / held.dh,
  });
}

// The zoom pad's buttons (zoom-pad.ts). Zooms in (`steps` 1) or out (-1)
// around the middle of what's shown.
export function zoomStep(steps: number) {
  const place = currentPlace();
  if (place) {
    const middle = middleOf(place.box);
    moveZoom(place, middle, middle, ZOOM_STEP ** steps);
  }
}

// Moves what's shown right (`x` 1), left (-1), down (`y` 1) or up (-1).
export function moveStep(x: number, y: number) {
  const place = currentPlace();
  if (place) {
    const { box } = place;
    const middle = middleOf(box);
    // Seeing more to the right means moving the picture left.
    moveZoom(
      place,
      middle,
      {
        x: middle.x - x * box.width * MOVE_STEP,
        y: middle.y - y * box.height * MOVE_STEP,
      },
      1,
    );
  }
}

function middleOf(box: Box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// For the zoom pad: the zoom, and which ways it can still go (a direction
// is false at that edge of the game, and every one at 1×).
export function zoomState() {
  const ways = { left: false, right: false, up: false, down: false };
  const place = currentPlace();
  if (place) {
    const { box, dx, dy, dw, dh } = place;
    // Part of the game hidden past each edge of the slot (with half a
    // pixel's leeway, for rounding).
    ways.left = dx < box.x - 0.5;
    ways.right = dx + dw > box.x + box.width + 0.5;
    ways.up = dy < box.y - 0.5;
    ways.down = dy + dh > box.y + box.height + 0.5;
  }
  return {
    scale: zoom.scale,
    zoomIn: zoom.scale < MAX_ZOOM,
    zoomOut: zoom.scale > 1,
    ...ways,
  };
}

// Pinching, dragging and the wheel on the canvas the game is drawn on.
// `place` gives where the game is now (null outside Menus mode, which turns
// this off), and `toCanvas` a pointer's position in the canvas's pixels.
export function zoomByGestures(
  canvas: HTMLCanvasElement,
  place: () => Place | null,
  toCanvas: (event: MouseEvent) => Point,
) {
  // The zoom pad uses it too.
  currentPlace = place;
  // The fingers (or the mouse button) down on the canvas, where each was
  // last seen.
  const pointers = new Map<number, Point>();
  // Where the first one went down, and whether it has moved far enough to
  // be a drag.
  let start: Point = { x: 0, y: 0 };
  let moved = false;
  // True once a pinch or drag happened in this press: its click is no tap.
  let gestured = false;

  const inSlot = ({ x, y }: Point, { box }: Place) =>
    x >= box.x &&
    x <= box.x + box.width &&
    y >= box.y &&
    y <= box.y + box.height;

  canvas.addEventListener('pointerdown', (event) => {
    const now = place();
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    if (pointers.size === 0) {
      // A new press: a gesture that ended without a click (it can) mustn't
      // swallow this one's.
      gestured = false;
      moved = false;
    }
    const point = toCanvas(event);
    if (!now || !inSlot(point, now)) {
      return;
    }
    if (pointers.size === 0) {
      start = point;
    }
    pointers.set(event.pointerId, point);
    // Keeps the moves coming here even if the finger leaves the canvas.
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    const last = pointers.get(event.pointerId);
    const now = place();
    if (!last || !now) {
      return;
    }
    const point = toCanvas(event);
    const [first, second] = [...pointers.keys()];
    if (
      second !== undefined &&
      (event.pointerId === first || event.pointerId === second)
    ) {
      // Pinching: zoom by how much the fingers spread, and move with the
      // point between them.
      const other = pointers.get(event.pointerId === first ? second : first)!;
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(point.x - other.x, point.y - other.y);
      if (before > 0) {
        moveZoom(
          now,
          { x: (last.x + other.x) / 2, y: (last.y + other.y) / 2 },
          { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 },
          after / before,
        );
      }
      gestured = true;
    } else if (pointers.size === 1 && zoom.scale > 1) {
      // Dragging, once zoomed in: move around the game.
      const cssPixel = canvas.width / canvas.clientWidth;
      moved ||=
        Math.hypot(point.x - start.x, point.y - start.y) >
        DRAG_START * cssPixel;
      if (moved) {
        moveZoom(now, last, point, 1);
        gestured = true;
      }
    }
    pointers.set(event.pointerId, point);
  });

  const lift = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);

  // A click that ends a pinch or drag stops here, before the tap handler
  // sees it, so it doesn't click the game. `capture` runs this first.
  canvas.addEventListener(
    'click',
    (event) => {
      if (gestured) {
        event.stopImmediatePropagation();
        gestured = false;
      }
    },
    { capture: true },
  );

  // The wheel zooms around the pointer. `passive: false` lets it stop the
  // page from scrolling instead.
  canvas.addEventListener(
    'wheel',
    (event) => {
      const now = place();
      const point = toCanvas(event);
      if (!now || !inSlot(point, now)) {
        return;
      }
      event.preventDefault();
      moveZoom(now, point, point, Math.exp(-event.deltaY * WHEEL_ZOOM));
    },
    { passive: false },
  );
}
