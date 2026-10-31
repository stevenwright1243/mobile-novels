/**
 * The picker's "Open on" switch: Main (Windows' main display, as usual) or
 * another monitor, where this app's windows and the games it starts then
 * open (open-on-display.ts, in main). With more than one other monitor, a
 * select picks which. Saved as an app setting as soon as it changes.
 */

const row = document.querySelector<HTMLElement>('#open-on-row')!;
const openOnSwitch = document.querySelector<HTMLElement>('#open-on')!;
const choices = openOnSwitch.querySelectorAll<HTMLInputElement>('input');
const otherName = document.querySelector<HTMLElement>('#open-on-name')!;
const monitorSelect =
  document.querySelector<HTMLSelectElement>('#open-on-monitor')!;

let openOn: OpenOn = { on: false, monitor: null };

async function show() {
  const others = (await window.vn.listMonitors()).filter(
    (monitor) => !monitor.main,
  );
  openOn = await window.vn.getOpenOn();
  // With one monitor there's nowhere else to open.
  row.hidden = others.length === 0;
  const names = others.map((monitor) => monitor.name);
  // The saved monitor, or the first other one if it isn't connected now.
  const chosen = names.includes(openOn.monitor ?? '')
    ? openOn.monitor!
    : (names[0] ?? null);
  otherName.textContent = chosen ?? '';
  monitorSelect.hidden = others.length < 2;
  monitorSelect.replaceChildren(
    ...names.map((name) => new Option(name, name, false, name === chosen)),
  );
  const connected = openOn.on && chosen === openOn.monitor;
  for (const choice of choices) {
    choice.checked = choice.value === (connected ? 'other' : 'main');
  }
  openOnSwitch.title = connected
    ? `This app and the games it starts open on ${chosen}.`
    : openOn.on
      ? `${openOn.monitor} isn't connected, so windows open on the main display.`
      : 'Windows open on the main display, as usual.';
}

function save(on: boolean) {
  openOn = { on, monitor: otherName.textContent || null };
  void window.vn.setOpenOn(openOn).then(show);
}

// `change` fires on the radio button that just became checked.
openOnSwitch.addEventListener('change', (event) => {
  save((event.target as HTMLInputElement).value === 'other');
});
monitorSelect.addEventListener('change', () => {
  otherName.textContent = monitorSelect.value;
  save(openOn.on);
});

window.vn.onMonitorsChanged(show);
void show();
