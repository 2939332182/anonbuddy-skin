<#
.SYNOPSIS
  AnonBuddy Skin - locate WorkBuddy.exe and node.
.DESCRIPTION
  Prints the auto-detected paths of WorkBuddy.exe and node, to debug
  "apply.ps1 cannot find the app" problems.
  NOTE: keep this file ASCII-only. PowerShell 5.1 reads BOM-less UTF-8 as the
  ANSI codepage, and Chinese characters break parsing.
#>
$ErrorActionPreference = 'Continue'

function Find-WorkBuddyExe {
  if ($env:WORKBUDDY_EXE -and (Test-Path -LiteralPath $env:WORKBUDDY_EXE)) { return $env:WORKBUDDY_EXE }
  # Guard every env var: a missing one makes Join-Path throw.
  $candidates = @()
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA 'workbuddy\WorkBuddy.exe')
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\workbuddy\WorkBuddy.exe')
  }
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'WorkBuddy\WorkBuddy.exe') }
  # ${env:ProgramFiles(x86)} needs braces -- bare $env:ProgramFiles(x86) is a parse error.
  if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'WorkBuddy\WorkBuddy.exe') }
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { return $c } }
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

$exe = Find-WorkBuddyExe
$node = Find-Node
Write-Host "=== AnonBuddy Skin probe ==="
Write-Host "WorkBuddy.exe: $(if ($exe) { $exe } else { '(not found)' })"
Write-Host "node:          $(if ($node) { $node } else { '(not found)' })"
if (-not $exe) {
  Write-Host ""
  Write-Host "WorkBuddy.exe not found. Specify it in one of these ways:"
  Write-Host "  1. Set the env var: `$env:WORKBUDDY_EXE = 'C:\path\to\WorkBuddy.exe'"
  Write-Host "  2. Pass it to apply.ps1: .\apply.ps1 -WorkBuddyExe 'C:\path\to\WorkBuddy.exe'"
}
if (-not $node) {
  Write-Host ""
  Write-Host "node not found. Install node.js, or check the node bundled with WorkBuddy."
}
