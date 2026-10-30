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

## Background (fixed, the same for every game)

The background fills the whole portrait. The message window lies over its
bottom, and never moves it.

| Setting               | Default | Meaning                                                                                                                           |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Zoom: Show all ↔ Fill | **20%** | 0% = the whole background region fits (space around it); 100% = it fills the portrait (edges trimmed)                             |
| Left ↔ Right          | **50%** | 0% = left edges together, 50% = centered, 100% = right edges together                                                             |
| Top ↔ Bottom          | **20%** | 0% = top edges together, 100% = bottom edges together. At 20% a zoomed-out picture sits near the top, clear of the message window |

- These are **fixed in code**, on purpose, so the text box can be tuned
  against them: `BACKGROUND_VIEW` in `src/zone-view.ts`, the only place
  they're defined. There are no sliders for them in the picker, and games no
  longer save their own (older saved values are ignored).
- The percentages are the same scale the old sliders used, for reference.
- Space around a zoomed-out picture shows a blurred copy of it, washed with
  the theme's `--backdrop-tint` (in `src/theme.css`; pale sky in Aokana).
- The zoom blends between "show all" and "fill" evenly: each slider step
  zooms by the same factor (see `placeInZone()`).

## Text (per game, saved in the profile)

| Setting    | Default | Range   | Meaning                                                                                                                                                                  |
| ---------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text size  | 100%    | 60–200% | Multiplies the base size below                                                                                                                                           |
| Long lines | Auto    | 60–200% | Size for a line too long for the window's resting height. Auto = shrink just enough (never below 60%). A set size is used exactly, and the window grows over the picture |

- **Base size (100%):** `clamp(1.6875rem, 7.5vw, 3rem)` = `--base-font-size` at
  the top of `portrait.css`. Raised by half from the original
  `clamp(1.125rem, 5vw, 2rem)`, so 100% now equals the old 150%.
- Font: Nunito, weight 600, line height 1.55.

## Message window (text mode)

- **Resting height:** room for **3 lines** at the chosen text size, plus
  padding. Most lines fit, so the window stays the same size. It's worked out
  from the chosen size, not the size a long line was shrunk to.
- **Maximum height:** 60% of the portrait's height; longer text scrolls inside.
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
    1.3em; picked automatically with the MiSide theme).
  - The arrow (`#next-arrow`) is sized in `em` of the chosen text size and
    sits `clamp(0.75rem, 3.5vw, 1.25rem)` in from the window's right edge,
    `clamp(0.5rem, 2.5vw, 0.9rem)` up from its bottom.
  - Set in the "Message window styles" section of `src/portrait.css`.

## Corner buttons

- **Menus** (top-left) and **Log** (top-right): frosted pills, at least 48px
  tall, `max(0.75rem, 4.5vmin)` from the top and sides (set in a little
  further than the message window), text
  `clamp(1.05rem, 4.75vmin × Button size, 7vmin)`, padding `0.5em 1.15em`.
  Set in `.corner-button` in `src/portrait.css`. Sized only by the screen
  (no `rem` cap), so they look the same on the PC and the phone; the 7vmin
  ceiling (about 150%) keeps both fitting side by side.
- **Button size** (picker slider, 50–150%, default 100%): an app setting,
  the same for every game, saved straight away (`buttonSize` in
  `settings.json`, `src/settings.ts`; slider in `src/button-size.ts`).
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
  `max(0.85rem, 3.5vmin)`; the line itself at the message window's text size.

## Current game profiles

What's saved for each game (`%APPDATA%\mobile-novel\games\`), as of
2026-10-26. Text sizes were set before the base size went up by half. (Their
old background settings are no longer used.)

| Game               | Text size | Long lines |
| ------------------ | --------- | ---------- |
| Aokana             | 170%      | 200%       |
| YOU and ME and HER | 150%      | 130%       |

## Where to change things

| What                               | Where                                             |
| ---------------------------------- | ------------------------------------------------- |
| Background zoom and position       | `BACKGROUND_VIEW` in `src/zone-view.ts`           |
| Base text size                     | `--base-font-size` in `src/portrait.css`          |
| Message window size, padding, gaps | `#text-zone` / `#text-line` in `src/portrait.css` |
| Smallest shrink for long lines     | `SMALLEST_SIZE` in `src/portrait.ts`              |
| Corner button size and gaps        | `.corner-button` in `src/portrait.css`            |
| Slider ranges                      | `min` / `max` on the inputs in `index.html`       |
| Colours, fonts and shapes (themes) | `src/theme.css`                                   |
