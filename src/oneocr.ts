/**
 * OneOCR: the OCR engine inside Windows 11's Snipping Tool (oneocr.dll),
 * called through koffi. Main process only. Far better on game text than
 * Tesseract, which the app used before (see tools/ocr-shootout on the
 * ocr-shootout branch: 0.3% of letters wrong against 6.2%, and no line
 * missed, in half the time).
 *
 * It isn't a public part of Windows: its functions and the key its model
 * file is opened with come from the `oneocr` Python package
 * (github.com/AuroraWright/oneocr), and a Snipping Tool update could change
 * them. The app can't ship it (it's Microsoft's), so it uses the user's own
 * Snipping Tool's files. `recognize()` is all the rest of the app sees, so
 * another engine could take its place.
 */

import { app, nativeImage } from 'electron';
import koffi from 'koffi';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadLibraryNextTo, packageFolder } from './win32';

// The Snipping Tool's package family, the same in every version.
const SNIPPING_TOOL = 'Microsoft.ScreenSketch_8wekyb3d8bbwe';
// The engine's files, in the Snipping Tool's SnippingTool folder.
const FILES = ['oneocr.dll', 'oneocr.onemodel', 'onnxruntime.dll'];
// The key the Snipping Tool opens its model file with.
const MODEL_KEY = 'kj)TGtrK>f]b[Piow.gU+nC@s""""""4';
// It won't read a picture with a side shorter than this.
const MIN_SIDE = 50;

/** A box's edges, in pixels from the picture's top-left corner. */
export interface Edges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
/** A word read: its text, how sure OneOCR is (0 to 100) and where it is. */
export type OcrWord = Edges & { text: string; confidence: number };
/** A line read: where it is, and its words from left to right. */
export type OcrLine = Edges & { words: OcrWord[] };

type Engine = ReturnType<typeof load>;
// Loaded on the first read and kept, since loading the model takes a second.
// If loading fails, so does every read, without trying again.
let engine: Promise<Engine> | null = null;

// Windows won't load a DLL from a Store app's folder into another program
// ("access denied", though the files can be read), so the engine's files are
// copied into the app's own folder first: once, and again when the Snipping
// Tool is updated (its folder is named after its version, noted beside the
// copy in `from.txt`). About 115 MB.
async function copyOfEngine() {
  const root = packageFolder(SNIPPING_TOOL);
  if (!root) {
    throw new Error(
      "the Snipping Tool isn't installed (get it from the Microsoft Store)",
    );
  }
  const dir = path.join(app.getPath('userData'), 'oneocr');
  const note = path.join(dir, 'from.txt');
  const copiedFrom = await readFile(note, 'utf8').catch(() => null);
  if (copiedFrom !== root) {
    await mkdir(dir, { recursive: true });
    for (const file of FILES) {
      await copyFile(
        path.join(root, 'SnippingTool', file),
        path.join(dir, file),
      );
    }
    await writeFile(note, root);
  }
  return dir;
}

// The DLL's functions return 0 when they work, and hand back handles (to a
// result, a line, a word) and values through `_Out_` arguments, which koffi
// writes into the one-item arrays passed for them.
function load(dir: string) {
  loadLibraryNextTo(path.join(dir, 'oneocr.dll'));
  const dll = koffi.load(path.join(dir, 'oneocr.dll'));
  const IMAGE = koffi.struct('OneOcrImage', {
    type: 'int32_t',
    width: 'int32_t',
    height: 'int32_t',
    reserved: 'int32_t',
    step: 'int64_t',
    data: 'uint8_t *',
  });
  // A box's four corners, clockwise from the top-left.
  const BOX = koffi.struct('OneOcrBox', {
    x1: 'float',
    y1: 'float',
    x2: 'float',
    y2: 'float',
    x3: 'float',
    y3: 'float',
    x4: 'float',
    y4: 'float',
  });
  const f = (signature: string) => dll.func(signature);
  const api = {
    BOX,
    IMAGE,
    createInitOptions: f(
      'int64_t CreateOcrInitOptions(_Out_ int64_t *options)',
    ),
    setDelayLoad: f(
      'int64_t OcrInitOptionsSetUseModelDelayLoad(int64_t options, char delay)',
    ),
    createPipeline: f(
      'int64_t CreateOcrPipeline(const char *model, const char *key, int64_t options, _Out_ int64_t *pipeline)',
    ),
    createProcessOptions: f(
      'int64_t CreateOcrProcessOptions(_Out_ int64_t *options)',
    ),
    setMaxLines: f(
      'int64_t OcrProcessOptionsSetMaxRecognitionLineCount(int64_t options, int64_t count)',
    ),
    run: f(
      'int64_t RunOcrPipeline(int64_t pipeline, const OneOcrImage *image, int64_t options, _Out_ int64_t *result)',
    ),
    lineCount: f(
      'int64_t GetOcrLineCount(int64_t result, _Out_ int64_t *count)',
    ),
    line: f(
      'int64_t GetOcrLine(int64_t result, int64_t index, _Out_ int64_t *line)',
    ),
    lineBox: f(
      'int64_t GetOcrLineBoundingBox(int64_t line, _Out_ OneOcrBox **box)',
    ),
    wordCount: f(
      'int64_t GetOcrLineWordCount(int64_t line, _Out_ int64_t *count)',
    ),
    word: f(
      'int64_t GetOcrWord(int64_t line, int64_t index, _Out_ int64_t *word)',
    ),
    wordText: f(
      'int64_t GetOcrWordContent(int64_t word, _Out_ const char **text)',
    ),
    wordBox: f(
      'int64_t GetOcrWordBoundingBox(int64_t word, _Out_ OneOcrBox **box)',
    ),
    wordConfidence: f(
      'int64_t GetOcrWordConfidence(int64_t word, _Out_ float *confidence)',
    ),
    release: f('void ReleaseOcrResult(int64_t result)'),
  };
  const out = [0];
  api.createInitOptions(out);
  const init = out[0];
  api.setDelayLoad(init, 0);
  const model = path.join(dir, 'oneocr.onemodel');
  if (api.createPipeline(model, MODEL_KEY, init, out) !== 0) {
    throw new Error(`it couldn't open its model (${model})`);
  }
  const pipeline = out[0];
  api.createProcessOptions(out);
  const processOptions = out[0];
  api.setMaxLines(processOptions, 1000);
  return { ...api, pipeline, processOptions };
}

/** Loads OneOCR if it isn't yet; throws why, if it can't be. */
function getEngine() {
  engine ??= copyOfEngine()
    .then(load)
    .catch((error: Error) => {
      throw new Error(
        `OneOCR (the Snipping Tool's OCR) couldn't be loaded: ${error.message}`,
      );
    });
  return engine;
}

// A box's four corners as its top, bottom, left and right edges.
function edges(api: Engine, box: unknown): Edges {
  const b = koffi.decode(box, api.BOX) as Record<string, number>;
  return {
    top: Math.min(b.y1, b.y2, b.y3, b.y4),
    bottom: Math.max(b.y1, b.y2, b.y3, b.y4),
    left: Math.min(b.x1, b.x2, b.x3, b.x4),
    right: Math.max(b.x1, b.x2, b.x3, b.x4),
  };
}

/** Reads the text in a PNG: its lines, top to bottom. */
export async function recognize(png: Uint8Array): Promise<OcrLine[]> {
  const api = await getEngine();
  let picture = nativeImage.createFromBuffer(Buffer.from(png));
  let { width, height } = picture.getSize();
  // Too small: drawn bigger (only a tiny name box ever is).
  if (Math.min(width, height) < MIN_SIDE) {
    const grow = MIN_SIDE / Math.min(width, height);
    picture = picture.resize({
      width: Math.ceil(width * grow),
      height: Math.ceil(height * grow),
      quality: 'best',
    });
    ({ width, height } = picture.getSize());
  }
  // On Windows, `toBitmap()` gives BGRA pixels, which is what it reads.
  const image = {
    type: 3,
    width,
    height,
    reserved: 0,
    step: width * 4,
    data: picture.toBitmap(),
  };
  const out = [0];
  // On koffi's own thread, so main isn't held up while it reads.
  const failed = await new Promise<number>((resolve, reject) =>
    api.run.async(
      api.pipeline,
      image,
      api.processOptions,
      out,
      (error: Error | null, code: number) =>
        error ? reject(error) : resolve(code),
    ),
  );
  if (failed !== 0) {
    return [];
  }
  const result = out[0];
  const lines: OcrLine[] = [];
  try {
    api.lineCount(result, out);
    const lineCount = out[0];
    for (let i = 0; i < lineCount; i++) {
      api.line(result, i, out);
      const line = out[0];
      const lineBox = [null];
      api.lineBox(line, lineBox);
      const words: OcrWord[] = [];
      api.wordCount(line, out);
      const wordCount = out[0];
      for (let j = 0; j < wordCount; j++) {
        api.word(line, j, out);
        const word = out[0];
        const text = [''];
        const confidence = [0];
        const wordBox = [null];
        api.wordText(word, text);
        api.wordConfidence(word, confidence);
        api.wordBox(word, wordBox);
        words.push({
          text: text[0],
          confidence: confidence[0] * 100,
          ...edges(api, wordBox[0]),
        });
      }
      lines.push({ ...edges(api, lineBox[0]), words });
    }
  } finally {
    api.release(result);
  }
  return lines;
}
