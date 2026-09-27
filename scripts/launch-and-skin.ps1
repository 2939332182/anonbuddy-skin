<#
.SYNOPSIS
  Launch WorkBuddy with CDP enabled and inject the skin -- in one step.
.DESCRIPTION
  The skin lives inside the renderer process, so it vanishes whenever the app
  is (re)started. Double-clicking WorkBuddy.exe normally starts it WITHOUT
  --remote-debugging-port, and then there is no endpoint for the injector to
  attach to -- the app looks unskinned and nothing is broken.

  This script closes that gap: it brings the app up with the CDP port open,
  waits for the renderer, then applies the skin. If an instance is already
  running without the port, it restarts it (that is what the "one click" in
  one-click means); pass -NoRestart to refuse instead.

  Works for both product lines -- the international build ships as
  WorkBuddyAI.exe, the China build as WorkBuddy.exe. Pass -WorkBuddyExe to
  pick one explicitly when both are installed.

.PARAMETER WorkBuddyExe
  Explicit path to the executable. Defaults to auto-discovery.
.PARAMETER Port
  CDP port. Default 9334 (the international edition's launcher uses 9333).
.PARAMETER Theme
  Theme id, or "last" to restore whatever was picked in the in-app menu.
.PARAMETER NoRestart
  If an instance is running without the CDP port, fail instead of restarting it.
.PARAMETER TimeoutSeconds
  How long to wait for the renderer to come up. Default 120.

.EXAMPLE
  .\launch-and-skin.ps1 -WorkBuddyExe "D:\Downloads\WorkBuddy-CN\portable\WorkBuddy.exe"
  .\launch-and-skin.ps1 -WorkBuddyExe "D:\Apps\WorkBuddyAI\WorkBuddyAI.exe" -Port 9333

.NOTE
  Keep this file ASCII-only: PowerShell 5.1 reads BOM-less UTF-8 as the ANSI
  codepage, and non-ASCII characters break parsing. The Chinese prompts live in
  the .bat wrapper, which sets chcp 65001 first.
#>
[CmdletBinding()]
param(
  [string]$WorkBuddyExe = "",
  [int]$Port = 9334,
  [string]$Theme = "last",
  [switch]$NoRestart,
  [switch]$NoWatch,
  [ValidateSet("", "cn", "intl")][string]$Prefer = "",
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

# Shared cross-machine discovery (env override -> well-known roots -> registry).
. (Join-Path $PSScriptRoot 'workbuddy-path.ps1')

function Test-CDP([int]$P) {
  try {
    $targets = Invoke-RestMethod "http://127.0.0.1:$P/json/list" -TimeoutSec 2
    return [bool]($targets | Where-Object {
      $_.type -eq 'page' -and $_.url -like '*renderer/index.html*'
    })
  } catch {
    return $false
  }
}

# NOTE: we deliberately do NOT try to kill WorkBuddy.
#
# Its processes are protected: Stop-Process, taskkill /F and the CIM Terminate
# method all fail with "Access is denied", and even GetOwner() is refused. The
# app ships native/turing-sdk (Tencent Turing Shield), which is the usual source
# of that kind of protection. CloseMainWindow() is not blocked, but the app
# treats WM_CLOSE as "hide to tray" and keeps running (verified: handle stays
# valid, process count unchanged after 20s).
#
# So an instance started WITHOUT --remote-debugging-port can only be stopped by
# the user, through the tray icon's Exit command. The renderer then has to be
# relaunched with the port. That is why the launchers below ship a shortcut that
# always passes the flag: use it and this situation never comes up.

function Wait-CDP([int]$P, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-CDP $P) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# --- 1. resolve the target -------------------------------------------------
# -Prefer picks the product line by executable name, which matters when both
# builds are installed side by side: cn ships WorkBuddy.exe, intl ships
# WorkBuddyAI.exe (see each build's product.json -> win32ExecutableName).
if (-not $WorkBuddyExe -and $Prefer) {
  $wantLeaf = if ($Prefer -eq 'cn') { 'WorkBuddy.exe' } else { 'WorkBuddyAI.exe' }
  $WorkBuddyExe = @(Get-WorkBuddyCandidates) |
    Where-Object { (Split-Path -Leaf $_) -ieq $wantLeaf } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
}
if (-not $WorkBuddyExe) { $WorkBuddyExe = Find-WorkBuddyExe }
if (-not $WorkBuddyExe) {
  Write-Error "WorkBuddy.exe not found. Pass -WorkBuddyExe or set WORKBUDDY_EXE."
  exit 1
}
if (-not (Test-Path -LiteralPath $WorkBuddyExe)) {
  Write-Error "Not found: $WorkBuddyExe"
  exit 1
}
$procName = Get-WorkBuddyProcessName -ExePath $WorkBuddyExe
Write-Host "WorkBuddy : $WorkBuddyExe"
Write-Host "Process   : $procName.exe"
Write-Host "CDP port  : $Port"

$node = Find-NodeExe
if (-not $node) {
  Write-Error "node not found. Install Node.js 20+, or start WorkBuddy once so it unpacks its bundled copy."
  exit 1
}

# --- 2. make sure it is up WITH the CDP port ------------------------------
if (Test-CDP $Port) {
  Write-Host "CDP already up on $Port - injecting into the running instance."
} else {
  $running = @(Get-Process -Name $procName -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    # We cannot terminate it ourselves (see the note above), so ask the user and wait
    # instead of failing outright.
    Write-Host ""
    Write-Host "  $procName.exe is running WITHOUT --remote-debugging-port=$Port,"
    Write-Host "  so there is no endpoint for the skin to attach to."
    Write-Host ""
    Write-Host "  Please quit it: right-click the WorkBuddy tray icon -> Exit."
    Write-Host "  (Clicking the window's X only hides it to the tray.)"
    Write-Host ""
    if ($NoRestart) {
      Write-Error "Refusing to wait because -NoRestart was passed."
      exit 1
    }
    Write-Host "  Waiting up to ${TimeoutSeconds}s for it to exit..."
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      if (@(Get-Process -Name $procName -ErrorAction SilentlyContinue).Count -eq 0) { break }
      Start-Sleep -Milliseconds 800
    }
    if (@(Get-Process -Name $procName -ErrorAction SilentlyContinue).Count -gt 0) {
      Write-Error "Still running after ${TimeoutSeconds}s. Nothing was touched - re-run this script once it is closed."
      exit 1
    }
    Write-Host "  It exited. Continuing."
  }

  Write-Host "Starting $procName.exe with --remote-debugging-port=$Port ..."
  Start-Process -FilePath $WorkBuddyExe -ArgumentList "--remote-debugging-port=$Port"
  if (-not (Wait-CDP -P $Port -Seconds $TimeoutSeconds)) {
    Write-Error "Renderer did not become ready within ${TimeoutSeconds}s. The app may still be starting - retry apply later."
    exit 1
  }
  Write-Host "Renderer ready."
}

# --- 3. inject ------------------------------------------------------------
$cli = Join-Path $Root 'src\cli.mjs'
Write-Host "Applying theme '$Theme' ..."
& $node $cli 'apply' '--port' "$Port" '--theme' $Theme
if ($LASTEXITCODE -ne 0) {
  Write-Error "Injection failed with exit code $LASTEXITCODE"
  exit 1
}
Write-Host "Done. Look for the floating button in the top-right corner of WorkBuddy."

# --- 4. watch for windows opened later ------------------------------------
# WorkBuddy 5.6.x opens Settings as its OWN renderer window, created after we
# injected. That new window starts unskinned, and the settings entry would never
# appear there. watch-targets.mjs polls CDP and re-injects when a new renderer
# shows up. Small cost (one background Node process, ~40 MB) - pass -NoWatch to
# skip it.
if (-not $NoWatch) {
  $watchScript = Join-Path $PSScriptRoot 'watch-targets.mjs'
  if (Test-Path -LiteralPath $watchScript) {
    $already = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -like '*watch-targets.mjs*' -and $_.CommandLine -like "*$Port*" })
    if ($already.Count -gt 0) {
      Write-Host "Watcher already running for port $Port."
    } else {
      Start-Process -FilePath $node -ArgumentList $watchScript, "$Port" -WindowStyle Hidden
      Write-Host "Watcher started: windows opened later get the skin automatically."
    }
  }
}
