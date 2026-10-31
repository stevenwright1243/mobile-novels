// OCR bench: runs the app's text reader on every saved OCR test (frames of
// games where it went wrong, saved from the picker's debug tools) and shows
// how many it gets right. With commits named, it builds and runs those too,
// to compare.
//
//   npm run ocr-bench                    the code as it is now
//   npm run ocr-bench -- HEAD~3 1fab162  ...and those commits, side by side
//   npm run ocr-bench -- --only aokana   only tests whose file names match
//   npm run ocr-bench -- --scales 1      only full size (default: 1, 0.8 and 0.6)
//   npm run ocr-bench -- --verbose       also every OCR attempt, to see why
//
// Each test runs at full size, 80% and 60% (small text is the weak spot,
// and the live capture can be any size in between). The
// tests live in %APPDATA%\mobile-novel\ocr-tests (see src/ocr-tests.ts).

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const userData = path.join(process.env.APPDATA ?? os.homedir(), 'mobile-novel');
const testsFolder = path.join(userData, 'ocr-tests');
const buildFolder = path.join(os.tmpdir(), 'mobile-novel-ocr-bench');
// The files the reader is made of; each version is built from these.
const SOURCES = ['src/ocr.ts', 'src/capture.ts', 'src/text-reader.ts'];

// --- Options ---
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args.splice(i, 2)[1];
};
const only = option('--only', '');
const verbose = args.includes('--verbose');
if (verbose) {
  args.splice(args.indexOf('--verbose'), 1);
}
const scales = option('--scales', '1,0.8,0.6').split(',').map(Number);
const versions = ['now', ...args];

// --- Tests ---
const saved = existsSync(testsFolder)
  ? readdirSync(testsFolder)
      .filter((file) => file.endsWith('.json') && file.includes(only))
      .map((file) => ({
        id: file.replace(/\.json$/, ''),
        image: path.join(testsFolder, file.replace(/\.json$/, '.png')),
        ...JSON.parse(readFileSync(path.join(testsFolder, file), 'utf8')),
      }))
  : [];
// Tests saved from the phone in one tap hold what the app showed, not the
// right text, until someone fills that in (and takes out `unchecked`).
const tests = saved.filter((test) => !test.unchecked);
const unchecked = saved.filter((test) => test.unchecked);
if (unchecked.length > 0) {
  console.log(
    `Skipped ${unchecked.length} unchecked OCR tests (fill in their right text, then remove "unchecked"):`,
  );
  for (const test of unchecked) {
    console.log(`  ${test.id}`);
  }
}
if (tests.length === 0) {
  console.log(`No OCR tests in ${testsFolder}.`);
  console.log(
    'Save some from the picker: npm run start:debug, then "Save as OCR test…".',
  );
  process.exit(0);
}

// --- Building a version ---
// The reader's files from git (or as they are now), bundled with rolldown:
// ocr.ts for the bench's main process, text-reader.ts for its page.
function build(version) {
  const dir = path.join(buildFolder, version.replace(/[^\w.-]/g, '_'));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const file of SOURCES) {
    const text =
      version === 'now'
        ? readFileSync(path.join(repo, file), 'utf8')
        : execFileSync('git', ['show', `${version}:${file}`], {
            cwd: repo,
            encoding: 'utf8',
          });
    writeFileSync(path.join(dir, file), text);
  }
  writeFileSync(
    path.join(dir, 'src/entry.ts'),
    "import { startTextReader } from './text-reader';\n(window as any).startTextReader = startTextReader;\n",
  );
  const rolldown = path.join(repo, 'node_modules/rolldown/bin/cli.mjs');
  const bundle = (...options) => {
    const result = spawnSync(process.execPath, [rolldown, ...options], {
      cwd: dir,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `Building ${version} failed:\n${result.stderr || result.stdout}`,
      );
    }
  };
  bundle(
    'src/ocr.ts',
    '--format',
    'cjs',
    '--platform',
    'node',
    '--external',
    'electron',
    '--external',
    'tesseract.js',
    '--file',
    'ocr.cjs',
  );
  bundle(
    'src/entry.ts',
    '--format',
    'iife',
    '--platform',
    'browser',
    '--file',
    'reader.js',
  );
  return dir;
}

// --- Running a version ---
// In Electron, since the reader needs a real page (canvases) and ocr.ts
// needs Electron's `app`. Results come back as JSON in the build folder.
function bench(version, dir) {
  const electron = createRequire(import.meta.url)('electron');
  const started = Date.now();
  const result = spawnSync(electron, [path.join(here, 'bench-main.cjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OCR_BENCH: JSON.stringify({
        dir,
        tests,
        scales,
        userData,
        repo,
        verbose,
      }),
    },
  });
  if (verbose) {
    console.log(`\n${version}:\n${result.stdout}`);
  }
  const file = path.join(dir, 'results.json');
  if (!existsSync(file)) {
    throw new Error(
      `Running ${version} failed:\n${(result.stderr || '').slice(-3000)}`,
    );
  }
  console.log(`  ${version}: ${Math.round((Date.now() - started) / 1000)}s`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

// --- Scoring ---
// Small differences that don't matter are evened out first: curly and
// straight quotes, "…" and "...", runs of spaces. Names are tidied like the
// portrait does (tidyName in portrait.ts). A page of full-screen text keeps
// its paragraph breaks (a blank line), as " ¶ ", so a missed or extra one
// counts.
const tidyName = (name) =>
  name.replace(/^[^\p{L}\p{N}?]+|[^\p{L}\p{N}?!]+$/gu, '');
const even = (text) =>
  text
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/\n\s*\n/g, ' ¶ ')
    .replace(/\s+/g, ' ')
    .trim();
// How many letters must change to turn one text into the other (the
// "edit distance").
function distance(a, b) {
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
  return previous[b.length];
}

console.log(
  `${tests.length} OCR tests, at ${scales.map((s) => `${s * 100}%`).join(' and ')}.`,
);
const scored = {};
for (const version of versions) {
  scored[version] = bench(version, build(version)).map((r) => {
    const got = even(r.kind === 'name' ? tidyName(r.got) : r.got);
    const expected = even(r.expected);
    return { ...r, got, expected, errors: distance(got, expected) };
  });
}

const summary = versions.map((version) => {
  const results = scored[version];
  const letters = results.reduce(
    (sum, r) => sum + Math.max(r.expected.length, 1),
    0,
  );
  const errors = results.reduce((sum, r) => sum + r.errors, 0);
  return {
    version,
    right: `${results.filter((r) => r.errors === 0).length}/${results.length}`,
    'letters wrong': `${((100 * errors) / letters).toFixed(1)}%`,
    'made up': results.filter((r) => r.expected === '' && r.got !== '').length,
    missed: results.filter((r) => r.expected !== '' && r.got === '').length,
    'OCR seconds': (results.reduce((sum, r) => sum + r.ms, 0) / 1000).toFixed(
      1,
    ),
  };
});
console.table(summary);

// Every read some version got wrong, with what each version read.
const first = scored[versions[0]];
first.forEach((r, i) => {
  if (versions.every((version) => scored[version][i].errors === 0)) {
    return;
  }
  console.log(`\n${r.id}  ${r.kind} at ${r.scale * 100}%`);
  console.log(`  ${'should be'.padEnd(12)} ${JSON.stringify(r.expected)}`);
  for (const version of versions) {
    const { got, errors } = scored[version][i];
    console.log(
      `  ${version.padEnd(12)} ${errors === 0 ? '✓' : JSON.stringify(got)}`,
    );
  }
});
