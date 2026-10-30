/**
 * Every shape of the message window's "tap to continue" arrow (picked in
 * Style settings or the Menus sheet), as HTML. Each arrow element holds all
 * of them, and CSS (reader.css) shows the picked one: the portrait's own
 * arrow, the Menus sheet's samples and the Sizes sample (in both windows).
 * Kept here so there's one copy of them.
 */

export const ARROW_SHAPES = `
<svg class="chevron" viewBox="0 0 24 24">
  <path d="M5 9l7 7 7-7" />
</svg>
<span class="dots"><i></i><i></i><i></i></span>
<span class="triangle"></span>
<span class="ember"></span>
<span class="drop"></span>
<!-- A big heart and a small one, like MiSide's menu cursor. -->
<svg class="hearts" viewBox="0 0 32 32">
  <path
    transform="translate(0 2) rotate(-12 10 12) scale(0.85)"
    d="M12 21s-7.5-4.6-9.6-9.2C.9 8.2 3.2 4.5 6.8 4.5c2.1 0 3.6 1.2 4.2 2.6.6-1.4 2.1-2.6 4.2-2.6 3.6 0 5.9 3.7 4.4 7.3C19.5 16.4 12 21 12 21z"
  />
  <path
    transform="translate(16 15) rotate(12 7 7) scale(0.6)"
    d="M12 21s-7.5-4.6-9.6-9.2C.9 8.2 3.2 4.5 6.8 4.5c2.1 0 3.6 1.2 4.2 2.6.6-1.4 2.1-2.6 4.2-2.6 3.6 0 5.9 3.7 4.4 7.3C19.5 16.4 12 21 12 21z"
  />
</svg>
<!-- A bloody knife (SVG Repo's "knife blood"), mirrored left to
     right so the blade points into the corner. -->
<svg class="knife" viewBox="0 0 24 24">
  <path
    transform="matrix(-1 0 0 1 24 0)"
    d="M4.342 1.408L22.373 19.44a1.5 1.5 0 0 1-2.121 2.122l-4.596-4.597L12.12 20.5 8 16.38V19a1 1 0 0 1-2 0v-4a1 1 0 0 0-1.993-.117L4 15v1a1 1 0 0 1-2 0V7.214a7.976 7.976 0 0 1 2.168-5.627l.174-.179zm.241 3.07l-.051.11a5.993 5.993 0 0 0-.522 2.103L4 7l-.001.12a5.984 5.984 0 0 0 1.58 4.003l.177.185 6.363 6.363 2.829-2.828L4.583 4.478z"
  />
</svg>
`;
