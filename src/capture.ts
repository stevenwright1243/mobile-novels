// Shared by both pages: live capture of a game window into a <video>.

// The whole capture: used when the game's content can't be measured.
const FULL_FRAME: Region = { x: 0, y: 0, w: 1, h: 1 };

// Where the game's own content is inside the capture, leaving out the
// window's title bar and borders.
export async function getClientArea() {
  return (await window.vn.getClientArea()) ?? FULL_FRAME;
}

// Starts playing a live capture of a window in `video`, replacing (and
// stopping) whatever it was showing before.
export async function playCapture(video: HTMLVideoElement, sourceId: string) {
  const previous = video.srcObject as MediaStream | null;
  previous?.getTracks().forEach((track) => track.stop());

  // `mandatory.chromeMediaSource` is a Chromium/Electron extension for
  // capturing a specific window by ID. It isn't in TypeScript's built-in
  // types, hence the cast.
  const constraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
    },
  } as MediaTrackConstraints;

  video.srcObject = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: constraints,
  });
  await video.play();
}
