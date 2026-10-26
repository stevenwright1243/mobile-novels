# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An Electron app that turns a PC visual novel (VN) into a portrait, phone-friendly view. It captures the game window, redraws it as a 9:16 layout (cropped background on top, enlarged text box below, big buttons), and that view is streamed to a phone with Apollo/Sunshine + Moonlight over Tailscale. Taps then get translated back into clicks or keys in the game. Target platform is Windows. The final streaming programs are flexible.

`getting-started.md` is the design and planning doc. It covers the four sub-problems (capture, reformat, stream, input), the chosen tools (desktopCapturer, Textractor/OCR, koffi for `SendInput`/`PostMessage`, Apollo, Tailscale) and the milestone plan. Check it before starting a milestone.

## About the user

They're returning to programming after ~7 years and are new to TypeScript. Explain unfamiliar patterns briefly, especially Electron's main/preload/renderer split and TypeScript-specific syntax. Prefer small, milestone-sized changes they can test and commit.

Their knowledge of web and tooling practices may be outdated, and they've asked for guidance. When they suggest a technique and a better current best practice exists, don't just build what they asked. Say so before building, explain why the alternative is better in plain terms, and urge them to consider it. They make the final call. (Example: they suggested flexbox for the portrait zones; CSS Grid named areas fit better.)

## Commands

- `npm start`: run the app in dev mode (Electron Forge + Vite, with hot reload for the renderer). Type `rs` in that terminal to restart after main-process or preload changes.
- `npm run typecheck`: `tsc --noEmit`
- `npm run lint`: oxlint plus an oxfmt format check. `npm run lint:fix` fixes both.
- `npm run package` / `npm run make`: build a distributable (Squirrel installer on Windows).

There's no test framework set up yet.

## Architecture

Electron Forge's Vite plugin (`forge.config.mts`) builds three separate bundles, each with its own Vite config:

- **Main process:** `src/main.ts` with `vite.main.config.mts`. Node/Electron APIs live here: window creation, `desktopCapturer`, and later the native input helper.
- **Preload:** `src/preload.ts` with `vite.preload.config.mts`. Output is `preload.cjs`, loaded by path in `main.ts`. This is the only bridge between main and renderer: expose APIs via `contextBridge`, then call into main via `ipcRenderer.invoke`/`ipcMain.handle`.
- **Renderer:** two pages built by `vite.renderer.config.mts` (multi-page `rolldownOptions.input`), each in its own window: `index.html` → `src/renderer.ts` (window picker and text-zone drawing) and `portrait.html` → `src/portrait.ts` (the streamed portrait view). Both run with Node integration disabled and share `src/preload.ts`. `desktopCapturer` is **not** available here; get source IDs from main over IPC, then capture with `playCapture()` from `src/capture.ts`.
- **Shared state lives in main** (the selected source ID and the `Regions`). Pages read it with a `get-*` invoke, change it with a `set-*`/`select-*` invoke, and main pushes changes to the portrait window with `webContents.send`. Shared types (`WindowSource`, `Region`, `Regions`, the `window.vn` API) are in `src/declarations.d.ts`.

Each entry in the `renderer` array of `forge.config.mts` (currently only `main_window`) generates build-time globals `<NAME>_VITE_DEV_SERVER_URL` and `<NAME>_VITE_NAME`. `main.ts` uses these (via its `loadPage` helper) to load a page from the dev server in dev, or the built file when packaged. A new window's page goes in as another HTML input in `vite.renderer.config.mts`, like `portrait.html`.

Packaged builds have Electron fuses set (`RunAsNode` off, `OnlyLoadAppFromAsar` on, asar integrity validation). Code shouldn't rely on loading files from outside the asar at runtime unless they're explicitly unpacked.

## Conventions

- Formatting is enforced by oxfmt: single quotes, 80-column width.
- Per-game calibration data (regions for the background, text box, name box and buttons) is planned to be stored as small JSON files, one per game. Regions are fractions (0 to 1) of the captured game window, never screen pixels.
- Layouts follow responsive design: CSS Grid with named areas for page/zone layout, flexbox only for one-dimensional rows, `fr`/`clamp()` instead of fixed pixel sizes, and media/container queries for big shape changes. Don't hard-code an output resolution; the portrait view must fit whatever size the window or streamed display is.
- Each canvas is resized by a `ResizeObserver` to its box size × `devicePixelRatio`, and draws its crop with contain (text box) or cover (background) scaling.
- Capture targets a specific app window (`desktopCapturer` window source), not a screen area. On Windows its source ID (`window:<HWND>:0`) carries the HWND, which the input bridge uses to find the game window.
