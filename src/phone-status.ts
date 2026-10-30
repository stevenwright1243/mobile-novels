/**
 * Shows in the picker whether the phone is streaming: while it is, Apollo
 * adds a display the size of the phone's screen, and the portrait goes full
 * screen on it (see phone-display.ts). The PC / Phone switch chooses whether
 * it does, for testing, or when a paused stream leaves the display behind.
 * The choice is saved as an app setting (settings.ts) as soon as it changes.
 */

const phoneStatus = document.querySelector<HTMLElement>('#phone-status')!;
const placeSwitch = document.querySelector<HTMLElement>('#portrait-place')!;
const placeChoices = placeSwitch.querySelectorAll<HTMLInputElement>('input');

function showPhone(phone: PhoneDisplay | null) {
  phoneStatus.classList.toggle('connected', phone !== null);
  if (phone) {
    phoneStatus.textContent = `Phone connected: ${phone.width} × ${phone.height}`;
    phoneStatus.title =
      `The phone's display (“${phone.label || 'unnamed'}”, ` +
      `scaling ${Math.round(phone.scale * 100)}%). The portrait goes full ` +
      'screen on it while the switch is on Phone.';
  } else {
    phoneStatus.textContent = 'Phone not connected';
    phoneStatus.title =
      'Connect from Artemis on the phone: with the switch on Phone, the ' +
      'portrait then goes full screen on the display Apollo adds for it.';
  }
}

function showChoice(onPhone: boolean) {
  const chosen = onPhone ? 'phone' : 'pc';
  for (const choice of placeChoices) {
    choice.checked = choice.value === chosen;
  }
}

// `change` fires on the radio button that just became checked.
placeSwitch.addEventListener('change', (event) => {
  const choice = event.target as HTMLInputElement;
  window.vn.setPortraitOnPhone(choice.value === 'phone');
});

window.vn.onPhoneDisplayChanged(showPhone);
window.vn.getPhoneDisplay().then(showPhone);
window.vn.getPortraitOnPhone().then(showChoice);
