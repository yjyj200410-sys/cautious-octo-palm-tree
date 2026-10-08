/**
 * Win32 window helpers — bring to front and close by title.
 * Uses PowerShell with ExecutionPolicy Bypass to work on restricted systems.
 */
import { execFile } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import logger from '../logger';

function runPs(script: string, timeout = 3000): Promise<string> {
  return new Promise((resolve) => {
    // Use a temp .ps1 file so -File avoids escaping issues with -Command
    const tmpFile = join(tmpdir(), `lumina_win32_${Date.now()}.ps1`);
    writeFileSync(tmpFile, script, 'utf-8');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tmpFile],
      { timeout },
      (err, stdout) => {
        try {
          unlinkSync(tmpFile);
        } catch {
          // The helper result matters more than best-effort temp-file cleanup.
        }
        resolve(err ? '' : stdout.trim());
      },
    );
  });
}

/**
 * Cover the current monitor with the window's client area while keeping the normal
 * frameless-window border outside the monitor. Chromium deliberately reserves a
 * bottom activation strip for an auto-hidden taskbar; that strip otherwise exposes
 * the desktop through Volo's edge-to-edge wallpaper.
 *
 * Returns true only for the auto-hide layout (work area equals monitor bounds). A
 * regular taskbar keeps the native maximized window untouched.
 */
export async function coverMonitorClientArea(nativeHandle: bigint): Promise<boolean> {
  const script = `
$cs = @'
using System;
using System.Runtime.InteropServices;
public static class VoloMaximizeFix {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
}
'@
Add-Type -TypeDefinition $cs -ErrorAction SilentlyContinue
$null = [VoloMaximizeFix]::SetThreadDpiAwarenessContext([IntPtr](-4))
$h = [IntPtr]([long]${nativeHandle.toString()})
$monitor = [VoloMaximizeFix]::MonitorFromWindow($h, 2)
$info = New-Object VoloMaximizeFix+MONITORINFO
$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
if (-not [VoloMaximizeFix]::GetMonitorInfo($monitor, [ref]$info)) { 'FAILED'; exit }
$m = $info.rcMonitor; $w = $info.rcWork
if ($m.Left -ne $w.Left -or $m.Top -ne $w.Top -or $m.Right -ne $w.Right -or $m.Bottom -ne $w.Bottom) { 'SKIP'; exit }
$null = [VoloMaximizeFix]::ShowWindow($h, 9)
Start-Sleep -Milliseconds 100
$cornerPreference = 1
$borderColor = -2
$null = [VoloMaximizeFix]::DwmSetWindowAttribute($h, 33, [ref]$cornerPreference, 4)
$null = [VoloMaximizeFix]::DwmSetWindowAttribute($h, 34, [ref]$borderColor, 4)
$targetClientWidth = $m.Right - $m.Left
$targetClientHeight = $m.Bottom - $m.Top
for ($attempt = 0; $attempt -lt 4; $attempt++) {
    $windowRect = New-Object VoloMaximizeFix+RECT
    $clientRect = New-Object VoloMaximizeFix+RECT
    $clientOrigin = New-Object VoloMaximizeFix+POINT
    if (-not [VoloMaximizeFix]::GetWindowRect($h, [ref]$windowRect)) { 'FAILED'; exit }
    if (-not [VoloMaximizeFix]::GetClientRect($h, [ref]$clientRect)) { 'FAILED'; exit }
    if (-not [VoloMaximizeFix]::ClientToScreen($h, [ref]$clientOrigin)) { 'FAILED'; exit }
    $clientWidth = $clientRect.Right - $clientRect.Left
    $clientHeight = $clientRect.Bottom - $clientRect.Top
    if ($clientOrigin.X -eq $m.Left -and $clientOrigin.Y -eq $m.Top -and
        $clientWidth -eq $targetClientWidth -and $clientHeight -eq $targetClientHeight) {
        'APPLIED'; exit
    }
    $windowWidth = $windowRect.Right - $windowRect.Left
    $windowHeight = $windowRect.Bottom - $windowRect.Top
    $targetX = $windowRect.Left + ($m.Left - $clientOrigin.X)
    $targetY = $windowRect.Top + ($m.Top - $clientOrigin.Y)
    $targetWidth = $windowWidth + ($targetClientWidth - $clientWidth)
    $targetHeight = $windowHeight + ($targetClientHeight - $clientHeight)
    $ok = [VoloMaximizeFix]::SetWindowPos($h, [IntPtr]::Zero, $targetX, $targetY, $targetWidth, $targetHeight, 0x0034)
    if (-not $ok) { 'FAILED'; exit }
    Start-Sleep -Milliseconds 60
}
'FAILED'
`;
  return (await runPs(script, 5000)) === 'APPLIED';
}

export async function restoreWindowFrameAppearance(nativeHandle: bigint): Promise<void> {
  const script = `
$cs = @'
using System;
using System.Runtime.InteropServices;
public static class VoloWindowFrameRestore {
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
}
'@
Add-Type -TypeDefinition $cs -ErrorAction SilentlyContinue
$h = [IntPtr]([long]${nativeHandle.toString()})
$cornerPreference = 0
$borderColor = -1
$null = [VoloWindowFrameRestore]::DwmSetWindowAttribute($h, 33, [ref]$cornerPreference, 4)
$null = [VoloWindowFrameRestore]::DwmSetWindowAttribute($h, 34, [ref]$borderColor, 4)
`;
  await runPs(script);
}

export async function focusWindowByTitle(title: string): Promise<void> {
  const safeTitle = title.replace(/'/g, "''");
  const script = `
Add-Type -Name W32 -Namespace _ -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int X, int Y, int cx, int cy, uint f);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
'@
$h = [_W32]::FindWindow([NullString]::Value, '${safeTitle}')
if ($h -ne [IntPtr]::Zero) {
  $null = [_W32]::ShowWindow($h, 9)
  $null = [_W32]::SetWindowPos($h, -1, 0, 0, 0, 0, 3)
}
`;
  const result = await runPs(script);
  logger.debug('focusWindowByTitle', { title, result: result || '(empty)' });
}

export async function getWindowRectByTitle(
  title: string
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const safeTitle = title.replace(/'/g, "''");
  // C# Add-Type is more reliable than -MemberDefinition for structs passed by
  // out/[ref]; CharSet.Unicode is required to match the (Unicode) window title.
  const script = `
$cs = @'
using System;
using System.Runtime.InteropServices;
public static class LuminaW32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
'@
Add-Type -TypeDefinition $cs -ErrorAction SilentlyContinue
$h = [LuminaW32]::FindWindow([NullString]::Value, '${safeTitle}')
if ($h -eq [IntPtr]::Zero) { 'NOT_FOUND'; exit }
$r = New-Object LuminaW32+RECT
$ok = [LuminaW32]::GetWindowRect($h, [ref]$r)
if (-not $ok) { 'FAILED'; exit }
'{0},{1},{2},{3}' -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top)
`;
  const result = await runPs(script);
  if (!result || result === 'NOT_FOUND' || result === 'FAILED') return null;
  const [x, y, width, height] = result.split(',').map(Number);
  if ([x, y, width, height].some((n) => !Number.isFinite(n) || n < 0)) return null;
  logger.debug('getWindowRectByTitle', { title, result });
  return { x, y, width, height };
}

/**
 * Move + resize a window to an exact rect, force it topmost, and return the
 * VERIFIED rect in PHYSICAL pixels.
 *
 * Used to pin the WE recording window to the top-left at the exact capture size
 * (WE ignores its own -x/-y/-width/-height at near-fullscreen sizes, so the
 * Win32 rect is the single source of truth).
 *
 * DPI: sets per-monitor-v2 awareness on the CALLING THREAD ONLY — NOT the whole
 * process.  SetProcessDPIAware() flags the process and a separately-spawned,
 * non-DPI-aware measurement then reports virtualized LOGICAL coords (×0.8 at
 * 125%), which is the mismatch we hit.  Here SetWindowPos AND the immediately
 * following GetWindowRect run on the same per-monitor-v2 thread, so both speak
 * physical pixels and the returned rect is what the renderer crops 1:1 against
 * the (also physical) screen-capture frame.
 */
export async function setWindowRectByTitle(
  title: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const safeTitle = title.replace(/'/g, "''");
  const script = `
$cs = @'
using System;
using System.Runtime.InteropServices;
public static class LuminaW32Move {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiAwarenessContext);
}
'@
Add-Type -TypeDefinition $cs -ErrorAction SilentlyContinue
# Per-monitor-v2 awareness on THIS thread only (DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4).
$null = [LuminaW32Move]::SetThreadDpiAwarenessContext([IntPtr](-4))
$h = [LuminaW32Move]::FindWindow([NullString]::Value, '${safeTitle}')
if ($h -eq [IntPtr]::Zero) { 'NOT_FOUND'; exit }
$ok = [LuminaW32Move]::SetWindowPos($h, -1, ${x}, ${y}, ${width}, ${height}, 0)
if (-not $ok) { 'FAILED'; exit }
# Verify immediately (same thread, same physical pixel space).
$r = New-Object LuminaW32Move+RECT
$ok2 = [LuminaW32Move]::GetWindowRect($h, [ref]$r)
if (-not $ok2) { 'FAILED'; exit }
'{0},{1},{2},{3}' -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top)
`;
  const result = await runPs(script);
  if (!result || result === 'NOT_FOUND' || result === 'FAILED') return null;
  const [rx, ry, rw, rh] = result.split(',').map(Number);
  if ([rx, ry, rw, rh].some((n) => !Number.isFinite(n) || n < 0)) return null;
  logger.debug('setWindowRectByTitle', { title, x, y, width, height, result });
  return { x: rx, y: ry, width: rw, height: rh };
}

/**
 * Force DWM to recomposite a window by nudging it (x,y) → (x+1,y) → (x,y).
 * Windows may cache a near-fullscreen window in an MPO hardware overlay plane;
 * the tiny position bounce forces the compositor to rebuild the surface so the
 * capture path actually sees it.
 *
 * Flags: SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING (0x0001|0x0010|0x0400).
 * Thread-scoped per-monitor-v2 DPI awareness (same as setWindowRectByTitle), so
 * x/y are physical pixels.
 */
export async function nudgeWindowByTitle(title: string, x: number, y: number): Promise<void> {
  const safeTitle = title.replace(/'/g, "''");
  const x1 = x + 1;
  const script = `
$cs = @'
using System;
using System.Runtime.InteropServices;
public static class LuminaW32Nudge {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiAwarenessContext);
}
'@
Add-Type -TypeDefinition $cs -ErrorAction SilentlyContinue
$null = [LuminaW32Nudge]::SetThreadDpiAwarenessContext([IntPtr](-4))
$h = [LuminaW32Nudge]::FindWindow([NullString]::Value, '${safeTitle}')
if ($h -eq [IntPtr]::Zero) { exit }
$flags = 0x0411
$null = [LuminaW32Nudge]::SetWindowPos($h, -1, ${x}, ${y}, 0, 0, $flags)
Start-Sleep -Milliseconds 30
$null = [LuminaW32Nudge]::SetWindowPos($h, -1, ${x1}, ${y}, 0, 0, $flags)
Start-Sleep -Milliseconds 30
$null = [LuminaW32Nudge]::SetWindowPos($h, -1, ${x}, ${y}, 0, 0, $flags)
'OK'
`;
  const result = await runPs(script);
  logger.debug('nudgeWindowByTitle', { title, x, y, result: result || '(empty)' });
}

export async function closeWindowByTitle(title: string): Promise<void> {
  const safeTitle = title.replace(/'/g, "''");
  const script = `
Add-Type -Name W32 -Namespace _ -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string w);
[DllImport("user32.dll")] public static extern int SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
'@
$h = [_W32]::FindWindow([NullString]::Value, '${safeTitle}')
if ($h -ne [IntPtr]::Zero) {
  $null = [_W32]::SendMessage($h, 0x0010, 0, 0)
}
`;
  const result = await runPs(script);
  logger.debug('closeWindowByTitle', { title, result: result || '(empty)' });
}

export async function hideCursor(): Promise<void> {
  await runPs(`
Add-Type -Name W32 -Namespace _ -MemberDefinition @'
[DllImport("user32.dll")] public static extern int ShowCursor(bool bShow);
'@
$null = [_W32]::ShowCursor($false)
`);
}

export async function showCursor(): Promise<void> {
  await runPs(`
Add-Type -Name W32 -Namespace _ -MemberDefinition @'
[DllImport("user32.dll")] public static extern int ShowCursor(bool bShow);
'@
$null = [_W32]::ShowCursor($true)
`);
}
