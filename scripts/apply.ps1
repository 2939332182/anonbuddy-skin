<#
.SYNOPSIS
  AnonBuddy Skin - Windows apply
.DESCRIPTION
  Restart WorkBuddy with CDP enabled and apply the skin.
.PARAMETER Port
  CDP port. Default 9333.
.PARAMETER WorkBuddyExe
  Explicit WorkBuddy.exe path (skips auto-detection).
.PARAMETER Theme
  Theme id to apply. Defaults to "last" = restore whatever theme the user last
  picked in the in-app menu (custom uploads included).
.EXAMPLE
  .\apply.ps1
  .\apply.ps1 -Theme chunzhi-night
  .\apply.ps1 -WorkBuddyExe "D:\apps\WorkBuddy\WorkBuddy.exe"
#>
[CmdletBinding()]
param(
  [int]$Port = 9333,
  [string]$WorkBuddyExe,
  [string]$Theme
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

# Shared resolver: explicit override -> WORKBUDDY_EXE -> well-known roots -> registry -> Start Menu.
# This block used to be a private copy that only read the registry InstallLocation value and
# only ever tried "WorkBuddy.exe". On a machine installed as WorkBuddyAI.exe with an empty
# InstallLocation it returned nothing, so apply.ps1 exited 1 -- while find-workbuddy.ps1,
# which carried the same weak copy, told the user "(not found)" for the same reason.
# scripts/workbuddy-path.ps1 also reads DisplayIcon and UninstallString, so one
# implementation keeps every launcher in sync (they can no longer drift apart).
. (Join-Path $PSScriptRoot 'workbuddy-path.ps1')

function Test-CDP([int]$P) {
  try {
    $r = Invoke-RestMethod "http://127.0.0.1:$P/json/list" -TimeoutSec 1
    return [bool]($r | Where-Object { $_.type -eq 'page' -and $_.url -like '*renderer/index.html*' })
  } catch { return $false }
}

$exe = Find-WorkBuddyExe -Extra $WorkBuddyExe
if (-not $exe) {
  Write-Error "WorkBuddy.exe not found. Pass -WorkBuddyExe or set $env:WORKBUDDY_EXE."
  exit 1
}
$node = Find-NodeExe
if (-not $node) {
  Write-Error "node not found. Put node on PATH, or use the node bundled with WorkBuddy."
  exit 1
}

Write-Host "WorkBuddy: $exe"
Write-Host "Node:      $node"
Write-Host "Port:      $Port"

if (Test-CDP $Port) {
  Write-Host "CDP already up on port $Port - skipping restart"
} else {
  Write-Host "Closing WorkBuddy..."
  Get-Process WorkBuddy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Write-Host "Starting WorkBuddy with CDP on port $Port ..."
  Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$Port"
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-CDP $Port)) {
    if ((Get-Date) -ge $deadline) { Write-Error "CDP not ready within 30s"; exit 1 }
    Start-Sleep -Milliseconds 400
  }
  Write-Host "CDP ready"
}

Write-Host "Applying skin..."
$cli = Join-Path $Root 'src/cli.mjs'
if (-not $Theme) { $Theme = 'last' }
& $node $cli 'apply' '--port' "$Port" '--theme' $Theme
