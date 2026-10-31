/**
 * Shows in the picker whether Apollo, the streaming server, is running, with
 * a Start button while it isn't and a button for its settings page (see
 * apollo.ts, in main).
 */

const apolloStatus = document.querySelector<HTMLElement>('#apollo-status')!;
const startButton = document.querySelector<HTMLButtonElement>('#start-apollo')!;
const settingsButton =
  document.querySelector<HTMLButtonElement>('#apollo-settings')!;

const LABELS: Record<ServiceState, string> = {
  running: 'Apollo running',
  starting: 'Apollo starting…',
  stopping: 'Apollo stopping…',
  stopped: 'Apollo stopped',
  missing: 'Apollo not installed',
};

function showApollo(status: ServiceStatus) {
  apolloStatus.textContent = LABELS[status.state];
  apolloStatus.classList.toggle('running', status.state === 'running');
  apolloStatus.title =
    status.state === 'missing'
      ? 'No ApolloService on this PC. Install Apollo to stream to the phone.'
      : 'Apollo streams the portrait to Artemis on the phone. It runs as a ' +
        'Windows service, which starts with the PC.';
  startButton.hidden = status.state !== 'stopped';
  startButton.title = status.canStart
    ? 'Start Apollo'
    : 'Start Apollo (Windows will ask for permission)';
  settingsButton.hidden = status.state === 'missing';
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  try {
    await window.vn.startApollo();
  } finally {
    startButton.disabled = false;
  }
});
settingsButton.addEventListener('click', () => window.vn.openApolloSettings());

window.vn.onApolloChanged(showApollo);
window.vn.getApollo().then(showApollo);
