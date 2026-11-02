/**
 * Tests for ocr.ts's clean-up of what OneOCR reads. Run with `npm test`.
 *
 * The real OneOCR needs Windows and a picture, so these tests swap it for a
 * stand-in (`vi.mock` below) that returns whatever lines a test gives it.
 * Each test then calls `readText` as the app does and checks what comes out,
 * so the rules are tested by what they do, not how they're written inside.
 */

import { describe, expect, it, vi } from 'vitest';
import { readText } from './ocr';
import { type OcrLine, recognize } from './oneocr';

// Replaces oneocr.ts with a module whose `recognize` is a mock function
// (`vi.fn()`): it does nothing until a test tells it what to return. Vitest
// moves this call above the imports, so ocr.ts gets the stand-in too.
vi.mock('./oneocr', () => ({ recognize: vi.fn() }));

const LINE_HEIGHT = 20;

// A line as OneOCR might return it: its words split at spaces, `top` pixels
// down, every word `confidence` sure. Where words sit left to right doesn't
// matter to the clean-up, so they all share the line's box.
function line(text: string, top = 0, confidence = 90): OcrLine {
  const edges = { top, bottom: top + LINE_HEIGHT, left: 0, right: 100 };
  return {
    ...edges,
    words: text
      .split(' ')
      .map((word) => ({ ...edges, text: word, confidence })),
  };
}

// Lines one under another with a small gap, as in one paragraph.
function lines(...texts: string[]) {
  return texts.map((text, i) => line(text, i * (LINE_HEIGHT + 2)));
}

// Runs `readText` as if OneOCR had read these lines.
async function read(...ocrLines: OcrLine[]) {
  // `vi.mocked` only tells TypeScript that `recognize` is a mock here.
  vi.mocked(recognize).mockResolvedValue(ocrLines);
  return readText(new Uint8Array());
}

describe('dots and quote marks read as words of their own', () => {
  it('joins dots to the word before them', async () => {
    expect((await read(line('Ah ...'))).text).toBe('Ah...');
    expect((await read(line('Hi ... Hisao'))).text).toBe('Hi... Hisao');
  });

  it('joins dots starting a line to the word after them', async () => {
    expect((await read(line('... I see'))).text).toBe('...I see');
  });

  it('joins a quote mark ending a line to the word before it', async () => {
    expect((await read(line('mmph... ”'))).text).toBe('mmph...”');
  });

  it('joins a quote mark starting a line to the word after it', async () => {
    const quoted = line('“ Hello');
    quoted.words[0].confidence = 8;
    const result = await read(quoted);
    expect(result.text).toBe('“Hello');
    // The joined word keeps the word's confidence, not the lone mark's.
    expect(result.confidence).toBe(90);
  });

  it('leaves a quote mark in the middle of a line alone', async () => {
    expect((await read(line('He said “ hi there'))).text).toBe(
      'He said “ hi there',
    );
  });
});

describe('lines read twice', () => {
  it('keeps only the longer of two overlapping lines', async () => {
    const result = await read(
      line('Most', 0),
      line("Most people? Who's most people?", 2),
    );
    expect(result.text).toBe("Most people? Who's most people?");
    expect(result.dropped).toEqual(['Most']);
  });

  it('keeps lines that sit one under another', async () => {
    expect((await read(...lines('First line,', 'second line.'))).text).toBe(
      'First line,\nsecond line.',
    );
  });
});

describe('common misreads', () => {
  it('turns | into I', async () => {
    expect((await read(line('| think so.'))).text).toBe('I think so.');
  });

  it('turns a lone l into I, but not an l inside a word', async () => {
    expect((await read(line('I-l did it'))).text).toBe('I-I did it');
    expect((await read(line('Hello all.'))).text).toBe('Hello all.');
  });

  it('turns two dots into three', async () => {
    expect((await read(line('N..'))).text).toBe('N...');
    expect((await read(line('Wait...'))).text).toBe('Wait...');
  });
});

describe('a lone letter or mark after a sentence ends', () => {
  it('drops a lone letter at the very end', async () => {
    const result = await read(line('I tried to read them. I'));
    expect(result.text).toBe('I tried to read them.');
    expect(result.dropped).toEqual(['I']);
  });

  it('drops a | there too', async () => {
    expect((await read(line('I tried to read them. |'))).text).toBe(
      'I tried to read them.',
    );
  });

  it('keeps it when the sentence goes on to the next line', async () => {
    expect(
      (await read(...lines('I tried to read them. I', 'wanted to know.'))).text,
    ).toBe('I tried to read them. I\nwanted to know.');
  });

  it('keeps it when no sentence ended before it', async () => {
    expect((await read(line("Let's go with plan B"))).text).toBe(
      "Let's go with plan B",
    );
  });

  it('drops a stray dash or comma mark at the end', async () => {
    expect((await read(line('to answer. -.'))).text).toBe('to answer.');
    expect((await read(line('to answer. ~~'))).text).toBe('to answer.');
  });

  it('keeps marks that can end a line', async () => {
    expect((await read(line('What? !?'))).text).toBe('What? !?');
  });
});

describe('paragraphs', () => {
  it('starts a new paragraph at a bigger gap between lines', async () => {
    const result = await read(
      line('The first line', 0),
      line('of a paragraph.', 22),
      // 13 pixels under the line above: 0.65 of a line's height.
      line('A new one.', 55),
    );
    expect(result.paragraphs).toEqual([
      'The first line of a paragraph.',
      'A new one.',
    ]);
  });

  it('drops a lone letter at the end of each paragraph', async () => {
    const result = await read(
      line('I tried to read them. I', 0),
      line('Then I gave up.', 35),
    );
    expect(result.paragraphs).toEqual([
      'I tried to read them.',
      'Then I gave up.',
    ]);
  });
});

describe('confidence', () => {
  it("is the kept words' average, rounded", async () => {
    const result = await read(line('Hello', 0, 80), line('there.', 22, 91));
    expect(result.confidence).toBe(86);
  });

  it('leaves out dropped words', async () => {
    const result = await read(
      line('I tried to read them.', 0, 90),
      line('I', 1, 5),
    );
    expect(result.text).toBe('I tried to read them.');
    expect(result.confidence).toBe(90);
  });

  it('is 0 when nothing is read', async () => {
    expect(await read()).toMatchObject({
      text: '',
      confidence: 0,
      paragraphs: [],
    });
  });
});
