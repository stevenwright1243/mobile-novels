/**
 * The line shown, its speaker and the history log (main process).
 *
 * Main gives it each line and name as they're read (after memory-text.ts has
 * had its say), and it decides what shows: a name only changes along with the
 * line, so it always belongs to the line on screen, and the history log keeps
 * each line with its speaker. It has no Electron in it: it's given its clock
 * and what to call when the line or speaker changes, so it can be tested on
 * its own (line.test.ts).
 */

// How many lines the history log keeps.
const HISTORY_LENGTH = 30;
// The name box and the text box are read separately, so a new speaker can be
// confirmed a moment after their line. A speaker arriving this soon after a
// line (in milliseconds) is taken to be that line's.
const SPEAKER_CATCH_UP = 2000;

export interface LineOptions {
  // The time in milliseconds (`performance.now()` in the app).
  now: () => number;
  // Called with the line each time it's shown, changed or not.
  onLineChanged: (text: string) => void;
  // Called with the speaker each time it's shown ('' for narration).
  onSpeakerChanged: (speaker: string) => void;
}

export type Line = ReturnType<typeof createLine>;

// A fresh line, speaker and history log. Its state lives in the variables
// below, which only the returned functions can reach (a closure).
export function createLine({
  now,
  onLineChanged,
  onSpeakerChanged,
}: LineOptions) {
  // The line shown.
  let text = '';
  // Who's speaking ('' for narration): the name shown, which only changes
  // along with the line (see `nameRead`), and the name box's latest read.
  let speaker = '';
  let latestName = '';
  // The history log: the last lines shown, oldest first.
  let history: HistoryEntry[] = [];
  // When the line last changed.
  let changedAt = 0;

  // Shows a new speaker, and if the line was just shown, it's that line's
  // speaker, so its history entry is corrected too.
  function changeSpeaker(name: string) {
    speaker = name;
    onSpeakerChanged(speaker);
    const last = history.at(-1);
    if (last?.line === text && now() - changedAt < SPEAKER_CATCH_UP) {
      history = [...history.slice(0, -1), { ...last, speaker }];
    }
  }

  // Clears the line and speaker, and forgets the name box's latest read.
  function clear() {
    text = '';
    speaker = '';
    latestName = '';
    onLineChanged(text);
    onSpeakerChanged(speaker);
  }

  return {
    get text() {
      return text;
    },
    get speaker() {
      return speaker;
    },
    get history() {
      return history;
    },

    // Shows a line ('' when no text box shows): OCR's read, or the game's own
    // text from its memory.
    show(line: string) {
      if (line !== text) {
        changedAt = now();
      }
      text = line;
      onLineChanged(text);
      // Add it to the history log, unless it's empty (no text box showing) or
      // the same line again (the box was hidden and shown again). `.at(-1)`
      // is the last item; `.slice(-N)` keeps the last N.
      if (line && line !== history.at(-1)?.line) {
        history = [...history, { speaker, line }].slice(-HISTORY_LENGTH);
      }
      // The text moved on, so the name box's latest read is now shown.
      if (latestName !== speaker) {
        changeSpeaker(latestName);
      }
    },

    // The game's own text for a line OCR read, found a moment later: it
    // replaces the read if that's still shown, in the history log too.
    correct(read: string, line: string) {
      if (text !== read) {
        return;
      }
      text = line;
      onLineChanged(text);
      const last = history.at(-1);
      if (last?.line === read) {
        history = [...history.slice(0, -1), { ...last, line }];
      }
    },

    // The name box's latest read ('' for none). Every change, a name
    // appearing, going or switching, shows along with the line (`show` shows
    // the latest read then), so the name always belongs to the line on
    // screen. A name read just after the line changed belongs with that line,
    // so it shows at once.
    nameRead(name: string) {
      latestName = name;
      const justChanged = now() - changedAt < SPEAKER_CATCH_UP;
      if (name !== speaker && justChanged) {
        changeSpeaker(name);
      }
    },

    // The game's window closed. The history log stays, so it can still be
    // looked back over (after a crash, say) until another game is picked.
    clearLine() {
      clear();
    },

    // Another game was picked: the last game's line and history log no
    // longer apply.
    newGame() {
      history = [];
      clear();
    },
  };
}
