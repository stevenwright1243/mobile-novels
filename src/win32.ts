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
// Windows' FILETIMEs (a 64-bit count) are read as plain 64-bit numbers.
const GetProcessTimes = kernel32.func(
  'bool __stdcall GetProcessTimes(intptr_t hProcess, _Out_ uint64_t *lpCreationTime, _Out_ uint64_t *lpExitTime, _Out_ uint64_t *lpKernelTime, _Out_ uint64_t *lpUserTime)',
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
const SW_RESTORE = 9;
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

// Un-minimizes the window if needed and brings it in front of all others,
// focused, as if clicked in the taskbar.
export function bringToFront(hwnd: number) {
  if (IsIconic(hwnd)) {
    ShowWindow(hwnd, SW_RESTORE);
  }
  SetForegroundWindow(hwnd);
}

// Un-minimizes the window without focusing it, then tucks it behind
// everything else: out of the way, but still running and capturable.
export function restoreBehind(hwnd: number) {
  ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  sendToBack(hwnd);
}

// The ID of the process (running program) that owns a window.
export function processIdOf(hwnd: number) {
  // Single-element arrays act as "output" variables that Windows fills in.
  const processId = [0];
  GetWindowThreadProcessId(hwnd, processId);
  return processId[0];
}

/**
 * The full path of the program that owns a window, e.g.
 * "D:\...\totono_Steam.exe". Null if it can't be read, e.g. the game runs as
 * administrator and this app doesn't.
 */
export function exePathOf(hwnd: number): string | null {
  return exePathOfProcess(processIdOf(hwnd));
}

// The same, from the process's ID.
export function exePathOfProcess(processId: number): string | null {
  const process = OpenProcess(
    PROCESS_QUERY_LIMITED_INFORMATION,
    false,
    processId,
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

/**
 * When the program that owns a window started, in Windows' own units (100
 * nanoseconds since 1601; only for comparing), or 0 if it can't be read.
 */
export function startTimeOf(hwnd: number) {
  const process = OpenProcess(
    PROCESS_QUERY_LIMITED_INFORMATION,
    false,
    processIdOf(hwnd),
  );
  if (!process) {
    return 0;
  }
  try {
    const created = [0n];
    const unused = [0n];
    return GetProcessTimes(process, created, unused, unused, unused)
      ? Number(created[0])
      : 0;
  } finally {
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

// --- Pressing keys -------------------------------------------------------------

export const VK_F12 = 0x7b;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const MapVirtualKey = user32.func(
  'uint32_t __stdcall MapVirtualKeyW(uint32_t uCode, uint32_t uMapType)',
);
const MAPVK_VK_TO_VSC = 0;

/**
 * Presses a key (a "virtual-key code", e.g. `VK_F12`) in the game, with
 * simulated real input: brings the game to the front first, since real key
 * presses go to whichever window is in front. Real input is what overlays
 * like Steam's watch for.
 */
export async function pressKey(hwnd: number, key: number) {
  const keyEvent = (flags: number) => ({
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: key,
        // The key's hardware code too, which some programs read instead.
        wScan: MapVirtualKey(key, MAPVK_VK_TO_VSC),
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  });
  SetForegroundWindow(hwnd);
  await sleep(50);
  SendInput(1, [keyEvent(0)], koffi.sizeof(INPUT));
  await sleep(50);
  SendInput(1, [keyEvent(KEYEVENTF_KEYUP)], koffi.sizeof(INPUT));
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

// --- Muting games ---------------------------------------------------------------
// Each program playing sound has an "audio session" on each sound device,
// the rows of Windows' Volume mixer. Sessions are COM objects too (see the
// property store above): we list the devices, then each device's sessions,
// and mute or unmute a session by the program it belongs to.
const ole32 = koffi.load('ole32.dll');
const CoInitializeEx = ole32.func(
  'long __stdcall CoInitializeEx(void *pvReserved, uint32_t dwCoInit)',
);
const CoCreateInstance = ole32.func(
  'long __stdcall CoCreateInstance(const GUID *rclsid, void *pUnkOuter, uint32_t dwClsContext, const GUID *riid, _Out_ void **ppv)',
);
const CLSID_MMDeviceEnumerator = guid('BCDE0395-E52F-467C-8E3D-C4579291692E');
const IID_IMMDeviceEnumerator = guid('A95664D2-9614-4F35-A746-DE8DB63617E6');
const IID_IAudioSessionManager2 = guid('77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F');
const IID_IAudioSessionControl2 = guid('BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D');
const IID_ISimpleAudioVolume = guid('87CE5498-68D6-44E5-9215-6DA47EF883D8');
const CLSCTX_ALL = 0x17;
const COINIT_APARTMENTTHREADED = 0x2;
const E_RENDER = 0; // Sound devices that play (not record).
const DEVICE_STATE_ACTIVE = 0x1;

// The COM methods used, each with the object itself first.
const ComRelease = koffi.proto('uint32_t __stdcall ComRelease(void *self)');
const ComQueryInterface = koffi.proto(
  'long __stdcall ComQueryInterface(void *self, const GUID *riid, _Out_ void **ppv)',
);
const EnumAudioEndpoints = koffi.proto(
  'long __stdcall EnumAudioEndpoints(void *self, int dataFlow, uint32_t stateMask, _Out_ void **ppDevices)',
);
const GetCount = koffi.proto(
  'long __stdcall GetCount(void *self, _Out_ uint32_t *pcount)',
);
const Item = koffi.proto(
  'long __stdcall Item(void *self, uint32_t index, _Out_ void **ppItem)',
);
const GetSessionEnumerator = koffi.proto(
  'long __stdcall GetSessionEnumerator(void *self, _Out_ void **ppEnum)',
);
const Activate = koffi.proto(
  'long __stdcall Activate(void *self, const GUID *iid, uint32_t clsCtx, void *params, _Out_ void **ppInterface)',
);
const GetProcessId = koffi.proto(
  'long __stdcall GetProcessId(void *self, _Out_ uint32_t *pid)',
);
const SetMute = koffi.proto(
  'long __stdcall SetMute(void *self, int mute, const GUID *context)',
);
const GetMute = koffi.proto(
  'long __stdcall GetMute(void *self, _Out_ int *mute)',
);
// Positions in each vtable (0–2 are IUnknown's QueryInterface, AddRef,
// Release).
const QUERY_INTERFACE = 0;
const ENUM_AUDIO_ENDPOINTS = 3; // IMMDeviceEnumerator
const GET_COUNT = 3; // IMMDeviceCollection, IAudioSessionEnumerator
const ITEM = 4; // the same two: Item, GetSession
const ACTIVATE = 3; // IMMDevice
const GET_SESSION_ENUMERATOR = 5; // IAudioSessionManager2
const GET_PROCESS_ID = 14; // IAudioSessionControl2
const SET_MUTE = 5; // ISimpleAudioVolume
const GET_MUTE = 6;

// Calls method number `index` of a COM object.
function comCall(
  self: unknown,
  index: number,
  proto: ReturnType<typeof koffi.proto>,
  ...args: unknown[]
) {
  const methods = koffi.decode(
    koffi.decode(self, 'void *'),
    koffi.array('void *', index + 1),
  );
  return koffi.call(methods[index], proto, self, ...args) as number;
}
const release = (self: unknown) => comCall(self, RELEASE, ComRelease);

// Gets a COM object through a call that fills in a pointer, or null if it
// failed. `get` makes the call with the "output variable" it's given.
function comGet(get: (out: unknown[]) => number) {
  const out: unknown[] = [null];
  return get(out) === 0 && out[0] ? out[0] : null;
}

// The items of a COM list (a device collection or session enumerator),
// each passed to `use` and released after.
function forEachItem(list: unknown, use: (item: unknown) => void) {
  const count = [0];
  if (comCall(list, GET_COUNT, GetCount, count) !== 0) {
    return;
  }
  for (let i = 0; i < count[0]; i++) {
    const item = comGet((out) => comCall(list, ITEM, Item, i, out));
    if (item) {
      try {
        use(item);
      } finally {
        release(item);
      }
    }
  }
}

let comReady = false;

/**
 * Mutes or unmutes programs' sound, on every sound device. `decide` gets the
 * ID and .exe path of each program playing sound, and returns true to mute
 * it, false to unmute it, or null to leave it as it is.
 */
export function setMutes(
  decide: (processId: number, exePath: string | null) => boolean | null,
) {
  if (!comReady) {
    // Main's thread already has COM set up (Chromium does it), in which
    // case this does nothing.
    CoInitializeEx(null, COINIT_APARTMENTTHREADED);
    comReady = true;
  }
  const enumerator = comGet((out) =>
    CoCreateInstance(
      CLSID_MMDeviceEnumerator,
      null,
      CLSCTX_ALL,
      IID_IMMDeviceEnumerator,
      out,
    ),
  );
  if (!enumerator) {
    return;
  }
  try {
    const devices = comGet((out) =>
      comCall(
        enumerator,
        ENUM_AUDIO_ENDPOINTS,
        EnumAudioEndpoints,
        E_RENDER,
        DEVICE_STATE_ACTIVE,
        out,
      ),
    );
    if (!devices) {
      return;
    }
    try {
      forEachItem(devices, (device) => muteOnDevice(device, decide));
    } finally {
      release(devices);
    }
  } finally {
    release(enumerator);
  }
}

function muteOnDevice(
  device: unknown,
  decide: (processId: number, exePath: string | null) => boolean | null,
) {
  const manager = comGet((out) =>
    comCall(
      device,
      ACTIVATE,
      Activate,
      IID_IAudioSessionManager2,
      CLSCTX_ALL,
      null,
      out,
    ),
  );
  if (!manager) {
    return;
  }
  try {
    const sessions = comGet((out) =>
      comCall(manager, GET_SESSION_ENUMERATOR, GetSessionEnumerator, out),
    );
    if (!sessions) {
      return;
    }
    try {
      forEachItem(sessions, (session) => {
        const control = comGet((out) =>
          comCall(
            session,
            QUERY_INTERFACE,
            ComQueryInterface,
            IID_IAudioSessionControl2,
            out,
          ),
        );
        if (!control) {
          return;
        }
        const processId = [0];
        try {
          comCall(control, GET_PROCESS_ID, GetProcessId, processId);
        } finally {
          release(control);
        }
        // Process 0 is Windows' own sounds.
        const mute = processId[0]
          ? decide(processId[0], exePathOfProcess(processId[0]))
          : null;
        if (mute === null) {
          return;
        }
        const volume = comGet((out) =>
          comCall(
            session,
            QUERY_INTERFACE,
            ComQueryInterface,
            IID_ISimpleAudioVolume,
            out,
          ),
        );
        if (!volume) {
          return;
        }
        try {
          const muted = [0];
          comCall(volume, GET_MUTE, GetMute, muted);
          if (Boolean(muted[0]) !== mute) {
            comCall(volume, SET_MUTE, SetMute, mute ? 1 : 0, null);
          }
        } finally {
          release(volume);
        }
      });
    } finally {
      release(sessions);
    }
  } finally {
    release(manager);
  }
}

// --- Reading the game's memory (memory-text.ts) -------------------------------

// What Windows reports about one stretch ("region") of a process's memory.
const MEMORY_BASIC_INFORMATION = koffi.struct('MEMORY_BASIC_INFORMATION', {
  BaseAddress: 'uintptr_t',
  AllocationBase: 'uintptr_t',
  AllocationProtect: 'uint32_t',
  PartitionId: 'uint16_t',
  RegionSize: 'size_t',
  State: 'uint32_t',
  Protect: 'uint32_t',
  Type: 'uint32_t',
});
const VirtualQueryEx = kernel32.func(
  'size_t __stdcall VirtualQueryEx(intptr_t hProcess, uintptr_t lpAddress, _Out_ MEMORY_BASIC_INFORMATION *lpBuffer, size_t dwLength)',
);
const ReadProcessMemory = kernel32.func(
  'bool __stdcall ReadProcessMemory(intptr_t hProcess, uintptr_t lpBaseAddress, _Out_ uint8_t *lpBuffer, size_t nSize, _Out_ size_t *lpNumberOfBytesRead)',
);
// Enough access to list a process's memory and read it, never to change it.
const PROCESS_VM_READ = 0x0010;
const PROCESS_QUERY_INFORMATION = 0x0400;
// Memory in use (not just reserved), and owned by the process itself (its
// heaps, where text the game builds lives; not its .exe and DLLs).
const MEM_COMMIT = 0x1000;
const MEM_PRIVATE = 0x20000;
// Writable memory: read-write, with or without execute, and copy-on-write.
const WRITABLE = 0x04 | 0x08 | 0x40 | 0x80;
// Guard pages fault when touched; skipped.
const PAGE_GUARD = 0x100;
// Past this, a 64-bit process's user memory ends (and a 32-bit one's long
// before).
const USER_MEMORY_END = 0x7fffffff0000;

// An open handle to read a process's memory, or 0 if it can't be opened
// (e.g. the game runs as administrator and this app doesn't).
export const openForReading = (processId: number): number =>
  OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, processId);

export const closeProcess = (process: number) => CloseHandle(process);

// The stretches of a process's memory where a game keeps text it builds at
// run time (in use, its own, writable), as addresses and sizes.
export function writableRegions(process: number) {
  const regions: { address: number; size: number }[] = [];
  let address = 0;
  while (address < USER_MEMORY_END) {
    const info = {} as {
      BaseAddress: number;
      RegionSize: number;
      State: number;
      Protect: number;
      Type: number;
    };
    if (
      !VirtualQueryEx(
        process,
        address,
        info,
        koffi.sizeof(MEMORY_BASIC_INFORMATION),
      )
    ) {
      break;
    }
    if (
      info.State === MEM_COMMIT &&
      info.Type === MEM_PRIVATE &&
      info.Protect & WRITABLE &&
      !(info.Protect & PAGE_GUARD)
    ) {
      regions.push({ address: info.BaseAddress, size: info.RegionSize });
    }
    address = info.BaseAddress + info.RegionSize;
  }
  return regions;
}

// Copies up to `size` bytes of a process's memory from `address`: fewer if
// its region ends sooner (Windows refuses the whole read if any of it can't
// be read), or null if none can be read (freed since, say).
export function readMemory(
  process: number,
  address: number,
  size: number,
): Buffer | null {
  const buffer = Buffer.alloc(size);
  const read = [0];
  if (ReadProcessMemory(process, address, buffer, size, read)) {
    return buffer.subarray(0, read[0]);
  }
  const info = {} as { BaseAddress: number; RegionSize: number };
  if (
    !VirtualQueryEx(
      process,
      address,
      info,
      koffi.sizeof(MEMORY_BASIC_INFORMATION),
    )
  ) {
    return null;
  }
  const available = info.BaseAddress + info.RegionSize - address;
  return available > 0 && available < size
    ? readMemory(process, address, available)
    : null;
}

// The same, done on one of koffi's worker threads, so reading a lot of
// memory doesn't hold up the main process.
export function readMemoryAsync(
  process: number,
  address: number,
  size: number,
) {
  const buffer = Buffer.alloc(size);
  const read = [0];
  return new Promise<Buffer | null>((resolve) =>
    ReadProcessMemory.async(
      process,
      address,
      buffer,
      size,
      read,
      (error: unknown, ok: boolean) =>
        resolve(!error && ok ? buffer.subarray(0, read[0]) : null),
    ),
  );
}
