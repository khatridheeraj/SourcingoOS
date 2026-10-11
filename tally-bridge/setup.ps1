# One-line install of the Sourcingo Tally reader, copied from Tally > Setup in Sourcingo OS:
#   $env:SOURCINGO_SYNC_KEY='...'; irm https://<app>/tally-reader/setup.ps1 | iex
# Downloads the reader into %LOCALAPPDATA%\SourcingoTallyReader, saves the key, then runs install-windows.ps1.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$base = if ($env:SOURCINGO_URL) { $env:SOURCINGO_URL.TrimEnd("/") } else { "https://sourcingo-os.vercel.app" }
$dir = Join-Path $env:LOCALAPPDATA "SourcingoTallyReader"
New-Item -ItemType Directory -Force -Path (Join-Path $dir "lib") | Out-Null
Write-Host "Downloading the Sourcingo Tally reader to $dir ..."
foreach ($f in @("sync.mjs", "lib/sync.mjs", "lib/xml.mjs", "install-windows.ps1", "config.example.json", "package.json", "README.md")) {
  Invoke-WebRequest -Uri "$base/tally-reader/$f" -OutFile (Join-Path $dir $f) -UseBasicParsing
}
if ($env:SOURCINGO_SYNC_KEY) {
  $cfg = Get-Content (Join-Path $dir "config.example.json") -Raw | ConvertFrom-Json
  $cfg.syncKey = $env:SOURCINGO_SYNC_KEY.Trim()
  [IO.File]::WriteAllText((Join-Path $dir "config.json"), ($cfg | ConvertTo-Json))
}
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir "install-windows.ps1")
