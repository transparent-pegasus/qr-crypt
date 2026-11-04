$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PSNativeCommandUseErrorActionPreference = $false
if (!$IsWindows) { throw 'Windows download control required' }
$root = (Get-Location).Path
$negativeRoot = Join-Path $env:RUNNER_TEMP 'native-policy-negative'
$evidence = Join-Path $root '.tmp/native-relay-evidence/download-negative'
New-Item -ItemType Directory $evidence | Out-Null
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
$build = Get-Content (Join-Path $root '.tmp/native-relay-evidence/build.json') -Raw | ConvertFrom-Json
$prepared = Get-Content (Join-Path $root '.tmp/native-relay-evidence/download-profile/identity.json') -Raw | ConvertFrom-Json
$tool = Get-Content (Join-Path $root '.tmp/native-relay-evidence/launcher/tool.json') -Raw | ConvertFrom-Json
if (!$prepared.prepared -or $prepared.source -cne $env:GITHUB_SHA -or $build.source -cne $env:GITHUB_SHA -or $tool.source -cne $env:GITHUB_SHA -or (Hash $prepared.helper_executable) -cne $prepared.helper_executable_sha256 -or (Hash $tool.pwsh) -cne $tool.pwsh_sha256) { throw 'Source-bound helper and selected host required' }
function OriginalIdentity {
  [ordered]@{
    executable_sha256 = Hash $prepared.original_executable
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
foreach ($entry in $prepared.original.PSObject.Properties) {
  if ($before[$entry.Name] -cne $entry.Value) { throw "Original input changed before the download control: $($entry.Name)" }
}
if ($env:NATIVE_RELAY_EXE -cne $prepared.original_executable -or $before.executable_sha256 -cne $build.executable_sha256 -or (Hash $prepared.preserved_executable) -cne $before.executable_sha256) { throw 'The download control must preserve the original release EXE' }
$previousExecutable = $env:NATIVE_RELAY_EXE
$previousJson = $env:PLAYWRIGHT_JSON_OUTPUT_NAME
$previousEvidence = $env:NATIVE_RELAY_RUN_EVIDENCE
$primary = $null
$cleanup = [Collections.Generic.List[string]]::new()
$mutation = [ordered]@{
  source = $env:GITHUB_SHA; path = 'native/desktop/src/main.rs'
  before = '.on_download(|_, _| false)'; after = '.on_download(|_, _| true)'
  original = $before; mutant_source_sha256 = $null; mutant_executable_sha256 = $null
  test_exit = $null; accepted = $false; primary = $null; cleanup = @()
}
try {
  $negativeHead = (& git -C $negativeRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $negativeHead -cne $env:GITHUB_SHA) { throw 'Existing complete isolated negative worktree required' }
  $paths = @(& git ls-files -- native/desktop)
  if ($LASTEXITCODE -ne 0 -or $paths.Count -eq 0) { throw 'Cannot identify original tracked native inputs' }
  foreach ($inputPath in $paths) {
    Copy-Item -LiteralPath (Join-Path $root $inputPath) -Destination (Join-Path $negativeRoot $inputPath) -Force
  }
  & git -C $negativeRoot diff --exit-code -- native/desktop
  if ($LASTEXITCODE -ne 0) { throw 'The download control must start from the original tracked native inputs' }
  $nativeInputs = @(foreach ($inputPath in $paths) {
    [ordered]@{ path = $inputPath; sha256 = Hash (Join-Path $root $inputPath) }
  })
  $nativeInputs | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $evidence 'native-inputs.json')
  $policy = Join-Path $negativeRoot $mutation.path
  $old = [IO.File]::ReadAllText($policy)
  if ([regex]::Matches($old, [regex]::Escape($mutation.before)).Count -ne 1) { throw 'Exactly one download callback mutation required' }
  [IO.File]::WriteAllText($policy, $old.Replace($mutation.before, $mutation.after), [Text.UTF8Encoding]::new($false))
  $mutation.mutant_source_sha256 = Hash $policy
  & git -C $negativeRoot diff -- native/desktop | Set-Content (Join-Path $evidence 'mutation.diff')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot retain the exact download mutation' }
  foreach ($file in $nativeInputs) {
    $expected = if ($file.path -ceq $mutation.path) { $mutation.mutant_source_sha256 } else { $file.sha256 }
    if ((Hash (Join-Path $negativeRoot $file.path)) -cne $expected) { throw 'Unrelated native mutation detected' }
  }
  Push-Location (Join-Path $negativeRoot 'native/desktop')
  try {
    $started = [DateTime]::UtcNow.ToString('o')
    & mise exec -- cargo build --release --locked --offline --bin qr-crypt-relay --target-dir target 1> (Join-Path $evidence 'build.stdout.log') 2> (Join-Path $evidence 'build.stderr.log')
    $buildExit = $LASTEXITCODE
    [ordered]@{ argv = @('mise', 'exec', '--', 'cargo', 'build', '--release', '--locked', '--offline', '--bin', 'qr-crypt-relay', '--target-dir', 'target'); cwd = (Get-Location).Path; started_at = $started; finished_at = [DateTime]::UtcNow.ToString('o'); exit = $buildExit; stdout = 'build.stdout.log'; stderr = 'build.stderr.log' } | ConvertTo-Json | Set-Content (Join-Path $evidence 'build-command.json')
  } finally { Pop-Location }
  Get-Content (Join-Path $evidence 'build.stdout.log'), (Join-Path $evidence 'build.stderr.log') | Write-Output
  if ($buildExit -ne 0) { throw "Download mutant must compile: $buildExit" }
  $mutant = Join-Path $negativeRoot 'native/desktop/target/release/qr-crypt-relay.exe'
  $mutation.mutant_executable_sha256 = Hash $mutant
  if ($mutation.mutant_executable_sha256 -ceq $before.executable_sha256) { throw 'Download mutant EXE must differ from the original' }
  foreach ($file in $nativeInputs) {
    $expected = if ($file.path -ceq $mutation.path) { $mutation.mutant_source_sha256 } else { $file.sha256 }
    if ((Hash (Join-Path $negativeRoot $file.path)) -cne $expected) { throw 'Isolated input changed during mutant build' }
  }
  [ordered]@{
    variant = 'mutant'; source = $build.source; exeSha256 = $mutation.mutant_executable_sha256
    cargoLockSha256 = $build.cargo_lock_sha256; aubeLockSha256 = $build.aube_lock_sha256
    helperSha256 = $prepared.helper_executable_sha256; powerShellSha256 = $tool.pwsh_sha256
  } | ConvertTo-Json | Set-Content (Join-Path $evidence 'expected.json')
  $env:NATIVE_RELAY_EXE = $mutant
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path $evidence 'report.json'
  $env:NATIVE_RELAY_RUN_EVIDENCE = $evidence
  $command = @'
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
& $env:NATIVE_RELAY_MISE exec -- aube node node_modules/@playwright/test/cli.js test -c playwright.native-relay.config.ts tests/e2e-native-relay/policy.spec.ts --grep 'a trusted blob download cannot complete or save a file in owned storage$' --workers=1 --retries=0 --reporter=list,json "--output=$(Join-Path $env:NATIVE_RELAY_RUN_EVIDENCE 'test-results')" 1> (Join-Path $env:NATIVE_RELAY_RUN_EVIDENCE 'stdout.log') 2> (Join-Path $env:NATIVE_RELAY_RUN_EVIDENCE 'stderr.log')
exit $LASTEXITCODE
'@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $started = [DateTime]::UtcNow.ToString('o')
  & $env:NATIVE_RELAY_PWSH -NoProfile -NonInteractive -File tests/e2e-native-relay/run-medium.ps1 -EncodedCommand $encoded -TimeoutSeconds 120
  $mutation.test_exit = $LASTEXITCODE
  [ordered]@{ argv = @($env:NATIVE_RELAY_PWSH, '-NoProfile', '-NonInteractive', '-File', 'tests/e2e-native-relay/run-medium.ps1', '-EncodedCommand', $encoded, '-TimeoutSeconds', '120'); cwd = $root; started_at = $started; finished_at = [DateTime]::UtcNow.ToString('o'); exit = $mutation.test_exit } | ConvertTo-Json | Set-Content (Join-Path $evidence 'test-command.json')
  $mutation.test_exit | Set-Content (Join-Path $evidence 'exit.txt')
  [Console]::Out.Write([IO.File]::ReadAllText((Join-Path $evidence 'stdout.log')))
  [Console]::Error.Write([IO.File]::ReadAllText((Join-Path $evidence 'stderr.log')))
  if ($mutation.test_exit -ne 1) { throw 'The same original denial assertion must fail in the download control' }
  & mise exec -- aube node tests/e2e-native-relay/download-report.mjs (Join-Path $evidence 'report.json') (Join-Path $evidence 'expected.json') 1> (Join-Path $evidence 'validation.stdout.log') 2> (Join-Path $evidence 'validation.stderr.log')
  if ($LASTEXITCODE -ne 0) { throw 'Download control evidence rejected; retain the original failure and cleanup evidence' }
  $mutation.accepted = $true
} catch { $primary = $_.Exception.Message; $mutation.accepted = $false }
finally {
  $env:NATIVE_RELAY_EXE = $previousExecutable
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = $previousJson
  $env:NATIVE_RELAY_RUN_EVIDENCE = $previousEvidence
  try {
    $after = OriginalIdentity
    $after | ConvertTo-Json | Set-Content (Join-Path $evidence 'original-after.json')
    foreach ($key in $before.Keys) { if ($after[$key] -cne $before[$key]) { throw "Original input changed during download control: $key" } }
    if ((Hash $prepared.preserved_executable) -cne $before.executable_sha256 -or (Hash $prepared.helper_executable) -cne $prepared.helper_executable_sha256) { throw 'Preserved original/helper EXE changed during control' }
  } catch { $cleanup.Add($_.Exception.Message); $mutation.accepted = $false }
  $mutation.primary = $primary
  $mutation.cleanup = $cleanup.ToArray()
  $mutation | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'mutation.json')
}
if ($null -ne $primary) { throw $primary }
if ($cleanup.Count -ne 0) { throw ($cleanup -join '; ') }
exit 0
