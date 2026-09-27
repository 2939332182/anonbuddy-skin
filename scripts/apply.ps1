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

function Find-WorkBuddyExe {
  if ($WorkBuddyExe -and (Test-Path -LiteralPath $WorkBuddyExe)) { return $WorkBuddyExe }
  if ($env:WORKBUDDY_EXE -and (Test-Path -LiteralPath $env:WORKBUDDY_EXE)) { return $env:WORKBUDDY_EXE }
  # Guard every env var: a missing one makes Join-Path throw.
  $candidates = @()
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA 'workbuddy\WorkBuddy.exe')
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\workbuddy\WorkBuddy.exe')
  }
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'WorkBuddy\WorkBuddy.exe') }
  # NOTE: ${env:ProgramFiles(x86)} needs braces -- bare $env:ProgramFiles(x86) is a parse error.
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'WorkBuddy\WorkBuddy.exe') }
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { return $c } }
  # Registry Uninstall entries
  try {
    $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
    $found = $null
    foreach ($k in $keys) {
      if ($found) { break }
      # NOTE: 'return' inside ForEach-Object only ends that iteration, not the function,
      # so the hit has to be collected in a variable instead.
      Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*WorkBuddy*' -and $_.InstallLocation } | ForEach-Object {
        if (-not $found) {
          $p = Join-Path $_.InstallLocation 'WorkBuddy.exe'
          if (Test-Path -LiteralPath $p) { $found = $p }
        }
      }
    }
    if ($found) { return $found }
  } catch {}
  return $null
}

function Find-Node {
  $g = Get-Command node -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  # WorkBuddy bundles node under ~/.workbuddy-ai (current) or ~/.workbuddy (older builds).
  $roots = @(
    (Join-Path $env:USERPROFILE '.workbuddy-ai\binaries\node\versions'),
    (Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions')
  )
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $n = Get-ChildItem $root -Directory |
      Sort-Object Name -Descending |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } |
      Select-Object -First 1
    if ($n) { return (Join-Path $n.FullName 'node.exe') }
  }
  return $null
}

function Test-CDP([int]$P) {
  try {
    $r = Invoke-RestMethod "http://127.0.0.1:$P/json/list" -TimeoutSec 1
    return [bool]($r | Where-Object { $_.type -eq 'page' -and $_.url -like '*renderer/index.html*' })
  } catch { return $false }
}

$exe = Find-WorkBuddyExe
if (-not $exe) {
  Write-Error "WorkBuddy.exe not found. Pass -WorkBuddyExe or set $env:WORKBUDDY_EXE."
  exit 1
}
$node = Find-Node
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
