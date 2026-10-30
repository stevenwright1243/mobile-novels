# VN Mobile App: how to start

This is the project's planning doc. It assumes a **Windows PC** (where most VNs and Sunshine live).

## Status (as of 2026-10-26)

**Read this first when picking the project up in a new chat or tool.**

**Done:** milestones 1a–1c, 2, 3a and 3d (see the table in section 3).

- The picker window lists open windows and saved **game profiles**. The portrait window draws the background and text zone live.
- Regions are edited with handles, snapping (toggle, or hold Alt to flip it), an exact-pixel X/Y/W/H panel, a size lock and arrow-key nudging. Two **spots** (points, not boxes) mark the game's quick save and quick load buttons, tapped by q.Save and q.Load in the portrait's Menus sheet.
- The title bar is cropped by measuring the game's client area through Win32 (koffi).
- Taps in the portrait click the same spot in the game. There are two methods, posted messages or simulated mouse, and the test VN accepts both.
- The portrait window is non-focusable (so the game keeps focus) but still listed in the taskbar and Alt+Tab.
- Minimized games are restored behind other windows automatically. Use "Send game to back" instead of minimizing.
- Profiles: one JSON file per game, keyed by `.exe`.
  - Saving is **manual**: the Save button or Ctrl+S, with Save / Don't save / Cancel when switching games or closing with unsaved edits.
  - Right-clicking a game card opens a native menu: Pick / Show file in folder / Delete.

**Key decisions, and why:**

- **CSS Grid** for layout, flexbox only for single rows. Nothing is hard-coded to a resolution.
- **Regions are fractions of the game's client area**, so they survive window moves, resizes and DPI changes. The same coordinates are used for clicking.
- **Profiles are keyed by `.exe`**, not window title, because titles can change per chapter.
- **Manual saving** was the user's preference over autosave.
- **Native Electron menus and dialogs** rather than HTML imitations.
- **koffi 3** for Win32: pointers are BigInts, so window handles are declared as `intptr_t` and passed as plain numbers. New Win32 calls are tested with a small scratch probe before being written into the app.

**Known gaps:**

- `npm run package` doesn't include koffi or tesseract.js yet (and the OCR language data is downloaded on first use rather than bundled). Forge's Vite plugin only packages `.vite/`. `npm start` is fine.
- No landscape layout for the portrait.
- A game that was maximized may come back un-maximized after auto-restore.

**Next step: Milestone 5 (real text), OCR first.** Moved ahead of streaming: everything up to streaming can be built and tested on the PC, with the portrait window standing in for the phone.

- 5a ✅: an OCR test button in the picker (now a debug tool, shown only with `npm run start:debug`) reads the text region with `tesseract.js` (in main, `src/ocr.ts`) and shows the image read plus the result. On "YOU and ME and HER" it reads lines exactly in ~75 ms; the only noise is the ▽ next-line icon.
- 5b ✅: the portrait reads text automatically (`src/text-reader.ts`). It checks a tiny sample of the text box 4 times a second; a big change (a new line) starts OCR, and reading repeats until two reads in a row agree, which means the typewriter animation has finished. Pixel stability alone doesn't work, since the ▽ icon keeps bobbing. The confirmed line goes to main (`set-text-line`), which broadcasts `text-line-changed`; the picker shows it as "Live text". OCR text gets common fixes in `ocr.ts`: `|` and a lone `l` become `I` (telling Tesseract never to output `|` just gives `[` instead).
- 5c (built, being tested): the portrait's text zone shows the line as real text in a clean reader style (dark panel, large `clamp()` type, wraps to the screen, room for 3 lines so the background doesn't jump). Tapping it clicks the middle of the game's text box. The text is always read: the old per-game "Picture of the text box" fallback was removed. Themes are for later.

**Name box:** a third region, `name` (picker: "Edit name box", green outline), read by its own OCR reader like the text box. The speaker's name shows on the message window's top-left corner as an accent pill (hidden during narration). The history log shows each line's speaker after its count, as plain text ("6 / 9 — Asuka").

**History log:** a Log button in the portrait's top-right corner opens a pop-up (`<dialog>`) with the last 30 lines, one at a time: "Return to game" on top, the line in the middle, big ◀ / ▶ buttons below. It opens on the newest line; main keeps the history and clears it when another game is picked.

**Menus (3c, raw mode):** a button in the portrait's top-left corner, matching Log, switches to the entire game screen, shown in full over the blurred backdrop, with taps landing 1:1, for menus, settings and choices; tapping it again ("Reader") goes back. Session-only, not saved. In Menus mode the game sits just under the corner buttons, with a **settings sheet** below it (beside it in a wide window): the look (theme, arrow, border) picked with big buttons that each show what they pick, and a sample message window. At the top of that sheet, a **Full-screen text** switch (built, to be tried in a real game) for games that fill the screen with text (NVL, like Katawa Shoujo's monologues): it reads a per-game `page` region (picker: **Edit full-screen text**; the whole game less a small margin by default), splits it into paragraphs by the gaps between them, and shows it as a scrolling page, earlier paragraphs dimmed and the new one bright, each new paragraph logged once. Off / On for now (not saved); Auto once there are full-screen frames in the OCR bench. A full page reads in about 0.6 s. The 3b button row (Skip / Auto / Menu…) is on hold: it needs game-specific settings.

**Live window list:** the picker's window list and game cards update by themselves when windows open or close; closing the picked game clears the portrait (with a message) and unfolds the window list.

**Picker UI:** a sidebar of saved games (click to play a running one or start one that isn't, ✕ to force-close, "muted" on the running games not being played) and open windows (folds away once a game is picked), with the phone status at the bottom; the picked game's pages beside it: Regions, Style (Sizes and Input Settings on one page: the same panels as the portrait's Menus sheet, where they're separate drop-downs), Look, and Debug in debug mode; the preview zooms (Ctrl+scroll, − / + / Fit, drag to move around). **Portrait background:** centered left to right; how much of its width shows (Portrait width, 50–100%, default 75%) and its height (Portrait height, default 20%) are set per game with the Sizes sliders (picker or Menus sheet); a "Portrait view" box in the preview marks the part that's visible; space around the zoomed-out background shows a blurred copy instead of black bars. The text panel overlays the bottom of the background (a dark gradient scrim) instead of sitting below it, so a longer or shorter line never moves the background; Top ↔ Bottom can push a zoomed-out picture up, clear of the panel.

**Text size:** a per-game slider (60–200%, 5% steps). Bigger text makes the message window (3 lines) taller, over the background picture (the picture never moves because of the text: it fills the portrait, and the window lies on top). The background sliders and the text settings never affect each other.

**Look:** a styling sweep in the spirit of Aokana: shared sky-blue and white theme (`src/theme.css`), bundled Nunito font, frosted-glass message window with a sky ribbon and bobbing arrow, pill buttons and white cards in the picker.

Done from 3b: text zone sizing (in picture mode the text row takes the text region's shape, so there are no black bars) and removing the portrait's menu bar. Still left: the portrait button row (on hold). 3c (raw mode) is done, and its game view can be pinched to zoom in (or zoomed with the mouse wheel) and dragged around (`src/game-zoom.ts`), or zoomed and moved a step per tap with the zoom pad at the top of the Menus sheet (`src/zoom-pad.ts`); pinch on the phone is still to be confirmed (it needs Artemis in touchscreen mode; in trackpad mode a two-finger drag arrives as the wheel, which zooms too).

**Now: Milestone 4 (streaming to the phone).** The phone is **Android**, so the client is **Artemis** (Apollo's own Moonlight fork), which streams in portrait at the phone's exact resolution.

- 4a (setup, outside the app): install Apollo on the PC and Artemis on the phone, pair them on home Wi-Fi, and stream the Desktop app with "Always use Virtual Display". _As of 2026-10-29:_ Apollo 0.4.6 is installed and running (NVENC encoders found), Parsec's virtual display driver is gone, and the phone (Galaxy S24+, `SM-S926U1`) is paired. Still to do: tick "Always use Virtual Display" on the Desktop app (it's off by default), then the first stream. Leave Apollo's "Device configuration" off "Deactivate other displays" and "make it a primary display", so the game stays on the PC's monitor, and never rotate the virtual display in Windows (Apollo handles portrait).
- 4b (built, to be tested with the phone): the portrait goes full screen on the phone's display by itself (`src/phone-display.ts`). It recognizes that display by its adapter, Apollo's SudoVDA driver (`displayAdapterAt()` in `win32.ts`), not by shape: this PC's HP 727pq monitor is portrait (1440×2560) too. The picker shows "On phone: W × H" or "Phone not connected", and the portrait hides the mouse pointer there. Verified: the adapter is named "SudoMaker Virtual Display Adapter", which matches `/SudoMaker|SudoVDA/i`. Found on the first stream: closing Artemis only _pauses_ Apollo's session, and the display stays (with the portrait on it, out of sight) until you **Quit session** in Artemis. So a **PC / Phone switch** in the picker moves the portrait between the phone's display and the PC while that display exists; it's also handy for testing. The choice is saved as an app setting (`settings.json`), so on PC it stays on PC even when the phone connects: switch it to Phone before leaving the house. Back on the PC, the portrait matches the picker's height. (A duplicate on both was considered and left out: it needs a second portrait window, capture and OCR reader.) For 4c: the phone's display came up at 1080 × 1920 with **100% scaling**, so the text will be small on the phone until that's raised.
- 4c: taps from the phone reach the portrait (Artemis touch → Apollo → mouse or touch input) and go on to the game; check the virtual display's Windows scaling (the text is tuned for a portrait window about 500 px wide; 200–300% scaling on a 1080-wide phone gives the same proportions).
- 4d: Tailscale on both, then stream on mobile data.

**Layout reference:** `portrait-layout.md` holds the portrait's sizes and positions. The background is centered; its width (default 75%) and height (default 20%) are per game (`BACKGROUND_VIEW` in `src/zone-view.ts` holds the defaults).

**Working agreement:** small steps the user can test and commit; explain TypeScript and Electron patterns briefly; when the user suggests something and a better current practice exists, say so and explain before building (see `CLAUDE.md`).

## 1. The big picture

```
 Main monitor                       Virtual portrait monitor (e.g. 1080x1920)
┌──────────────────┐               ┌──────────┐
│   Visual novel   │──capture──▶   │ Electron │  ◀── Sunshine/Apollo streams THIS display
│   (normal size)  │               │ 9:16 view│
└──────────────────┘ ◀──clicks──── └──────────┘
                      (translated)       ▲
                                         │ taps / mouse
                                   Moonlight on phone (over Tailscale)
```

Four separate problems, and it helps to keep them separate:

1. **Capture**: get frames of the game window into Electron.
2. **Reformat**: draw a 9:16 layout: cropped/scaled background on top, big readable text box below, buttons for menus/choices.
3. **Stream**: send that portrait view to the phone.
4. **Input**: taps on the phone have to end up as clicks/keys in the _game_, not just in your app.

## 2. Pieces and the tools I'd pick

### Project setup

- **Electron Forge with the Vite + TypeScript template.** It's Electron's official tool, and it handles dev reload and packaging for you:
  `npx create-electron-app@latest vn-mobile --template=vite-typescript`
- **TypeScript:** don't study it up front. It's JavaScript plus type labels. Write JS-shaped code, let VS Code's red squiggles and Claude Code explain things as they come up. You'll pick it up in a week or two.
- Install: Node.js LTS, Git, VS Code, the Claude Code extension. Put the project on GitHub early (it doubles as backup and lets Claude in this project see the code if you attach the repo).

### Capture

- Electron has this built in: `desktopCapturer.getSources({ types: ['window'] })` lists windows, and you feed the chosen one into a `<video>` element with `getUserMedia`. Then draw regions of that video onto `<canvas>` elements. No native code needed.
- This captures **the app window itself**, not an area of the screen: it follows the game when it moves and still works when other windows cover it. (Minimized windows go black, so keep the game open.)
- On Windows the source ID looks like `window:<number>:0`, where the number is the window's handle (HWND). Keep it: the input bridge can use it to target the same window.
- **The capture includes the window's title bar and borders.** To leave them out, the app asks Windows (through koffi) where the game's _client area_ is: the window minus title bar, borders and menu bar. Regions are measured against that. How it varies between games:
  - Normal windowed games: the title bar is removed exactly.
  - Borderless or fullscreen-windowed games: there's no title bar, so nothing is removed, which is correct.
  - Games that draw their _own_ title bar inside the window (like VS Code or Discord do): Windows counts it as content, so it stays. Draw your regions to leave it out.
  - Exclusive-fullscreen games may not capture at all. Switch them to windowed or borderless.
- **Minimized games can't be captured or clicked.** Windows doesn't draw minimized windows, and most engines pause their game loop when minimized. A game that's only _covered_ by other windows keeps running fine. So the app checks once a second and, if the selected game is minimized, restores it _without focusing it_ and pushes it behind all other windows. Use the picker's **Send game to back** button instead of minimizing.

### Reformat

- A "calibration" screen where you drag rectangles over a screenshot of the game: _background area_, _text box_, _name box_, _menu buttons_. Save those per game in a **game profile**.
- **Game profiles:** one JSON file per game in `%APPDATA%\mobile-novel\games\`, named after the game's `.exe` (e.g. `totono_steam.exe.json`), so it survives window-title changes. It holds the exe path, last window title, click method, regions, the game's pixel size and when it was last played. The picker's **Your games** list shows each profile as a card with an _Open / Not running_ badge. Clicking an open game's card picks its window. **Saving is manual:** changes apply live, but the file is only written when you click **Save profile** (or press Ctrl+S). Switching games or closing the app with unsaved changes asks whether to save them.
- **Drawing snaps** to the game picture's sides and to the other regions' edges, so regions can sit flush against each other. Hold Alt to place freely.
- **Regions are stored as fractions of the game's content (0 to 1), not pixels.** For example, `{ "x": 0.05, "y": 0.72, "w": 0.9, "h": 0.25 }`. That way they still line up if the game window is moved, resized, or run at another resolution.
- **"Set text zone" setting (the first calibration tool).** A button in the main window turns the live game preview into a drawing surface. You click and drag a rectangle over the game's text box, and that rectangle becomes the region the portrait view shows in its text zone:
  - While dragging, an outline follows the mouse. After you let go it stays visible, so you can see what's being captured, and dragging again replaces it.
  - The mouse position is converted to fractions of the _game frame_, not of the preview element. The preview is letterboxed (`object-fit: contain`), so the black bars have to be subtracted first. The video's `videoWidth`/`videoHeight` give the real frame size.
  - The region goes main window → main process → portrait window over IPC, and the portrait's text zone switches to the new crop immediately, live.
  - Later, the same region is what gets OCR'd (see _Text_ below), and Milestone 2 reuses this drag tool for the other regions and saves them per game.
- **The portrait view uses responsive layout, not a fixed 1080x1920 canvas.** It has to fit whatever resolution Apollo picks for the phone, or a resizable window while testing. The principles:
  - **CSS Grid with named areas for the zones** (background, name, text box, buttons). For example: `grid-template-areas: 'bg' 'name' 'text' 'buttons'` with `grid-template-rows: 3fr auto 2fr auto`. `fr` units share out the space. Rearranging the layout, such as for landscape, means changing only the area map, not the HTML. A layout can then live in the per-game JSON as data.
  - **Flexbox only for one-dimensional rows**, like the button row.
  - **No fixed pixel sizes.** Zones take shares (`fr`). Text and buttons scale with `clamp()`, e.g. `font-size: clamp(1rem, 4vw, 2rem)`, so they're never too small or too huge.
  - **Media or container queries for big shape changes** (portrait vs landscape, very narrow screens), instead of separate layouts per resolution.
  - **Canvases need code to be responsive.** CSS stretches the canvas _box_, but its drawing is in pixels:
    - A `ResizeObserver` resets each canvas's pixel size to its box size × `devicePixelRatio`, so it stays sharp on high-resolution phone screens.
    - The drawing code chooses _contain_ (show the whole crop, with bars) or _cover_ (fill the zone, trim the edges): contain for the text box so no text is lost, cover for the background.
- **Text, in stages:**
  1. _First:_ just show the text box as an enlarged image crop. Zero extra work, already readable.
  2. _Then real text, by OCR:_ read the text box region with `tesseract.js`. It works with any engine, needs no extra program, and only ever reads the region you drew, so it can't pick up menu or UI text by mistake. Read only once the box stops changing, so typewriter animations aren't caught half-way. The text source is kept swappable, so other sources can be added later without touching the display:
     - _Windows' built-in OCR,_ if tesseract.js struggles (often faster and more accurate on screen text, but harder to call from Node).
     - **_Textractor,_** for games OCR reads badly, especially Japanese ones. It hooks the engine and gets the exact text, but produces several text streams you have to choose between, and doesn't work with every engine. A WebSocket extension forwards the text to the app. Only ever an optional extra, never a replacement for OCR (very old games are a goal, and DOS, PC-98 and other emulated games can't be hooked at all). Idea for choosing the stream without hand-filtering menus: compare each stream's latest text with the OCR read of the text box (a fuzzy match, so OCR's mistakes don't matter); the one that keeps matching is the story stream, saved in the game's profile (the name box can pick the name stream the same way). Keep checking each line against OCR, so menu text sent through the same stream is dropped, and fall back to OCR when nothing matches.
     - _A per-game letter table, for old games with pixel fonts._ A bitmap font draws each letter as exactly the same pixels every time, so letters can be read by exact matching instead of guessing: OCR fills the table at first, the user corrects wrong letters in the picker, then matching takes over. Often near-perfect on tiny text, and fast. Many old fonts (Japanese especially) are fixed-width, which makes splitting letters easy.
     - _Old full-screen games_ that capture can't see can usually be made to run in a window with dgVoodoo2 or DxWnd (a setup note, not app code).
     - **Future goal: italics.** Games use italics for emphasis ("I mean, _of course_ I do."), and the portrait should show them. Tesseract can't help: tesseract.js 7 gives each word only its text, confidence, box and a font name, with no style. So measure each word's slant: take its black-and-white pixels (from the word boxes `readText` already gets) and try shearing them back by 0–20°. Upright strokes line up best at 0°, italic ones at about 10–15°; "lined up" is when the count of ink per column has the sharpest peaks. A word slanted well beyond the rest of its line is italic. Short words ("I", "a") are too small to measure, so they take their neighbours' slant. The line then has to carry which words are italic all the way to the portrait and the Log, e.g. `{ text, italic: [[start, end]] }` rather than marks inside the text (a real "\*" in a line would break those), and OCR tests need a way to mark italic words so the bench can check it. Start by saving italic lines as OCR tests and checking how cleanly the slant separates the two on real frames.
  3. _Later:_ AI fun (sprite cutouts, translation, etc.).

### Stream

- Sunshine streams a whole **monitor**, not a window. So the trick is a **virtual portrait monitor**: the game sits on your real screen, your Electron view goes fullscreen on the virtual one, and Sunshine streams only that.
- **Apollo** (a Sunshine fork) creates a virtual display matching the phone's resolution automatically when Moonlight connects, which is exactly this use case. Plain Sunshine plus a virtual display driver also works. Try Apollo first.
- **Artemis** (Android) is Apollo's companion Moonlight fork: it connects in portrait, and Apollo makes the virtual display the phone's exact size and shape. Moonlight for iPhone has no confirmed portrait support with Apollo.
- **The app's side:** the portrait window moves onto that virtual display and goes full screen while it exists (`src/phone-display.ts`), and back to its place on the PC when the phone disconnects. Apollo names the display after the phone, so it's recognized by its adapter (SudoVDA) instead.

### Input and different networks

- **This is mostly solved already.** Moonlight sends touch, mouse and keyboard from the phone to the PC. It has a touchpad/mouse mode, and a Bluetooth mouse paired to your phone works too. You don't need to build your own remote-input system.
- **Different networks:** install **Tailscale** on the PC and phone, then point Moonlight at the PC's Tailscale address. No router port-forwarding. Free for personal use.
- **The real problem is translation and focus.** A tap lands on your Electron window, so the app has to work out "that was the Skip button" or "that was at (x, y) in the game" and then send that click or key to the game. Two catches:
  - Electron can't click on other windows by itself. You need a small native helper. The easiest route in a Node app is calling Windows' `SendInput`/`PostMessage` through **koffi** (an FFI library, no C++ compiling). `robotjs` and `nut.js` exist too, but robotjs is unmaintained and nut.js moved to a paid license.
  - Clicking your window takes focus away from the game, and some VNs pause or ignore input when they're not focused. Usually the fix is to briefly focus the game, send the input, then refocus your app. Or send messages straight to the game window, which works for some engines.
  - **Map taps through the same fractions:** tap position inside a zone → fraction of that zone's region → fraction of the game window → real pixel position using the game window's _current_ position, looked up from its HWND at click time. Nothing depends on where the game sits on screen.
  - **Two ways to deliver a click**, and which one works depends on the game's engine:
    - _Posted messages_ (`PostMessage` with `WM_LBUTTONDOWN`/`UP`): sent straight to the game window. No cursor movement and no focus change, but engines that read raw input ignore them.
    - _Simulated mouse_ (`SendInput`): brings the game to the front, moves the real cursor there, clicks, and moves it back. Works almost everywhere, at the cost of a visible cursor jump.
  - The portrait window is created with `focusable: false`, so tapping it never takes focus from the game.
  - **This is the riskiest part, so test it early** (Milestone 3).
- Safety net: a "raw mode" toggle that shows the whole game, letterboxed, where every tap maps 1:1. That way you can always reach settings screens your layout doesn't cover.

## 3. Milestones (each one small and testable)

| #   | Goal                 | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Setup                | Forge app opens a window from VS Code; repo on GitHub                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1   | **Capture + layout** | 1a: pick the VN window from a list and see it live. 1b: a responsive portrait window (Grid zones, canvases sized with `ResizeObserver`) shows the cropped background on top and the text box enlarged below, live, and still fits when you resize the window. 1c: a "Set text zone" button lets you drag a rectangle over the live preview, and the portrait's text zone switches to that crop live                                                                                                                                                                                                                                                                                                                                                              |
| 2   | Calibration          | Reuse the 1c drag tool for the background too. Regions save automatically per game as JSON (fractions of the window, not pixels) and load when you pick that game again. Now part of each game's profile, keyed by `.exe`. Name box and button regions are deferred: the name box only when a game needs it, buttons to Milestone 3                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3   | Input bridge         | 3a ✅: tapping anywhere in the portrait clicks the same spot in the game, with two delivery methods (posted messages vs simulated mouse). The portrait window never takes focus from the game. _Result: "YOU and ME and HER" accepts both methods; minimized games are auto-restored behind other windows._ 3b: save the working method per game, and add a portrait button row (Advance, Back, Skip, Auto, Menu…) that sends keys or clicks button regions drawn in the picker. 3c ✅: raw mode ("Menus" button): the whole game letterboxed, taps map 1:1. 3d ✅: identify games by their `.exe` instead of window title (titles can change per chapter). Done as part of game profiles, which also save the click method per game (originally planned for 3b) |
| 4   | Streaming            | Apollo + Tailscale: play from your phone on mobile data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5   | Real text            | OCR first (`tesseract.js` on the text region) → nicely styled text in the app. 5a: OCR test button. 5b: read automatically when the text box settles. 5c: styled text layer, image crop as fallback. Textractor / Windows OCR later as other text sources. _Moved ahead of 4._                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6+  | Creative             | Sprite extraction, themes, per-game presets, history log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7   | Sharing and setup    | _Final polish, last._ Another person can install the app and get streaming to their phone with as little manual work as reasonable: automate what the PC can do, and give detailed step-by-step instructions for the rest (the phone). See section 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Start with Milestone 1.** It shows results fast, and everything else builds on it. You can test streaming (4) whenever you like, since it doesn't depend on your code.

## 4. Working with Claude Code

- Open the project folder in VS Code and run Claude Code there. Run `/init` once the scaffold exists so it writes a `CLAUDE.md` about your project. Add a line like "I'm returning to programming after ~7 years and new to TypeScript; explain unfamiliar patterns briefly."
- Use **plan mode** (Shift+Tab) for each milestone: ask for a plan, read it, then let it build.
- Keep requests milestone-sized. For example: _"Add a window picker using desktopCapturer and show the selected window live in a video element."_
- Commit after each working step (`git commit`), so you can roll back when something goes wrong.
- Ask it "why" freely. Having it explain its code is the fastest way to relearn.
- **Expect pushback on outdated ideas.** Some of my knowledge is years old. When I suggest a technique and there's a better current best practice, Claude should say so, explain why it's better, and urge me to consider it before building. Example: I suggested flexbox for the zones, and CSS Grid with named areas turned out to fit better. This rule is also in `CLAUDE.md`, so it applies in every session.

### A first prompt you can paste into Claude Code (after scaffolding)

> This is an Electron Forge + Vite + TypeScript app. I want a window that lists open windows using desktopCapturer, lets me pick one, and shows it live. Then add a second "portrait" window laid out with CSS Grid named areas, each zone holding a canvas that a ResizeObserver keeps sized to its box (times devicePixelRatio). Draw two hard-coded regions of that capture into them, given as fractions of the game window: a background crop (cover) in a top zone (3fr) and a text-box crop (contain) in a bottom zone (2fr). Keep it simple and explain the main-process vs renderer split as you go.

## 5. Milestone 7: sharing and setup (final polish)

Do this last, once the app itself is done. The aim: automate as much of the setup as is reasonable, and give detailed steps for what can't be automated. It's based on what setting up Apollo and Artemis by hand took on 2026-10-29: Parsec's driver had to be gone, Apollo's Desktop app needed "Always use Virtual Display", a saved per-phone display mode (`1080x1920x30`) caused black bars and a 30 fps cap, Artemis was stuck in landscape until Auto Orientation was on, and closing Artemis only paused the session, leaving the portrait stuck on the phone's display.

Each step is a small milestone that can be tested on its own:

1. **7a: Packaging works.** `npm run package` / `npm run make` include koffi and tesseract.js (copied in, e.g. with a `packageAfterCopy` hook, and unpacked from the asar), and the OCR language data is bundled rather than downloaded on first use. The Squirrel installer then gives a normal install with auto-updates. Nothing can be shared before this.
2. **7b: A "Phone setup" checklist page in the picker (detect only).** Each row shows ✅ or ⚠️ and how to fix it. Every check is one that was done by hand with PowerShell during 4a:
   - Apollo installed (its uninstall registry entry) and running (the `ApolloService` service).
   - Apollo's virtual display driver present: "SudoMaker Virtual Display Adapter" (the same lookup as `displayAdapterAt()`).
   - No other virtual display drivers (Parsec and similar), which Apollo advises removing.
   - A phone is paired, with "Always use virtual display" on and no display mode override.
   - The phone's display while connected: size and scaling (the picker's pill already has these).
   - Tailscale installed, and the PC's `100.x.x.x` address to type into Artemis.
3. **7c: One-click fixes through Apollo's web API** (port 47990, the same service as its settings page, with the user's Apollo login). Check the exact endpoints and options against Apollo's source before building on them.
   - Add the app's own **"VN Mobile" app entry** with "Always use Virtual Display", instead of asking users to edit Desktop (that leaves their normal Desktop streaming alone).
   - Clear per-phone overrides like the display mode.
   - If it works out: have that app entry launch VN Mobile, so connecting from Artemis starts everything.
   - Setting Apollo's web login from the command line (Sunshine-based servers support this) could make first-time setup smoother.
   - Store the Apollo password with Electron's `safeStorage` (encrypted), never in a plain JSON file.
4. **7d: Pairing help.** Show Apollo's one-time pairing PIN (or a QR code) in the picker, so the user never opens Apollo's web page.
5. **7e: Detailed phone steps** for what the PC can't do, with screenshots, in the checklist page:
   - Install Artemis from its official download page (a QR code to it).
   - Pair with the PIN from 7d.
   - In Artemis's settings: **Auto Orientation** on, video resolution set to **Native** (or a custom resolution matching the phone, short side first).
   - On the phone: auto-rotate on. On Samsung phones, Display → Screen resolution decides "native": FHD+ is the better choice for streaming.
   - Connect to the "VN Mobile" entry holding the phone upright.
   - When done, **Quit session** (long-press the PC in Artemis), not just close the app, or the phone's display stays behind. Otherwise, use the picker's PC / Phone switch.
   - Install Tailscale on both and sign in with the same account; in Artemis, add the PC by its Tailscale address to play away from home.
6. **Avoid:** bundling Apollo's installer inside the app (download it from Apollo's official releases instead: bundling ties the app to one Apollo version), and editing Apollo's config files directly (they're in Program Files, need admin rights, and can break while Apollo is running; its web API is the supported way in).
