param(
  [int]$Port = 9333,
  # Leave empty to auto-discover (recommended). Override only if discovery fails,
  # or set the WORKBUDDY_EXE environment variable.
  [string]$WorkBuddyExe = "",
  # "last" = restore the theme the user last picked in the in-app menu (custom uploads included).
  [string]$Theme = "last",
  [string]$ProcessName = ""
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Log = Join-Path $Root 'apply-result.log'

# Shared cross-machine discovery (see workbuddy-path.ps1)
. (Join-Path $PSScriptRoot 'workbuddy-path.ps1')

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -LiteralPath $Log -Value $line
}

Write-Log "=== apply-ai START ==="

# Resolve the app dynamically so a fresh clone works on any machine.
if (-not $WorkBuddyExe) { $WorkBuddyExe = Find-WorkBuddyExe }
if (-not $ProcessName) { $ProcessName = Get-WorkBuddyProcessName -ExePath $WorkBuddyExe }

if (-not $WorkBuddyExe -or -not (Test-Path -LiteralPath $WorkBuddyExe)) {
  Write-Log "ERROR: WorkBuddy.exe not found. Set WORKBUDDY_EXE or pass -WorkBuddyExe."
  Write-Log ("checked: " + ((Get-WorkBuddyCandidates) -join ' | '))
  exit 1
}

Write-Log "exe=$WorkBuddyExe theme=$Theme port=$Port process=$ProcessName"

$node = Find-NodeExe
if (-not $node) { Write-Log "ERROR: node not found"; exit 1 }
Write-Log "node=$node"

function Test-CDP([int]$P) {
  try {
    $r = Invoke-RestMethod "http://127.0.0.1:$P/json/list" -TimeoutSec 2
    return [bool]($r | Where-Object { $_.type -eq 'page' -and $_.url -like '*renderer/index.html*' })
  } catch { return $false }
}

if (Test-CDP $Port) {
  Write-Log "CDP already ready, skip restart"
} else {
  Write-Log "Killing process: $ProcessName"
  Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Write-Log "Relaunch with CDP port $Port"
  Start-Process -FilePath $WorkBuddyExe -ArgumentList "--remote-debugging-port=$Port"
  $deadline = (Get-Date).AddSeconds(40)
  while (-not (Test-CDP $Port)) {
    if ((Get-Date) -ge $deadline) { Write-Log "ERROR: CDP timeout"; exit 1 }
    Start-Sleep -Milliseconds 500
  }
  Write-Log "CDP ready"
}

$cli = Join-Path $Root 'src/cli.mjs'
$applyArgs = @('apply', '--port', "$Port", '--theme', $Theme)
Write-Log "Applying: node $cli $($applyArgs -join ' ')"
$out = & $node $cli @applyArgs 2>&1
Write-Log "apply output: $($out | Out-String)"

Start-Sleep -Seconds 2
$status = & $node $cli status --port "$Port" 2>&1
Write-Log "status: $($status | Out-String)"
Write-Log "=== apply-ai END ==="
