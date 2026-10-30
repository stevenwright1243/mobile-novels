/**
 * The picker's Sizes page: the same Sizes panel as the portrait's Menus
 * sheet (sizes-panel.ts), with its small copy of the reader screen
 * (sizes-sample.ts) drawn from the picker's preview of the game. The copy is
 * laid out at the portrait's own size, which the portrait reports (its
 * background zone fills it), and takes the reader's settings that the
 * portrait sets on its `.portrait`: the sizes, text position and arrow.
 */

import { getClientArea } from './capture';
import { buttonSize, backgroundYCap, textStyle } from './portrait-sizes';
import {
  backgroundYCapFor,
  copyToSample,
  drawSample,
  fitSample,
  sampleParts,
  sampleShown,
  setUpSample,
} from './sizes-sample';

const preview = document.querySelector<HTMLVideoElement>('#preview')!;
// The copy of the screen: a `.portrait` too, so the reader's rules in
// reader.css apply inside it.
const screen = document.querySelector<HTMLElement>('.sample-screen')!;
screen.classList.add('portrait');

// The portrait's size in CSS pixels, once it's reported; a phone's shape
// until then.
let screenSize: Size = { width: 450, height: 975 };
function receiveScreenSize(size: Size | null) {
  if (size && size.width > 0 && size.height > 0) {
    screenSize = size;
    fitSample();
  }
}
window.vn.onBackgroundZoneSizeChanged(receiveScreenSize);
window.vn.getBackgroundZoneSize().then(receiveScreenSize);
setUpSample(() => screenSize);

// The reader's settings, as portrait.ts sets them on its `.portrait`.
textStyle.listen((style) => {
  screen.style.setProperty('--text-size', String(style.size));
  screen.style.setProperty('--name-size', String(style.nameSize ?? 1));
  screen.dataset.textPosition = style.position ?? 'bottom';
  screen.style.setProperty('--text-padding', String(style.padding ?? 0));
});
buttonSize.listen((size) =>
  screen.style.setProperty('--button-size', String(size)),
);
const showArrow = (style: MessageStyle) => {
  screen.dataset.arrow = style.arrow;
};
window.vn.onMessageStyleChanged(showArrow);
window.vn.getMessageStyle().then(showArrow);

// The line and name the portrait shows.
let line = '';
let speaker = '';
const copyText = () => copyToSample(line, speaker);
window.vn.onTextLineChanged((newLine) => {
  line = newLine;
  copyText();
});
window.vn.onSpeakerChanged((name) => {
  speaker = name;
  copyText();
});
Promise.all([window.vn.getTextLine(), window.vn.getSpeaker()]).then(
  ([newLine, name]) => {
    line = newLine;
    speaker = name;
    copyText();
  },
);

// The game's regions. Main doesn't send this window back its own changes
// (made in the region editor), so they're fetched again whenever the Sizes
// page is shown (`refreshSizesPage`).
let regions: Regions | null = null;
window.vn.onRegionsChanged((newRegions) => {
  regions = newRegions;
});
export function refreshSizesPage() {
  window.vn.getRegions().then((newRegions) => {
    regions = newRegions;
  });
  fitSample();
}
refreshSizesPage();

// Where the game's content is inside the capture (without the title bar).
let clientArea: Region = { x: 0, y: 0, w: 1, h: 1 };
preview.addEventListener('resize', async () => {
  clientArea = await getClientArea();
});

// Drawn every screen refresh while the page is shown, with the Portrait
// height cap worked out on the copy (the portrait works out its own).
function drawFrame() {
  if (regions && sampleShown() && preview.videoWidth > 0) {
    const cap = backgroundYCapFor(
      sampleParts,
      preview,
      clientArea,
      regions,
      screenSize,
    );
    if (cap !== null) {
      backgroundYCap.set(cap);
    }
    const bottom = drawSample(preview, clientArea, regions);
    if (bottom !== null) {
      screen.style.setProperty('--picture-bottom', `${Math.round(bottom)}px`);
    }
  }
  requestAnimationFrame(drawFrame);
}
requestAnimationFrame(drawFrame);
