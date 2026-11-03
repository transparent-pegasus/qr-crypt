$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$owned = Get-Process -Id $request.processId -ErrorAction SilentlyContinue
if ($null -eq $owned) {
  if ($request.action -eq 'terminate') { '{"exited":true}'; exit 0 }
  throw 'Owned executable has exited'
}
$null = $owned.Handle
$startedAt = ([DateTimeOffset]$owned.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
if ($owned.Path -ine $request.executable -or $startedAt -lt $request.spawnedAfter) {
  throw 'Native process identity mismatch'
}
if ($null -ne $request.startedAt -and $startedAt -ne $request.startedAt) {
  throw 'Native process start identity changed'
}
if ($request.action -eq 'terminate') {
  # The held process handle and start identity guard the PID; never kill by image name.
  & "$env:SystemRoot\System32\taskkill.exe" /PID $owned.Id /T /F | Out-Null
  if ($LASTEXITCODE -ne 0 -and !$owned.HasExited) { throw 'Owned process tree termination failed' }
  '{"exited":true}'
  exit 0
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RelayWindow {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
$handle = $owned.MainWindowHandle
if ($null -ne $request.windowHandle -and $handle.ToInt64().ToString() -cne $request.windowHandle) {
  throw 'Native window handle identity changed'
}
[uint32]$windowOwner = 0
$null = [RelayWindow]::GetWindowThreadProcessId($handle, [ref]$windowOwner)
if (![RelayWindow]::IsWindow($handle) -or $windowOwner -ne $owned.Id -or $owned.MainWindowTitle -cne 'QR Crypt Relay') {
  throw 'Owned QR Crypt Relay window is not ready or has the wrong identity'
}
switch ($request.action) {
  'inspect' {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $request.port -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { throw 'Owned CDP listener is not ready' }
    $processes = @(Get-CimInstance Win32_Process)
    foreach ($listener in $listeners) {
      if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) { throw 'CDP listener is not loopback-only' }
      $cursor = $listener.OwningProcess
      $listenerOwned = $false
      for ($depth = 0; $depth -lt 32; $depth++) {
        if ($cursor -eq $owned.Id) { $listenerOwned = $true; break }
        $ancestor = $processes | Where-Object ProcessId -eq $cursor | Select-Object -First 1
        if ($null -eq $ancestor) { break }
        $cursor = $ancestor.ParentProcessId
      }
      if (!$listenerOwned) { throw 'CDP listener does not belong to the owned executable tree' }
      $browserProcess = $processes | Where-Object ProcessId -eq $listener.OwningProcess | Select-Object -First 1
      if ($null -eq $browserProcess -or !$browserProcess.CommandLine.Contains($request.profile)) {
        throw 'CDP listener does not use the unique owned profile'
      }
      $runtimeVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($browserProcess.ExecutablePath)
    }
    $os = Get-CimInstance Win32_OperatingSystem
    @{
      processId = $owned.Id; startedAt = $startedAt; windowHandle = $handle.ToInt64().ToString()
      title = $owned.MainWindowTitle
      windows = @{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber }
      webview2 = @{ fileVersion = $runtimeVersion.FileVersion; productVersion = $runtimeVersion.ProductVersion }
      cdpOwned = $true
    } | ConvertTo-Json -Compress
  }
  { $_ -in 'minimize', 'restore' } {
    $minimize = $request.action -eq 'minimize'
    $command = if ($minimize) { 6 } else { 9 }
    $null = [RelayWindow]::ShowWindow($handle, $command)
    if (!$minimize) { $null = [RelayWindow]::SetForegroundWindow($handle) }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ([RelayWindow]::IsIconic($handle) -ne $minimize -and [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 50
    }
    if ([RelayWindow]::IsIconic($handle) -ne $minimize) { throw 'Native window operation did not take effect' }
    @{
      minimized = [RelayWindow]::IsIconic($handle); visible = [RelayWindow]::IsWindowVisible($handle)
      at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); processId = $windowOwner
    } | ConvertTo-Json -Compress
  }
  { $_ -in 'seedClipboard', 'readClipboard' } {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if ($request.action -eq 'seedClipboard') {
      [System.Windows.Forms.Clipboard]::Clear()
      [System.Windows.Forms.Clipboard]::SetText($request.text, [System.Windows.Forms.TextDataFormat]::UnicodeText)
    }
    $text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
    $png = $null
    $bitmap = [System.Windows.Forms.Clipboard]::GetImage()
    if ($null -ne $bitmap) {
      $bytes = New-Object System.IO.MemoryStream
      try {
        $bitmap.Save($bytes, [System.Drawing.Imaging.ImageFormat]::Png)
        $png = [Convert]::ToBase64String($bytes.ToArray())
      } finally { $bytes.Dispose(); $bitmap.Dispose() }
    }
    @{ text = $text; png = $png } | ConvertTo-Json -Compress
  }
  default { throw 'Unknown native test operation' }
}
