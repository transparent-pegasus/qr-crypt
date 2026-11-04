$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if (!$IsWindows) { throw 'Windows storage observation required' }
$clock = [Diagnostics.Stopwatch]::StartNew()
if ($request.budget -le 0 -or $request.budget -gt 15000) { throw 'Invalid storage deadline' }
function Budget { if ($clock.Elapsed.TotalMilliseconds -ge $request.budget) { throw 'Storage deadline expired' } }
function Plain([string]$Value) {
  if ($Value -cnotmatch '^[A-Za-z]:\\' -or [Text.Encoding]::UTF8.GetByteCount($Value) -gt 1024) { throw 'Ambiguous owned path' }
  foreach ($part in $Value.Substring(3).Split('\')) {
    if (!$part -or $part -match '[. ]$|[\x00-\x1f\x7f-\x9f/:"<>|?*~]' -or $part.Split('.')[0] -match '^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$') { throw 'Ambiguous owned component' }
  }
}
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class DownloadPath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string p, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetFinalPathNameByHandleW(SafeFileHandle h, StringBuilder b, uint n, uint f);
  public static string Canonical(string p) {
    using (var h = CreateFileW(p, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (h.IsInvalid) throw new Win32Exception();
      var b = new StringBuilder(2048);
      uint n = GetFinalPathNameByHandleW(h, b, 2048, 0);
      if (n == 0 || n >= 2048) throw new Win32Exception();
      string v = b.ToString();
      if (!v.StartsWith(@"\\?\")) throw new Exception("Nonlocal canonical path");
      return v.Substring(4);
    }
  }
}
'@
function Checked([string]$Path, [bool]$Directory) {
  Budget
  Plain $Path
  $cursor = $Path
  while ($cursor) {
    $item = Get-Item -LiteralPath $cursor -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Owned reparse point' }
    if ($cursor -ceq $Path) {
      if ($item.PSIsContainer -ne $Directory -or (!$Directory -and ($item.Attributes -band [IO.FileAttributes]::Device) -ne 0)) { throw 'Owned entry type mismatch' }
    } elseif (!$item.PSIsContainer) { throw 'Non-directory owned ancestor' }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
  if ([DownloadPath]::Canonical($Path) -cne $Path) { throw 'Owned canonical spelling mismatch' }
  Budget
  return Get-Item -LiteralPath $Path -Force
}
$parent = [string]$request.parent
Plain $parent
$null = Checked $parent $true
$root = $request.root
if ($null -ne $root) {
  if (!$root.StartsWith($parent + '\', [StringComparison]::Ordinal) -or $root.Substring($parent.Length) -cnotmatch '^\\qr-crypt-dl0-[0-9a-f]{32}$') { throw 'Root is not one exact owned child' }
  $null = Checked $root $true
  $null = Checked (Join-Path $root 'profile') $true
  $null = Checked (Join-Path $root 'downloads') $true
}
if ($request.action -in @('parent', 'validate')) { '{"validated":true}'; exit 0 }
if ($request.action -eq 'members' -or $request.action -eq 'drained') {
  $all = @(Get-CimInstance Win32_Process)
  Budget
  if ($all.Count -gt 16384) { throw 'Process inventory overflow' }
  $matched = @($all | Where-Object { $_.CommandLine -and $_.CommandLine.Contains((Join-Path $root 'profile'), [StringComparison]::Ordinal) })
  if ($request.action -eq 'drained') {
    foreach ($saved in $request.members) {
      $same = @($all | Where-Object { $_.ProcessId -eq $saved.pid -and ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() -eq $saved.startedAt })
      if ($same.Count -ne 0) { throw 'Retained candidate process remains alive' }
    }
    if ($matched.Count -ne 0) { throw 'Owned profile process drainage unproved' }
    '{"drained":true}'
    exit 0
  }
  $ids = [Collections.Generic.HashSet[uint32]]::new()
  $null = $ids.Add([uint32]$request.pid)
  for ($depth = 0; $depth -lt 32; $depth++) {
    $changed = $false
    foreach ($item in $all) { if ($ids.Contains([uint32]$item.ParentProcessId) -and $ids.Add([uint32]$item.ProcessId)) { $changed = $true } }
    if (!$changed) { break }
  }
  $members = @($all | Where-Object { $ids.Contains([uint32]$_.ProcessId) -or @($matched | ForEach-Object ProcessId) -contains $_.ProcessId })
  if ($members.Count -gt 128) { throw 'Candidate process inventory overflow' }
  foreach ($item in $members) {
    $start = ([DateTimeOffset]$item.CreationDate).ToUnixTimeMilliseconds()
    if ($start -lt $request.spawnedAfter -or !$ids.Contains([uint32]$item.ProcessId)) {
      $rootStart = $null
      try {
        $rootRecord = @($all | Where-Object { $_.ProcessId -eq $request.pid })
        if ($rootRecord.Count -eq 1) { $rootStart = ([DateTimeOffset]$rootRecord[0].CreationDate).ToUnixTimeMilliseconds() }
      } catch { $rootStart = $null }
      $detail = [ordered]@{
        root_pid = [uint32]$request.pid
        lower_ms = [long]$request.spawnedAfter
        pid = [uint32]$item.ProcessId
        ppid = [uint32]$item.ParentProcessId
        start_ms = [long]$start
        in_descendants = $ids.Contains([uint32]$item.ProcessId)
        profile_match = [bool](@($matched | ForEach-Object ProcessId) -contains $item.ProcessId)
        root_start_available = $null -ne $rootStart
        root_start_ms = $(if ($null -ne $rootStart) { $rootStart } else { 0 })
      } | ConvertTo-Json -Compress
      throw "Foreign owned-profile process $detail"
    }
    if ($item.ProcessId -eq $request.pid -and $item.ExecutablePath -ine $request.executable) { throw 'Candidate image mismatch' }
  }
  ConvertTo-Json -Compress -InputObject @{ members = @($members | ForEach-Object { @{ pid = $_.ProcessId; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(); image = $_.ExecutablePath } }) } -Depth 4
  exit 0
}
$entries = [Collections.Generic.List[object]]::new()
function Walk([string]$Path, [string]$Base, [int]$Depth) {
  Budget
  if ($Depth -gt 16 -or $entries.Count -ge 4096) { throw 'Storage inventory overflow' }
  if ($Path -cne $Base -and !$Path.StartsWith($Base + '\', [StringComparison]::Ordinal)) { throw 'Storage escaped containment' }
  $item = Get-Item -LiteralPath $Path -Force
  $null = Checked $Path $item.PSIsContainer
  if ($item.PSIsContainer) {
    foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($Path)) { Walk $entry $Base ($Depth + 1) }
  }
  $entries.Add([ordered]@{ path = $Path; directory = $item.PSIsContainer; bytes = $(if ($item.PSIsContainer) { 0 } else { $item.Length }) })
  if ($entries.Count -gt 4096) { throw 'Storage inventory overflow' }
}
if ($request.action -eq 'inventory') {
  if ($null -eq $root) { throw 'No transferred root for inventory' }
  $downloads = Join-Path $root 'downloads'
  Walk $downloads $downloads 0
  $files = @(foreach ($entry in $entries) {
    if ($entry.path -ceq $downloads) { continue }
    $hash = $null
    if (!$entry.directory -and $entry.bytes -eq 27 -and $entry.path -ceq (Join-Path $downloads 'native-relay-inert-download.txt')) {
      # Validate containment, canonical spelling, no reparse, regular type and size before the bounded read.
      $item = Checked $entry.path $false
      if ($item.Length -ne 27) { throw 'Payload size changed' }
      $stream = [IO.File]::Open($entry.path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      try {
        if ($stream.Length -ne 27) { throw 'Payload handle size mismatch' }
        $bytes = [byte[]]::new(27)
        $stream.ReadExactly($bytes, 0, 27)
        if ($stream.ReadByte() -ne -1) { throw 'Payload grew during read' }
        $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
      } finally { $stream.Dispose() }
    }
    Budget
    [ordered]@{ name = $entry.path.Substring($downloads.Length + 1); contained = $true; regular = !$entry.directory; bytes = $entry.bytes; sha256 = $hash }
  })
  $json = ConvertTo-Json -Compress -InputObject @{ files = $files; complete = $true; no_reparse = $true } -Depth 5
  if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 32768) { throw 'Inventory output overflow' }
  [Console]::Out.WriteLine($json)
  exit 0
}
if ($request.action -eq 'remove') {
  if ($null -ne $root) {
    Walk $root $root 0
    foreach ($entry in $entries) {
      Budget
      $null = Checked $entry.path $entry.directory
      if ($entry.directory) { [IO.Directory]::Delete($entry.path, $false) } else { [IO.File]::Delete($entry.path) }
    }
  }
  Budget
  $null = Checked $parent $true
  [IO.Directory]::Delete($parent, $false)
  Budget
  @{ rootRemoved = ($null -ne $root); parentRemoved = $true } | ConvertTo-Json -Compress
  exit 0
}
throw 'Unknown storage operation'
