# VN Mobile App: how to start

This is a planning doc, not code yet. It assumes a **Windows PC** (where most VNs and Sunshine live). If you're on something else, say so and parts change.

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

### Reformat
- A "calibration" screen where you drag rectangles over a screenshot of the game: *background area*, *text box*, *name box*, *menu buttons*. Save those per game as a small JSON file.
- The portrait window then draws: the background region cropped/scaled to fill the top, the text box region enlarged below it, and a row of big buttons (Menu, Skip, Auto, Back, etc.).
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
  - **This is the riskiest part, so test it early** (Milestone 3).
- Safety net: a "raw mode" toggle that shows the whole game, letterboxed, where every tap maps 1:1. That way you can always reach settings screens your layout doesn't cover.

## 3. Milestones (each one small and testable)

| # | Goal | Done when |
|---|------|-----------|
| 0 | Setup | Forge app opens a window from VS Code; repo on GitHub |
| 1 | **Capture + layout** | Pick the VN window from a list. A 1080x1920 window shows a cropped background on top and the text box enlarged below, live |
| 2 | Calibration | Drag rectangles to define regions, saved per game as JSON |
| 3 | Input bridge | Clicking "Advance" or a mapped region in your window makes the game advance/click. Raw mode works |
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

### A first prompt you can paste into Claude Code (after scaffolding)
> This is an Electron Forge + Vite + TypeScript app. I want a window that lists open windows using desktopCapturer, lets me pick one, and shows it live. Then add a second "portrait" window that draws two hard-coded regions of that capture onto canvases: a background crop scaled to fill the top 60%, and a text-box crop scaled to fill the bottom 40%. Keep it simple and explain the main-process vs renderer split as you go.
