<#
.SYNOPSIS
  Bind every WorkBuddy launch entry to the silent skinned launcher.

.DESCRIPTION
  The skin is injected into the renderer process, so it only appears when the
  app was started WITH --remote-debugging-port. A plain shortcut, the Start Menu
  entry and the auto-start registry value all launch the bare executable, which
  is why the skin "disappears" after a reboot or a normal double-click.

  This script rewrites exactly those entries so they go through
  scripts/autoskin-launch.vbs: start with the CDP port, wait for the renderer,
  inject, exit. No console window, and nothing left running afterwards.

  Only entries whose target is the SAME executable are touched, so on a machine
  with both the international build (WorkBuddyAI.exe) and the China build
  (WorkBuddy.exe) each one keeps its own port and they do not fight.

  Every change is backed up first, and -Undo restores the originals.

  If WorkBuddy is currently running, quit it from the tray (right-click the tray
  icon -> Exit) and start it again through the shortcut. Closing the window only
  hides it, and the process is protected, so no script can stop it for you.

.PARAMETER WorkBuddyExe
  Which build to bind. Defaults to auto-discovery.
.PARAMETER Port
  CDP port to bake into the entries. Default 9334; use 9333 for the
  international build if that is what its shortcuts already use.
.PARAMETER Undo
  Restore every entry from the backup taken at install time.
.PARAMETER ListOnly
  Show what would change, change nothing.

.EXAMPLE
  .\setup-autoskin.ps1 -ListOnly
  .\setup-autoskin.ps1 -WorkBuddyExe "D:\Downloads\WorkBuddy-CN\portable\WorkBuddy.exe" -Port 9334
  .\setup-autoskin.ps1 -Undo

.NOTE
  Keep this file ASCII-only: PowerShell 5.1 reads BOM-less UTF-8 as the ANSI
  codepage, and non-ASCII characters break parsing.
#>
[CmdletBinding()]
param(
  [string]$WorkBuddyExe = "",
  [int]$Port = 0,
  # Which product line to bind. cn => WorkBuddy.exe, intl => WorkBuddyAI.exe.
  # Also picks the default port (cn 9334 / intl 9333) when -Port is omitted.
  [ValidateSet("", "cn", "intl")][string]$Prefer = "",
  [switch]$Undo,
  [switch]$ListOnly
)

$ErrorActionPreference = 'Stop'

# Resolve the default port from -Prefer before anything else uses it.
if ($Port -le 0) {
  $Port = switch ($Prefer) {
    'intl' { 9333 }
    'cn' { 9334 }
    default { 9334 }
  }
}
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Vbs = Join-Path $PSScriptRoot 'autoskin-launch.vbs'
$WScript = Join-Path $env:SystemRoot 'System32\wscript.exe'

$StateDir = Join-Path $env:LOCALAPPDATA 'AnonBuddySkin'
$StatePath = Join-Path $StateDir 'autoskin-setup.json'
$BackupDir = Join-Path $StateDir 'autoskin-backup'

. (Join-Path $PSScriptRoot 'workbuddy-path.ps1')

$RunKeys = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
)

$ShortcutDirs = @(
  [Environment]::GetFolderPath('Desktop'),
  "$env:PUBLIC\Desktop",
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

# --- helpers ---------------------------------------------------------------

function Get-LaunchEntries {
  param([string]$ExePath)

  $shell = New-Object -ComObject WScript.Shell
  $found = New-Object System.Collections.Generic.List[object]

  foreach ($dir in $ShortcutDirs) {
    Get-ChildItem -LiteralPath $dir -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '(?i)workbuddy' } |
      ForEach-Object {
        try {
          $sc = $shell.CreateShortcut($_.FullName)
          # Two shapes count as "points at this executable":
          #   1. a plain shortcut aimed straight at the exe (never bound yet);
          #   2. one ALREADY bound to the silent launcher and carrying this exe in
          #      its arguments. Without case 2 a bound shortcut can never be touched
          #      again -- its TargetPath is wscript.exe, not the app -- so an
          #      outdated argument format would stay outdated forever.
          $boundToThisExe = $sc.TargetPath -ieq $WScript -and $sc.Arguments -like '*autoskin-launch.vbs*' -and $sc.Arguments -like "*$ExePath*"
          if ($sc.TargetPath -and ($sc.TargetPath -ieq $ExePath -or $boundToThisExe)) {
            $found.Add([pscustomobject]@{
              Kind   = 'Shortcut'
              Where  = $_.FullName
              Target = $sc.TargetPath
              Args   = $sc.Arguments
              Wd     = $sc.WorkingDirectory
            })
          }
        } catch { }
      }
  }

  foreach ($key in $RunKeys) {
    $props = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
    if (-not $props) { continue }
    foreach ($prop in $props.PSObject.Properties) {
      if ($prop.Name -like 'PS*') { continue }
      $value = [string]$prop.Value
      if (-not $value) { continue }
      # match "..." quoted path, or a bare path up to the first space
      $match = [regex]::Match($value, '^\s*"([^"]+)"|^\s*([^\s]+)')
      $exe = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
      if ($exe -and $exe -ieq $ExePath) {
        $found.Add([pscustomobject]@{
          Kind   = 'RunKey'
          Where  = "$key\$($prop.Name)"
          Target = $exe
          Args   = $value
          Wd     = ''
        })
      }
    }
  }

  return $found
}

function Write-StateFile {
  param($Entries, [string]$Exe, [int]$P)
  if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Force -Path $StateDir | Out-Null }

  # One record per executable. Binding the second product line must not erase
  # the rollback info of the first one: rebinding the same exe replaces only
  # that exe's record, every other record is carried over untouched.
  $kept = @()
  $existing = Read-StateFile
  if ($existing) {
    $kept = @($existing.installs | Where-Object { $_.exe -and ($_.exe -ine $Exe) })
  }

  $record = [pscustomobject]@{
    installedAt = (Get-Date).ToString('s')
    exe         = $Exe
    port        = $P
    vbs         = $Vbs
    entries     = $Entries
  }

  $state = [pscustomobject]@{
    version  = 2
    installs = @($kept) + @($record)
  }
  $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Read-StateFile {
  if (-not (Test-Path -LiteralPath $StatePath)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  } catch {
    Write-Warning "State file is unreadable, ignoring it: $($_.Exception.Message)"
    return $null
  }
  $props = @($raw.PSObject.Properties.Name)
  if ($props -contains 'installs') {
    return [pscustomobject]@{ installs = @($raw.installs) }
  }
  # Legacy layout written before multi-install support: the root object WAS
  # the single install record.
  if ($props -contains 'entries') {
    return [pscustomobject]@{ installs = @($raw) }
  }
  return $null
}

# --- undo ------------------------------------------------------------------

if ($Undo) {
  $state = Read-StateFile
  if (-not $state -or @($state.installs).Count -eq 0) {
    Write-Host "No recorded install found at $StatePath - nothing to undo."
    exit 0
  }
  $shell = New-Object -ComObject WScript.Shell
  $restored = 0

  # Every bound executable carries its own record; undo restores all of them,
  # not just the most recently bound product line.
  $allEntries = @()
  foreach ($install in @($state.installs)) {
    if ($install.exe) { Write-Host "Unbinding $($install.exe) (port $($install.port))" }
    $allEntries += @($install.entries)
  }

  foreach ($entry in $allEntries) {
    try {
      if ($entry.Kind -eq 'Shortcut') {
        $backup = Join-Path $BackupDir ([IO.Path]::GetFileName($entry.Where))
        if (Test-Path -LiteralPath $backup) {
          Copy-Item -LiteralPath $backup -Destination $entry.Where -Force
          $restored++
          Write-Host "  restored shortcut : $($entry.Where)"
        } else {
          Write-Warning "  backup missing for $($entry.Where)"
        }
      } elseif ($entry.Kind -eq 'RunKey') {
        $split = $entry.Where -split '\\'
        $name = $split[-1]
        $key = ($split[0..($split.Count - 2)] -join '\')
        Set-ItemProperty -Path $key -Name $name -Value $entry.Args -ErrorAction Stop
        $restored++
        Write-Host "  restored Run value: $($entry.Where)"
      }
    } catch {
      Write-Warning "  could not restore $($entry.Where): $($_.Exception.Message)"
    }
  }
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "Undo complete. $restored entries restored."
  exit 0
}

# --- install ---------------------------------------------------------------

if (-not $WorkBuddyExe -and $Prefer) {
  $wantLeaf = if ($Prefer -eq 'cn') { 'WorkBuddy.exe' } else { 'WorkBuddyAI.exe' }
  $WorkBuddyExe = @(Get-WorkBuddyCandidates) |
    Where-Object { (Split-Path -Leaf $_) -ieq $wantLeaf } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
}
if (-not $WorkBuddyExe) { $WorkBuddyExe = Find-WorkBuddyExe }
if (-not $WorkBuddyExe) {
  Write-Error "WorkBuddy.exe not found. Pass -WorkBuddyExe."
  exit 1
}
if (-not (Test-Path -LiteralPath $WorkBuddyExe)) { Write-Error "Not found: $WorkBuddyExe"; exit 1 }
if (-not (Test-Path -LiteralPath $Vbs)) { Write-Error "Launcher missing: $Vbs"; exit 1 }

$exeDir = Split-Path -Parent $WorkBuddyExe

Write-Host "Target executable : $WorkBuddyExe"
Write-Host "CDP port          : $Port"
Write-Host "Silent launcher   : $Vbs"
Write-Host ""

$entries = Get-LaunchEntries -ExePath $WorkBuddyExe
if ($entries.Count -eq 0) {
  Write-Host "No launch entries point at that executable -- nothing to bind."
  Write-Host "Create a shortcut first, or run WorkBuddy once so it registers itself."
  exit 0
}

Write-Host "Found $($entries.Count) entry/entries pointing at it:"
foreach ($e in $entries) {
  $already = if ($e.Args -like "*autoskin-launch.vbs*") { '  [already bound]' } else { '' }
  Write-Host "  $($e.Kind): $($e.Where)$already"
}
Write-Host ""

if ($ListOnly) {
  Write-Host "-ListOnly: nothing was changed."
  exit 0
}

# These arguments go to autoskin-launch.vbs, which forwards them **verbatim** to
# launch-and-skin.mjs -- and that script only understands double-dash options.
# Writing -WorkBuddyExe / -Port here used to break the whole double-click chain
# silently: the launcher threw "unrecognized argument" inside a hidden window,
# so the shortcut just looked dead (China build "would not open").
$vbsArgs = "--exe `"$WorkBuddyExe`" --port $Port"
$newValue = "`"$WScript`" `"$Vbs`" $vbsArgs"

if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }

$shell = New-Object -ComObject WScript.Shell
$changed = New-Object System.Collections.Generic.List[object]

foreach ($entry in $entries) {
  # Only skip entries already bound **in the current argument format**. An entry
  # bound with the older single-dash spelling (-WorkBuddyExe / -Port) has to be
  # rewritten: the launcher tolerates that spelling only as a compatibility alias,
  # but shortcuts we generate ourselves should carry the canonical form.
  $bound = $entry.Args -like '*autoskin-launch.vbs*'
  $currentFormat = ($entry.Args -like '*--exe*') -and ($entry.Args -like '*--port*')
  if ($bound -and $currentFormat) {
    Write-Host "  skip (already bound): $($entry.Where)"
    continue
  }

  if ($entry.Kind -eq 'Shortcut') {
    $backup = Join-Path $BackupDir ([IO.Path]::GetFileName($entry.Where))
    if (-not (Test-Path -LiteralPath $backup)) {
      Copy-Item -LiteralPath $entry.Where -Destination $backup -Force
    }
    $sc = $shell.CreateShortcut($entry.Where)
    $sc.TargetPath = $WScript
    $sc.Arguments = "`"$Vbs`" $vbsArgs"
    $sc.WorkingDirectory = $exeDir
    $sc.IconLocation = "$WorkBuddyExe,0"
    $sc.Save()
    $changed.Add($entry)
    Write-Host "  bound shortcut: $($entry.Where)"
  } elseif ($entry.Kind -eq 'RunKey') {
    $split = $entry.Where -split '\\'
    $name = $split[-1]
    $key = ($split[0..($split.Count - 2)] -join '\')
    Set-ItemProperty -Path $key -Name $name -Value $newValue -ErrorAction Stop
    $changed.Add($entry)
    Write-Host "  bound Run value: $($entry.Where)"
  }
}

if ($changed.Count -gt 0) {
  Write-StateFile -Entries $entries -Exe $WorkBuddyExe -P $Port
  Write-Host ""
  Write-Host "Done. $($changed.Count) entry/entries now start WorkBuddy through the silent launcher."
  Write-Host "Backups and rollback info: $StateDir"
  Write-Host ""
  Write-Host "If WorkBuddy is running right now, quit it from the tray and start it again"
  Write-Host "through the shortcut; the skin will be there from the first second."
} else {
  Write-Host ""
  Write-Host "Everything was already bound - nothing changed."
}
