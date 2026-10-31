---
name: ocr-tests
description: Check OCR tests the user saved (from the phone's Menus sheet, marked "unchecked", or from the picker), fill in the text each frame really shows, find out why the app read it wrong, fix it with the OCR bench before and after, and commit. Use this whenever the user says they saved an OCR test (or "ocr submission"), sends a phone screenshot where the text box shows wrong, garbled or missing text, or a wrong speaker name, or asks to look at their OCR tests, even if they don't say "OCR".
---

# Checking saved OCR tests

The user reads visual novels on their phone through this app. When a line
shows wrong, they tap **Save as OCR test** in the Menus sheet's Debug
drop-down (or use the picker's Debug page) and tell you. Each test is a frame
of the game plus what the app showed. Your job: work out what the game really
showed, why the app got it wrong, and fix that without breaking other tests.

Tests live in `%APPDATA%\mobile-novel\ocr-tests\` (`$APPDATA/mobile-novel/ocr-tests`
in Bash), as `<game>-<date>.png` and `.json`. They're kept out of the repo on
purpose: the repo is public and the frames are the games' art. Never copy them
into it.

## 1. Find the tests to check

Phone saves are marked `"unchecked": true`: the phone can't be typed in, so
their expected text is only what the app showed, and the bench skips them.
List them, plus anything saved recently:

```bash
cd "$APPDATA/mobile-novel/ocr-tests" && for f in $(ls -t *.json); do
  node -e "const t=require('./$f'); if (t.unchecked) console.log('$f (unchecked)')"; done
ls -t | head -6
```

## 2. Fill in what the game really shows

For each test, read the JSON and **look at the PNG** (the Read tool shows
images). Then fill in, exactly as the game draws it:

- `expectedText`: the text box's line, joined into one line (the game's line
  breaks become spaces). Keep the game's punctuation as written ("..." stays
  three dots; a stammer like "O-Okay" keeps its letters).
- `expectedName`: the name plate's name, or `""` for narration.
- `expectedPage`: only for real full-screen text; paragraphs separated by a
  blank line.

Then delete `unchecked`. Keep `shownText` and `shownName`: they're the record
of what went wrong.

**Saved in full-screen text mode** (`text` is null and `page` is set), but the
frame shows an ordinary text box? Then the app wrongly switched to full-screen
text. That's a separate bug (`src/auto-page.ts`), not OCR. Turn the test into
a text-box test so it still checks the reading: copy `text` and `name` from
the game's profile, `$APPDATA/mobile-novel/games/<exe>.json` → `regions`, and
drop `page` and `expectedPage`.

Write the JSON back with `node` (`JSON.stringify(test, null, 2)`) so the file
stays valid.

## 3. See what happened

If the app runs from this session's terminal (`npm run start:debug`), read it
with `read_terminal`. The lines around the save show:

- `OCR 35% 47ms: Ah... (dropped: ee - - - -)`: each read, how sure it was,
  and the words dropped as junk.
- `[memory text] …`: whether the game's memory found or corrected the line.

Then run the bench on the test, with every attempt shown:

```bash
npm run ocr-bench -- --only <test name> --verbose
```

It reads the frame at 100%, 80% and 60% size, the way the portrait does.

## 4. Find the cause

Where each kind of fault lives (see CLAUDE.md for the full rules):

| What you see                              | Where to look                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Wrong letters ("0-Okay", "777" for "???") | `fixCommonMistakes` in `src/ocr.ts`                                                    |
| Right text read but shown empty (low %)   | `looksLikeText`, `hasWriting`, `MIN_CONFIDENCE` in `src/text-reader.ts`                |
| Junk words from the frame or art          | word filters in `readText` in `src/ocr.ts`                                             |
| Only dots, read as nothing                | `readDots` in `src/text-reader.ts`                                                     |
| Wrong mode, junk around the line          | `src/auto-page.ts`                                                                     |
| Memory didn't correct it                  | `src/memory-text.ts` (it needs a run of 8 to 12 letters from OCR's read to search for) |

Check a theory before keeping a fix. A change that doesn't move the bench gets
undone, not committed "just in case".

## 5. Fix, and prove it with the bench

Compare the change with the last commit across **all** tests:

```bash
npm run ocr-bench -- HEAD
```

The fix should turn the new test right and change nothing else: no test that
was right goes wrong, and **made up** (text read in empty boxes) doesn't go
up. Showing the wrong text is worse than showing none.

Some misses are already known (see the bench's list; e.g. the mouse pointer in
`katawa-shoujo-nvl-page`). Don't chase those unless asked.

## 6. Commit and tell the user

Run the checks (`npm run typecheck`, `npm run lint`), then commit and push per
CLAUDE.md's git workflow: one change per commit, naming the test and the bench
result in the message. Update CLAUDE.md where it describes the rule you
changed.

Which changes need an app restart:

- **Restart:** main-process files (`ocr.ts`, `memory-text.ts`, `main.ts`).
- **Live in their running app:** renderer files (`text-reader.ts`,
  `auto-page.ts`, CSS).

Offer the restart; it loses unsaved edits.

Report each test in plain words: what the game showed, what the app showed,
why, and what changed. Then the bench before and after (tests right, made up).
If a test shows a problem OCR can't solve, say so and suggest what could
(e.g. memory).
