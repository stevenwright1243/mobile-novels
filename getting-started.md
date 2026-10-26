# VN Mobile App: how to start

This is the project's planning doc. It assumes a **Windows PC** (where most VNs and Sunshine live).

## Status (as of 2026-10-25)

**Read this first when picking the project up in a new chat or tool.**

**Done:** milestones 1a–1c, 2, 3a and 3d (see the table in section 3).
- The picker window lists open windows and saved **game profiles**. The portrait window draws the background and text zone live.
- Regions are edited with handles, snapping (toggle, or hold Alt to flip it), an exact-pixel X/Y/W/H panel, a size lock and arrow-key nudging.
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
- `npm run package` doesn't include koffi yet. Forge's Vite plugin only packages `.vite/`. `npm start` is fine.
- No landscape layout for the portrait.
- A game that was maximized may come back un-maximized after auto-restore.

**Next step: Milestone 3b.**
- A button row in the portrait (Advance / Back / Skip / Auto / Menu) that sends keys or clicks *button regions* drawn in the picker.
- Size the text zone's row to the text region's shape, to remove the black gaps.
- Remove the menu bar from the portrait window.

Then 3c (raw mode: the whole game letterboxed, with 1:1 taps), then Milestone 4 (Apollo + Tailscale).

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
4. **Input**: taps on the phone have to end up as clicks/keys in the *game*, not just in your app.

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
- **The capture includes the window's title bar and borders.** To leave them out, the app asks Windows (through koffi) where the game's *client area* is: the window minus title bar, borders and menu bar. Regions are measured against that. How it varies between games:
  - Normal windowed games: the title bar is removed exactly.
  - Borderless or fullscreen-windowed games: there's no title bar, so nothing is removed, which is correct.
  - Games that draw their *own* title bar inside the window (like VS Code or Discord do): Windows counts it as content, so it stays. Draw your regions to leave it out.
  - Exclusive-fullscreen games may not capture at all. Switch them to windowed or borderless.
- **Minimized games can't be captured or clicked.** Windows doesn't draw minimized windows, and most engines pause their game loop when minimized. A game that's only *covered* by other windows keeps running fine. So the app checks once a second and, if the selected game is minimized, restores it *without focusing it* and pushes it behind all other windows. Use the picker's **Send game to back** button instead of minimizing.

### Reformat
- A "calibration" screen where you drag rectangles over a screenshot of the game: *background area*, *text box*, *name box*, *menu buttons*. Save those per game in a **game profile**.
- **Game profiles:** one JSON file per game in `%APPDATA%\mobile-novel\games\`, named after the game's `.exe` (e.g. `totono_steam.exe.json`), so it survives window-title changes. It holds the exe path, last window title, click method, regions, the game's pixel size and when it was last played. The picker's **Your games** list shows each profile as a card with an *Open / Not running* badge. Clicking an open game's card picks its window. **Saving is manual:** changes apply live, but the file is only written when you click **Save profile** (or press Ctrl+S). Switching games or closing the app with unsaved changes asks whether to save them.
- **Drawing snaps** to the game picture's sides and to the other regions' edges, so regions can sit flush against each other. Hold Alt to place freely.
- **Regions are stored as fractions of the game's content (0 to 1), not pixels.** For example, `{ "x": 0.05, "y": 0.72, "w": 0.9, "h": 0.25 }`. That way they still line up if the game window is moved, resized, or run at another resolution.
- **"Set text zone" setting (the first calibration tool).** A button in the main window turns the live game preview into a drawing surface. You click and drag a rectangle over the game's text box, and that rectangle becomes the region the portrait view shows in its text zone:
  - While dragging, an outline follows the mouse. After you let go it stays visible, so you can see what's being captured, and dragging again replaces it.
  - The mouse position is converted to fractions of the *game frame*, not of the preview element. The preview is letterboxed (`object-fit: contain`), so the black bars have to be subtracted first. The video's `videoWidth`/`videoHeight` give the real frame size.
  - The region goes main window → main process → portrait window over IPC, and the portrait's text zone switches to the new crop immediately, live.
  - Later, the same region is what gets OCR'd (see *Text* below), and Milestone 2 reuses this drag tool for the other regions and saves them per game.
- **The portrait view uses responsive layout, not a fixed 1080x1920 canvas.** It has to fit whatever resolution Apollo picks for the phone, or a resizable window while testing. The principles:
  - **CSS Grid with named areas for the zones** (background, name, text box, buttons). For example: `grid-template-areas: 'bg' 'name' 'text' 'buttons'` with `grid-template-rows: 3fr auto 2fr auto`. `fr` units share out the space. Rearranging the layout, such as for landscape, means changing only the area map, not the HTML. A layout can then live in the per-game JSON as data.
  - **Flexbox only for one-dimensional rows**, like the button row.
  - **No fixed pixel sizes.** Zones take shares (`fr`). Text and buttons scale with `clamp()`, e.g. `font-size: clamp(1rem, 4vw, 2rem)`, so they're never too small or too huge.
  - **Media or container queries for big shape changes** (portrait vs landscape, very narrow screens), instead of separate layouts per resolution.
  - **Canvases need code to be responsive.** CSS stretches the canvas *box*, but its drawing is in pixels:
    - A `ResizeObserver` resets each canvas's pixel size to its box size × `devicePixelRatio`, so it stays sharp on high-resolution phone screens.
    - The drawing code chooses *contain* (show the whole crop, with bars) or *cover* (fill the zone, trim the edges): contain for the text box so no text is lost, cover for the background.
- **Text, in stages:**
  1. *First:* just show the text box as an enlarged image crop. Zero extra work, already readable.
  2. *Then real text:* **Textractor** hooks most VN engines and pulls out the actual text (very reliable, especially for Japanese VNs). It has plugins that can forward text over a WebSocket, which Electron can read easily. Fallback for games it can't hook: OCR the text box region (`tesseract.js`, or Windows' built-in OCR).
  3. *Later:* AI fun (sprite cutouts, translation, etc.).

### Stream
- Sunshine streams a whole **monitor**, not a window. So the trick is a **virtual portrait monitor**: the game sits on your real screen, your Electron view goes fullscreen on the virtual one, and Sunshine streams only that.
- **Apollo** (a Sunshine fork) creates a virtual display matching the phone's resolution automatically when Moonlight connects, which is exactly this use case. Plain Sunshine plus a virtual display driver also works. Try Apollo first.

### Input and different networks
- **This is mostly solved already.** Moonlight sends touch, mouse and keyboard from the phone to the PC. It has a touchpad/mouse mode, and a Bluetooth mouse paired to your phone works too. You don't need to build your own remote-input system.
- **Different networks:** install **Tailscale** on the PC and phone, then point Moonlight at the PC's Tailscale address. No router port-forwarding. Free for personal use.
- **The real problem is translation and focus.** A tap lands on your Electron window, so the app has to work out "that was the Skip button" or "that was at (x, y) in the game" and then send that click or key to the game. Two catches:
  - Electron can't click on other windows by itself. You need a small native helper. The easiest route in a Node app is calling Windows' `SendInput`/`PostMessage` through **koffi** (an FFI library, no C++ compiling). `robotjs` and `nut.js` exist too, but robotjs is unmaintained and nut.js moved to a paid license.
  - Clicking your window takes focus away from the game, and some VNs pause or ignore input when they're not focused. Usually the fix is to briefly focus the game, send the input, then refocus your app. Or send messages straight to the game window, which works for some engines.
  - **Map taps through the same fractions:** tap position inside a zone → fraction of that zone's region → fraction of the game window → real pixel position using the game window's *current* position, looked up from its HWND at click time. Nothing depends on where the game sits on screen.
  - **Two ways to deliver a click**, and which one works depends on the game's engine:
    - *Posted messages* (`PostMessage` with `WM_LBUTTONDOWN`/`UP`): sent straight to the game window. No cursor movement and no focus change, but engines that read raw input ignore them.
    - *Simulated mouse* (`SendInput`): brings the game to the front, moves the real cursor there, clicks, and moves it back. Works almost everywhere, at the cost of a visible cursor jump.
  - The portrait window is created with `focusable: false`, so tapping it never takes focus from the game.
  - **This is the riskiest part, so test it early** (Milestone 3).
- Safety net: a "raw mode" toggle that shows the whole game, letterboxed, where every tap maps 1:1. That way you can always reach settings screens your layout doesn't cover.

## 3. Milestones (each one small and testable)

| # | Goal | Done when |
|---|------|-----------|
| 0 | Setup | Forge app opens a window from VS Code; repo on GitHub |
| 1 | **Capture + layout** | 1a: pick the VN window from a list and see it live. 1b: a responsive portrait window (Grid zones, canvases sized with `ResizeObserver`) shows the cropped background on top and the text box enlarged below, live, and still fits when you resize the window. 1c: a "Set text zone" button lets you drag a rectangle over the live preview, and the portrait's text zone switches to that crop live |
| 2 | Calibration | Reuse the 1c drag tool for the background too. Regions save automatically per game as JSON (fractions of the window, not pixels) and load when you pick that game again. Now part of each game's profile, keyed by `.exe`. Name box and button regions are deferred: the name box only when a game needs it, buttons to Milestone 3 |
| 3 | Input bridge | 3a ✅: tapping anywhere in the portrait clicks the same spot in the game, with two delivery methods (posted messages vs simulated mouse). The portrait window never takes focus from the game. *Result: "YOU and ME and HER" accepts both methods; minimized games are auto-restored behind other windows.* 3b: save the working method per game, and add a portrait button row (Advance, Back, Skip, Auto, Menu…) that sends keys or clicks button regions drawn in the picker. 3c: raw mode: the whole game letterboxed, taps map 1:1. 3d ✅: identify games by their `.exe` instead of window title (titles can change per chapter). Done as part of game profiles, which also save the click method per game (originally planned for 3b) |
| 4 | Streaming | Apollo + Tailscale: play from your phone on mobile data |
| 5 | Real text | Textractor → WebSocket → nicely styled text in the app; OCR fallback |
| 6+ | Creative | Sprite extraction, themes, per-game presets, history log |

**Start with Milestone 1.** It shows results fast, and everything else builds on it. You can test streaming (4) whenever you like, since it doesn't depend on your code.

## 4. Working with Claude Code

- Open the project folder in VS Code and run Claude Code there. Run `/init` once the scaffold exists so it writes a `CLAUDE.md` about your project. Add a line like "I'm returning to programming after ~7 years and new to TypeScript; explain unfamiliar patterns briefly."
- Use **plan mode** (Shift+Tab) for each milestone: ask for a plan, read it, then let it build.
- Keep requests milestone-sized. For example: *"Add a window picker using desktopCapturer and show the selected window live in a video element."*
- Commit after each working step (`git commit`), so you can roll back when something goes wrong.
- Ask it "why" freely. Having it explain its code is the fastest way to relearn.
- **Expect pushback on outdated ideas.** Some of my knowledge is years old. When I suggest a technique and there's a better current best practice, Claude should say so, explain why it's better, and urge me to consider it before building. Example: I suggested flexbox for the zones, and CSS Grid with named areas turned out to fit better. This rule is also in `CLAUDE.md`, so it applies in every session.

### A first prompt you can paste into Claude Code (after scaffolding)
> This is an Electron Forge + Vite + TypeScript app. I want a window that lists open windows using desktopCapturer, lets me pick one, and shows it live. Then add a second "portrait" window laid out with CSS Grid named areas, each zone holding a canvas that a ResizeObserver keeps sized to its box (times devicePixelRatio). Draw two hard-coded regions of that capture into them, given as fractions of the game window: a background crop (cover) in a top zone (3fr) and a text-box crop (contain) in a bottom zone (2fr). Keep it simple and explain the main-process vs renderer split as you go.
