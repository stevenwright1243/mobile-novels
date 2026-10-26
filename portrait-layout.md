# Portrait layout reference

The sizes and positions of everything in the portrait view (what the phone
sees), in one place. Read this before tuning the layout, especially the text
box, which is meant to be adjusted against the background defaults below.

Percentages are what the picker's sliders and boxes show. "vw" is a percent of
the portrait's width, so sizes follow the screen; `clamp(min, preferred, max)`
keeps them within limits.

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
  pale sky (`--backdrop-tint` in `portrait.css`).
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
- **Gap to the portrait's edges:** `clamp(0.5rem, 3vw, 1rem)` at the sides and
  bottom, so it floats.
- **Corners:** rounded `clamp(0.75rem, 3vw, 1.25rem)`.
- Look: frosted white glass (`.glass`), a sky-blue ribbon on the top edge, a
  bobbing ▼ in the bottom-right corner.

## Corner buttons

- **Menus** (top-left) and **Log** (top-right): frosted pills, at least 44px
  tall, `clamp(0.5rem, 3vw, 1rem)` from the edges, text
  `clamp(0.95rem, 4vw, 1.2rem)`.
- **Menus** shows the whole game screen in full (taps map 1:1) until tapped
  again ("Reader"). Not saved.
- **Log** opens the history log: "Return to game" on top, one line in the
  middle, big ◀ / ▶ buttons (at least `clamp(4rem, 16vw, 6rem)` tall) below.

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
| Slider ranges                      | `min` / `max` on the inputs in `index.html`       |
| Colours and font                   | `src/theme.css`                                   |
