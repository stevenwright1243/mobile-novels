/**
 * Shows in the picker whether the phone is streaming: while it is, Apollo
 * adds a display the size of the phone's screen, and the portrait goes full
 * screen on it (see phone-display.ts).
 */

const phoneStatus = document.querySelector<HTMLElement>('#phone-status')!;

function showPhone(phone: PhoneDisplay | null) {
  phoneStatus.classList.toggle('connected', phone !== null);
  if (phone) {
    phoneStatus.textContent = `On phone: ${phone.width} × ${phone.height}`;
    phoneStatus.title =
      `The portrait is full screen on the phone's display ` +
      `(“${phone.label || 'unnamed'}”, scaling ${Math.round(phone.scale * 100)}%). ` +
      'It comes back here when the phone disconnects.';
  } else {
    phoneStatus.textContent = 'Phone not connected';
    phoneStatus.title =
      'Connect from Artemis on the phone: the portrait then goes full ' +
      'screen on the display Apollo adds for it.';
  }
}

window.vn.onPhoneDisplayChanged(showPhone);
window.vn.getPhoneDisplay().then(showPhone);
