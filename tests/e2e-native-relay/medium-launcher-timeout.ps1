$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$launcher = $null
$owned = @{}
$ready = @{}
$evidenceDirectory = $null
$failure = $null
$phase = 'setup'
$result = [ordered]@{ timeoutSeconds = 20; maximumSeconds = 45; passed = $false }

function Hold-Participant([string]$role) {
  if ($owned.ContainsKey($role)) { return }
  $recordPath = Join-Path $evidenceDirectory "$role.json"
  if (-not [IO.File]::Exists($recordPath)) { return }
  $record = [IO.File]::ReadAllText($recordPath) | ConvertFrom-Json
  if ($record.nonce -cne $nonce -or $record.role -cne $role -or
      $record.processId -le 0 -or $record.processId -eq $PID -or
      $record.processId -eq $launcher.Id -or $record.executable -ine $pwsh -or
      [long]$record.startedAt -lt $launchedAfter) {
    throw 'NATIVE_RELAY_TIMEOUT_CONTROL: ownership_evidence'
  }
  $participant = [Diagnostics.Process]::GetProcessById([int]$record.processId)
  try {
    $null = $participant.Handle
    if ($participant.HasExited -or $participant.MainModule.FileName -ine $pwsh -or
        $participant.StartTime.ToUniversalTime().Ticks -ne [long]$record.startedAt) {
      throw 'NATIVE_RELAY_TIMEOUT_CONTROL: ownership_identity'
    }
  } catch {
    $participant.Dispose()
    throw
  }
  $owned.Add($role, $participant)
}

try {
  if (-not $IsWindows) { throw 'NATIVE_RELAY_TIMEOUT_CONTROL: windows_required' }
  $pwsh = $env:NATIVE_RELAY_PWSH
  if ([string]::IsNullOrWhiteSpace($pwsh) -or -not [IO.Path]::IsPathFullyQualified($pwsh) -or
      -not [IO.File]::Exists($pwsh)) {
    throw 'NATIVE_RELAY_TIMEOUT_CONTROL: selected_pwsh_required'
  }
  $pwsh = [IO.Path]::GetFullPath($pwsh)
  $launcherPath = Join-Path $PSScriptRoot 'run-medium.ps1'
  if (-not [IO.File]::Exists($launcherPath)) {
    throw 'NATIVE_RELAY_TIMEOUT_CONTROL: launcher_missing'
  }
  $checkout = (Get-Location).ProviderPath
  $nonce = [Guid]::NewGuid().ToString('N')
  $evidenceDirectory = Join-Path $checkout ".tmp/native-relay-evidence/timeout-$nonce"
  $null = New-Item -ItemType Directory -Path $evidenceDirectory
  $sleeperPath = Join-Path $evidenceDirectory 'owned-sleeper.ps1'
  [IO.File]::WriteAllText($sleeperPath, @'
param([string]$Directory, [string]$Nonce, [string]$Role)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$self = [Diagnostics.Process]::GetCurrentProcess()
$descendant = $null
try {
  $identity = @{
    nonce = $Nonce; role = $Role; processId = $PID
    executable = $self.MainModule.FileName
    startedAt = [string]$self.StartTime.ToUniversalTime().Ticks
  } | ConvertTo-Json
  $recordPath = Join-Path $Directory "$Role.json"
  [IO.File]::WriteAllText("$recordPath.new", $identity)
  [IO.File]::Move("$recordPath.new", $recordPath)
  $waiting = [Diagnostics.Stopwatch]::StartNew()
  while (-not [IO.File]::Exists((Join-Path $Directory "$Role.held"))) {
    if ($waiting.Elapsed.TotalSeconds -ge 60) { throw 'Owned handle was not retained' }
    Start-Sleep -Milliseconds 25
  }
  if ($Role -eq 'child') {
    $info = [Diagnostics.ProcessStartInfo]::new($env:NATIVE_RELAY_PWSH)
    $info.UseShellExecute = $false
    foreach ($argument in @('-NoProfile', '-NonInteractive', '-File', $PSCommandPath,
        '-Directory', $Directory, '-Nonce', $Nonce, '-Role', 'descendant')) {
      $info.ArgumentList.Add($argument)
    }
    $descendant = [Diagnostics.Process]::Start($info)
    $null = $descendant.Handle
  }
  $readyPath = Join-Path $Directory "$Role.ready"
  [IO.File]::WriteAllText("$readyPath.new", $Nonce)
  [IO.File]::Move("$readyPath.new", $readyPath)
  Start-Sleep -Seconds 90
} finally {
  if ($null -ne $descendant) {
    try {
      if (-not $descendant.HasExited) {
        $descendant.Kill()
        if (-not $descendant.WaitForExit(5000)) { throw 'Owned descendant did not exit' }
      }
    } finally { $descendant.Dispose() }
  }
  $self.Dispose()
}
'@)
  $command = "& '" + $sleeperPath.Replace("'", "''") + "' -Directory '" +
    $evidenceDirectory.Replace("'", "''") + "' -Nonce '$nonce' -Role child"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $info = [Diagnostics.ProcessStartInfo]::new($pwsh)
  $info.UseShellExecute = $false
  $info.WorkingDirectory = $checkout
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($argument in @('-NoProfile', '-NonInteractive', '-File', $launcherPath,
      '-EncodedCommand', $encoded, '-TimeoutSeconds', [string]$result.timeoutSeconds)) {
    $info.ArgumentList.Add($argument)
  }
  $launchedAfter = [DateTime]::UtcNow.Ticks
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $launcher = [Diagnostics.Process]::Start($info)
  $null = $launcher.Handle
  $stdout = $launcher.StandardOutput.ReadToEndAsync()
  $stderr = $launcher.StandardError.ReadToEndAsync()
  while (-not $launcher.HasExited) {
    $phase = 'ownership'
    foreach ($role in @('child', 'descendant')) {
      Hold-Participant $role
      if ($owned.ContainsKey($role)) {
        $heldPath = Join-Path $evidenceDirectory "$role.held"
        if (-not [IO.File]::Exists($heldPath)) { [IO.File]::WriteAllText($heldPath, $nonce) }
        $readyPath = Join-Path $evidenceDirectory "$role.ready"
        if (-not $ready.ContainsKey($role) -and [IO.File]::Exists($readyPath)) {
          if ([IO.File]::ReadAllText($readyPath) -cne $nonce -or $owned[$role].HasExited) {
            throw 'NATIVE_RELAY_TIMEOUT_CONTROL: ready_not_live'
          }
          $ready.Add($role, $true)
        }
      }
    }
    if ($clock.Elapsed.TotalSeconds -gt $result.maximumSeconds) {
      throw 'NATIVE_RELAY_TIMEOUT_CONTROL: outer_deadline'
    }
    Start-Sleep -Milliseconds 25
  }
  $result.elapsedMilliseconds = $clock.ElapsedMilliseconds
  $result.launcherExitCode = $launcher.ExitCode
  $returnedAt = $launcher.ExitTime.ToUniversalTime().Ticks
  $result.readyCount = $ready.Count
  if ($ready.Count -ne 2 -or $owned.Count -ne 2 -or
      $owned['child'].Id -eq $owned['descendant'].Id) {
    throw 'NATIVE_RELAY_TIMEOUT_CONTROL: ready_missing'
  }
  foreach ($role in @('child', 'descendant')) {
    # Capture before fallback cleanup; a later exit must never satisfy the deadline.
    $exited = $owned[$role].HasExited
    $result["${role}ExitedBeforeReturn"] = $exited -and
      $owned[$role].ExitTime.ToUniversalTime().Ticks -le $returnedAt
    if (-not $result["${role}ExitedBeforeReturn"]) {
      throw "NATIVE_RELAY_TIMEOUT_CONTROL: ${role}_survived_return"
    }
  }
  $phase = 'stream_capture'
  if (-not $stdout.Wait(1000) -or -not $stderr.Wait(1000)) {
    throw 'NATIVE_RELAY_TIMEOUT_CONTROL: streams_not_closed'
  }
  [IO.File]::WriteAllText((Join-Path $evidenceDirectory 'stdout.log'), $stdout.Result)
  [IO.File]::WriteAllText((Join-Path $evidenceDirectory 'stderr.log'), $stderr.Result)
  if ($result.launcherExitCode -ne 124) { throw 'NATIVE_RELAY_TIMEOUT_CONTROL: timeout_exit_code' }
  if ($stderr.Result -cnotmatch '(?m)^NATIVE_RELAY_LAUNCH_TIMEOUT:') {
    throw 'NATIVE_RELAY_TIMEOUT_CONTROL: timeout_reason'
  }
  if ($result.elapsedMilliseconds -lt ($result.timeoutSeconds * 1000) -or
      $result.elapsedMilliseconds -gt ($result.maximumSeconds * 1000)) {
    throw 'NATIVE_RELAY_TIMEOUT_CONTROL: elapsed_bound'
  }
} catch {
  $failure = if ($_.Exception.Message.StartsWith('NATIVE_RELAY_TIMEOUT_CONTROL:')) {
    $_.Exception.Message
  } else { "NATIVE_RELAY_TIMEOUT_CONTROL: $phase" }
} finally {
  foreach ($role in @('descendant', 'child')) {
    try {
      if ($null -ne $launcher) { Hold-Participant $role }
      if ($owned.ContainsKey($role)) {
        # Only retained, path/start/nonce-validated handles may be terminated.
        if (-not $owned[$role].HasExited) {
          $owned[$role].Kill()
          if (-not $owned[$role].WaitForExit(5000)) { throw 'Owned cleanup deadline' }
        }
      }
    } catch {
      $failure = 'NATIVE_RELAY_TIMEOUT_CONTROL: fallback_ownership_or_cleanup'
    } finally {
      if ($owned.ContainsKey($role)) { $owned[$role].Dispose() }
    }
  }
  if ($null -ne $launcher) {
    try {
      if (-not $launcher.HasExited) {
        $launcher.Kill()
        if (-not $launcher.WaitForExit(5000)) { throw 'Launcher cleanup deadline' }
      }
    } catch { $failure = 'NATIVE_RELAY_TIMEOUT_CONTROL: launcher_cleanup' }
    finally { $launcher.Dispose() }
  }
}
$result.passed = $null -eq $failure
$result.failure = $failure
if ($null -ne $evidenceDirectory) {
  try {
    [IO.File]::WriteAllText((Join-Path $evidenceDirectory 'result.json'), ($result | ConvertTo-Json))
  } catch { $failure = 'NATIVE_RELAY_TIMEOUT_CONTROL: evidence_write' }
}
if ($null -ne $failure) { [Console]::Error.WriteLine($failure); exit 1 }
Write-Output 'NATIVE_RELAY_TIMEOUT_CONTROL: passed'
exit 0
