<#
.SYNOPSIS
  WorkBuddy Skin Studio - Windows pause
.DESCRIPTION
  Remove the skin and go back to the native UI (no restart).
.PARAMETER Port
  CDP port. Default 9333.
#>
[CmdletBinding()]
param([int]$Port = 9333)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

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

$node = Find-Node
if (-not $node) { Write-Error "node not found."; exit 1 }
& $node (Join-Path $Root 'src/cli.mjs') pause --port $Port
