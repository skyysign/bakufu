<#
  Public test helper (Windows). Opens a temporary HTTPS address for the local
  Docker game through a Cloudflare quick tunnel and switches the two settings
  that must match it. It never prints secrets, never rebuilds or restarts Docker
  and never changes Discord settings; it tells you what to run and paste.

    powershell -ExecutionPolicy Bypass -File scripts\public-test.ps1 -Start
    powershell -ExecutionPolicy Bypass -File scripts\public-test.ps1 -Status
    powershell -ExecutionPolicy Bypass -File scripts\public-test.ps1 -Stop

  Requires .tools\cloudflared.exe (https://github.com/cloudflare/cloudflared/releases).
  See docs/deployment/public-test.md.
#>
param([switch]$Start, [switch]$Stop, [switch]$Status)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$state = Join-Path $root '.test-data\public-test-state.json'
$log = Join-Path $root '.test-data\public-test-tunnel.log'
$cloudflared = Join-Path $root '.tools\cloudflared.exe'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-EnvValue([string]$name) {
  foreach ($line in [System.IO.File]::ReadAllLines($envFile)) {
    if ($line -match "^$name=(.*)$") { return $Matches[1] }
  }
  return $null
}
function Set-EnvValues([hashtable]$values) {
  $lines = [System.Collections.Generic.List[string]]::new([System.IO.File]::ReadAllLines($envFile))
  foreach ($name in $values.Keys) {
    $index = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^$name=") { $index = $i } }
    if ($index -ge 0) { $lines[$index] = "$name=$($values[$name])" } else { $lines.Add("$name=$($values[$name])") }
  }
  # UTF-8 without BOM: Docker Compose reads the first key literally.
  [System.IO.File]::WriteAllText($envFile, ($lines -join "`n") + "`n", $utf8)
}
function Show-Next([string]$origin) {
  Write-Host ''
  Write-Host 'Next steps:' -ForegroundColor Cyan
  Write-Host '  1. Apply the new address to the game (recreates the containers, a few seconds offline):'
  Write-Host '       docker compose up -d --no-build --wait'
  if ($origin) {
    Write-Host '  2. Discord Developer Portal -> your application:'
    Write-Host "       OAuth2 -> Redirects:              $origin/api/auth/discord/callback"
    Write-Host "       General -> Interactions Endpoint: $origin/api/discord/interactions"
    Write-Host "  3. Share $origin with your testers. Keep this window's tunnel running."
  }
}

if (-not (Test-Path $envFile)) { throw '.env not found. Run this from the project folder after the quickstart.' }

if ($Status) {
  if (Test-Path $state) {
    $saved = Get-Content $state -Raw | ConvertFrom-Json
    $running = Get-Process -Id $saved.processId -ErrorAction SilentlyContinue
    Write-Host "Public test address: $($saved.origin)"
    Write-Host ("Tunnel: " + ($(if ($running) { 'running' } else { 'not running (start again for a new address)' })))
  } else { Write-Host 'No public test is active.' }
  Write-Host "APP_ORIGIN in .env: $(Read-EnvValue 'APP_ORIGIN')"
  exit 0
}

if ($Start) {
  if (-not (Test-Path $cloudflared)) { throw "Missing $cloudflared. Download cloudflared-windows-amd64.exe from the cloudflared releases page and save it there as cloudflared.exe." }
  if (Test-Path $state) { throw 'A public test is already active. Run -Stop first (or -Status).' }
  try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/health/ready' -TimeoutSec 5 | Out-Null }
  catch { throw 'The game is not answering on http://localhost:3000. Start Docker first: docker compose up -d --no-build --wait' }
  if (Test-Path $log) { Remove-Item $log -Force }
  $process = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--no-autoupdate', '--url', 'http://localhost:3000', '--logfile', $log) -WindowStyle Minimized -PassThru
  $origin = $null
  for ($i = 0; $i -lt 60 -and -not $origin; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
      $match = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
      if ($match) { $origin = $match.Matches[0].Value }
    }
  }
  if (-not $origin) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "The tunnel did not report an address within 60 seconds. See $log"
  }
  $previous = @{ APP_ORIGIN = Read-EnvValue 'APP_ORIGIN'; COOKIE_SECURE = Read-EnvValue 'COOKIE_SECURE' }
  [System.IO.File]::WriteAllText($state, (@{
        processId = $process.Id; origin = $origin; startedAt = (Get-Date).ToString('o'); previous = $previous
      } | ConvertTo-Json), $utf8)
  Set-EnvValues @{ APP_ORIGIN = $origin; COOKIE_SECURE = 'true' }
  Write-Host "Tunnel running: $origin" -ForegroundColor Green
  Write-Host 'Saved your previous APP_ORIGIN/COOKIE_SECURE; -Stop restores them.'
  Show-Next $origin
  exit 0
}

if ($Stop) {
  if (-not (Test-Path $state)) { Write-Host 'No public test is active.'; exit 0 }
  $saved = Get-Content $state -Raw | ConvertFrom-Json
  Stop-Process -Id $saved.processId -Force -ErrorAction SilentlyContinue
  $restore = @{}
  foreach ($name in 'APP_ORIGIN', 'COOKIE_SECURE') {
    $value = $saved.previous.$name
    $restore[$name] = $(if ($value) { $value } elseif ($name -eq 'APP_ORIGIN') { 'http://localhost:3000' } else { 'false' })
  }
  Set-EnvValues $restore
  Remove-Item $state -Force
  Write-Host "Tunnel stopped; APP_ORIGIN is $($restore.APP_ORIGIN) again." -ForegroundColor Green
  Show-Next $null
  Write-Host '  Discord sign-in keeps working only with a redirect for that address (e.g. http://localhost:3000/api/auth/discord/callback).'
  exit 0
}

Write-Host 'Use -Start, -Status or -Stop. See docs/deployment/public-test.md.'
