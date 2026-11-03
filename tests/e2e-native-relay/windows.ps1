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
using System.ComponentModel;
using System.Runtime.InteropServices;
public sealed class RelayIntegrity {
  public uint rid;
  public bool elevated;
}
public static class RelayToken {
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int informationClass, IntPtr buffer, int size, out int needed);
  [DllImport("advapi32.dll")] static extern bool IsValidSid(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  public static RelayIntegrity Measure(IntPtr process) {
    IntPtr token = IntPtr.Zero, label = IntPtr.Zero, elevation = IntPtr.Zero;
    try {
      if (!OpenProcessToken(process, 0x0008, out token)) // TOKEN_QUERY only.
        throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken failed");
      int size;
      bool sized = GetTokenInformation(token, 25, IntPtr.Zero, 0, out size); // TokenIntegrityLevel.
      int error = Marshal.GetLastWin32Error();
      if (sized || error != 122)
        throw new Win32Exception(error, "Cannot size TokenIntegrityLevel");
      if (size < IntPtr.Size + 4) throw new InvalidOperationException("Invalid integrity label size");
      label = Marshal.AllocHGlobal(size);
      int received;
      if (!GetTokenInformation(token, 25, label, size, out received))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "TokenIntegrityLevel failed");
      if (received < IntPtr.Size + 4 || received > size)
        throw new InvalidOperationException("Invalid integrity label length");
      IntPtr sid = Marshal.ReadIntPtr(label); // TOKEN_MANDATORY_LABEL starts with SID_AND_ATTRIBUTES.Sid.
      if (sid == IntPtr.Zero || !IsValidSid(sid)) throw new InvalidOperationException("Invalid integrity SID");
      IntPtr countAddress = GetSidSubAuthorityCount(sid);
      if (countAddress == IntPtr.Zero) throw new InvalidOperationException("Missing integrity SID count");
      byte count = Marshal.ReadByte(countAddress);
      if (count == 0) throw new InvalidOperationException("Missing integrity RID");
      IntPtr ridAddress = GetSidSubAuthority(sid, (uint)(count - 1));
      if (ridAddress == IntPtr.Zero) throw new InvalidOperationException("Missing integrity RID address");
      uint rid = unchecked((uint)Marshal.ReadInt32(ridAddress));
      elevation = Marshal.AllocHGlobal(4);
      if (!GetTokenInformation(token, 20, elevation, 4, out received)) // TokenElevation.
        throw new Win32Exception(Marshal.GetLastWin32Error(), "TokenElevation failed");
      if (received != 4) throw new InvalidOperationException("Invalid elevation length");
      return new RelayIntegrity { rid = rid, elevated = Marshal.ReadInt32(elevation) != 0 };
    } finally {
      if (elevation != IntPtr.Zero) Marshal.FreeHGlobal(elevation);
      if (label != IntPtr.Zero) Marshal.FreeHGlobal(label);
      if (token != IntPtr.Zero && !CloseHandle(token))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "Token CloseHandle failed");
    }
  }
}
public static class RelayWindow {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, System.Text.StringBuilder text, int capacity);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
if ($request.action -eq 'token') {
  @{
    processId = $owned.Id; startedAt = $startedAt; executable = $owned.Path
    integrity = [RelayToken]::Measure($owned.Handle)
  } | ConvertTo-Json -Compress
  exit 0
}
$handle = if ($null -eq $request.windowHandle) { $owned.MainWindowHandle } else { [IntPtr]([long]$request.windowHandle) }
if ($null -eq $request.windowHandle -and $owned.MainWindowTitle -cne 'QR Crypt Relay') {
  throw 'Owned QR Crypt Relay window is not ready or has the wrong identity'
}
[uint32]$windowOwner = 0
$null = [RelayWindow]::GetWindowThreadProcessId($handle, [ref]$windowOwner)
$title = New-Object System.Text.StringBuilder 256
$null = [RelayWindow]::GetWindowText($handle, $title, $title.Capacity)
if (![RelayWindow]::IsWindow($handle) -or $windowOwner -ne $owned.Id -or $title.ToString() -cne 'QR Crypt Relay') {
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
      title = $title.ToString()
      windows = @{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber }
      webview2 = @{ fileVersion = $runtimeVersion.FileVersion; productVersion = $runtimeVersion.ProductVersion }
      cdpOwned = $true
    } | ConvertTo-Json -Compress
  }
  { $_ -in 'minimize', 'hide', 'restore' } {
    $minimize = $request.action -eq 'minimize'
    $visible = $request.action -ne 'hide'
    $command = if ($minimize) { 6 } elseif (!$visible) { 0 } else { 9 }
    $null = [RelayWindow]::ShowWindow($handle, $command)
    if ($request.action -eq 'restore') { $null = [RelayWindow]::SetForegroundWindow($handle) }
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (([RelayWindow]::IsIconic($handle) -ne $minimize -or [RelayWindow]::IsWindowVisible($handle) -ne $visible) -and [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 50
    }
    if ([RelayWindow]::IsIconic($handle) -ne $minimize -or [RelayWindow]::IsWindowVisible($handle) -ne $visible) {
      throw 'Native window operation did not take effect'
    }
    $null = [RelayWindow]::GetWindowThreadProcessId($handle, [ref]$windowOwner)
    if (![RelayWindow]::IsWindow($handle) -or $windowOwner -ne $owned.Id) { throw 'Native window owner identity changed' }
    @{
      minimized = [RelayWindow]::IsIconic($handle); visible = [RelayWindow]::IsWindowVisible($handle)
      at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); processId = $windowOwner
      windowHandle = $handle.ToInt64().ToString()
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
