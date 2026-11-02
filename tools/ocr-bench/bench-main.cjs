// The bench's Electron main process (started by run.mjs): loads one built
// version's ocr.cjs, opens a hidden page running its reader.js, and runs
// every test through it, the way the portrait does. Writes results.json.

const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { dir, tests, scales, repo, verbose } = JSON.parse(process.env.OCR_BENCH);

// The built ocr.cjs asks for koffi, which lives in the repo's node_modules,
// not next to the build.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'koffi') {
    request = path.join(repo, 'node_modules/koffi');
  }
  return resolve.call(this, request, ...rest);
};

// A browser profile of its own, so it can't clash with the running app.
app.setPath('userData', path.join(dir, 'profile'));

app.whenReady().then(async () => {
  const { readText } = require(path.join(dir, 'ocr.cjs'));
  let ocrMs = 0;
  ipcMain.handle('read-text', async (_event, png) => {
    const started = performance.now();
    let result;
    try {
      result = await readText(png);
    } catch (error) {
      // Every read would fail the same way (OneOCR not loading, say), and
      // each test would wait out its timeout: stop now, with the reason.
      console.error(`BENCH:error ${error.stack ?? error}`);
      app.exit(1);
      return null;
    }
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
    // Progress for run.mjs, which shows a dot per read.
    console.error(`BENCH:scale ${scale * 100}`);
    for (const test of tests) {
      for (const kind of ['text', 'name', 'page']) {
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
            {
              text: { textBox: true },
              name: {},
              page: { page: true },
            }[kind],
          )})`,
        );
        console.error('BENCH:read');
        results.push({
          id: test.id,
          kind,
          scale,
          got,
          expected: {
            text: test.expectedText,
            name: test.expectedName,
            page: test.expectedPage,
          }[kind],
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
