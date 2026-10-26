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

// For sending input.
const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'long',
  dy: 'long',
  mouseData: 'uint32_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16_t',
  wScan: 'uint16_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
// A C "union" holds one of several things in the same memory; INPUT is
// either a mouse or a keyboard event, depending on `type`.
const INPUT = koffi.struct('INPUT', {
  type: 'uint32_t',
  u: koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT }),
});

const PostMessage = user32.func(
  'bool __stdcall PostMessageW(intptr_t hWnd, uint32_t Msg, uintptr_t wParam, intptr_t lParam)',
);
const SendInput = user32.func(
  'uint32_t __stdcall SendInput(uint32_t cInputs, INPUT *pInputs, int cbSize)',
);
const SetForegroundWindow = user32.func(
  'bool __stdcall SetForegroundWindow(intptr_t hWnd)',
);
const GetCursorPos = user32.func(
  'bool __stdcall GetCursorPos(_Out_ POINT *lpPoint)',
);
const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int X, int Y)');

const GetWindowLongPtr = user32.func(
  'intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)',
);
const SetWindowLongPtr = user32.func(
  'intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int nIndex, intptr_t dwNewLong)',
);
const GWL_EXSTYLE = -20;
const WS_EX_APPWINDOW = 0x00040000;

// For keeping the game un-minimized.
const IsWindow = user32.func('bool __stdcall IsWindow(intptr_t hWnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hWnd)');
const ShowWindow = user32.func(
  'bool __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)',
);
const SetWindowPos = user32.func(
  'bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)',
);
const SW_SHOWNOACTIVATE = 4;
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;

const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const MK_LBUTTON = 0x0001;
const INPUT_MOUSE = 0;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Makes a window that can't take focus still show in the taskbar and Alt+Tab.
 * Windows hides "no-activate" windows from both unless they also have the
 * WS_EX_APPWINDOW style.
 */
export function showInTaskbar(hwnd: number) {
  const style = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
  SetWindowLongPtr(hwnd, GWL_EXSTYLE, style | WS_EX_APPWINDOW);
}

// --- Keeping the game un-minimized -------------------------------------------
// Windows doesn't draw minimized windows, and most game engines pause when
// minimized, so a minimized game can't be captured or clicked. A game that's
// just covered by other windows keeps running fine.

// Whether the window still exists and is minimized ("iconic" in Win32 terms).
export function isMinimized(hwnd: number) {
  return IsWindow(hwnd) && IsIconic(hwnd);
}

// Puts the window behind all others, without moving, resizing or focusing it.
export function sendToBack(hwnd: number) {
  SetWindowPos(
    hwnd,
    HWND_BOTTOM,
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
  );
}

// Un-minimizes the window without focusing it, then tucks it behind
// everything else: out of the way, but still running and capturable.
export function restoreBehind(hwnd: number) {
  ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  sendToBack(hwnd);
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

// --- Sending clicks ------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A point inside the game's client area as whole pixels, from fractions
// (0 to 1) of it. Null if the window can't be measured.
function clientPixels(hwnd: number, point: { x: number; y: number }) {
  const client = {} as Rect;
  if (!GetClientRect(hwnd, client) || client.right <= 0) {
    return null;
  }
  return {
    x: Math.round(point.x * (client.right - 1)),
    y: Math.round(point.y * (client.bottom - 1)),
  };
}

/**
 * Clicks by posting mouse messages straight to the game window. The real
 * cursor doesn't move and focus doesn't change, but some engines ignore
 * messages like these and only react to real input.
 */
export async function postClick(hwnd: number, point: { x: number; y: number }) {
  const pixels = clientPixels(hwnd, point);
  if (!pixels) {
    return;
  }
  // The position is packed into one number: y in the high 16 bits, x in the
  // low 16 (what C code calls MAKELPARAM).
  const position = (pixels.y << 16) | (pixels.x & 0xffff);
  // Hover first, since some games only register a click on a button that's
  // been hovered.
  PostMessage(hwnd, WM_MOUSEMOVE, 0, position);
  PostMessage(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, position);
  // Games often check input once per frame, so hold the button briefly.
  await sleep(50);
  PostMessage(hwnd, WM_LBUTTONUP, 0, position);
}

/**
 * Clicks with simulated real mouse input: brings the game to the front,
 * moves the cursor over the spot, clicks, then puts the cursor back. Works
 * with almost any game, but the cursor visibly jumps.
 */
export async function sendClick(hwnd: number, point: { x: number; y: number }) {
  const pixels = clientPixels(hwnd, point);
  if (!pixels) {
    return;
  }
  // Client-area pixels → screen pixels (ClientToScreen fills in the copy).
  const onScreen = { ...pixels };
  if (!ClientToScreen(hwnd, onScreen)) {
    return;
  }
  const previousCursor = { x: 0, y: 0 };
  GetCursorPos(previousCursor);

  const mouseButton = (flags: number) => ({
    type: INPUT_MOUSE,
    u: {
      mi: {
        dx: 0,
        dy: 0,
        mouseData: 0,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  });

  SetForegroundWindow(hwnd);
  SetCursorPos(onScreen.x, onScreen.y);
  // Let the game notice the hover before clicking.
  await sleep(30);
  SendInput(1, [mouseButton(MOUSEEVENTF_LEFTDOWN)], koffi.sizeof(INPUT));
  await sleep(50);
  SendInput(1, [mouseButton(MOUSEEVENTF_LEFTUP)], koffi.sizeof(INPUT));
  await sleep(30);
  SetCursorPos(previousCursor.x, previousCursor.y);
}
