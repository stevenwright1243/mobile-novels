# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An Electron app that turns a PC visual novel (VN) into a portrait, phone-friendly view. It captures the game window, redraws it as a 9:16 layout (cropped background on top, enlarged text box below, big buttons), and that view is streamed to a phone with Apollo/Sunshine + Moonlight over Tailscale. Taps then get translated back into clicks or keys in the game. Target platform is Windows. The final streaming programs are flexible.

`getting-started.md` is the design and planning doc. It covers the four sub-problems (capture, reformat, stream, input), the chosen tools (desktopCapturer, Textractor/OCR, koffi for `SendInput`/`PostMessage`, Apollo, Tailscale) and the milestone plan. Check it before starting a milestone.

## About the user

They're returning to programming after ~7 years and are new to TypeScript. Explain unfamiliar patterns briefly, especially Electron's main/preload/renderer split and TypeScript-specific syntax. Prefer small, milestone-sized changes they can test and commit.

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
- **Renderer:** `index.html` → `src/renderer.ts` with `vite.renderer.config.mts`. Runs with Node integration disabled. `desktopCapturer` is **not** available here; get source IDs from main over IPC, then use `getUserMedia`/`getDisplayMedia` here.

Each entry in the `renderer` array of `forge.config.mts` (currently only `main_window`) generates build-time globals `<NAME>_VITE_DEV_SERVER_URL` and `<NAME>_VITE_NAME`. `main.ts` uses these to load the dev server URL in dev, or the built file when packaged. The types come from `src/declarations.d.ts`. A new window, such as the planned 1080x1920 portrait window, needs either a new renderer entry there or an extra HTML input in the renderer's Vite config.

Packaged builds have Electron fuses set (`RunAsNode` off, `OnlyLoadAppFromAsar` on, asar integrity validation). Code shouldn't rely on loading files from outside the asar at runtime unless they're explicitly unpacked.

## Conventions

- Formatting is enforced by oxfmt: single quotes, 80-column width.
- Per-game calibration data (screen regions for the background, text box, name box and buttons) is planned to be stored as small JSON files, one per game.
