[CmdletBinding()]
param(
  [int]$Port = 9333,
  # Leave empty to auto-discover (recommended). Override only if discovery fails,
  # or set the WORKBUDDY_EXE environment variable.
  [string]$WorkBuddyExe = "",
  # "last" = restore the theme the user last picked in the in-app menu (custom uploads
  # included). Pass a concrete id (e.g. miku-488137) to force one.
  [string]$Theme = "last",
  [string]$ProcessName = ""
)

# NOTE: keep this file ASCII-only. PowerShell 5.1 misreads BOM-less UTF-8
# and would fail to parse Chinese characters.

$Root = Split-Path -Parent $PSScriptRoot
$Log = Join-Path $Root "restart-skin.log"
$Cli = Join-Path $Root "src\cli.mjs"

# Shared cross-machine discovery (see workbuddy-path.ps1)
. (Join-Path $PSScriptRoot "workbuddy-path.ps1")

if (-not $WorkBuddyExe) { $WorkBuddyExe = Find-WorkBuddyExe }
if (-not $ProcessName) { $ProcessName = Get-WorkBuddyProcessName -ExePath $WorkBuddyExe }
$Node = Find-NodeExe

function Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $Log -Value $line
}

function Get-Procs { @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) }

Log "=== RESTART+SKIN START ==="
Log ("exe={0} proc={1} theme={2} port={3}" -f $WorkBuddyExe, $ProcessName, $Theme, $Port)

if (-not $WorkBuddyExe -or -not (Test-Path -LiteralPath $WorkBuddyExe)) {
  Log "ERROR: WorkBuddy.exe not found. Set WORKBUDDY_EXE or pass -WorkBuddyExe."
  Log ("checked: " + ((Get-WorkBuddyCandidates) -join " | "))
  exit 1
}
if (-not $Node -or -not (Test-Path -LiteralPath $Node)) {
  Log "ERROR: node not found (install Node.js 20+ or add it to PATH)"
  exit 1
}

$procs = Get-Procs
if ($procs.Count -gt 0) {
  Log ("stopping {0} process(es)" -f $procs.Count)
  $ids = @($procs | ForEach-Object { $_.Id })
  $cim = @(Get-CimInstance Win32_Process -Filter "Name='$ProcessName.exe'" -ErrorAction SilentlyContinue)
  $roots = @($cim | Where-Object { $ids -notcontains $_.ParentProcessId })
  foreach ($r in $roots) {
    try {
      Stop-Process -Id $r.ProcessId -Force -ErrorAction Stop
      Log ("stopped root {0}" -f $r.ProcessId)
    } catch {
      Log ("FAILED to stop root {0}: {1}" -f $r.ProcessId, $_.Exception.Message)
    }
  }
  foreach ($p in $cim) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
  }
  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline -and (Get-Procs).Count -gt 0) { Start-Sleep -Milliseconds 500 }
  Log ("remaining after stop: {0}" -f (Get-Procs).Count)
} else {
  Log "no running WorkBuddy process"
}

Start-Sleep -Seconds 3

Log ("launching with --remote-debugging-port={0}" -f $Port)
Start-Process -FilePath $WorkBuddyExe -ArgumentList "--remote-debugging-port=$Port"

$ok = $false
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
  try {
    $targets = Invoke-RestMethod "http://127.0.0.1:$Port/json/list" -TimeoutSec 3
    $hit = @($targets | Where-Object { $_.type -eq "page" -and $_.url -like "*renderer/index.html*" })
    if ($hit.Count -gt 0) { $ok = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 800
}
Log ("CDP ready: {0}" -f $ok)

if ($ok -and (Test-Path -LiteralPath $Node)) {
  $output = & $Node $Cli "apply" "--port" "$Port" "--theme" $Theme 2>&1 | Out-String
  Log ("apply exit={0}" -f $LASTEXITCODE)
  Log $output.Trim()
} else {
  Log ("skip inject (cdp={0}, node={1})" -f $ok, (Test-Path -LiteralPath $Node))
}

try {
  Start-ScheduledTask -TaskName "WorkBuddy Skin Auto" -ErrorAction Stop
  Log "watcher task started"
} catch {
  Log ("failed to start watcher task: {0}" -f $_.Exception.Message)
}

Log "=== RESTART+SKIN END ==="
