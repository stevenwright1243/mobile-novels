// Shared by both pages: live capture of a game window into a <video>.

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
