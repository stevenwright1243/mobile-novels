# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An Electron app that turns a PC visual novel (VN) into a portrait, phone-friendly view. It captures the game window, redraws it as a 9:16 layout (cropped background on top, enlarged text box below, big buttons), and that view is streamed to a phone with Apollo/Sunshine + Moonlight over Tailscale. Taps then get translated back into clicks or keys in the game. Target platform is Windows. The final streaming programs are flexible.

`getting-started.md` is the design and planning doc. It covers the four sub-problems (capture, reformat, stream, input), the chosen tools (desktopCapturer, OCR with tesseract.js first and Textractor later, koffi for `SendInput`/`PostMessage`, Apollo, Tailscale) and the milestone plan. Its **Status** section, at the top, says what's done, the key decisions, known gaps and the next step. Read it first in a new session, and check the plan before starting a milestone.

## About the user

They're returning to programming after ~7 years and are new to TypeScript. Explain unfamiliar patterns briefly, especially Electron's main/preload/renderer split and TypeScript-specific syntax. Prefer small, milestone-sized changes they can test and commit.

Their knowledge of web and tooling practices may be outdated, and they've asked for guidance. When they suggest a technique and a better current best practice exists, don't just build what they asked. Say so before building, explain why the alternative is better in plain terms, and urge them to consider it. They make the final call. (Example: they suggested flexbox for the portrait zones; CSS Grid named areas fit better.)

## Commands

- `npm start`: run the app in dev mode (Electron Forge + Vite, with hot reload for the renderer). Type `rs` in that terminal to restart after main-process or preload changes.
- `npm run start:debug`: the same, with debug logging (`--debug-ocr`: every OCR read, its confidence and time, printed in the terminal).
- `npm run typecheck`: `tsc --noEmit`
- `npm run lint`: oxlint plus an oxfmt format check. `npm run lint:fix` fixes both.
- `npm run package` / `npm run make`: build a distributable (Squirrel installer on Windows).

There's no test framework set up yet.

## Architecture

Electron Forge's Vite plugin (`forge.config.mts`) builds three separate bundles, each with its own Vite config:

- **Main process:** `src/main.ts` with `vite.main.config.mts`. Node/Electron APIs live here: window creation, `desktopCapturer`, and later the native input helper.
- **Preload:** `src/preload.ts` with `vite.preload.config.mts`. Output is `preload.cjs`, loaded by path in `main.ts`. This is the only bridge between main and renderer: expose APIs via `contextBridge`, then call into main via `ipcRenderer.invoke`/`ipcMain.handle`.
- **Renderer:** two pages built by `vite.renderer.config.mts` (multi-page `rolldownOptions.input`), each in its own window: `index.html` → `src/renderer.ts` (window picker; the window list is a `<details>` that folds once a game is picked) + `src/region-editor.ts` (region outlines with move/resize handles and snapping) + `src/preview-zoom.ts` (zoom by laying `#zoom-box` out bigger inside the scrolling `#preview-area`, not a CSS transform, so the editor's `getBoundingClientRect` maths still holds) and `portrait.html` → `src/portrait.ts` (the streamed portrait view). Both run with Node integration disabled and share `src/preload.ts`. `desktopCapturer` is **not** available here; get source IDs from main over IPC, then capture with `playCapture()` from `src/capture.ts`.
- **Shared state lives in main** (the selected source ID and the `Regions`). Pages read it with a `get-*` invoke, change it with a `set-*`/`select-*` invoke, and main pushes changes to the portrait window with `webContents.send`. Shared types (`WindowSource`, `Region`, `Regions`, the `window.vn` API) are in `src/declarations.d.ts`.

Each entry in the `renderer` array of `forge.config.mts` (currently only `main_window`) generates build-time globals `<NAME>_VITE_DEV_SERVER_URL` and `<NAME>_VITE_NAME`. `main.ts` uses these (via its `loadPage` helper) to load a page from the dev server in dev, or the built file when packaged. A new window's page goes in as another HTML input in `vite.renderer.config.mts`, like `portrait.html`.

Packaged builds have Electron fuses set (`RunAsNode` off, `OnlyLoadAppFromAsar` on, asar integrity validation). Code shouldn't rely on loading files from outside the asar at runtime unless they're explicitly unpacked.

## Conventions

- Formatting is enforced by oxfmt: single quotes, 80-column width.
- Each game has a **profile** (`GameProfile` in `src/declarations.d.ts`): one JSON file per game in `%APPDATA%\mobile-novel\games\` (`app.getPath('userData')`), handled by `src/profiles.ts`. It holds the exe path, title, click method, text mode (`'text'`: the OCR line as styled text, or `'image'`: the text box crop), background view (zoom and position in the portrait), regions, client-area size and last-played time. Format `version: 3`. Older version-2 files (named after the window title) are upgraded in memory on pick, keeping their regions, and the old file is deleted on first save. Profiles are keyed by the lowercase `.exe` name (`exePathOf()` in `win32.ts`), falling back to `title:<window title>` if the exe can't be read. Main holds the picked game's `profile` and replaces it immutably on each change. **Saving is manual** (the user's choice): edits apply live, but nothing is written until the picker's Save button or Ctrl+S (`save-profile`). Unsaved edits are detected by comparing against `savedSnapshot`. Switching games or closing the picker with unsaved edits shows a Save / Don't save / Cancel dialog (`resolveUnsavedEdits`). Saves are announced with `profiles-changed`, and the button state with `save-state-changed`. Right-clicking a game card opens a native menu (`show-profile-menu`, built with `Menu.buildFromTemplate` in main) with Pick / Show file in folder / Delete (confirmed with a dialog). Not-running cards use `aria-disabled`, not `disabled`, so they still receive right-clicks. The picker's "Your games" list comes from `list-profiles`, which marks each profile open/closed by matching the exes of open windows. Regions are fractions (0 to 1) of the game's **client area** (the window minus title bar, borders and menu bar), never of the whole capture and never screen pixels. Renderers convert using the client area from `window.vn.getClientArea()`. Currently `background` and `text`; name box and button regions are deferred.
- Layouts follow responsive design: CSS Grid with named areas for page/zone layout, flexbox only for one-dimensional rows, `fr`/`clamp()` instead of fixed pixel sizes, and media/container queries for big shape changes. Don't hard-code an output resolution; the portrait view must fit whatever size the window or streamed display is.
- Each canvas is resized by a `ResizeObserver` to its box size × `devicePixelRatio`. Crops are placed by `placeInZone()` (`src/zone-view.ts`, shared by the portrait and the picker) from a `ZoneView`: `fill` blends from show-all (0) to fill/cover (1), `x`/`y` pick which part shows when trimmed. The text box picture always uses `SHOW_ALL`. The background uses the profile's `backgroundView`, set by sliders in the picker (`src/background-view.ts`, which also outlines the "Shown in portrait" part using the zone size the portrait reports via `setBackgroundZoneSize`). Space around a zoomed-out background is filled with a blurred, darkened copy (drawn tiny and stretched, for speed).
- Capture targets a specific app window (`desktopCapturer` window source), not a screen area. On Windows its source ID (`window:<HWND>:0`) carries the HWND (verified), which `src/win32.ts` uses for Win32 calls.
- Taps in the portrait are mapped back through each zone's scaling (`placeZone()` in `portrait.ts`, shared with drawing) to a point in the game's client area, then clicked by main via `postClick` (posted messages) or `sendClick` (`SendInput`) in `src/win32.ts`. The portrait window is `focusable: false` so it never takes focus from the game; this also means keyboard shortcuts (e.g. Ctrl+Shift+I) don't reach it. On Windows that also hides it from the taskbar and Alt+Tab, so `main.ts` adds `WS_EX_APPWINDOW` (`showInTaskbar()` in `win32.ts`) and calls `setSkipTaskbar(false)` to put it back.
- Minimized windows can't be captured or clicked (Windows doesn't draw them; engines pause). Main polls the selected game once a second and calls `restoreBehind()` (`win32.ts`: un-minimize without activating, then `HWND_BOTTOM`) if it's minimized. `click-game` does the same before clicking. The picker's "Send game to back" button is the supported way to hide the game.
- Win32 calls go through koffi (v3: pointers are BigInts, so HWNDs are declared as `intptr_t` and passed as numbers) in `src/win32.ts`, main process only. koffi is marked external in `vite.main.config.mts` because native modules can't be bundled.
- OCR runs in main (`src/ocr.ts`, tesseract.js in a worker thread, also marked external). Renderers crop the text region to a PNG (`regionInVideo()` + `cropForOcr()` in `capture.ts`) and send it with `window.vn.readText`. The portrait runs the automatic reader (`src/text-reader.ts`) and sends each confirmed line to main (`setTextLine`). Main keeps the current line and broadcasts `text-line-changed`, so text sources stay swappable. The English data is downloaded on first use into `userData/tessdata`. **Known gap:** Forge's Vite plugin packages only `.vite/`, so `npm run package` won't include koffi or tesseract.js yet; it needs copying in (e.g. a `packageAfterCopy` hook) and unpacking from the asar before packaged builds work.
