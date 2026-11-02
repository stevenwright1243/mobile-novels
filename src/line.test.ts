/**
 * Tests for line.ts: the line shown, its speaker and the history log. Run
 * with `npm test`.
 *
 * The module is given its clock and what to do on each change, so these tests
 * pass a clock they move by hand and callbacks that record what the windows
 * would have been told.
 */

import { describe, expect, it } from 'vitest';
import { createLine } from './line';

function setup() {
  // `performance.now()` counts from the app's start, so reads never come at 0.
  let time = 10_000;
  const linesSent: string[] = [];
  const speakersSent: string[] = [];
  const line = createLine({
    now: () => time,
    onLineChanged: (text) => linesSent.push(text),
    onSpeakerChanged: (speaker) => speakersSent.push(speaker),
  });
  const wait = (ms: number) => {
    time += ms;
  };
  return { line, linesSent, speakersSent, wait };
}

describe('the line', () => {
  it('tells the windows about each line shown', () => {
    const { line, linesSent } = setup();
    line.show('Hello.');
    expect(line.text).toBe('Hello.');
    expect(linesSent).toEqual(['Hello.']);
  });

  it('adds each new line to the history log, but not empty or repeated ones', () => {
    const { line } = setup();
    line.show('Hello.');
    line.show('');
    line.show('Hello.');
    line.show('Goodbye.');
    expect(line.history.map((entry) => entry.line)).toEqual([
      'Hello.',
      'Goodbye.',
    ]);
  });

  it('keeps the last 30 lines in the history log', () => {
    const { line } = setup();
    for (let i = 1; i <= 35; i++) {
      line.show(`Line ${i}.`);
    }
    expect(line.history).toHaveLength(30);
    expect(line.history[0].line).toBe('Line 6.');
    expect(line.history.at(-1)?.line).toBe('Line 35.');
  });
});

describe('the speaker', () => {
  it('changes only when the next line comes', () => {
    const { line, speakersSent, wait } = setup();
    line.show('Hello.');
    wait(500);
    line.nameRead('Kana');
    wait(3000);
    line.nameRead('');
    // Kana was read along with the line; the name going away waits.
    expect(line.speaker).toBe('Kana');
    line.show('It was quiet.');
    expect(line.speaker).toBe('');
    expect(speakersSent).toEqual(['Kana', '']);
    expect(line.history.at(-1)).toEqual({ speaker: '', line: 'It was quiet.' });
  });

  it('shows at once when read within 2 seconds of a new line, fixing its history entry', () => {
    const { line, wait } = setup();
    line.show('Hello.');
    wait(1500);
    line.nameRead('Kana');
    expect(line.speaker).toBe('Kana');
    expect(line.history.at(-1)).toEqual({ speaker: 'Kana', line: 'Hello.' });
  });

  it('waits for the next line when read more than 2 seconds after one', () => {
    const { line, speakersSent, wait } = setup();
    line.show('Hello.');
    wait(2500);
    line.nameRead('Kana');
    expect(line.speaker).toBe('');
    expect(speakersSent).toEqual([]);
    line.show('Good morning.');
    expect(line.speaker).toBe('Kana');
    expect(line.history).toEqual([
      { speaker: '', line: 'Hello.' },
      { speaker: 'Kana', line: 'Good morning.' },
    ]);
  });
});

describe('a correction from memory', () => {
  it('replaces the line and its history entry while that read is shown', () => {
    const { line, linesSent } = setup();
    line.show('Helo.');
    line.correct('Helo.', 'Hello.');
    expect(line.text).toBe('Hello.');
    expect(linesSent).toEqual(['Helo.', 'Hello.']);
    expect(line.history.map((entry) => entry.line)).toEqual(['Hello.']);
  });

  it('does nothing once the read is no longer shown', () => {
    const { line, linesSent } = setup();
    line.show('Helo.');
    line.show('Goodbye.');
    line.correct('Helo.', 'Hello.');
    expect(line.text).toBe('Goodbye.');
    expect(linesSent).toEqual(['Helo.', 'Goodbye.']);
    expect(line.history.map((entry) => entry.line)).toEqual([
      'Helo.',
      'Goodbye.',
    ]);
  });
});

describe('clearing', () => {
  it('clearLine clears the line, the speaker and a waiting name, but keeps the history log', () => {
    const { line, linesSent, speakersSent, wait } = setup();
    line.show('Hello.');
    line.nameRead('Kana');
    wait(3000);
    line.nameRead('Yuuma');
    line.clearLine();
    expect(line.text).toBe('');
    expect(line.speaker).toBe('');
    expect(linesSent.at(-1)).toBe('');
    expect(speakersSent.at(-1)).toBe('');
    expect(line.history).toEqual([{ speaker: 'Kana', line: 'Hello.' }]);
    // Yuuma's read was forgotten, so the next line is narration.
    line.show('It was quiet.');
    expect(line.speaker).toBe('');
  });

  it('newGame also clears the history log', () => {
    const { line } = setup();
    line.show('Hello.');
    line.newGame();
    expect(line.text).toBe('');
    expect(line.history).toEqual([]);
  });
});
