/**
 * How alike two texts are, for telling whether two reads are the same text
 * despite a letter or two being different (OCR's mistakes). Shared by the
 * portrait's full-screen page (page-view.ts) and main's memory reader
 * (memory-text.ts).
 */

// How many letters must change to turn one text into the other (the "edit
// distance"), worked out a row at a time.
export function distance(a: string, b: string) {
  return prefixDistances(a, b)[b.length];
}

// The edit distance from `a` to every start of `b`: entry `j` is the
// distance to `b`'s first `j` letters. The last row of the same table as
// `distance`, so it costs no more.
export function prefixDistances(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous;
}

// How alike two texts are, from 0 (nothing alike) to 1 (the same).
export const similarity = (a: string, b: string) =>
  1 - distance(a, b) / Math.max(a.length, b.length, 1);
