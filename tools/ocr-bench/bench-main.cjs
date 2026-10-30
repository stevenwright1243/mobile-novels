// The bench's Electron main process (started by run.mjs): loads one built
// version's ocr.cjs, opens a hidden page running its reader.js, and runs
// every test through it, the way the portrait does. Writes results.json.

const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { dir, tests, scales, userData, repo, verbose } = JSON.parse(
  process.env.OCR_BENCH,
);

// The built ocr.cjs asks for tesseract.js, which lives in the repo's
// node_modules, not next to the build.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'tesseract.js') {
    request = path.join(repo, 'node_modules/tesseract.js');
  }
  return resolve.call(this, request, ...rest);
};

// A browser profile of its own, so it can't clash with the running app.
app.setPath('userData', path.join(dir, 'profile'));

app.whenReady().then(async () => {
  // ocr.ts keeps Tesseract's language data in the app's own folder.
  app.setPath('userData', userData);
  const { readText } = require(path.join(dir, 'ocr.cjs'));
  let ocrMs = 0;
  ipcMain.handle('read-text', async (_event, png) => {
    const started = performance.now();
    const result = await readText(png);
    ocrMs += performance.now() - started;
    // With --verbose, every OCR attempt (a box is read at least twice, and
    // retried other ways when the read fails), as in debug mode's log.
    if (verbose) {
      const dropped = result.dropped?.length
        ? ` (dropped: ${result.dropped.join(' ')})`
        : '';
      console.log(
        `    OCR ${result.confidence}%: ${JSON.stringify(result.text)}${dropped}`,
      );
    }
    return result;
  });

  const page = new BrowserWindow({
    show: false,
    webPreferences: {
      // The page loads the frames and reader.js from disk.
      webSecurity: false,
      contextIsolation: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'bench-preload.cjs'),
    },
  });
  await page.loadFile(path.join(__dirname, 'bench-page.html'), {
    query: { reader: path.join(dir, 'reader.js') },
  });

  const results = [];
  for (const scale of scales) {
    for (const test of tests) {
      for (const kind of ['text', 'name']) {
        if (!test[kind]) {
          continue;
        }
        const before = ocrMs;
        if (verbose) {
          console.log(`  ${test.id} ${kind} at ${scale * 100}%`);
        }
        const got = await page.webContents.executeJavaScript(
          `runTest(${JSON.stringify(test.image)}, ${scale}, ${JSON.stringify(test[kind])}, ${JSON.stringify(
            // The same options the portrait gives each box (portrait.ts).
            kind === 'text' ? { textBox: true } : { retryFlattened: true },
          )})`,
        );
        results.push({
          id: test.id,
          kind,
          scale,
          got,
          expected: kind === 'text' ? test.expectedText : test.expectedName,
          ms: Math.round(ocrMs - before),
        });
      }
    }
  }
  fs.writeFileSync(
    path.join(dir, 'results.json'),
    JSON.stringify(results, null, 1),
  );
  app.exit(0);
});
