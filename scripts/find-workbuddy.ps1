<#
.SYNOPSIS
  AnonBuddy Skin - locate WorkBuddy.exe and node.
.DESCRIPTION
  Prints every candidate path the launcher will try, in order, and marks the
  ones that actually resolve on this machine. Use this to debug
  "apply.ps1 cannot find the app" problems.

  This file used to carry its own copy of the discovery logic, which only read
  the registry InstallLocation value and only ever tried "WorkBuddy.exe". On a
  machine installed as WorkBuddyAI.exe with an empty InstallLocation it printed
  "(not found)" while apply.ps1 worked fine -- a misleading diagnostic. It now
  reuses scripts/workbuddy-path.ps1, so the two can no longer drift apart.

  NOTE: keep this file ASCII-only. PowerShell 5.1 reads BOM-less UTF-8 as the
  ANSI codepage, and non-ASCII characters break parsing.
#>
$ErrorActionPreference = 'Continue'

# Shared resolver: env override -> well-known roots -> registry -> Start Menu.
. (Join-Path $PSScriptRoot 'workbuddy-path.ps1')

$candidates = @(Get-WorkBuddyCandidates)
$exe = Find-WorkBuddyExe
$node = Find-NodeExe

Write-Host '=== AnonBuddy Skin probe ==='
Write-Host "WorkBuddy.exe: $(if ($exe) { $exe } else { '(not found)' })"
Write-Host "node:          $(if ($node) { $node } else { '(not found)' })"

Write-Host ''
Write-Host "candidates tried ($($candidates.Count)), first hit wins:"
$hits = 0
foreach ($c in $candidates) {
  $ok = Test-Path -LiteralPath $c
  if ($ok) { $hits++ }
  $mark = if ($ok) { 'x' } else { ' ' }
  Write-Host ("  [{0}] {1}" -f $mark, $c)
}
if ($hits -gt 1) {
  Write-Host ''
  Write-Host 'NOTE: several candidates exist on disk; the first one listed above is the one used.'
}

if (-not $exe) {
  Write-Host ''
  Write-Host 'WorkBuddy.exe not found. Specify it in one of these ways:'
  Write-Host "  1. Set the env var: `$env:WORKBUDDY_EXE = 'C:\path\to\WorkBuddyAI.exe'"
  Write-Host "  2. Pass it to apply.ps1: .\apply.ps1 -WorkBuddyExe 'C:\path\to\WorkBuddyAI.exe'"
  Write-Host '  3. Reinstall WorkBuddy so its uninstall entry points at the current location.'
}
if (-not $node) {
  Write-Host ''
  Write-Host 'node not found. Install node.js, or check the node bundled with WorkBuddy.'
}
