# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An Electron app that turns a PC visual novel (VN) into a portrait, phone-friendly view. It captures the game window, redraws it as a 9:16 layout (cropped background on top, enlarged text box below, big buttons), and that view is streamed to a phone with Apollo/Sunshine + Moonlight over Tailscale. Taps then get translated back into clicks or keys in the game. Target platform is Windows. The final streaming programs are flexible.

`getting-started.md` is the design and planning doc. It covers the four sub-problems (capture, reformat, stream, input), the chosen tools (desktopCapturer, OCR (now OneOCR, the Snipping Tool's engine) and the game's memory, koffi for `SendInput`/`PostMessage`, Apollo, Tailscale) and the milestone plan. Its **Status** section, at the top, says what's done, the key decisions, known gaps and the next step. Read it first in a new session, and check the plan before starting a milestone.

## Words: GLOSSARY.md

[GLOSSARY.md](GLOSSARY.md) is the project's shared language: the words for its own things (text box vs message window, region vs zone, spot, profile, copy, and the rest), each with the words to avoid. Use its words in replies, docs and new code names. When a new term is settled, or a term's meaning changes, update its entry in the same commit, keeping definitions to one or two sentences about what the thing is, with no code details.

## Docs: read the one for the area you're changing

This file holds the rules for working here. How each part of the app works is in `docs/`, one file per area. **Before changing an area, read its doc**, and when a change alters what a doc describes, update that doc in the same commit, rewriting the passage rather than adding a note beside it, so each fact lives in one place.

- **OCR** (`ocr.ts`, `oneocr.ts`, `text-reader.ts`, debug mode's OCR tools, the OCR bench): [docs/ocr.md](docs/ocr.md)
- **Exact text from memory** (`memory-text.ts`, `text-codec.ts`, the game's alphabet, names from memory): [docs/memory-text.md](docs/memory-text.md)
- **The portrait** (drawing the zones, the background view, the text window's size, the history log, Menus mode, the Menus sheet and its Sizes, Visual Novels and Input Settings, full-screen text): [docs/portrait.md](docs/portrait.md)
- **Portrait sizes and positions** (background defaults, text sizing, message window, corner buttons, current game profiles): [portrait-layout.md](portrait-layout.md). The user tunes the text box against it, so keep it up to date when changing any of them.
- **Auto** (`auto-play.ts`, the learned reading pace): [docs/auto-play.md](docs/auto-play.md)
- **Themes, borders and arrows** (`theme.css`, `message-style.ts`, `reader.css`): [docs/styling.md](docs/styling.md)
- **Game profiles** (`profiles.ts`, regions, spots, saving, the name box's reader): [docs/profiles.md](docs/profiles.md)
- **The phone** (Apollo, the phone's display, parking the cursor, keeping the phone clear, Open on): [docs/phone.md](docs/phone.md)
- **Clicking the game and its window** (taps, focus, minimized or closed games, muting): [docs/game-windows.md](docs/game-windows.md)
- **The picker** (sidebar, pages, region editor): [docs/picker.md](docs/picker.md)

## About the user

They're returning to programming after ~7 years and are new to TypeScript. Explain unfamiliar patterns briefly, especially Electron's main/preload/renderer split and TypeScript-specific syntax. Prefer small, milestone-sized changes they can test and commit.

Their knowledge of web and tooling practices may be outdated, and they've asked for guidance. When they suggest a technique and a better current best practice exists, don't just build what they asked. Say so before building, explain why the alternative is better in plain terms, and urge them to consider it. They make the final call. (Example: they suggested flexbox for the portrait zones; CSS Grid named areas fit better.)

## Commands

- `npm start`: run the app in dev mode (Electron Forge + Vite, with hot reload for the renderer). Type `rs` in that terminal to restart after main-process or preload changes.
- `npm run start:debug`: the same, in debug mode (`--vn-debug`; not `--debug`, which Electron rejects as an old Node flag): OCR reads are logged, and both windows get Debug tools ([docs/ocr.md](docs/ocr.md)).
- **Live edits mix versions.** While the user has `npm start` running, edits to renderer files (`capture.ts`, `text-reader.ts`, the pages) hot-reload into their open app, but main-process files (`ocr.ts`, `main.ts`, `preload.ts`) need a restart. Tell them when an OCR change is being tried live, and confirm a change with a saved OCR test (and a restart) before keeping it on what was seen live.
- `npm run ocr-bench`: scores the text reader on every saved OCR test, or compares commits (`-- <commit> <commit>`). Run it before and after any OCR change, in the background with the watchdog; add a test whenever the user reports a misread (project skill `ocr-tests`). Options and details: [docs/ocr.md](docs/ocr.md).
- `npm run typecheck`: `tsc --noEmit`
- `npm run lint`: oxlint plus an oxfmt format check (including Markdown). `npm run lint:fix` fixes both.
- `npm test`: runs the unit tests once with Vitest (`vitest run`; `npx vitest` keeps watching and re-runs on each save). Tests sit beside the code as `*.test.ts` and import `describe`/`it`/`expect` from `vitest` (no globals). They run in plain Node, not Electron, so anything native (koffi, OneOCR) is swapped for a stand-in with `vi.mock`, as `src/ocr.test.ts` does for `recognize`, to test ocr.ts's clean-up rules through `readText`. When changing a rule that has tests, add a test for the new case; the OCR bench still checks whole frames.
- `npm run package` / `npm run make`: build a distributable (Squirrel installer on Windows). **Known gap:** Forge's Vite plugin packages only `.vite/`, so `npm run package` won't include koffi yet; it needs copying in (e.g. a `packageAfterCopy` hook) and unpacking from the asar before packaged builds work.

## Git workflow

Follows the user's git workflow in `~/.claude/CLAUDE.md`: after each finished change, once the checks pass, commit it on `master` and push. The checks are `npm run typecheck`, `npm run lint` and `npm test`; the **Check** workflow (`.github/workflows/check.yml`) runs them again on GitHub after each push.

## Architecture

Electron Forge's Vite plugin (`forge.config.mts`) builds three separate bundles, each with its own Vite config:

- **Main process:** `src/main.ts` with `vite.main.config.mts`. Node/Electron APIs live here: window creation, `desktopCapturer`, Win32 calls, OCR and memory reading.
- **Preload:** `src/preload.ts` with `vite.preload.config.mts`. Output is `preload.cjs`, loaded by path in `main.ts`. This is the only bridge between main and renderer: expose APIs via `contextBridge`, then call into main via `ipcRenderer.invoke`/`ipcMain.handle`.
- **Renderer:** two pages built by `vite.renderer.config.mts` (multi-page `rolldownOptions.input`), each in its own window: `index.html` → `src/renderer.ts` (the picker, [docs/picker.md](docs/picker.md)) and `portrait.html` → `src/portrait.ts` (the streamed portrait view, [docs/portrait.md](docs/portrait.md)). Both run with Node integration disabled and share `src/preload.ts`. `desktopCapturer` is **not** available here; get source IDs from main over IPC, then capture with `playCapture()` from `src/capture.ts`.
- **Shared state lives in main** (the selected source ID, the picked game's profile, the text line). Pages read it with a `get-*` invoke, change it with a `set-*`/`select-*` invoke, and main pushes changes to the windows with `webContents.send`. Shared types (`WindowSource`, `Region`, `Regions`, `GameProfile`, the `window.vn` API) are in `src/declarations.d.ts`.
- **App settings** (theme, message style, button size, PC / Phone, Open on, reading samples, learned alphabets) live in `settings.json` in `userData` (`src/settings.ts`), laid over defaults on load and mostly saved straight away. **Game settings** live in the game's profile and are saved only with Save ([docs/profiles.md](docs/profiles.md)).

Each entry in the `renderer` array of `forge.config.mts` (currently only `main_window`) generates build-time globals `<NAME>_VITE_DEV_SERVER_URL` and `<NAME>_VITE_NAME`. `main.ts` uses these (via its `loadPage` helper) to load a page from the dev server in dev, or the built file when packaged. A new window's page goes in as another HTML input in `vite.renderer.config.mts`, like `portrait.html`.

Packaged builds have Electron fuses set (`RunAsNode` off, `OnlyLoadAppFromAsar` on, asar integrity validation). Code shouldn't rely on loading files from outside the asar at runtime unless they're explicitly unpacked.

## Conventions

- Formatting is enforced by oxfmt: single quotes, 80-column width.
- **Styles use theme variables only.** Never hard-code a colour, font or radius in a style; use the theme's variables (listed and explained at the top of `src/theme.css`), with `color-mix(in srgb, var(--accent) 35%, transparent)` for see-through shades. The region editor's overlay colours are the one exception.
- **Every style option must exist in every theme.** Build a new option (a border, an arrow, a button look, a new element) from the theme variables only, then check it in every theme, light and dark. Where the shared version doesn't suit a theme, give that theme its own version under its `:root[data-theme='…']` block. A new theme defines every variable `:root` defines. Checklists for new options and themes: [docs/styling.md](docs/styling.md).
- **Layouts are responsive:** CSS Grid with named areas for page/zone layout, flexbox only for one-dimensional rows, `fr`/`clamp()` instead of fixed pixel sizes, and media/container queries for big shape changes. Don't hard-code an output resolution; the portrait view must fit whatever size the window or streamed display is.
- **The background picture never moves because of the text** (the user treats that as a bug): it's placed in the full canvas and the text window always lies over it.
- **Regions and spots are fractions (0 to 1) of the game's client area** (the window minus title bar, borders and menu bar), never of the whole capture and never screen pixels. Renderers convert using `window.vn.getClientArea()`.
- **Saving game settings is manual** (the user's choice): edits apply live, and nothing is written until Save or Ctrl+S. A new game setting must be part of the unsaved edits, Save and Reset ([docs/profiles.md](docs/profiles.md)).
- Capture targets a specific app window (`desktopCapturer` window source), not a screen area. On Windows its source ID (`window:<HWND>:0`) carries the HWND (verified), which `src/win32.ts` uses for Win32 calls.
- Win32 calls go through koffi (v3: pointers are BigInts, so HWNDs are declared as `intptr_t` and passed as numbers) in `src/win32.ts`, main process only. koffi is marked external in `vite.main.config.mts` because native modules can't be bundled.
- OCR is **OneOCR** only; there's no fallback engine (the user's choice). See [docs/ocr.md](docs/ocr.md) for why, and which clean-up rules were taken out.
