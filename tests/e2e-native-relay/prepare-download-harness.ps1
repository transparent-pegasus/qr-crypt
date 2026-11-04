$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $false
if (!$IsWindows) { throw 'Windows helper preparation required' }
$root = (Get-Location).Path
$source = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $source -cne $env:GITHUB_SHA) { throw 'Current workflow source required' }
$inputs = Join-Path $root '.tmp/native-relay-evidence/download-profile'
New-Item -ItemType Directory $inputs | Out-Null
$scratch = Join-Path $root '.tmp/native-relay-preserved'
New-Item -ItemType Directory $scratch | Out-Null
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
$build = Get-Content (Join-Path $root '.tmp/native-relay-evidence/build.json') -Raw | ConvertFrom-Json
$tool = Get-Content (Join-Path $root '.tmp/native-relay-evidence/launcher/tool.json') -Raw | ConvertFrom-Json
if ($build.source -cne $source -or $tool.source -cne $source -or $tool.pwsh -cne $env:NATIVE_RELAY_PWSH -or (Hash $tool.pwsh) -cne $tool.pwsh_sha256) { throw 'Original build/selected host identity mismatch' }
function OriginalIdentity {
  [ordered]@{
    executable_sha256 = Hash $env:NATIVE_RELAY_EXE
    cargo_lock_sha256 = Hash (Join-Path $root 'native/desktop/Cargo.lock')
    aube_lock_sha256 = Hash (Join-Path $root 'aube-lock.yaml')
    cargo_manifest_sha256 = Hash (Join-Path $root 'native/desktop/Cargo.toml')
    product_source_sha256 = Hash (Join-Path $root 'native/desktop/src/main.rs')
    launcher_sha256 = Hash (Join-Path $root 'tests/e2e-native-relay/run-medium.ps1')
    host_script_sha256 = Hash (Join-Path $root 'tests/e2e-native-relay/windows.ps1')
    powershell_sha256 = Hash $tool.pwsh
  }
}
$before = OriginalIdentity
foreach ($key in @('executable_sha256', 'cargo_lock_sha256', 'aube_lock_sha256')) {
  if ($before[$key] -cne $build.$key) { throw "Original build identity mismatch: $key" }
}
$paths = @(& git ls-files -- native/desktop tests/e2e-native-relay package.json aube-lock.yaml mise.toml)
if ($LASTEXITCODE -ne 0 -or $paths.Count -eq 0) { throw 'Cannot enumerate checked-in helper inputs' }
& git diff --exit-code -- $paths
if ($LASTEXITCODE -ne 0) { throw 'Helper preparation requires unchanged checked-in inputs' }
$snapshot = [ordered]@{
  source = $source
  files = @(foreach ($inputPath in $paths) {
    $path = Join-Path $root $inputPath
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Regular checked-in helper input required' }
    $copy = Join-Path $inputs "source/$inputPath"
    $null = New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($copy))
    Copy-Item -LiteralPath $path -Destination $copy
    $digest = Hash $path
    if ((Hash $copy) -cne $digest) { throw 'Helper source evidence copy mismatch' }
    [ordered]@{ path = $inputPath; bytes = $item.Length; sha256 = $digest }
  })
}
$snapshot | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $inputs 'inputs.json')
$snapshotBefore = Hash (Join-Path $inputs 'inputs.json')
$originalSaved = Join-Path $scratch 'original-release-preserved.exe'
Copy-Item -LiteralPath $env:NATIVE_RELAY_EXE -Destination $originalSaved
if ((Hash $originalSaved) -cne $before.executable_sha256) { throw 'Original EXE preservation failed' }
$identity = [ordered]@{
  source = $source
  prepared = $false
  original_executable = $env:NATIVE_RELAY_EXE
  preserved_executable = $originalSaved
  original = $before
  powerShell = [ordered]@{ executable = $tool.pwsh; sha256 = $tool.pwsh_sha256 }
  input_manifest_sha256 = $snapshotBefore
  helper_executable = Join-Path $root 'native/desktop/target/release/native-relay-download-profile.exe'
  helper_executable_sha256 = $null
  commands = @()
  primary = $null
  cleanup = @()
}
$primary = $null
$cleanupErrors = [Collections.Generic.List[string]]::new()
try {
  Push-Location (Join-Path $root 'native/desktop')
  try {
    $rust = (& mise exec -- rustc --version) -join "`n"
    if ($LASTEXITCODE -ne 0 -or !$rust.StartsWith('rustc 1.99.1 ')) { throw 'The exact scoped Rust toolchain is required' }
    $metadata = & mise exec -- cargo metadata --no-deps --locked --offline --format-version 1
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the feature-gated helper target' }
    $metadata | Set-Content (Join-Path $inputs 'cargo-metadata.json')
    $package = ($metadata | ConvertFrom-Json).packages | Where-Object { $_.name -ceq 'qr-crypt-relay' }
    $target = @($package.targets | Where-Object { $_.name -ceq 'native-relay-download-profile' })
    if ($target.Count -ne 1 -or @($target[0].'required-features').Count -ne 1 -or $target[0].'required-features'[0] -cne 'native-e2e' -or $package.features.default -contains 'native-e2e' -or $package.default_run -cne 'qr-crypt-relay') { throw 'Helper must be explicit and absent from default product builds' }
    $started = [DateTime]::UtcNow.ToString('o')
    & mise exec -- cargo build --release --locked --offline --features native-e2e --bin native-relay-download-profile --target-dir target 1> (Join-Path $inputs 'helper-build.stdout.log') 2> (Join-Path $inputs 'helper-build.stderr.log')
    $buildExit = $LASTEXITCODE
    $identity.commands += [ordered]@{ argv = @('mise', 'exec', '--', 'cargo', 'build', '--release', '--locked', '--offline', '--features', 'native-e2e', '--bin', 'native-relay-download-profile', '--target-dir', 'target'); cwd = (Get-Location).Path; started_at = $started; finished_at = [DateTime]::UtcNow.ToString('o'); exit = $buildExit; stdout = 'helper-build.stdout.log'; stderr = 'helper-build.stderr.log' }
  } finally { Pop-Location }
  Get-Content (Join-Path $inputs 'helper-build.stdout.log'), (Join-Path $inputs 'helper-build.stderr.log') | Write-Output
  if ($buildExit -ne 0) { throw "Download helper build failed: $buildExit" }
  Push-Location (Join-Path $root 'native/desktop')
  try {
    $started = [DateTime]::UtcNow.ToString('o')
    & mise exec -- cargo test --release --locked --offline --features native-e2e --bin native-relay-download-profile --target-dir target 1> (Join-Path $inputs 'protocol-tests.stdout.log') 2> (Join-Path $inputs 'protocol-tests.stderr.log')
    $testExit = $LASTEXITCODE
    $identity.commands += [ordered]@{ argv = @('mise', 'exec', '--', 'cargo', 'test', '--release', '--locked', '--offline', '--features', 'native-e2e', '--bin', 'native-relay-download-profile', '--target-dir', 'target'); cwd = (Get-Location).Path; started_at = $started; finished_at = [DateTime]::UtcNow.ToString('o'); exit = $testExit; stdout = 'protocol-tests.stdout.log'; stderr = 'protocol-tests.stderr.log' }
  } finally { Pop-Location }
  $testOutput = [IO.File]::ReadAllText((Join-Path $inputs 'protocol-tests.stdout.log'))
  [Console]::Out.Write($testOutput)
  [Console]::Error.Write([IO.File]::ReadAllText((Join-Path $inputs 'protocol-tests.stderr.log')))
  if ($testExit -ne 0 -or $testOutput -notmatch 'test result: ok\. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;') { throw 'All eight frozen helper protocol tests must pass' }
  $identity.rust = $rust.Trim()
  $identity.helper_executable_sha256 = Hash $identity.helper_executable
  $env:NDL0_PROOF_EXE = $identity.helper_executable
  $env:NDL0_PARENT_LOGS = Join-Path $inputs 'parent'
  New-Item -ItemType Directory $env:NDL0_PARENT_LOGS | Out-Null
  # BEGIN TASK0_LOADER_INSPECTION
  $loader = Join-Path $inputs 'loader-inspection'
  if (Test-Path -LiteralPath $loader) { throw 'Fresh loader evidence directory required' }
  New-Item -ItemType Directory $loader | Out-Null
  $inspectionClock = [Diagnostics.Stopwatch]::StartNew()
  $inspectionFiles = [Collections.Generic.List[object]]::new()
  $inspection = [ordered]@{
    source = $env:GITHUB_SHA
    scope = 'Read-only prelaunch loader/manifest gate; launch/profile fields cover this phase only; rebuilt helper is new evidence unless hashes match'
    phase = 'prelaunch'
    helper_launched = $false
    profile_touched = $false
    native_accepted = $false
    actual_loader_module_measured = $false
    comparison_only = $true
    incomplete = $true
    failure = $null
    manifest_exit = $null
    manifest_matches_application = $false
    manifest_interpretation = 'Read the exact mt exit and raw streams; no absent-manifest inference'
    original_before = $before
    commands = [Collections.Generic.List[object]]::new()
    adjacent_paths = [Collections.Generic.List[object]]::new()
    v6_candidates = [Collections.Generic.List[object]]::new()
    limits = [ordered]@{ helper_bytes = 64MB; manifest_bytes = 64KB; log_bytes_per_stream = 2MB; v6_candidates = 8; command_ms = 15000; inspection_ms = 120000 }
  }
  function InspectionFile([string]$Path, [long]$MaxBytes = [long]::MaxValue) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Regular inspection file required: $Path" }
    if ($item.Length -gt $MaxBytes) { throw "Inspection file exceeds its pre-copy bound: $Path" }
    $identity = [ordered]@{ path = $item.FullName; bytes = $item.Length; sha256 = Hash $item.FullName }
    $inspectionFiles.Add($identity)
    return $identity
  }
  function InspectCommand([string]$Name, [string]$Tool, [string[]]$Arguments) {
    $logLimit = 2MB
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new($Tool)
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $process.StartInfo.ArgumentList.Add($argument) }
    $record = [ordered]@{ name = $Name; tool = $Tool; arguments = $Arguments; exit = $null; overflow = $false; timed_out = $false; error = $null; streams = @() }
    $channels = @()
    $started = $false
    try {
      if ($inspectionClock.ElapsedMilliseconds -ge 120000) { throw 'Inspection deadline exhausted before command start' }
      $started = $process.Start()
      if (!$started) { throw 'Inspection tool did not start' }
      $commandClock = [Diagnostics.Stopwatch]::StartNew()
      foreach ($streamName in @('stdout', 'stderr')) {
        $path = Join-Path $loader "$Name.$streamName.log"
        $reader = if ($streamName -ceq 'stdout') { $process.StandardOutput.BaseStream } else { $process.StandardError.BaseStream }
        $channel = @{ path = $path; reader = $reader; buffer = [byte[]]::new(8192); done = $false; seen = 0; writer = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
        $channels += $channel
        $channel.task = $reader.ReadAsync($channel.buffer, 0, $channel.buffer.Length)
      }
      while ($true) {
        foreach ($channel in $channels) {
          if ($channel.done -or !$channel.task.IsCompleted) { continue }
          $count = $channel.task.GetAwaiter().GetResult()
          if ($count -eq 0) { $channel.done = $true; continue }
          $channel.seen += $count
          $remaining = $logLimit - $channel.writer.Length
          $channel.writer.Write($channel.buffer, 0, [Math]::Min($count, $remaining))
          if ($count -gt $remaining) { $record.overflow = $true; break }
          $channel.task = $channel.reader.ReadAsync($channel.buffer, 0, $channel.buffer.Length)
        }
        if ($record.overflow) { break }
        if ($commandClock.ElapsedMilliseconds -ge 15000 -or $inspectionClock.ElapsedMilliseconds -ge 120000) { $record.timed_out = $true; break }
        if ($process.HasExited -and @($channels | Where-Object { !$_.done }).Count -eq 0) { break }
        Start-Sleep -Milliseconds 10
      }
    } catch { $record.error = $_.Exception.Message }
    finally {
      try {
        if ($started -and !$process.HasExited) { $process.Kill($true) }
        if ($started -and $process.WaitForExit(1000)) { $record.exit = $process.ExitCode }
      } catch { $record.error = $_.Exception.Message }
      foreach ($channel in $channels) {
        $record.streams += [ordered]@{ path = $channel.path; seen_bytes = $channel.seen; retained_bytes = $channel.writer.Length }
        $channel.writer.Dispose()
      }
      $process.Dispose()
      $inspection.commands.Add($record)
      $record | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $loader "$Name.command.json")
    }
    if ($record.overflow -or $record.timed_out -or $null -ne $record.error -or $null -eq $record.exit) { throw "Incomplete inspection command: $Name; see raw capped streams and command receipt" }
    return $record.exit
  }
  try {
    $inspection.helper_before = InspectionFile $env:NDL0_PROOF_EXE 64MB
    $helperSaved = Join-Path $loader 'native-relay-download-profile.unmodified.exe'
    Copy-Item -LiteralPath $env:NDL0_PROOF_EXE -Destination $helperSaved
    $inspection.saved_helper = InspectionFile $helperSaved 64MB
    if ($inspection.saved_helper.sha256 -cne $inspection.helper_before.sha256) { throw 'Helper copy digest mismatch' }
    $appManifest = Join-Path $root '.tmp/native-relay-evidence/application.manifest'
    $inspection.application_manifest = InspectionFile $appManifest 64KB
    $appSaved = Join-Path $loader 'application.manifest'
    Copy-Item -LiteralPath $appManifest -Destination $appSaved
    $inspection.saved_application_manifest = InspectionFile $appSaved 64KB
    if ($inspection.saved_application_manifest.sha256 -cne $inspection.application_manifest.sha256) { throw 'Original application manifest copy digest mismatch' }
    $snapshotIdentity = InspectionFile (Join-Path $inputs 'inputs.json') 64KB
    if ($snapshotIdentity.sha256 -cne $snapshotBefore) { throw 'Preserved helper input manifest changed before inspection' }
    foreach ($suffix in @('.manifest', '.local')) {
      $adjacent = "$($env:NDL0_PROOF_EXE)$suffix"
      $exists = Test-Path -LiteralPath $adjacent
      $state = [ordered]@{ path = $adjacent; exists = $exists; directory = $false; reparse = $false }
      $inspection.adjacent_paths.Add($state)
      if (!$exists) { continue }
      $item = Get-Item -LiteralPath $adjacent -Force
      $state.directory = $item.PSIsContainer
      $state.reparse = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
      if ($suffix -ceq '.local' -and $item.PSIsContainer) {
        $inspection.interpretation_stopped = 'adjacent .local directory; contents not traversed'
        throw $inspection.interpretation_stopped
      }
      if ($state.reparse) { throw 'Adjacent redirection is a reparse point; stop interpretation' }
      if ($suffix -ceq '.manifest') {
        $state.identity = InspectionFile $adjacent 64KB
        $sidecarSaved = Join-Path $loader 'helper-adjacent.manifest'
        Copy-Item -LiteralPath $adjacent -Destination $sidecarSaved
        $state.saved = InspectionFile $sidecarSaved 64KB
        if ($state.saved.sha256 -cne $state.identity.sha256) { throw 'Adjacent manifest copy digest mismatch' }
      }
    }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    $inspection.vswhere = InspectionFile $vswhere
    $inspection.vswhere.file_version = (Get-Item -LiteralPath $vswhere).VersionInfo.FileVersion
    $vsExit = InspectCommand 'vswhere' $vswhere @('-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath')
    $vsRoots = @([IO.File]::ReadAllLines((Join-Path $loader 'vswhere.stdout.log')) | Where-Object { ![string]::IsNullOrWhiteSpace($_) })
    if ($vsExit -ne 0 -or $vsRoots.Count -ne 1) { throw 'One installed VS tools root required' }
    $selectedDumpbin = @(Get-ChildItem "$($vsRoots[0])/VC/Tools/MSVC/*/bin/Hostx64/x64/dumpbin.exe" -File | Sort-Object FullName | Select-Object -Last 1)
    $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    $selectedMt = @(Get-ChildItem "$sdkBin/*/x64/mt.exe" -File | Sort-Object FullName | Select-Object -Last 1)
    if ($selectedDumpbin.Count -ne 1 -or $selectedMt.Count -ne 1) { throw 'Unique installed x64 PE and SDK manifest tools required' }
    $dumpbin = $selectedDumpbin[0]
    $mt = $selectedMt[0]
    $inspection.dumpbin = InspectionFile $dumpbin.FullName
    $inspection.dumpbin.file_version = $dumpbin.VersionInfo.FileVersion
    $inspection.mt = InspectionFile $mt.FullName
    $inspection.mt.file_version = $mt.VersionInfo.FileVersion
    $inspection.tool_selection = [ordered]@{ vs_root = $vsRoots[0]; vc_directory = $dumpbin.Directory.Parent.Parent.Parent.FullName; sdk_directory = $mt.Directory.Parent.FullName; selection = 'lexical-last installed x64 path; SDK selection matches original workflow' }
    $inspection.headers_exit = InspectCommand 'helper-headers' $dumpbin.FullName @('/headers', $helperSaved)
    $inspection.imports_exit = InspectCommand 'helper-imports' $dumpbin.FullName @('/imports', $helperSaved)
    $helperManifest = Join-Path $loader 'helper.manifest'
    $inspection.manifest_exit = InspectCommand 'helper-manifest' $mt.FullName @("-inputresource:$helperSaved;#1", "-out:$helperManifest")
    $inspection.manifest_output_present = Test-Path -LiteralPath $helperManifest -PathType Leaf
    if ($inspection.manifest_exit -ne 0 -or !$inspection.manifest_output_present) { throw 'Helper manifest extraction failed' }
    $inspection.helper_manifest = InspectionFile $helperManifest 64KB
    $inspection.manifest_matches_application = $inspection.helper_manifest.sha256 -ceq $inspection.saved_application_manifest.sha256
    if (!$inspection.manifest_matches_application) { throw 'Helper manifest differs from the original application manifest' }
    $systemComctl = Join-Path $env:SystemRoot 'System32/comctl32.dll'
    $inspection.system_comctl = InspectionFile $systemComctl
    $inspection.system_exports_exit = InspectCommand 'system-comctl-exports' $dumpbin.FullName @('/exports', $systemComctl)
    $winSxS = Get-Item -LiteralPath (Join-Path $env:SystemRoot 'WinSxS') -Force
    if (!$winSxS.PSIsContainer -or ($winSxS.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Literal OS WinSxS directory required' }
    $identityPattern = '^amd64_microsoft\.windows\.common-controls_6595b64144ccf1df_6\.\d+\.\d+\.\d+_[a-z0-9-]+_[a-f0-9]{16}$'
    $v6 = @(Get-ChildItem -LiteralPath $winSxS.FullName -Directory -Force | Where-Object { $_.Name -cmatch $identityPattern } | Sort-Object FullName)
    $inspection.v6_candidate_count = $v6.Count
    if ($v6.Count -gt 8) { throw 'Common Controls v6 candidate cap exceeded; no candidate exports inspected' }
    $inspection.v6_candidate_paths = @($v6 | ForEach-Object FullName)
    foreach ($candidate in $v6) {
      if ($candidate.Parent.FullName -cne $winSxS.FullName -or $candidate.Name -cnotmatch $identityPattern -or ($candidate.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unexpected WinSxS candidate identity or redirection' }
      $dll = InspectionFile (Join-Path $candidate.FullName 'comctl32.dll')
      $name = 'winsxs-comctl-{0}-exports' -f $inspection.v6_candidates.Count
      $entry = [ordered]@{ assembly_identity = $candidate.Name; dll = $dll; exports_exit = $null; comparison_only = $true }
      $inspection.v6_candidates.Add($entry)
      $entry.exports_exit = InspectCommand $name $dumpbin.FullName @('/exports', $dll.path)
    }
    $inspection.incomplete = $v6.Count -eq 0 -or @($inspection.commands | Where-Object { $_.exit -ne 0 }).Count -ne 0
  } catch { $inspection.failure = $_.Exception.Message; $inspection.incomplete = $true }
  finally {
    $identityErrors = [Collections.Generic.List[string]]::new()
    try {
      $inspection.original_after_inspection = OriginalIdentity
      foreach ($key in $before.Keys) {
        if ($inspection.original_after_inspection[$key] -cne $before[$key]) { $identityErrors.Add("Original input changed during inspection: $key") }
      }
    } catch { $identityErrors.Add($_.Exception.Message) }
    foreach ($file in @($snapshot.files)) {
      $inspectionFiles.Add([ordered]@{ path = Join-Path $root $file.path; sha256 = $file.sha256 })
    }
    $inspection.preservation_after = @(foreach ($expected in $inspectionFiles) {
      $actual = $null
      $errorText = $null
      try {
        $actual = Hash $expected.path
        if ($actual -cne $expected.sha256) { throw "Inspection input digest changed: $($expected.path)" }
      } catch { $errorText = $_.Exception.Message; $identityErrors.Add($errorText) }
      [ordered]@{ path = $expected.path; expected_sha256 = $expected.sha256; actual_sha256 = $actual; error = $errorText }
    })
    $inspection.identity_errors = $identityErrors.ToArray()
    if ($identityErrors.Count -ne 0) { $inspection.incomplete = $true }
    $inspection.elapsed_ms = $inspectionClock.ElapsedMilliseconds
    $inspection | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $loader 'inspection.json')
  }
  if ($inspection.incomplete) { throw 'NATIVE_DOWNLOAD_HELPER_INSPECTION_INCOMPLETE: retain bounded evidence; helper not launched, profile not touched' }
  # END TASK0_LOADER_INSPECTION
  $command = @'
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
# BEGIN TASK0_PARENT_CONTROLS
$controlInputs = [IO.Path]::GetDirectoryName($env:NDL0_PARENT_LOGS)
$controls = @(
  [ordered]@{ name = 'old-arity'; evidence = (Join-Path $controlInputs 'control-old-evidence'); expected = 'TASK0_FAILURE: usage: observe <fresh-absolute-evidence-dir> <existing-absolute-parent> | set/read <owned-root> <nonce>'; exit = $null; stdout = $null; stderr = $null; trace = $null; evidence_absent = $null; errors = @(); passed = $false }
  [ordered]@{ name = 'relative-parent'; evidence = (Join-Path $controlInputs 'control-relative-evidence'); expected = 'TASK0_FAILURE: ambiguous temp parent spelling'; exit = $null; stdout = $null; stderr = $null; trace = $null; evidence_absent = $null; errors = @(); passed = $false }
)
foreach ($control in $controls) {
  $logs = Join-Path $env:NDL0_PARENT_LOGS $control.name
  try {
    if (![IO.Path]::IsPathFullyQualified($control.evidence) -or (Test-Path -LiteralPath $control.evidence)) { throw 'Fresh absolute control evidence path required' }
    New-Item -ItemType Directory $logs | Out-Null
    if ($control.name -ceq 'old-arity') {
      & $env:NDL0_PROOF_EXE observe $control.evidence 1> (Join-Path $logs 'stdout.log') 2> (Join-Path $logs 'stderr.log')
      $control.exit = $LASTEXITCODE
    } else {
      & $env:NDL0_PROOF_EXE observe $control.evidence relative-parent 1> (Join-Path $logs 'stdout.log') 2> (Join-Path $logs 'stderr.log')
      $control.exit = $LASTEXITCODE
    }
    $control.evidence_absent = !(Test-Path -LiteralPath $control.evidence)
  } catch { $control.errors += $_.Exception.Message }
  foreach ($stream in @(
    @{ name = 'stdout'; path = (Join-Path $logs 'stdout.log'); limit = 32KB }
    @{ name = 'stderr'; path = (Join-Path $logs 'stderr.log'); limit = 32KB }
    @{ name = 'trace'; path = (Join-Path $control.evidence 'observation.tsv'); limit = 128KB }
  )) {
    try {
      if ($stream.name -ceq 'trace' -and !(Test-Path -LiteralPath $stream.path)) { continue }
      $item = Get-Item -LiteralPath $stream.path -Force
      if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -gt $stream.limit) { throw "Control stream is not a bounded regular file: $($stream.path)" }
      $control[$stream.name] = [Text.UTF8Encoding]::new($false, $true).GetString([IO.File]::ReadAllBytes($stream.path))
    } catch { $control.errors += $_.Exception.Message }
  }
}
$controls | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $controlInputs 'parent-controls-observed.json')
foreach ($control in $controls) {
  try {
    if ($control.errors.Count -ne 0) { throw 'Control setup, launch or bounded capture failed' }
    if ($control.exit -ne 1 -or $control.stdout -cne '') { throw 'Control requires exit 1 and empty stdout' }
    if ($control.stderr -cne ($control.expected + "`n") -and $control.stderr -cne ($control.expected + "`r`n")) { throw 'Control did not reach its exact one-line rejection reason' }
    if ($control.name -ceq 'old-arity') {
      if (!$control.evidence_absent) { throw 'Old arity created its requested evidence path' }
    } else {
      # Four complete records also exclude every owned-root, helper and session record.
      $tracePattern = '\Aparent\tpid=[1-9]\d*\trid=8192\televated=false\tin_outer_job=true\tbudget_ms=90000\twork_ms=80000\toutput_cap=32768\r?\n' +
        'explicit-parent\tpath_hex=72656c61746976652d706172656e74\r?\n' +
        'primary-observation-error\t616d626967756f75732074656d7020706172656e74207370656c6c696e67\r?\n' +
        'result\tpersistence=false\tcleanup=true\telapsed_ms=\d+\twindows_runtime_measurement=true\r?\n\z'
      if ($null -eq $control.trace -or $control.trace -cnotmatch $tracePattern) { throw 'Relative parent lacks the exact Medium/explicit-parent/failure trace' }
    }
    $control.passed = $true
  } catch { $control.errors += $_.Exception.Message }
}
$controls | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $controlInputs 'parent-controls-result.json')
if (@($controls | Where-Object { !$_.passed }).Count -ne 0) { throw 'TASK0_PARENT_CONTROLS_FAILED: retained both controls; positive observation blocked' }
# END TASK0_PARENT_CONTROLS
exit 0
'@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  & $env:NATIVE_RELAY_PWSH -NoProfile -NonInteractive -File (Join-Path $root 'tests/e2e-native-relay/run-medium.ps1') -EncodedCommand $encoded -TimeoutSeconds 90
  $launchExit = $LASTEXITCODE
  $launchExit | Set-Content (Join-Path $inputs 'launch-exit.txt')
  if ($launchExit -ne 0) { throw "Download helper controls failed: $launchExit; retained artifacts, no profile reuse or native acceptance" }

  $identity.prepared = $true
} catch { $primary = $_.Exception.Message; $identity.prepared = $false }
finally {
  try {
    $after = OriginalIdentity
    $after | ConvertTo-Json | Set-Content (Join-Path $inputs 'original-after.json')
    foreach ($key in $before.Keys) { if ($after[$key] -cne $before[$key]) { throw "Original input changed during helper preparation: $key" } }
    if ((Hash $originalSaved) -cne $before.executable_sha256 -or (Hash (Join-Path $inputs 'inputs.json')) -cne $snapshotBefore) { throw 'Preserved EXE/helper input manifest changed' }
    foreach ($file in $snapshot.files) { if ((Hash (Join-Path $root $file.path)) -cne $file.sha256) { throw "Helper input changed: $($file.path)" } }
  } catch { $cleanupErrors.Add($_.Exception.Message); $identity.prepared = $false }
  $identity.primary = $primary
  $identity.cleanup = $cleanupErrors.ToArray()
  $identity | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $inputs 'identity.json')
}
if ($null -ne $primary) { throw $primary }
if ($cleanupErrors.Count -ne 0) { throw ($cleanupErrors -join '; ') }
[ordered]@{
  variant = 'original'; source = $build.source; exeSha256 = $build.executable_sha256
  cargoLockSha256 = $build.cargo_lock_sha256; aubeLockSha256 = $build.aube_lock_sha256
  helperSha256 = $identity.helper_executable_sha256; powerShellSha256 = $tool.pwsh_sha256
} | ConvertTo-Json | Set-Content (Join-Path $inputs 'expected-original.json')
exit 0
