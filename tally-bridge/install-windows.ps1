# Installs the Sourcingo Tally reader on the Windows PC that runs TallyPrime. It only reads Tally.
# Run from this folder in PowerShell:  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
# It starts with Windows (at sign-in), runs hidden, and logs to sync.log here.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# 1. Node.js 20 or newer.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Installing Node.js LTS..."
  winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  $node = Get-Command node -ErrorAction Stop
}
$major = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($major -lt 20) { throw "Node.js 20 or newer is needed (found $(& node --version)). Update it from nodejs.org." }

# 2. Settings, with the sync key from the Tally page in Sourcingo OS.
if (-not (Test-Path config.json)) {
  $key = Read-Host "Paste the sync key from Sourcingo OS (Tally page)"
  $cfg = Get-Content config.example.json -Raw | ConvertFrom-Json
  $cfg.syncKey = $key.Trim()
  $cfg | ConvertTo-Json | Set-Content config.json -Encoding UTF8
}

# 3. Check Tally answers on its port before going further.
$cfg = Get-Content config.json -Raw | ConvertFrom-Json
try {
  Invoke-WebRequest -Uri $cfg.tallyUrl -Method Post -Body "<ENVELOPE></ENVELOPE>" -UseBasicParsing -TimeoutSec 10 | Out-Null
  Write-Host "Tally is reachable at $($cfg.tallyUrl)."
} catch {
  Write-Warning "Tally didn't answer at $($cfg.tallyUrl). In TallyPrime: F1 Help > Settings > Connectivity, set 'TallyPrime acts as' to Both and port 9000, then keep Tally open."
}

# 4. One test round, so any problem shows now.
& node sync.mjs --once

# 5. Start at sign-in, hidden.
$vbs = Join-Path $PSScriptRoot "run-hidden.vbs"
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$PSScriptRoot"
sh.Run "node ""$PSScriptRoot\sync.mjs""", 0, False
"@ | Set-Content $vbs -Encoding ASCII
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName "Sourcingo Tally Reader" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "Sourcingo Tally Reader"
Write-Host "Installed. The reader runs whenever this user is signed in. Log: $PSScriptRoot\sync.log"
