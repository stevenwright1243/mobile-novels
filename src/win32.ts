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

// For window properties (Windows' per-window settings, kept in a "property
// store"). The store is a COM object: a pointer to a table of function
// pointers (its "vtable"), each called with the object itself first.
const shell32 = koffi.load('shell32.dll');
const GUID = koffi.struct('GUID', {
  Data1: 'uint32_t',
  Data2: 'uint16_t',
  Data3: 'uint16_t',
  Data4: koffi.array('uint8_t', 8),
});
koffi.struct('PROPERTYKEY', { fmtid: GUID, pid: 'uint32_t' });
// A value of any type. Only `vt` (the type) and a true/false are used here;
// the rest pads it to its real size (24 bytes).
koffi.struct('PROPVARIANT', {
  vt: 'uint16_t',
  reserved: koffi.array('uint16_t', 3),
  boolVal: 'int16_t',
  padding: koffi.array('uint8_t', 14),
});
const SHGetPropertyStoreForWindow = shell32.func(
  'long __stdcall SHGetPropertyStoreForWindow(intptr_t hwnd, const GUID *riid, _Out_ void **ppv)',
);
const PropertyStoreRelease = koffi.proto(
  'uint32_t __stdcall PropertyStoreRelease(void *self)',
);
const PropertyStoreSetValue = koffi.proto(
  'long __stdcall PropertyStoreSetValue(void *self, const PROPERTYKEY *key, const PROPVARIANT *value)',
);
// Positions in the vtable (after IUnknown's QueryInterface, AddRef, Release
// come GetCount, GetAt, GetValue, SetValue, Commit).
const RELEASE = 2;
const SET_VALUE = 6;
const VT_BOOL = 11;
const VARIANT_TRUE = -1;

// A GUID from its usual text form, e.g. "886D8EEB-8CF2-...".
function guid(text: string) {
  const hex = text.replaceAll('-', '');
  const byte = (i: number) => parseInt(hex.slice(16 + i * 2, 18 + i * 2), 16);
  return {
    Data1: parseInt(hex.slice(0, 8), 16),
    Data2: parseInt(hex.slice(8, 12), 16),
    Data3: parseInt(hex.slice(12, 16), 16),
    Data4: Array.from({ length: 8 }, (_, i) => byte(i)),
  };
}
const IID_IPropertyStore = guid('886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99');
const PKEY_EdgeGesture_DisableTouchWhenFullscreen = {
  fmtid: guid('32CE38B2-2C9A-41B1-9BC5-B3784394AA44'),
  pid: 2,
};

// For finding which program (.exe) a window belongs to.
const kernel32 = koffi.load('kernel32.dll');
const GetWindowThreadProcessId = user32.func(
  'uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)',
);
const OpenProcess = kernel32.func(
  'intptr_t __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)',
);
const QueryFullProcessImageName = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(intptr_t hProcess, uint32_t dwFlags, uint16_t *lpExeName, _Inout_ uint32_t *lpdwSize)',
);
const CloseHandle = kernel32.func(
  'bool __stdcall CloseHandle(intptr_t hObject)',
);
// Enough access to read a process's name, even for most other users' apps.
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

// For keeping the game un-minimized.
const IsWindow = user32.func('bool __stdcall IsWindow(intptr_t hWnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hWnd)');
const ShowWindow = user32.func(
  'bool __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)',
);
const SetWindowPos = user32.func(
  'bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)',
);
// For finding which graphics adapter drives a display. Windows names each
// display output like "\\.\DISPLAY2"; `koffi.array(..., 'String')` turns a
// fixed-size C text field into a JS string.
const MONITORINFOEXW = koffi.struct('MONITORINFOEXW', {
  cbSize: 'uint32_t',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32_t',
  szDevice: koffi.array('char16_t', 32, 'String'),
});
const DISPLAY_DEVICEW = koffi.struct('DISPLAY_DEVICEW', {
  cb: 'uint32_t',
  DeviceName: koffi.array('char16_t', 32, 'String'),
  DeviceString: koffi.array('char16_t', 128, 'String'),
  StateFlags: 'uint32_t',
  DeviceID: koffi.array('char16_t', 128, 'String'),
  DeviceKey: koffi.array('char16_t', 128, 'String'),
});
const MonitorFromPoint = user32.func(
  'intptr_t __stdcall MonitorFromPoint(POINT pt, uint32_t dwFlags)',
);
const GetMonitorInfo = user32.func(
  'bool __stdcall GetMonitorInfoW(intptr_t hMonitor, _Inout_ MONITORINFOEXW *lpmi)',
);
const EnumDisplayDevices = user32.func(
  'bool __stdcall EnumDisplayDevicesW(const char16_t *lpDevice, uint32_t iDevNum, _Inout_ DISPLAY_DEVICEW *lpDisplayDevice, uint32_t dwFlags)',
);
const MONITOR_DEFAULTTONULL = 0;

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

/**
 * Stops touch swipes in from a screen edge (e.g. up from the bottom, which
 * shows the taskbar) from reaching Windows while the window is full screen.
 * They reach the window instead. Returns whether Windows accepted it.
 */
export function blockEdgeSwipesWhenFullScreen(hwnd: number) {
  const store = [null];
  if (SHGetPropertyStoreForWindow(hwnd, IID_IPropertyStore, store) !== 0) {
    return false;
  }
  const self = store[0];
  const methods = koffi.decode(
    koffi.decode(self, 'void *'),
    koffi.array('void *', 8),
  );
  try {
    const result = koffi.call(
      methods[SET_VALUE],
      PropertyStoreSetValue,
      self,
      PKEY_EdgeGesture_DisableTouchWhenFullscreen,
      {
        vt: VT_BOOL,
        reserved: [0, 0, 0],
        boolVal: VARIANT_TRUE,
        padding: Array.from({ length: 14 }, () => 0),
      },
    );
    return result === 0;
  } finally {
    koffi.call(methods[RELEASE], PropertyStoreRelease, self);
  }
}

// --- Keeping the game un-minimized -------------------------------------------
// Windows doesn't draw minimized windows, and most game engines pause when
// minimized, so a minimized game can't be captured or clicked. A game that's
// just covered by other windows keeps running fine.

// Whether the window still exists (it's gone once its program closes it).
export function windowExists(hwnd: number) {
  return IsWindow(hwnd);
}

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

/**
 * The full path of the program that owns a window, e.g.
 * "D:\...\totono_Steam.exe". Null if it can't be read, e.g. the game runs as
 * administrator and this app doesn't.
 */
export function exePathOf(hwnd: number): string | null {
  // Single-element arrays act as "output" variables that Windows fills in.
  const processId = [0];
  GetWindowThreadProcessId(hwnd, processId);
  const process = OpenProcess(
    PROCESS_QUERY_LIMITED_INFORMATION,
    false,
    processId[0],
  );
  if (!process) {
    return null;
  }
  try {
    // Windows writes the path as UTF-16 text into this buffer, and sets
    // `length` to how many characters it wrote.
    const buffer = Buffer.alloc(1024 * 2);
    const length = [1024];
    return QueryFullProcessImageName(process, 0, buffer, length)
      ? buffer.toString('utf16le', 0, length[0] * 2)
      : null;
  } finally {
    // `finally` runs even after `return`, so the handle is always released.
    CloseHandle(process);
  }
}

// The game's client area (its content, without title bar) in pixels.
export function clientSize(hwnd: number) {
  const client = {} as Rect;
  // A minimized window's content measures 0×0, which isn't useful to save.
  if (!GetClientRect(hwnd, client) || client.right <= 0) {
    return null;
  }
  return { width: client.right, height: client.bottom };
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

/**
 * The name of the graphics adapter driving the display at a point on screen
 * (in real pixels), e.g. "NVIDIA GeForce RTX 5090", or null if there's no
 * display there. A virtual display is "driven" by its driver's adapter.
 */
export function displayAdapterAt(point: { x: number; y: number }) {
  const monitor = MonitorFromPoint(
    { x: Math.round(point.x), y: Math.round(point.y) },
    MONITOR_DEFAULTTONULL,
  );
  // Windows reads `cbSize` (or `cb`) to know which version of the struct
  // it's been given.
  const info = { cbSize: koffi.sizeof(MONITORINFOEXW) } as {
    cbSize: number;
    szDevice?: string;
  };
  if (!monitor || !GetMonitorInfo(monitor, info)) {
    return null;
  }
  // List the display outputs until the one with the same device name.
  for (let i = 0; ; i++) {
    const device = { cb: koffi.sizeof(DISPLAY_DEVICEW) } as {
      cb: number;
      DeviceName?: string;
      DeviceString?: string;
    };
    if (!EnumDisplayDevices(null, i, device, 0)) {
      return null;
    }
    if (device.DeviceName === info.szDevice) {
      return device.DeviceString ?? null;
    }
  }
}
