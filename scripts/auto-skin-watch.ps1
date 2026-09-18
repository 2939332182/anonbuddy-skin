[CmdletBinding()]
param(
  [int]$Port = 9333,
  # Leave empty to auto-discover (recommended). Override only if discovery fails,
  # or set the WORKBUDDY_EXE environment variable.
  [string]$WorkBuddyExe = "",
  # "last" = restore whatever theme the user last picked in the in-app menu (custom uploads
  # included). Pass a concrete id (e.g. miku-488137) to force one. Keep this file ASCII-only.
  [string]$Theme = "last",
  [string]$ProcessName = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Log = Join-Path $Root "apply-result.log"
$Cli = Join-Path $Root "src\cli.mjs"

# Shared cross-machine discovery (see workbuddy-path.ps1)
. (Join-Path $PSScriptRoot "workbuddy-path.ps1")

if (-not $WorkBuddyExe) { $WorkBuddyExe = Find-WorkBuddyExe }
if (-not $ProcessName) { $ProcessName = Get-WorkBuddyProcessName -ExePath $WorkBuddyExe }
$Node = Find-NodeExe

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $Log -Value $line
}

function Get-WorkBuddyProcesses {
  @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
}

function Test-CDP([int]$P) {
  try {
    $targets = Invoke-RestMethod "http://127.0.0.1:$P/json/list" -TimeoutSec 2
    return [bool]($targets | Where-Object {
      $_.type -eq "page" -and $_.url -like "*renderer/index.html*"
    })
  } catch {
    return $false
  }
}

function Get-SkinStatus {
  if (-not (Test-Path -LiteralPath $Node)) { return $null }
  try {
    $raw = & $Node $Cli "status" "--port" "$Port" 2>$null | Out-String
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) { return $null }
    return @($raw | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Apply-Skin {
  Write-Log "Applying theme $Theme on port $Port"
  $output = & $Node $Cli "apply" "--port" "$Port" "--theme" $Theme 2>&1 | Out-String
  Write-Log $output.Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "theme injection failed with exit code $LASTEXITCODE"
  }
}

function Wait-CDP([int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-CDP $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# Stop WorkBuddy safely. The ROOT process is stopped first, on purpose:
# killing renderers while the main process survives leaves a half-dead window
# (that is exactly what crashed WorkBuddy before). If the root cannot be stopped,
# we abort immediately and leave every other process untouched.
function Stop-WorkBuddy {
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='$ProcessName.exe'" -ErrorAction SilentlyContinue)
  if ($procs.Count -eq 0) { return $true }

  $ids = @($procs | ForEach-Object { $_.ProcessId })
  $roots = @($procs | Where-Object { $ids -notcontains $_.ParentProcessId })
  foreach ($root in $roots) {
    try {
      Stop-Process -Id $root.ProcessId -Force -ErrorAction Stop
      Write-Log "Stopped main process $($root.ProcessId)"
    } catch {
      Write-Log "CANNOT stop main process $($root.ProcessId): $($_.Exception.Message)"
      Write-Log "Aborting takeover - no other process was touched."
      return $false
    }
  }

  foreach ($p in $procs) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
  }

  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    if ((Get-WorkBuddyProcesses).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  }
  Write-Log "WARNING: some WorkBuddy processes survived the stop attempt"
  return $false
}

function Start-DebugWorkBuddy {
  if (-not (Test-Path -LiteralPath $WorkBuddyExe)) {
    Write-Log "ERROR: WorkBuddy.exe not found: $WorkBuddyExe"
    return $false
  }

  if ((Get-WorkBuddyProcesses).Count -gt 0) {
    Write-Log "Stopping normal WorkBuddy process before debug relaunch"
    if (-not (Stop-WorkBuddy)) { return $false }
    Start-Sleep -Seconds 3
  }

  Write-Log "Starting WorkBuddy with CDP port $Port"
  Start-Process -FilePath $WorkBuddyExe -ArgumentList "--remote-debugging-port=$Port"
  if (-not (Wait-CDP)) {
    Write-Log "ERROR: renderer did not become ready within 90 seconds"
    return $false
  }
  Write-Log "renderer ready"
  Apply-Skin
  return $true
}

# Only guarantees that the skin is injected -- it does NOT force a specific theme.
# NOTE: this check used to require "themeId -eq $Theme", which meant any manual theme
# switch was forcibly reverted to the default theme within 5 seconds. Now the skin only
# needs to be present, so the user keeps full control over which theme is active.
# The default $Theme is "last": after a WorkBuddy restart the theme the user last picked
# in the in-app menu is restored (custom uploads included), instead of resetting to Miku.
# (Keep this file ASCII-only: PowerShell 5.1 misreads BOM-less UTF-8 and breaks parsing.)
function Ensure-Skin {
  if (-not (Test-CDP $Port)) { return $false }
  $status = Get-SkinStatus
  $active = @($status | Where-Object {
    $_.installed -eq $true -and $_.menu -eq $true
  })
  if ($active.Count -eq 0) {
    Apply-Skin
  }
  return $true
}

if (-not $Node) {
  Write-Log "ERROR: node not found (install Node.js 20+ or add it to PATH)"
  exit 1
}

Write-Log "=== AUTO SKIN WATCH START (theme=$Theme, port=$Port) ==="
Write-Log "exe=$WorkBuddyExe proc=$ProcessName node=$Node"
$knownPids = @()
$cooldownUntil = [DateTime]::MinValue

while ($true) {
  try {
    $processes = Get-WorkBuddyProcesses
    $pids = @($processes | ForEach-Object { $_.Id })

    if ($pids.Count -eq 0) {
      $knownPids = @()
      Start-Sleep -Seconds 2
      continue
    }

    $newPids = @($pids | Where-Object { $knownPids -notcontains $_ })
    if ($newPids.Count -gt 0) {
      Write-Log "Detected WorkBuddy process start: $($newPids -join ",")"
      # Remember these PIDs BEFORE the takeover attempt. Otherwise a failed attempt
      # re-detects the very same processes as "new" every 5 seconds, forever.
      $knownPids = @($pids)
      Start-Sleep -Seconds 5
      if (Test-CDP $Port) {
        Ensure-Skin | Out-Null
      } elseif ((Get-Date) -lt $cooldownUntil) {
        Write-Log "In cooldown until $cooldownUntil - leaving WorkBuddy untouched"
      } elseif (-not (Start-DebugWorkBuddy)) {
        $cooldownUntil = (Get-Date).AddMinutes(10)
        Write-Log "Takeover failed; backing off for 10 minutes"
      }
    } elseif (Test-CDP $Port) {
      Ensure-Skin | Out-Null
    }
  } catch {
    Write-Log "ERROR: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 5
}
