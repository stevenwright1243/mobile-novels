/**
 * The zoom pad's q.Save and q.Load buttons: each clicks the game's own quick
 * save or quick load button, at the spot placed for it in the picker (the
 * game's `points`, part of its profile). They're in the Menus sheet, where
 * the whole game shows above them, so a confirmation the game asks can be
 * answered there. Each is disabled until its spot is placed, and while no
 * game is picked.
 */

const buttons = [
  ...document.querySelectorAll<HTMLButtonElement>('#zoom-pad [data-point]'),
];

let points: Points | null = null;
let hasGame = false;

const pointOf = (button: HTMLButtonElement) =>
  points?.[button.dataset.point as PointName] ?? null;

function update() {
  for (const button of buttons) {
    button.disabled = !hasGame || !pointOf(button);
  }
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    const point = pointOf(button);
    if (point) {
      window.vn.clickGame(point);
    }
  });
}

window.vn.onPointsChanged((newPoints) => {
  points = newPoints;
  update();
});
window.vn.getPoints().then((initialPoints) => {
  points ??= initialPoints;
  update();
});

window.vn.onSourceSelected((sourceId) => {
  hasGame = sourceId !== null;
  update();
});
window.vn.getSelectedSource().then((sourceId) => {
  hasGame = sourceId !== null;
  update();
});
