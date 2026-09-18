# WorkBuddy discovery helpers - shared by all scripts in this folder.
# Dot-source it:  . (Join-Path $PSScriptRoot 'workbuddy-path.ps1')
#
# Why this exists: the repo used to hardcode "E:\workbuudy\WorkBuddyAI\WorkBuddyAI.exe",
# which breaks on every other machine. Everything here resolves dynamically instead,
# so a fresh clone works without editing any file.
#
# Resolution order for the app EXE:
#   1. $env:WORKBUDDY_EXE            (explicit override, wins over everything)
#   2. $WorkBuddyExe passed in by the caller (if non-empty)
#   3. Common install locations (per-user, machine-wide, scoop, portable)
#   4. Registry uninstall entries / Start Menu shortcuts
# NOTE: keep this file pure ASCII - PowerShell 5.1 may read non-BOM UTF-8 as GBK.

function Get-WorkBuddyCandidates {
  [CmdletBinding()]
  param([string]$Extra)

  $list = New-Object System.Collections.Generic.List[string]
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'

  function Add-Cand([string]$p) {
    if ([string]::IsNullOrWhiteSpace($p)) { return }
    if ($seen.Add($p)) { $list.Add($p) | Out-Null }
  }

  # 1. explicit override
  Add-Cand $Extra
  Add-Cand $env:WORKBUDDY_EXE

  $names = @('WorkBuddy.exe', 'WorkBuddyAI.exe')
  $dirs = New-Object System.Collections.Generic.List[string]

  # 2. well-known roots
  foreach ($v in @('LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData')) {
    $base = [Environment]::GetEnvironmentVariable($v)
    if (-not $base) { continue }
    foreach ($sub in @('workbuddy', 'WorkBuddy', 'Programs\workbuddy', 'Programs\WorkBuddy',
                       'WorkBuddyAI', 'workbuudy\WorkBuddyAI')) {
      $dirs.Add((Join-Path $base $sub)) | Out-Null
    }
  }
  # portable / dev checkouts, next to this repo
  $dirs.Add((Join-Path (Split-Path -Parent $PSScriptRoot) '..\workbuudy\WorkBuddyAI')) | Out-Null

  foreach ($d in $dirs) {
    foreach ($n in $names) { Add-Cand (Join-Path $d $n) }
  }

  # 3. registry uninstall entries
  $regRoots = @(
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($rk in $regRoots) {
    try {
      $items = Get-ItemProperty $rk -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -and $_.DisplayName -like '*WorkBuddy*' }
      foreach ($it in $items) {
        foreach ($key in @('InstallLocation', 'DisplayIcon', 'UninstallString')) {
          $val = $it.$key
          if (-not $val) { continue }
          $val = $val.Trim('"')
          if ($val -match '\.exe') {
            $p = ($val -split ',')[0].Trim('"')
            Add-Cand $p
          } elseif ($val) {
            foreach ($n in $names) { Add-Cand (Join-Path $val $n) }
          }
        }
      }
    } catch { }
  }

  # 4. Start Menu shortcuts
  foreach ($sm in @(
      (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
      (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'))) {
    if (-not (Test-Path -LiteralPath $sm)) { continue }
    try {
      Get-ChildItem -LiteralPath $sm -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '*WorkBuddy*' } |
        ForEach-Object {
          try {
            $sh = New-Object -ComObject WScript.Shell
            $tgt = $sh.CreateShortcut($_.FullName).TargetPath
            Add-Cand $tgt
          } catch { }
        }
    } catch { }
  }

  return $list
}

function Find-WorkBuddyExe {
  [CmdletBinding()]
  param([string]$Extra)

  foreach ($c in (Get-WorkBuddyCandidates -Extra $Extra)) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

function Get-WorkBuddyProcessName {
  [CmdletBinding()]
  param([string]$ExePath)

  if ($ExePath) {
    $n = [System.IO.Path]::GetFileNameWithoutExtension($ExePath)
    if ($n) { return $n }
  }
  return 'WorkBuddy'
}

function Find-NodeExe {
  [CmdletBinding()]
  param()

  $g = Get-Command node -ErrorAction SilentlyContinue
  if ($g) { return $g.Source }
  $roots = @(
    (Join-Path $env:USERPROFILE '.workbuddy-ai\binaries\node\versions'),
    (Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions')
  )
  foreach ($r in $roots) {
    if (-not (Test-Path -LiteralPath $r)) { continue }
    $n = Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | Select-Object -First 1
    if ($n) {
      $exe = Join-Path $n.FullName 'node.exe'
      if (Test-Path -LiteralPath $exe) { return $exe }
    }
  }
  return $null
}

function Find-WorkBuddyAsar {
  [CmdletBinding()]
  param([string]$ExePath)

  if ($env:WORKBUDDY_ASAR -and (Test-Path -LiteralPath $env:WORKBUDDY_ASAR)) {
    return $env:WORKBUDDY_ASAR
  }
  if (-not $ExePath) { $ExePath = Find-WorkBuddyExe }
  if (-not $ExePath) { return $null }
  $res = Join-Path (Split-Path -Parent $ExePath) 'resources\app.asar'
  if (Test-Path -LiteralPath $res) { return $res }
  return $null
}
