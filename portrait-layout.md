# Portrait layout reference

The sizes and positions of everything in the portrait view (what the phone
sees), in one place. Read this before tuning the layout, especially the text
box, which is meant to be adjusted against the background defaults below.

Percentages are what the picker's sliders and boxes show. "vw" is a percent of
the portrait's width, so sizes follow the screen; "vmin" is a percent of its
shorter side (the width, in portrait); `clamp(min, preferred, max)` keeps them
within limits.

A cap in `rem`/px doesn't mean the same size everywhere: the phone's display
(from Apollo) has the phone's full pixel count at 100% scaling, so it's about
twice as many CSS pixels wide as the portrait window on the PC (150%), and a
`rem` cap that's reached there looks small.

## Background (width and height per game)

The background fills the whole portrait. The message window lies over its
bottom, and never moves it.

| Setting        | Default | Meaning                                                                                                                           |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Portrait width | **75%** | How much of the background region's width shows, 50–100%: 100% = all of it, 50% = the middle half, twice as big                   |
| Left ↔ Right   | **50%** | 0% = left edges together, 50% = centered, 100% = right edges together                                                             |
| Top ↔ Bottom   | **20%** | 0% = top edges together, 100% = bottom edges together. At 20% a zoomed-out picture sits near the top, clear of the message window |

- Left ↔ Right is **fixed in code** (centered): `BACKGROUND_VIEW` in
  `src/zone-view.ts`.
- Portrait width is the **Portrait width** slider (picker: 50–100% in 1%
  steps with a percent field; Menus sheet: 5% steps), saved per game
  (`backgroundWidth`). `BACKGROUND_VIEW.width` (75%) is the default.
  Measured as a share of the width, so a given % looks the same in every
  game. (Until 2026-10-30 the zoom was fixed for every game, 20% of the way
  from "show all" to "fill", which showed 74% of Aokana's width, 77% of You
  and Me and Her's and 79% of Katawa Shoujo's.)
- Top ↔ Bottom is the picker's **Portrait height** slider (0–100%), saved
  per game in its profile (`backgroundY`; slider in
  `src/background-view.ts`). `BACKGROUND_VIEW.y` (20%) is the default for a
  game that hasn't set one. Older profiles' saved `backgroundView` (all three
  values) is ignored.
- Space around a zoomed-out picture shows a blurred copy of it, washed with
  the theme's `--backdrop-tint` (in `src/theme.css`; pale sky in Aokana).
- `placeInZone()` zooms by `width` when a view has one (the background),
  otherwise by `fill`, blended between "show all" and "fill" evenly.

## Text (per game, saved in the profile)

| Setting   | Default | Range   | Meaning                                                                                                 |
| --------- | ------- | ------- | ------------------------------------------------------------------------------------------------------- |
| Text size | 100%    | 60–200% | Multiplies the base size below                                                                          |
| Name size | 100%    | 50–200% | Multiplies the name tag's size (both modes). Relative to the text size, so it grows and shrinks with it |

- **Base size (100%):** `clamp(1.6875rem, 7.5vw, 3rem)` = `--base-font-size` at
  the top of `portrait.css`. Raised by half from the original
  `clamp(1.125rem, 5vw, 2rem)`, so 100% now equals the old 150%.
- Font: Nunito, weight 600, line height 1.55.

## Message window

- **Text padding** (per game, the Menus sheet's slider, 0–100%, default
  0%): adds `Text padding × 20%` of the screen's height to the gap on the
  side the window grows from: below it with Bottom (on top of the usual
  bottom gap), between the picture and it with Top (and the Portrait
  height cap leaves room for it). 0% keeps both usual gaps.
- **Position** (per game, the Menus sheet's Text position): **Bottom**
  (default) puts it at the bottom of the screen, growing upward as the text
  gets longer or bigger. **Top** hangs it just under the picture's bottom
  edge, a `clamp(0.5rem, 3vw, 1rem)` gap below it, growing downward. The
  name tag's room above the window is always kept there (invisible during
  narration), so the window's top edge never moves when a name comes or
  goes. Never
  above the corner buttons' row. It grows down to the screen's usual
  bottom gap; past that, the window scrolls (drag it, by finger or mouse;
  the arrow hides until you're back at the end, and each new line starts
  at its top). It's never shorter than 3 lines: with Top, **Portrait
  height is capped** so the picture always leaves room under it for the
  name tag and 3 lines (worked out from the screen, picture and text size,
  so the cap moves with them; the Menus slider stops there). Bottom has no
  cap. (Before 2026-10-30: it stopped at 60% of the way down, then at the
  screen's bottom with no scrolling.)

- **Height:** room for **3 lines** at the chosen text size, plus padding.
- **Padding:** `clamp(0.9rem, 4.5vw, 1.6rem)` top and bottom,
  `clamp(1.1rem, 5.5vw, 2rem)` left and right.
- **Gap to the portrait's edges:** `clamp(0.5rem, 3vw, 1rem)` at the sides, so
  it floats. At the bottom, at least 5% of the portrait's height
  (`max(gap, 5dvh)`), so it sits up off the edge, clear of the phone's gesture
  bar. (Before 2026-10-29: the same as the sides.)
- **Corners:** rounded `max(0.75rem, 3vmin)` (`.glass`, shared with the
  history log's card).
- Look: frosted glass (`.glass`), coloured by the theme (Style settings ›
  Theme; see `src/theme.css`). Corners are `max(0.75rem, 3vmin)` × the
  theme's `--corner`; the glass blur is its `--glass-blur`. The edge and the "tap to continue"
  arrow are picked in the picker's **Style settings** (an app setting, the
  same for every game):
  - Border: **Halo** (default; a soft accent glow all round, slowly breathing),
    **Turning rim** (a 5px gradient ring that turns once every 6s), or
    **Ribbon** (the original 3px accent ribbon on the top edge), or **None**
    (just the glass).
  - The You and Me and Her theme has no glass: the whole text zone fades from
    clear to white (3rem of fade above the text), edge to edge and down to the
    bottom of the screen, with a thin (2px) chevron. Picking that theme picks
    border None and the chevron.
  - Arrow: **Chevron** (default; a rounded ⌄ that bobs), **Dots** (three dots
    hopping in turn), **Triangle** (the original bobbing ▼), or **Hearts** (a
    big heart and a small one, like MiSide's menu cursor, beating gently;
    1.3em; picked automatically with the MiSide theme), **Ember** (a glowing
    accent dot that pulses), **Drop** (a drop that forms, falls 0.12em and
    fades; it never leaves the window), **Knife** (a bloody knife, mirrored
    so the blade points right, in the theme's deep accent; 1em; bobs like the
    chevron), or **None** (no arrow).
  - The Miyuki's Realm theme gives every glass panel a bevelled frame: a 3px
    light rim with a 1px accent groove inside it. Picking that theme picks
    border None and the triangle.
  - The arrow (`#next-arrow`) is sized in `em` of the chosen text size and
    sits `clamp(0.75rem, 3.5vw, 1.25rem)` in from the window's right edge,
    `clamp(0.5rem, 2.5vw, 0.9rem)` up from its bottom.
  - Set in the "Message window styles" section of `src/portrait.css`.

## Name tag

The speaker's name (`#name-tag` in `src/portrait.css`), read by OCR from the
game's name box (the `name` region, per game).

- **Text mode:** a solid accent pill (`--accent` → `--accent-deep`, text in
  `--on-accent`, corners `--pill`) with a small dot before the name, inset
  `clamp(0.75rem, 4vw, 1.5rem)` from the window's left edge and overlapping
  its top edge by `0.6em`. Text **72%** of the chosen text size × Name size, bold (padding, overlap and dot are in `em`, so they scale with it),
  padding `0.15em 1.1em 0.2em 0.9em`, at most 80% of the width (longer names
  end in "…"), all times the **Name size** slider. It pops in with a short slide from the left on each new
  speaker, and is hidden while the name box is empty (narration), so the
  window doesn't move either way (the text zone grows upwards).
  - You and Me and Her: plain accent-coloured text on the haze, no pill.
  - Miyuki's Realm: the same bevelled frame as its glass panels.
- **Image mode:** the name box's picture, shaped like the name region,
  `1.5 ×` the base text size × Name size tall (at most 70% of the width), sitting on the
  text box's top edge, `clamp(0.5rem, 3vw, 1rem)` from the left.
- Tapping it clicks the game's text box, like the message window.

## Menus mode

- The game, whole, sits just under the corner buttons (the buttons' row:
  `2 × corner gap + max(48px, 2.2 × button text size)`), full width at its
  own shape, at most **55%** of the portrait's height (`#game-slot`).
  Pinch (or the mouse wheel) zooms into it, up to **4×**, and a drag moves
  around; the game stays inside the slot (`src/game-zoom.ts`).
- At the top of the sheet, the **zoom pad** (`#zoom-pad`): **q.Save** over
  **q.Load** on the left (an icon and the name, both as wide as the wider,
  `0.6em` side padding); on the right, zoom in over zoom out beside a d-pad
  with the zoom level in its middle; `0.6em` between the three groups;
  square chips **2.6em** (at least 48px).
  A zoom tap is ×√2 (1×, 1.4×, 2×, 2.8×, 4×); a move tap is half the view.
- Below it, the **Menus sheet** (`#menus-sheet`, glass), filling the rest,
  `clamp(0.5rem, 3vw, 1rem)` from the sides, at least 3% of the height from
  the bottom; it scrolls inside itself. Text `max(0.95rem, 3.8vmin)`.
- In a window wider than tall, the sheet goes beside the game instead
  (`minmax(16rem, 38%)` wide).
- Sheet contents: **Look**: a sample message window (name tag, text, arrow),
  then buttons for Themes (at least `max(7.5rem, 30vmin)` wide), Icons
  (the "next" arrows, `max(3.5rem, 14vmin)`) and Borders
  (`max(5.5rem, 21vmin)`), each at least
  48px tall; the picked one has a 3px ring in the current theme's
  `--accent-deep`.
- At the sheet's top: **Full-screen text**, Off / On buttons
  (`max(6rem, 25vmin)` wide), with a one-line note above them.
- At the bottom, **Sizes**, a drop-down (closed at first; its heading is a
  48px-tall button with a turning chevron; opening it scrolls the sheet to
  it): Text size (60–200%), Name size
  (50–200%), Portrait height (0–100%), Portrait width (50–100%) and Button
  size (50–150%), each a
  full-width slider in **5% steps** with its name and value above it; the
  input is 48px tall, the track 0.45em, the thumb 1.6em; slider names stay
  on one line. After Button size,
  **Text padding** (0–100%, starts at 0%, per game): extra space on the
  side the message window grows from, up to a fifth of the screen's height
  at 100% (1% of the screen per 5% step). Under them, **Text position**: "Bot", an on/off switch (2.3em × 1.3em of the sheet's text,
  1em knob, filled with the accent for Top), "Top" (the words at 75%); the
  switch drops under the name when the column is too narrow. A note says which
  are the game's. At the drop-down's bottom, always there while it's open,
  **Save** (accent), **Reset** (plain; back to the values as last saved)
  and **Default** (plain; sets text and name 100%, portrait height 20%,
  width 75%, button size 100%, text position Bottom, padding 0%, as unsaved
  changes), centered side by side: with nothing to do they're dimmed to 45%, blurred
  1.5px and can't be pressed.
  Left of the sliders, a live miniature of the reader screen, the screen's
  shape and as tall as the slider column (at most half the drop-down's
  width), so the Text position row lines up with its bottom edge (exactly
  on the phone; on a narrow PC window the cap leaves it a little shorter): the picture at the
  chosen height, the line and name at the chosen sizes, and the corner
  buttons, all exactly in proportion, as they're dragged.
- Under Sizes, **Visual Novels**, a drop-down like it (closed at first;
  opening it scrolls the sheet to it): a button per saved game
  (`max(9rem, 40vmin)` wide, at least 48px tall), its name over
  "Playing", "Open", "Tap to start" or "Starting…" (75%, in
  `--accent-deep`); the game being played has the 3px ring, and a game with
  no saved .exe is dimmed to 45% and can't be pressed. A note under them,
  then, centered at the drop-down's bottom, **Close <game>** (a plain button
  in bold, `1.4em` side padding, like the Sizes buttons; dimmed and blurred
  while no saved game is running), naming the game it closes: the one
  played before the current one, or the current one if it's the only one
  running.

## Full-screen text (page mode)

- The page (`#page-view`) replaces the message window and name tag, in the
  same place and with the same glass and border, growing upward with the
  text as far as the background picture's bottom edge (a 3vw gap above
  it), so the picture stays in view, then scrolling. Where the picture
  leaves less room than that, it still gets **45%** of the height, and it
  never goes past the corner buttons' row.
- It scrolls by dragging, with a finger or the mouse (taps from the phone
  may arrive as mouse input); a drag doesn't move the game on. Once
  scrolled, its top edge fades out over 1.5em; the arrow hides while it's
  scrolled back from the end.
- Text: **85%** of the chosen text size, line height 1.5, `0.6em` between
  paragraphs, the same padding as the message window; at least 3 lines tall.
- Paragraphs already read are dimmed to 55% of `--ink`; new ones are full
  colour and fade in. The arrow sits in the same corner, with room kept for
  it after the last paragraph.

## Corner buttons

- **Menus** (top-left) and **Log** (top-right): frosted pills, at least 48px
  tall, `max(0.75rem, 4.5vmin)` from the top and sides (set in a little
  further than the message window), text
  `clamp(1.05rem, 4.75vmin × Button size, 7vmin)`, padding `0.5em 1.15em`.
  Set in `.corner-button` in `src/portrait.css`. Sized only by the screen
  (no `rem` cap), so they look the same on the PC and the phone; the 7vmin
  ceiling (about 150%) keeps both fitting side by side.
- **Button size** (picker slider, 50–150%, default 100%): an app setting,
  the same for every game, saved with the Save button like the game's
  settings (`buttonSize` in `settings.json`, `src/settings.ts`; slider in
  `src/button-size.ts`; before 2026-10-30 it saved straight away).
  (Before 2026-10-29: 44px, `clamp(0.5rem, 3vw, 1rem)` from the edges,
  `clamp(0.95rem, 4vw, 1.2rem)`; then `clamp(0.75rem, 4.5vw, 2rem)` and
  `clamp(1.05rem, 4.75vw, 1.75rem)`, whose `rem` cap left them small on the
  phone.)
- **Menus** shows the whole game screen in full (taps map 1:1) until tapped
  again ("Reader"). Not saved.
- **Log** opens the history log: "Return to game" on top (the
  same size as the corner buttons, `--button-font-size`, following the
  Button size slider; drawn `20vmin` lower with `translate`, so the line
  below doesn't move; `#log-close`), one line in the middle, big ◀ / ▶ buttons below.

## History log

All sized in `vmin` with only a floor, no `rem` cap, so it looks the same on
the PC and the phone (`#log…` and `.log-arrow` in `src/portrait.css`).

- **Gap** around and between everything: `max(0.75rem, 4vmin)`.
- **Under the arrows:** `max(gap, 3.5dvh)`: a share of the _height_, so on a
  tall phone the arrows sit higher (nearer the thumb, clear of the gesture
  bar); on the PC it's about the same as the gap.
- **◀ / ▶ buttons:** at least `max(4rem, 14vmin)` tall, arrows
  `max(1.75rem, 7vmin)`.
- **Line card:** padding `max(1rem, 5vmin)`; the "2 / 4" count
  `max(0.85rem, 3.5vmin)`; then " — " and the speaker's name in the same font, size and colour (`#log-speaker`, plain text, not the name tag's pill; hidden for narration), e.g. "6 / 9 — Asuka", in one row (`#log-heading`; a long name ends in "…"); the line itself at the message window's text size.

## Current game profiles

What's saved for each game (`%APPDATA%\mobile-novel\games\`), as of
2026-10-26. Text sizes were set before the base size went up by half. (Their
old background settings are no longer used.)

| Game               | Text size |
| ------------------ | --------- |
| Aokana             | 170%      |
| YOU and ME and HER | 150%      |

## Where to change things

| What                               | Where                                             |
| ---------------------------------- | ------------------------------------------------- |
| Background zoom and position       | `BACKGROUND_VIEW` in `src/zone-view.ts`           |
| Portrait height (per game)         | Portrait height slider in the picker              |
| Base text size                     | `--base-font-size` in `src/portrait.css`          |
| Message window size, padding, gaps | `#text-zone` / `#text-line` in `src/portrait.css` |
| Name tag size and position         | `#name-tag` in `src/portrait.css`                 |
| Corner button size and gaps        | `.corner-button` in `src/portrait.css`            |
| Slider ranges                      | `min` / `max` on the inputs in `index.html`       |
| Colours, fonts and shapes (themes) | `src/theme.css`                                   |
