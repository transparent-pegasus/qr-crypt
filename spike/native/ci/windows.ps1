param([string]$Mode, [int]$AppPid, [string]$OutDir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class G0rMouse {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
if ($Mode -eq 'Click') {
  $app = Get-Process -Id $AppPid
  $app.Refresh()
  $hwnd = $app.MainWindowHandle
  if ($hwnd -eq [IntPtr]::Zero) { throw 'G0r window handle missing' }
  $rect = New-Object G0rMouse+RECT
  if (-not [G0rMouse]::GetWindowRect($hwnd, [ref]$rect)) { throw 'GetWindowRect failed' }
  [void][G0rMouse]::SetForegroundWindow($hwnd)
  [void][G0rMouse]::SetCursorPos([int](($rect.Left + $rect.Right) / 2), [int](($rect.Top + $rect.Bottom) / 2))
  [G0rMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [G0rMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
} else {
  Write-Output ('ContainsImage=' + [System.Windows.Forms.Clipboard]::ContainsImage())
  Write-Output ('ContainsText=' + [System.Windows.Forms.Clipboard]::ContainsText())
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $image = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($image)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $image.Save((Join-Path $OutDir 'screenshot.png'))
  $graphics.Dispose()
  $image.Dispose()
}
