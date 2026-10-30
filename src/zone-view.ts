/**
 * How a region is scaled and positioned inside a portrait zone (see
 * `ZoneView`). Shared by the portrait, which draws with it and maps taps
 * back through it, and the picker, which outlines the part that's shown.
 */

// How the background is zoomed and positioned in the portrait, for every
// game: 20% of the way from "show all" to "fill", centered left to right, and
// 20% of the way down. Fixed on purpose (the user's chosen layout, which the
// text box is tuned against; see portrait-layout.md), so there are no
// settings for it. Used by the portrait and the picker's "Portrait view".
export const BACKGROUND_VIEW: ZoneView = { fill: 0.2, x: 0.5, y: 0.2 };

// The whole region fits, centered, with space around it if the shapes
// differ. Used for the text box picture, where no text may be cut off.
export const SHOW_ALL: ZoneView = { fill: 0, x: 0.5, y: 0.5 };

// Where a region of size `sw` × `sh` lands in a zone of size `width` ×
// `height` (any units, as long as each pair matches): its scale, top-left
// corner (`dx`, `dy`) and size (`dw`, `dh`). Parts outside the zone are
// trimmed when drawn.
export function placeInZone(
  sw: number,
  sh: number,
  width: number,
  height: number,
  view: ZoneView,
) {
  // The scale that shows it all, and the one that fills the zone.
  const showAll = Math.min(width / sw, height / sh);
  const fill = Math.max(width / sw, height / sh);
  // Blend between them. Blending the powers (rather than the scales
  // themselves) makes each step of the slider zoom by the same amount.
  const scale = showAll * (fill / showAll) ** view.fill;
  const dw = sw * scale;
  const dh = sh * scale;
  // `x` / `y` line it up: 0 = left / top edges together, 1 = right / bottom.
  // Bigger than the zone, that chooses which part shows; smaller, it chooses
  // where the picture sits in the space.
  const dx = (width - dw) * view.x;
  const dy = (height - dh) * view.y;
  return { scale, dx, dy, dw, dh };
}
