// Calls into Windows' own DLLs through koffi, a "foreign function interface":
// we describe a C function's signature as a string, and koffi lets us call it
// from JS. Main process only.
import koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');

// C structs, described so koffi can convert them to and from JS objects.
const RECT = koffi.struct('RECT', {
  left: 'long',
  top: 'long',
  right: 'long',
  bottom: 'long',
});
koffi.struct('POINT', { x: 'long', y: 'long' });

// Window handles (HWNDs) are passed as plain integers (`intptr_t`).
// `_Out_` means Windows fills in the object we pass; `_Inout_` means it reads
// it and then fills it in.
const GetClientRect = user32.func(
  'bool __stdcall GetClientRect(intptr_t hWnd, _Out_ RECT *lpRect)',
);
const ClientToScreen = user32.func(
  'bool __stdcall ClientToScreen(intptr_t hWnd, _Inout_ POINT *lpPoint)',
);
const DwmGetWindowAttribute = dwmapi.func(
  'long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t dwAttribute, _Out_ RECT *pvAttribute, uint32_t cbAttribute)',
);
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// desktopCapturer window IDs look like "window:<HWND>:0".
export function hwndFromSourceId(sourceId: string) {
  return Number(sourceId.split(':')[1]);
}

/**
 * Where the game's own content sits inside a capture of its window, as
 * fractions of the capture. Windows calls this the "client area": the window
 * minus its title bar, borders and menu bar. Returns null if the window can't
 * be measured, e.g. it's minimized or was closed.
 */
export function getClientArea(hwnd: number): Region | null {
  // The window's visible bounds, which is what a window capture contains.
  const frame = {} as Rect;
  const result = DwmGetWindowAttribute(
    hwnd,
    DWMWA_EXTENDED_FRAME_BOUNDS,
    frame,
    koffi.sizeof(RECT),
  );
  // The client area's size, and its top-left corner in screen coordinates.
  const client = {} as Rect;
  const origin = { x: 0, y: 0 };
  if (
    result !== 0 ||
    !GetClientRect(hwnd, client) ||
    !ClientToScreen(hwnd, origin)
  ) {
    return null;
  }

  const width = frame.right - frame.left;
  const height = frame.bottom - frame.top;
  if (width <= 0 || height <= 0 || client.right <= 0 || client.bottom <= 0) {
    return null;
  }
  return {
    x: (origin.x - frame.left) / width,
    y: (origin.y - frame.top) / height,
    w: client.right / width,
    h: client.bottom / height,
  };
}
